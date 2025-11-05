// server.js - Сервер для гри в малювання
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

// Імпортуємо картки завдань з окремого файлу
const WORD_SETS = require('./wordSets.js');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.static('public'));

// Константи гри
const ROUNDS_PER_GAME = 4;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const SCORE_SEQUENCE = [6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1];

// Генерація коду кімнати
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Клас для управління кімнатою
class GameRoom {
  constructor(code, hostId) {
    this.code = code;
    this.hostId = hostId;
    this.players = new Map();
    this.state = 'lobby'; // lobby, playing, round_end, game_end
    this.currentRound = 0;
    this.roundData = null;
    this.drawings = new Map();
    this.guesses = new Map();
    this.scores = new Map();
    this.readyPlayers = new Set();
    this.finishedGuessing = new Set();
    this.blackTokensGiven = [];
    this.drawingLocks = new Map(); // Блокування малюнків
    this.usedWordSetIndices = []; // Зберігаємо індекси використаних наборів для уникнення повторів
    this.isStartingRound = false; // НОВЕ: Захист від race condition
    this.drawingRateLimit = new Map(); // НОВЕ: Rate limiting для малювання
  }

  // НОВЕ: Метод очищення пам'яті
  cleanup() {
    // Очищаємо всі Map та Set структури
    this.players.clear();
    this.drawings.clear();
    this.guesses.clear();
    this.scores.clear();
    this.readyPlayers.clear();
    this.finishedGuessing.clear();
    this.drawingLocks.clear();
    this.drawingRateLimit.clear(); // ВИПРАВЛЕНО: очищаємо rate limits
    
    // Очищаємо масиви
    this.blackTokensGiven = [];
    
    // Обмежуємо usedWordSetIndices максимум 100 записами (достатньо для 25 ігор)
    if (this.usedWordSetIndices.length > 100) {
      // Залишаємо тільки останні 50 записів
      this.usedWordSetIndices = this.usedWordSetIndices.slice(-50);
      console.log(`Trimmed usedWordSetIndices to 50 entries`);
    }
    
    // Очищаємо roundData
    if (this.roundData) {
      this.roundData.assignments?.clear();
      this.roundData.playerScoreSequences?.clear();
      this.roundData = null;
    }
    
    console.log(`Room ${this.code} cleaned up`);
  }

  addPlayer(id, name, socketId) {
    if (this.players.size >= MAX_PLAYERS) return false;
    
    // Якщо гравець вже був у грі (reconnect)
    if (this.players.has(id)) {
      const player = this.players.get(id);
      player.socketId = socketId;
      player.connected = true;
      return true;
    }
    
    // Новий гравець
    this.players.set(id, {
      id,
      name,
      socketId,
      connected: true,
      ready: false
    });
    
    if (!this.scores.has(id)) {
      this.scores.set(id, 0);
    }
    
    return true;
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (player) {
      player.connected = false;
      
      // ВИПРАВЛЕНО: Очищаємо дані відключеного гравця
      this.drawingRateLimit.delete(id);
      this.readyPlayers.delete(id);
      this.finishedGuessing.delete(id);
      this.drawingLocks.delete(id);
      
      // Видаляємо малюнки відключеного гравця для економії пам'яті
      if (this.state === 'playing' && this.drawings.has(id)) {
        const drawingSize = this.drawings.get(id)?.length || 0;
        if (drawingSize > 1000) { // Якщо багато даних
          this.drawings.delete(id);
          console.log(`Cleared ${drawingSize} drawing strokes for disconnected player ${id}`);
        }
      }
    }
  }

  setPlayerReady(id, ready) {
    const player = this.players.get(id);
    if (player) {
      player.ready = ready;
      if (ready) {
        this.readyPlayers.add(id);
      } else {
        this.readyPlayers.delete(id);
      }
    }
  }

  canStartGame() {
    return this.players.size >= MIN_PLAYERS && 
           this.readyPlayers.size === this.players.size;
  }

