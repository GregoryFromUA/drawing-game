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
const MAX_PLAYERS = 9;
const SCORE_SEQUENCE = [4, 3, 3, 2, 2, 2, 1, 1];

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
    this.finishedDrawing = new Set();
    this.finishedGuessing = new Set();
    this.blackTokensGiven = [];
    this.drawingLocks = new Map(); // Блокування малюнків
    this.usedWordSetIndices = []; // Зберігаємо індекси використаних наборів для уникнення повторів
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
    this.currentRound++;
    this.finishedDrawing.clear();
    this.finishedGuessing.clear();
    this.drawings.clear();
    this.guesses.clear();
    this.blackTokensGiven = [];
    this.drawingLocks.clear();
    
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
    if (availableIndices.length < 3) {
      console.log(`Not enough unused sets for round ${this.currentRound}, resetting...`);
      this.usedWordSetIndices = this.usedWordSetIndices.filter(id => !id.startsWith(`${this.currentRound}-`));
      availableIndices = [];
      for (let i = 0; i < roundWordStrings.length; i++) {
        availableIndices.push(i);
      }
    }
    
    // Вибираємо 3 випадкові картки з доступних
    const selectedIndices = [];
    for (let i = 0; i < 3; i++) {
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
      C: roundWordStrings[selectedIndices[2]].split(',').map(word => word.trim())
    };
    
    console.log(`Round ${this.currentRound}: using cards ${selectedIndices.join(', ')} from round pool`);
    
    // Перевіряємо що кожна картка має рівно 9 слів
    if (wordSet.A.length !== 9 || wordSet.B.length !== 9 || wordSet.C.length !== 9) {
      console.error('Word set validation error: each card must have exactly 9 words');
      console.log('Card A:', wordSet.A.length, 'words');
      console.log('Card B:', wordSet.B.length, 'words');
      console.log('Card C:', wordSet.C.length, 'words');
    }
    
    // Призначаємо кожному гравцю букву та номер
    const assignments = new Map();
    const usedNumbers = new Set();
    const letters = ['A', 'B', 'C'];
    
    for (let [playerId] of this.players) {
      let number;
      do {
        number = Math.floor(Math.random() * 9) + 1;
      } while (usedNumbers.has(number));
      usedNumbers.add(number);
      
      const letter = letters[Math.floor(Math.random() * letters.length)];
      const word = wordSet[letter][number - 1];
      
      assignments.set(playerId, {
        letter,
        number,
        word
      });
    }
    
    this.roundData = {
      wordSet,
      assignments,
      playerScoreSequences: new Map(), // Персональні черги очок для кожного художника
      blackTokenSequence: [] // Чорні жетони
    };
    
    // Ініціалізуємо черги очок
    const sequenceLength = Math.min(this.players.size - 1, SCORE_SEQUENCE.length);
    for (let [playerId] of this.players) {
      this.roundData.playerScoreSequences.set(
        playerId, 
        [...SCORE_SEQUENCE.slice(0, sequenceLength)]
      );
    }
    this.roundData.blackTokenSequence = [...SCORE_SEQUENCE.slice(0, sequenceLength)];
    
    this.state = 'playing';
    
    return {
      round: this.currentRound,
      wordSet,
      assignments
    };
  }

  addDrawingData(playerId, data) {
    if (this.drawingLocks.has(playerId)) return false;
    
    if (!this.drawings.has(playerId)) {
      this.drawings.set(playerId, []);
    }
    this.drawings.get(playerId).push(data);
    return true;
  }

  finishDrawing(playerId) {
    this.finishedDrawing.add(playerId);
    this.lockDrawing(playerId, 'manual_finish');
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
    const usedNumbers = new Set(guesserGuesses.values());
    if (usedNumbers.has(number)) return false;
    
    // Зберігаємо здогадку
    guesserGuesses.set(targetId, {
      number,
      time: Date.now(),
      correct: this.roundData.assignments.get(targetId).number === number
    });
    
    // Блокуємо малюнок після першої здогадки
    this.lockDrawing(targetId, 'first_guess');
    
    return true;
  }

  finishGuessing(playerId) {
    this.finishedGuessing.add(playerId);
    
    // Видаємо чорний жетон
    if (this.roundData.blackTokenSequence.length > 0) {
      const token = this.roundData.blackTokenSequence.shift();
      this.blackTokensGiven.push({ playerId, score: token });
      return token;
    }
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
    }
    
    // Оновлюємо загальні очки
    for (let [playerId, points] of roundScores) {
      const current = this.scores.get(playerId) || 0;
      this.scores.set(playerId, current + points);
    }
    
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
    
    if (room.addDrawingData(currentPlayerId, strokes)) {
      socket.to(currentRoomCode).emit('drawing_updated', {
        playerId: currentPlayerId,
        strokes
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
  
  // Завершення малювання
  socket.on('finish_drawing', () => {
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    
    room.finishDrawing(currentPlayerId);
    io.to(currentRoomCode).emit('player_finished_drawing', {
      playerId: currentPlayerId
    });
  });
  
  // Здогадка
  socket.on('make_guess', ({ targetId, number }) => {
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    
    if (room.makeGuess(currentPlayerId, targetId, number)) {
      socket.emit('guess_accepted', { targetId, number });
      
      // Повідомляємо про блокування малюнка
      io.to(currentRoomCode).emit('drawing_locked', {
        playerId: targetId
      });
    } else {
      socket.emit('guess_rejected', { targetId, number });
    }
  });
  
  // Завершення відгадування
  socket.on('finish_guessing', () => {
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    
    const blackToken = room.finishGuessing(currentPlayerId);
    socket.emit('black_token_received', { score: blackToken });
    
    io.to(currentRoomCode).emit('player_finished_guessing', {
      playerId: currentPlayerId
    });
    
    // Перевіряємо завершення раунду
    if (room.isRoundComplete()) {
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
    }
  });
  
  // Наступний раунд
  socket.on('next_round', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || currentPlayerId !== room.hostId) return;
    
    const roundData = room.startNewRound();
    
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
        io.to(currentRoomCode).emit('player_disconnected', {
          playerId: currentPlayerId,
          state: room.getState()
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

// package.json для сервера:
/*
{
  "name": "drawing-game-server",
  "version": "1.0.0",
  "description": "Multiplayer drawing game server",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.6.1",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "nodemon": "^2.0.22"
  }
}
*/