  startNewRound() {
    // НОВЕ: Захист від race condition
    if (this.isStartingRound) return null;
    this.isStartingRound = true;
    
    try {
      this.currentRound++;

      // ВИПРАВЛЕНО: Повне очищення попередніх даних раунду
      this.finishedGuessing.clear();
      this.drawings.clear();
      this.guesses.clear();
      this.blackTokensGiven = [];
      this.drawingLocks.clear();
      this.drawingRateLimit.clear(); // ВИПРАВЛЕНО: очищаємо rate limits
      
      // ВИПРАВЛЕНО: Видаляємо відключених гравців перед новим раундом
      const disconnectedPlayers = [];
      for (let [playerId, player] of this.players) {
        if (!player.connected) {
          disconnectedPlayers.push(playerId);
        }
      }
      
      disconnectedPlayers.forEach(playerId => {
        this.players.delete(playerId);
        this.scores.delete(playerId);
        console.log(`Removed disconnected player ${playerId} before round ${this.currentRound}`);
      });
      
      // ВИПРАВЛЕНО: Обмежуємо розмір usedWordSetIndices
      if (this.usedWordSetIndices.length > 60) {
        // Залишаємо тільки записи для поточних 4 раундів
        const currentRoundSets = this.usedWordSetIndices.filter(id => {
          const [round] = id.split('-');
          return parseInt(round) >= Math.max(1, this.currentRound - 3);
        });
        this.usedWordSetIndices = currentRoundSets;
        console.log(`Trimmed usedWordSetIndices to ${currentRoundSets.length} recent entries`);
      }
      
      // Отримуємо всі картки для поточного раунду
      const roundWordStrings = WORD_SETS[this.currentRound];
      
      // Якщо для раунду немає карток, використовуємо з 1-го раунду
      if (!roundWordStrings || roundWordStrings.length === 0) {
        console.error(`No word sets for round ${this.currentRound}, using round 1`);
        roundWordStrings = WORD_SETS[1];
      }
      
      // Фільтруємо невикористані картки для цього раунду
      let availableIndices = [];
      for (let i = 0; i < roundWordStrings.length; i++) {
        const setId = `${this.currentRound}-${i}`;
        if (!this.usedWordSetIndices.includes(setId)) {
          availableIndices.push(i);
        }
      }
      
      // Якщо недостатньо невикористаних карток, скидаємо для цього раунду
      if (availableIndices.length < 4) {
        console.log(`Not enough unused sets for round ${this.currentRound}, resetting...`);
        this.usedWordSetIndices = this.usedWordSetIndices.filter(id => !id.startsWith(`${this.currentRound}-`));
        availableIndices = [];
        for (let i = 0; i < roundWordStrings.length; i++) {
          availableIndices.push(i);
        }
      }

      // Вибираємо 4 випадкові картки з доступних
      const selectedIndices = [];
      for (let i = 0; i < 4; i++) {
        const randomIndex = Math.floor(Math.random() * availableIndices.length);
        const selectedIndex = availableIndices[randomIndex];
        selectedIndices.push(selectedIndex);
        availableIndices.splice(randomIndex, 1); // Видаляємо вибраний індекс

        // Запам'ятовуємо використану картку
        const setId = `${this.currentRound}-${selectedIndex}`;
        this.usedWordSetIndices.push(setId);
      }

      // Парсимо вибрані картки (розділяємо по комах та обрізаємо пробіли)
      const wordSet = {
        A: roundWordStrings[selectedIndices[0]].split(',').map(word => word.trim()),
        B: roundWordStrings[selectedIndices[1]].split(',').map(word => word.trim()),
        C: roundWordStrings[selectedIndices[2]].split(',').map(word => word.trim()),
        D: roundWordStrings[selectedIndices[3]].split(',').map(word => word.trim())
      };

      console.log(`Round ${this.currentRound}: using cards ${selectedIndices.join(', ')} from round pool`);

      // Перевіряємо що кожна картка має рівно 9 слів
      if (wordSet.A.length !== 9 || wordSet.B.length !== 9 || wordSet.C.length !== 9 || wordSet.D.length !== 9) {
        console.error('Word set validation error: each card must have exactly 9 words');
        console.log('Card A:', wordSet.A.length, 'words');
        console.log('Card B:', wordSet.B.length, 'words');
        console.log('Card C:', wordSet.C.length, 'words');
        console.log('Card D:', wordSet.D.length, 'words');
      }

      // Призначаємо кожному гравцю унікальну комбінацію (буква + номер)
      const assignments = new Map();
      const letters = ['A', 'B', 'C', 'D'];

      // ВИПРАВЛЕНО: Створюємо всі можливі комбінації (4 букви × 9 номерів = 36 слів)
      const allCombinations = [];
      for (let letter of letters) {
        for (let number = 1; number <= 9; number++) {
          allCombinations.push({ letter, number });
        }
      }

      // Перемішуємо комбінації (shuffle)
      for (let i = allCombinations.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allCombinations[i], allCombinations[j]] = [allCombinations[j], allCombinations[i]];
      }

      // Призначаємо унікальну комбінацію кожному гравцю
      let combinationIndex = 0;
      for (let [playerId] of this.players) {
        const { letter, number } = allCombinations[combinationIndex++];
        const word = wordSet[letter][number - 1];

        assignments.set(playerId, {
          letter,
          number,
          word
        });

        console.log(`  📋 Assignment: Player ${playerId} → ${letter}${number} "${word}"`);
      }
      
      this.roundData = {
        wordSet,
        assignments,
        playerScoreSequences: new Map(), // Персональні черги очок для кожного художника
        blackTokenSequence: [] // Чорні жетони
      };
      
      // Ініціалізуємо черги очок
      // Для очок за відгадування: кількість = players.size - 1 (не відгадуєш себе)
      const guessSequenceLength = Math.min(this.players.size - 1, SCORE_SEQUENCE.length);
      for (let [playerId] of this.players) {
        this.roundData.playerScoreSequences.set(
          playerId, 
          [...SCORE_SEQUENCE.slice(0, guessSequenceLength)]
        );
      }
      
      // ВИПРАВЛЕННЯ: Для чорних жетонів: кількість = players.size (всі можуть завершити)
      const blackTokenSequenceLength = Math.min(this.players.size, SCORE_SEQUENCE.length);
      this.roundData.blackTokenSequence = [...SCORE_SEQUENCE.slice(0, blackTokenSequenceLength)];
      
      console.log(`Round ${this.currentRound} initialized:`);
      console.log(`- Players: ${this.players.size}`);
      console.log(`- Guess sequence length: ${guessSequenceLength}`);
      console.log(`- Black token sequence: [${this.roundData.blackTokenSequence.join(', ')}]`);
      
      this.state = 'playing';
      
      return {
        round: this.currentRound,
        wordSet,
        assignments
      };
    } finally {
      // НОВЕ: Завжди знімаємо блокування
      this.isStartingRound = false;
    }
  }

  addDrawingData(playerId, data) {
    if (this.drawingLocks.has(playerId)) return false;
    
    // НОВЕ: Rate limiting
    const now = Date.now();
    let playerRate = this.drawingRateLimit.get(playerId);
    
    if (!playerRate) {
      playerRate = { count: 0, resetTime: now + 1000 };
      this.drawingRateLimit.set(playerId, playerRate);
    }
    
    if (now > playerRate.resetTime) {
      playerRate.count = 0;
      playerRate.resetTime = now + 1000;
    }
    
    playerRate.count++;
    if (playerRate.count > 60) { // максимум 60 повідомлень за секунду
      console.log(`Rate limit exceeded for player ${playerId}`);
      return false;
    }
    
    if (!this.drawings.has(playerId)) {
      this.drawings.set(playerId, []);
    }
    this.drawings.get(playerId).push(data);
    return true;
  }

  lockDrawing(playerId, reason) {
    if (!this.drawingLocks.has(playerId)) {
      this.drawingLocks.set(playerId, {
        locked: true,
        reason,
        time: Date.now()
      });
    }
  }

  makeGuess(guesserId, targetId, number) {
    // Перевіряємо чи не себе відгадує
    if (guesserId === targetId) return false;

    // Перевіряємо чи вже відгадував цього гравця
    if (!this.guesses.has(guesserId)) {
      this.guesses.set(guesserId, new Map());
    }

    const guesserGuesses = this.guesses.get(guesserId);
    if (guesserGuesses.has(targetId)) return false;

    // Перевіряємо чи не використаний вже цей номер
    const usedNumbers = new Set(Array.from(guesserGuesses.values()).map(g => g.number));
    if (usedNumbers.has(number)) return false;

    // DEBUG: Виводимо повну інформацію про здогадку
    const targetAssignment = this.roundData.assignments.get(targetId);
    const guesserAssignment = this.roundData.assignments.get(guesserId);

    console.log(`\n🔍 GUESS DEBUG:`);
    console.log(`  Guesser: ${guesserId} (has: ${guesserAssignment?.letter}${guesserAssignment?.number} "${guesserAssignment?.word}")`);
    console.log(`  Target: ${targetId} (has: ${targetAssignment?.letter}${targetAssignment?.number} "${targetAssignment?.word}")`);
    console.log(`  Guessed number: ${number} (type: ${typeof number})`);
    console.log(`  Target number: ${targetAssignment?.number} (type: ${typeof targetAssignment?.number})`);
    console.log(`  Comparison: ${number} === ${targetAssignment?.number} = ${number === targetAssignment?.number}`);
    console.log(`  Loose comparison: ${number} == ${targetAssignment?.number} = ${number == targetAssignment?.number}`);

    // Выводим ВСЕ assignments для контекста
    console.log(`\n  📋 ALL ASSIGNMENTS IN THIS ROUND:`);
    for (let [pid, assignment] of this.roundData.assignments) {
      const marker = pid === guesserId ? '👉' : (pid === targetId ? '🎯' : '  ');
      console.log(`    ${marker} ${pid}: ${assignment.letter}${assignment.number} "${assignment.word}"`);
    }

    // Перевіряємо правильність - ВИКОРИСТОВУЄМО LOOSE COMPARISON на випадок string vs number
    const correct = targetAssignment && (number == targetAssignment.number);

    console.log(`  RESULT: ${correct ? '✅ CORRECT' : '❌ INCORRECT'}\n`);

    // Зберігаємо здогадку
    guesserGuesses.set(targetId, {
      number,
      time: Date.now(),
      correct
    });

    // Блокуємо малюнок після першої здогадки
    this.lockDrawing(targetId, 'first_guess');

    // ВИПРАВЛЕНО: Повертаємо об'єкт з результатом
    return { success: true, correct };
  }

  finishGuessing(playerId) {
    this.finishedGuessing.add(playerId);
    
    // Видаємо чорний жетон
    if (this.roundData.blackTokenSequence.length > 0) {
      const token = this.roundData.blackTokenSequence.shift();
      this.blackTokensGiven.push({ playerId, score: token });
      console.log(`Player ${playerId} received black token: ${token} points`);
      console.log(`Remaining black tokens: [${this.roundData.blackTokenSequence.join(', ')}]`);
      return token;
    }
    console.log(`Player ${playerId} finished but no black tokens left`);
    return 0;
  }

  isRoundComplete() {
    return this.finishedGuessing.size === this.players.size;
  }

  calculateRoundScores() {
    const roundScores = new Map();
    
    // Ініціалізуємо всіх з 0
    for (let [playerId] of this.players) {
      roundScores.set(playerId, 0);
    }
    
    // Розподіляємо очки за правильні здогадки
    for (let [artistId, scoreSequence] of this.roundData.playerScoreSequences) {
      // Збираємо всі здогадки для цього художника
      const guessesForArtist = [];
      
      for (let [guesserId, guesserGuesses] of this.guesses) {
        if (guesserGuesses.has(artistId)) {
          const guess = guesserGuesses.get(artistId);
          if (guess.correct) {
            guessesForArtist.push({
              guesserId,
              time: guess.time
            });
          }
        }
      }
      
      // Сортуємо за часом
      guessesForArtist.sort((a, b) => a.time - b.time);
      
      // Видаємо очки з персональної черги художника
      for (let i = 0; i < guessesForArtist.length && i < scoreSequence.length; i++) {
        const points = scoreSequence[i];
        const current = roundScores.get(guessesForArtist[i].guesserId) || 0;
        roundScores.set(guessesForArtist[i].guesserId, current + points);
      }
    }
    
    // Додаємо чорні жетони
    for (let { playerId, score } of this.blackTokensGiven) {
      const current = roundScores.get(playerId) || 0;
      roundScores.set(playerId, current + score);
      console.log(`Adding black token score for ${playerId}: +${score}`);
    }
    
    // Оновлюємо загальні очки
    for (let [playerId, points] of roundScores) {
      const current = this.scores.get(playerId) || 0;
      this.scores.set(playerId, current + points);
    }
    
    console.log('Round scores:', Object.fromEntries(roundScores));
    console.log('Total scores:', Object.fromEntries(this.scores));
    
    return {
      roundScores: Object.fromEntries(roundScores),
      totalScores: Object.fromEntries(this.scores),
      assignments: Object.fromEntries(this.roundData.assignments),
      guesses: Object.fromEntries([...this.guesses].map(([id, guesses]) => 
        [id, Object.fromEntries(guesses)]
      ))
    };
  }

  isGameComplete() {
    return this.currentRound >= ROUNDS_PER_GAME;
  }

  getState() {
    return {
      code: this.code,
      players: Array.from(this.players.values()),
      state: this.state,
      currentRound: this.currentRound,
      scores: Object.fromEntries(this.scores),
      hostId: this.hostId
    };
  }
}

// Зберігання кімнат
const rooms = new Map();
const playerRooms = new Map(); // playerId -> roomCode

// Socket.io обробники
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);
  
  let currentPlayerId = null;
  let currentRoomCode = null;
  
  // Створення кімнати
  socket.on('create_room', ({ playerName }) => {
    const roomCode = generateRoomCode();
    const playerId = socket.id;
    const room = new GameRoom(roomCode, playerId);
    
    room.addPlayer(playerId, playerName, socket.id);
    rooms.set(roomCode, room);
    playerRooms.set(playerId, roomCode);
    
    currentPlayerId = playerId;
    currentRoomCode = roomCode;
    
    socket.join(roomCode);
    socket.emit('room_created', { 
      roomCode, 
      playerId,
      state: room.getState() 
    });
  });
  
  // Приєднання до кімнати
  socket.on('join_room', ({ roomCode, playerName, playerId }) => {
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit('error', { message: 'Кімната не знайдена' });
      return;
    }
    
    // Якщо це reconnect
    if (playerId && room.players.has(playerId)) {
      room.addPlayer(playerId, playerName, socket.id);
      currentPlayerId = playerId;
    } else {
      // Новий гравець
      const newPlayerId = socket.id;
      if (!room.addPlayer(newPlayerId, playerName, socket.id)) {
        socket.emit('error', { message: 'Кімната заповнена' });
        return;
      }
      currentPlayerId = newPlayerId;
      playerId = newPlayerId;
    }
    
    currentRoomCode = roomCode;
    playerRooms.set(currentPlayerId, roomCode);
    
    socket.join(roomCode);
    socket.emit('joined_room', { 
      roomCode, 
      playerId: currentPlayerId,
      state: room.getState() 
    });
    
    io.to(roomCode).emit('player_joined', room.getState());
  });
  
  // Готовність гравця
  socket.on('player_ready', ({ ready }) => {
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    
    room.setPlayerReady(currentPlayerId, ready);
    io.to(currentRoomCode).emit('player_ready_changed', room.getState());
    
    // Перевіряємо чи можна почати гру
    if (room.canStartGame() && currentPlayerId === room.hostId) {
      io.to(currentRoomCode).emit('can_start_game');
    }
  });
  
  // Старт гри
  socket.on('start_game', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || currentPlayerId !== room.hostId) return;
    
    if (room.canStartGame()) {
      const roundData = room.startNewRound();
      
      // НОВЕ: Перевіряємо чи вдалося почати раунд
      if (!roundData) {
        console.log('Round already starting, ignoring duplicate request');
        return;
      }
      
      // Відправляємо кожному гравцю його персональне завдання
      for (let [playerId, player] of room.players) {
        const assignment = roundData.assignments.get(playerId);
        io.to(player.socketId).emit('round_started', {
          round: roundData.round,
          wordSet: roundData.wordSet,
          personalAssignment: assignment,
          players: Array.from(room.players.values())
        });
      }
    }
  });
  
  // Синхронізація малювання
  socket.on('drawing_update', ({ strokes }) => {
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    
    // НОВЕ: Валідація stroke даних
    const validatedStrokes = strokes.filter(stroke => {
      if (stroke.type === 'start' || stroke.type === 'draw') {
        return stroke.x >= 0 && stroke.x <= 1 && 
               stroke.y >= 0 && stroke.y <= 1 &&
               stroke.size > 0 && stroke.size <= 50 &&
               (stroke.tool === 'pen' || stroke.tool === 'eraser');
      }
      return stroke.type === 'end';
    });
    
    if (validatedStrokes.length === 0) return;
    
    if (room.addDrawingData(currentPlayerId, validatedStrokes)) {
      socket.to(currentRoomCode).emit('drawing_updated', {
        playerId: currentPlayerId,
        strokes: validatedStrokes
      });
    }
  });
  
  // Очищення полотна
  socket.on('clear_canvas', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.drawingLocks.has(currentPlayerId)) return;

    room.drawings.set(currentPlayerId, []);
    io.to(currentRoomCode).emit('canvas_cleared', {
      playerId: currentPlayerId
    });
  });

  // Здогадка
  socket.on('make_guess', ({ targetId, number }) => {
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const result = room.makeGuess(currentPlayerId, targetId, number);

    if (result && result.success) {
      // ВИПРАВЛЕНО: Додаємо correct до відповіді (тільки для гравця що відгадував)
      console.log(`✅ Player ${currentPlayerId} guessed ${number} for ${targetId}: ${result.correct ? 'CORRECT' : 'INCORRECT'}`);
      socket.emit('guess_accepted', { targetId, number, correct: result.correct });

      // Повідомляємо про блокування малюнка
      io.to(currentRoomCode).emit('drawing_locked', {
        playerId: targetId
      });
    } else {
      socket.emit('guess_rejected', { targetId, number });
    }
  });
  
  // Завершення відгадування (опціонально, для майбутньої функціональності)
  socket.on('finish_guessing', () => {
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const blackToken = room.finishGuessing(currentPlayerId);
    socket.emit('black_token_received', { score: blackToken });

    io.to(currentRoomCode).emit('player_finished_guessing', {
      playerId: currentPlayerId
    });
  });

  // НОВЕ: Завершення раунду (тільки хост)
  socket.on('end_round', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || currentPlayerId !== room.hostId) {
      console.log(`Player ${currentPlayerId} tried to end round but is not host`);
      return;
    }

    console.log(`Host ${currentPlayerId} ending round ${room.currentRound}`);

    const scores = room.calculateRoundScores();
    io.to(currentRoomCode).emit('round_ended', scores);

    // Перевіряємо завершення гри
    if (room.isGameComplete()) {
      room.state = 'game_end';
      io.to(currentRoomCode).emit('game_ended', {
        finalScores: scores.totalScores,
        winner: Object.entries(scores.totalScores)
          .sort(([,a], [,b]) => b - a)[0][0]
      });
    } else {
      room.state = 'round_end';
    }
  });
  
  // Наступний раунд
  socket.on('next_round', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || currentPlayerId !== room.hostId) return;
    
    const roundData = room.startNewRound();
    
    // НОВЕ: Перевіряємо чи вдалося почати раунд
    if (!roundData) {
      console.log('Round already starting, ignoring duplicate request');
      return;
    }
    
    // Відправляємо кожному гравцю його персональне завдання
    for (let [playerId, player] of room.players) {
      const assignment = roundData.assignments.get(playerId);
      io.to(player.socketId).emit('round_started', {
        round: roundData.round,
        wordSet: roundData.wordSet,
        personalAssignment: assignment,
        players: Array.from(room.players.values())
      });
    }
  });
  
  // Нова гра
  socket.on('new_game', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || currentPlayerId !== room.hostId) return;
    
    room.currentRound = 0;
    room.scores.clear();
    room.state = 'lobby';
    room.readyPlayers.clear();
    room.usedWordSetIndices = []; // Скидаємо використані набори
    
    for (let [playerId] of room.players) {
      room.scores.set(playerId, 0);
      room.setPlayerReady(playerId, false);
    }
    
    io.to(currentRoomCode).emit('game_reset', room.getState());
  });
  
  // Відключення
  socket.on('disconnect', () => {
    if (currentRoomCode && currentPlayerId) {
      const room = rooms.get(currentRoomCode);
      if (room) {
        room.removePlayer(currentPlayerId);
        
        // ВИПРАВЛЕНО: Видаляємо з глобальної Map
        playerRooms.delete(currentPlayerId);
        
        // Перевіряємо чи всі гравці відключені
        let allDisconnected = true;
        for (let [, player] of room.players) {
          if (player.connected) {
            allDisconnected = false;
            break;
          }
        }
        
        // ВИПРАВЛЕНО: Видаляємо порожню кімнату або кімнату з усіма відключеними гравцями
        if (room.players.size === 0 || allDisconnected) {
          // Очищаємо всі дані кімнати
          room.cleanup();
          
          // Видаляємо кімнату з глобальної Map
          rooms.delete(currentRoomCode);
          
          // Очищаємо всі посилання на кімнату з playerRooms
          for (let [pid, rcode] of playerRooms) {
            if (rcode === currentRoomCode) {
              playerRooms.delete(pid);
            }
          }
          
          console.log(`Room ${currentRoomCode} deleted - ${allDisconnected ? 'all players disconnected' : 'no players left'}`);
        } else {
          io.to(currentRoomCode).emit('player_disconnected', {
            playerId: currentPlayerId,
            state: room.getState()
          });
        }
      } else {
        // Кімната вже не існує, очищаємо посилання
        playerRooms.delete(currentPlayerId);
      }
    }
    
    console.log(`Player ${socket.id} disconnected. Active rooms: ${rooms.size}, Active players: ${playerRooms.size}`);
  });
});

// НОВЕ: Періодичне очищення пам'яті кожну 1 годину.
setInterval(() => {
  let roomsCleaned = 0;
  let playersRemoved = 0;
  
  // Перевіряємо всі кімнати
  for (let [roomCode, room] of rooms) {
    // Видаляємо кімнати без активних гравців
    let hasActivePlayers = false;
    for (let [, player] of room.players) {
      if (player.connected) {
        hasActivePlayers = true;
        break;
      }
    }
    
    if (!hasActivePlayers) {
      room.cleanup();
      rooms.delete(roomCode);
      roomsCleaned++;
      
      // Очищаємо посилання з playerRooms
      for (let [pid, rcode] of playerRooms) {
        if (rcode === roomCode) {
          playerRooms.delete(pid);
          playersRemoved++;
        }
      }
    }
  }
  
  // Перевіряємо playerRooms на "осиротілі" записи
  for (let [playerId, roomCode] of playerRooms) {
    if (!rooms.has(roomCode)) {
      playerRooms.delete(playerId);
      playersRemoved++;
    }
  }
  
  if (roomsCleaned > 0 || playersRemoved > 0) {
    console.log(`[GC] Cleaned ${roomsCleaned} rooms, ${playersRemoved} player references`);
  }
  
  // Логуємо статистику
  console.log(`[GC] Active: ${rooms.size} rooms, ${playerRooms.size} player mappings`);
  
  // Форсуємо garbage collection Node.js (якщо запущено з --expose-gc)
  if (global.gc) {
    global.gc();
    console.log('[GC] Manual garbage collection triggered');
  }
}, 60 * 60 * 1000); // 1 година

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});