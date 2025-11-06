// server.js - Сервер для гри в малювання
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

// Імпортуємо картки завдань з окремого файлу
const WORD_SETS = require('./wordSets.js');
const FAKE_ARTIST_THEMES = require('./fakeArtistThemes.js');

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

    // ВИПРАВЛЕНО: Повертаємо об'єкт з результатом + правильне assignment для клієнта
    return {
      success: true,
      correct,
      targetAssignment: targetAssignment  // Відправляємо правильне слово клієнту
    };
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

// Клас для управління грою Unicorn Canvas (Fake Artist)
class FakeArtistGame {
  constructor(code, hostId, io) {
    this.code = code;
    this.hostId = hostId;
    this.io = io; // Socket.io instance для відправки подій
    this.players = new Map(); // playerId -> {id, name, socketId, connected, color}
    this.state = 'lobby'; // lobby, theme_selection, drawing, voting_fake, fake_guessing, voting_answer, round_end, game_end
    this.mode = 'unicorn_canvas';

    // Вибір тем
    this.themeSelectionTimer = null;
    this.playerThemeVotes = new Map(); // playerId -> [theme1, theme2, ...]
    this.availableThemes = Object.keys(FAKE_ARTIST_THEMES);
    this.selectedThemesPool = []; // Пул тем обраних гравцями
    this.usedThemes = []; // Використані теми (без повторів)

    // Раунд
    this.currentRound = 0;
    this.currentTheme = null;
    this.currentWord = null;
    this.fakeArtistId = null;
    this.playerCards = new Map(); // playerId -> {word: string, isFake: boolean}

    // Малювання
    this.sharedDrawing = []; // Масив штрихів від усіх гравців
    this.currentTurnIndex = 0;
    this.turnOrder = []; // Порядок гравців
    this.currentDrawingRound = 1; // 1 або 2 (кожен робить по 2 штрихи)
    this.turnTimer = null;
    this.playerColors = new Map(); // playerId -> color

    // Голосування за підробного
    this.votesForFake = new Map(); // playerId -> suspectId
    this.votingTimer = null;

    // Відгадування слова підробним
    this.fakeGuess = null;
    this.guessTimer = null;

    // Голосування за правильність відповіді
    this.votesForCorrectness = new Map(); // playerId -> boolean (true = правильно)

    // Очки
    this.scores = new Map(); // playerId -> score

    this.readyPlayers = new Set();
  }

  cleanup() {
    // Очищаємо таймери
    if (this.themeSelectionTimer) clearTimeout(this.themeSelectionTimer);
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.votingTimer) clearTimeout(this.votingTimer);
    if (this.guessTimer) clearTimeout(this.guessTimer);

    // Очищаємо Map та Set
    this.players.clear();
    this.playerThemeVotes.clear();
    this.playerCards.clear();
    this.playerColors.clear();
    this.votesForFake.clear();
    this.votesForCorrectness.clear();
    this.scores.clear();
    this.readyPlayers.clear();
    if (this.playerDisplayedThemes) this.playerDisplayedThemes.clear();

    // Очищаємо масиви
    this.sharedDrawing = [];
    this.turnOrder = [];
    this.selectedThemesPool = [];
    this.usedThemes = [];

    console.log(`FakeArtistGame ${this.code} cleaned up`);
  }

  addPlayer(id, name, socketId) {
    if (this.players.size >= MAX_PLAYERS) return false;

    // Reconnect
    if (this.players.has(id)) {
      const player = this.players.get(id);
      player.socketId = socketId;
      player.connected = true;
      return true;
    }

    // Новий гравець
    const color = this.assignColor();
    this.players.set(id, {
      id,
      name,
      socketId,
      connected: true,
      color,
      ready: false  // ВИПРАВЛЕНО: Додано поле ready
    });
    this.playerColors.set(id, color);
    this.scores.set(id, 0);

    return true;
  }

  assignColor() {
    const colors = [
      '#FF0000', '#0000FF', '#00FF00', '#FFFF00',
      '#FF00FF', '#00FFFF', '#FFA500', '#800080',
      '#008000', '#800000', '#000080', '#808000'
    ];
    return colors[this.players.size % colors.length];
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (!player) return;

    player.connected = false;

    // Якщо це хост, передаємо роль іншому гравцю
    if (this.hostId === id) {
      for (let [playerId, p] of this.players) {
        if (p.connected && playerId !== id) {
          this.hostId = playerId;
          break;
        }
      }
    }
  }

  toggleReady(playerId) {
    if (this.readyPlayers.has(playerId)) {
      this.readyPlayers.delete(playerId);
    } else {
      this.readyPlayers.add(playerId);
    }
  }

  // ВИПРАВЛЕНО: Додано метод setPlayerReady для сумісності з GameRoom
  setPlayerReady(playerId, ready) {
    const player = this.players.get(playerId);
    if (player) {
      // Оновлюємо ready стан гравця
      player.ready = ready;
      if (ready) {
        this.readyPlayers.add(playerId);
      } else {
        this.readyPlayers.delete(playerId);
      }
    }
  }

  // ВИПРАВЛЕНО: Додано метод canStartGame для сумісності з GameRoom
  canStartGame() {
    return this.players.size >= MIN_PLAYERS &&
           this.readyPlayers.size === this.players.size;
  }

  // Початок вибору тем
  startThemeSelection() {
    this.state = 'theme_selection';
    this.playerThemeVotes.clear();

    // ВИПРАВЛЕНО: Кожен гравець отримує свій унікальний набір з 12 тем
    const allThemes = Object.keys(FAKE_ARTIST_THEMES);
    this.playerDisplayedThemes = new Map();

    for (let [playerId] of this.players) {
      // Перемішуємо теми для кожного гравця окремо
      const shuffled = [...allThemes].sort(() => Math.random() - 0.5);
      this.playerDisplayedThemes.set(playerId, shuffled.slice(0, 12));
    }

    // Таймер 20 секунд
    this.themeSelectionTimer = setTimeout(() => {
      this.finishThemeSelection();
    }, 20000);
  }

  submitThemeVotes(playerId, selectedThemes) {
    // Максимум 5 тем
    const themes = selectedThemes.slice(0, 5);
    this.playerThemeVotes.set(playerId, themes);

    // Якщо всі проголосували, завершуємо достроково
    if (this.playerThemeVotes.size === this.players.size) {
      if (this.themeSelectionTimer) {
        clearTimeout(this.themeSelectionTimer);
        this.themeSelectionTimer = null;
      }
      this.finishThemeSelection();
    }
  }

  finishThemeSelection() {
    console.log(`Finishing theme selection. Votes received: ${this.playerThemeVotes.size}/${this.players.size}`);

    // Збираємо всі унікальні теми
    const allVotedThemes = new Set();
    for (let themes of this.playerThemeVotes.values()) {
      themes.forEach(theme => allVotedThemes.add(theme));
    }

    this.selectedThemesPool = Array.from(allVotedThemes);

    // ВИПРАВЛЕНО: Якщо менше 5 тем, додаємо випадкові з об'єднання всіх показаних тем
    if (this.selectedThemesPool.length < 5) {
      // Збираємо всі унікальні теми, які були показані хоча б одному гравцю
      const allDisplayedThemes = new Set();
      for (let playerThemes of this.playerDisplayedThemes.values()) {
        playerThemes.forEach(theme => allDisplayedThemes.add(theme));
      }

      const remainingThemes = Array.from(allDisplayedThemes).filter(t => !this.selectedThemesPool.includes(t));
      while (this.selectedThemesPool.length < 5 && remainingThemes.length > 0) {
        const randomIndex = Math.floor(Math.random() * remainingThemes.length);
        this.selectedThemesPool.push(remainingThemes[randomIndex]);
        remainingThemes.splice(randomIndex, 1);
      }
    }

    console.log(`Theme pool: ${this.selectedThemesPool.join(', ')}`);

    // Починаємо перший раунд
    this.startRound();
  }

  // Початок раунду
  startRound() {
    this.currentRound++;

    // Вибираємо випадкову тему з пулу (без повторів)
    const availableThemesForRound = this.selectedThemesPool.filter(t => !this.usedThemes.includes(t));

    if (availableThemesForRound.length === 0) {
      // Всі теми використані, можна почати повторювати
      this.usedThemes = [];
      this.currentTheme = this.selectedThemesPool[Math.floor(Math.random() * this.selectedThemesPool.length)];
    } else {
      this.currentTheme = availableThemesForRound[Math.floor(Math.random() * availableThemesForRound.length)];
    }

    this.usedThemes.push(this.currentTheme);

    // Вибираємо випадкове слово з теми
    const words = FAKE_ARTIST_THEMES[this.currentTheme];
    this.currentWord = words[Math.floor(Math.random() * words.length)];

    // Вибираємо підробного художника (випадково)
    const playerIds = Array.from(this.players.keys()).filter(id => this.players.get(id).connected);
    this.fakeArtistId = playerIds[Math.floor(Math.random() * playerIds.length)];

    // Роздаємо карточки
    this.playerCards.clear();
    for (let playerId of playerIds) {
      if (playerId === this.fakeArtistId) {
        this.playerCards.set(playerId, { word: 'X', isFake: true });
      } else {
        this.playerCards.set(playerId, { word: this.currentWord, isFake: false });
      }
    }

    // Визначаємо порядок ходів (випадково перший, потім по колу)
    this.turnOrder = [...playerIds];
    const firstPlayerIndex = Math.floor(Math.random() * this.turnOrder.length);
    this.turnOrder = [...this.turnOrder.slice(firstPlayerIndex), ...this.turnOrder.slice(0, firstPlayerIndex)];

    this.currentTurnIndex = 0;
    this.currentDrawingRound = 1;
    this.sharedDrawing = [];

    this.state = 'drawing';

    // Запускаємо таймер для першого ходу
    this.startTurnTimer();

    console.log(`Round ${this.currentRound}: Theme=${this.currentTheme}, Word=${this.currentWord}, Fake=${this.fakeArtistId}`);

    // Відправляємо кожному гравцю його карточку
    for (let [playerId, player] of this.players) {
      const card = this.playerCards.get(playerId);
      this.io.to(player.socketId).emit('round_started_unicorn', {
        round: this.currentRound,
        theme: this.currentTheme,
        card: card,
        turnOrder: this.turnOrder,
        currentTurnIndex: this.currentTurnIndex,
        currentDrawingRound: this.currentDrawingRound,
        state: this.getState()
      });
    }
  }

  startTurnTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);

    this.turnTimer = setTimeout(() => {
      // Час вичерпано, переходимо до наступного гравця
      this.nextTurn();
    }, 60000); // 60 секунд
  }

  addDrawingStroke(playerId, stroke) {
    const currentPlayerId = this.turnOrder[this.currentTurnIndex];
    if (playerId !== currentPlayerId) {
      return false; // Не твій хід
    }

    // Додаємо штрих до загального малюнка
    this.sharedDrawing.push({
      ...stroke,
      playerId,
      color: this.playerColors.get(playerId)
    });

    return true;
  }

  finishTurn(playerId) {
    const currentPlayerId = this.turnOrder[this.currentTurnIndex];
    if (playerId !== currentPlayerId) {
      return false;
    }

    this.nextTurn();
    return true;
  }

  nextTurn() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }

    this.currentTurnIndex++;

    // Перевіряємо чи всі зробили ходи в цьому раунді
    if (this.currentTurnIndex >= this.turnOrder.length) {
      this.currentTurnIndex = 0;
      this.currentDrawingRound++;

      // Якщо обидва раунди завершені, переходимо до голосування
      if (this.currentDrawingRound > 2) {
        this.startVotingForFake();
        return;
      }
    }

    // Запускаємо таймер для наступного ходу
    this.startTurnTimer();

    // Відправляємо оновлення про наступний хід
    this.io.to(this.code).emit('next_turn', {
      currentTurnIndex: this.currentTurnIndex,
      currentDrawingRound: this.currentDrawingRound,
      currentPlayerId: this.turnOrder[this.currentTurnIndex],
      state: this.getState()
    });
  }

  // Голосування за підробного
  startVotingForFake() {
    this.state = 'voting_fake';
    this.votesForFake.clear();

    // Таймер 10 секунд
    this.votingTimer = setTimeout(() => {
      this.finishVotingForFake();
    }, 10000);

    // Відправляємо подію про початок голосування
    this.io.to(this.code).emit('voting_for_fake_started', {
      state: this.getState()
    });
  }

  submitVoteForFake(playerId, suspectId) {
    this.votesForFake.set(playerId, suspectId);

    // Якщо всі проголосували, завершуємо
    if (this.votesForFake.size === this.players.size) {
      if (this.votingTimer) {
        clearTimeout(this.votingTimer);
        this.votingTimer = null;
      }
      this.finishVotingForFake();
    }
  }

  finishVotingForFake() {
    if (this.votingTimer) {
      clearTimeout(this.votingTimer);
      this.votingTimer = null;
    }

    // Підраховуємо голоси
    const voteCounts = new Map();
    for (let suspectId of this.votesForFake.values()) {
      voteCounts.set(suspectId, (voteCounts.get(suspectId) || 0) + 1);
    }

    // Знаходимо кандидатів з максимальною кількістю голосів
    let maxVotes = 0;
    let suspects = [];

    for (let [suspectId, count] of voteCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        suspects = [suspectId];
      } else if (count === maxVotes) {
        suspects.push(suspectId);
      }
    }

    // Перевіряємо результати голосування
    const fakeIsCaught = suspects.includes(this.fakeArtistId);
    const isTie = suspects.length > 1;

    if (!fakeIsCaught) {
      // Підробний не спійманий (або не отримав більшості) - автоматична перемога
      this.awardPoints('fake_not_caught');
      this.endRound({ fakeIsCaught: false, fakeWins: true });

      // Відправляємо результати раунду
      this.io.to(this.code).emit('round_ended_unicorn', {
        results: this.roundResults,
        state: this.getState()
      });
    } else if (fakeIsCaught && !isTie) {
      // Підробний спійманий (отримав більшість) - дозволяємо йому вгадати слово
      this.state = 'fake_guessing';
      this.startGuessTimer();

      // Відправляємо подію про початок вгадування
      this.io.to(this.code).emit('fake_guessing_started', {
        fakeArtistId: this.fakeArtistId,
        state: this.getState()
      });
    } else if (fakeIsCaught && isTie) {
      // Нічия і підробний серед підозрюваних - дозволяємо вгадати
      this.state = 'fake_guessing';
      this.startGuessTimer();

      // Відправляємо подію про початок вгадування
      this.io.to(this.code).emit('fake_guessing_started', {
        fakeArtistId: this.fakeArtistId,
        state: this.getState()
      });
    }
  }

  startGuessTimer() {
    this.guessTimer = setTimeout(() => {
      // Час вичерпано, підробний не встиг відповісти
      this.finishGuessing(null);
    }, 30000); // 30 секунд
  }

  submitGuess(playerId, guess) {
    if (playerId !== this.fakeArtistId) return false;

    this.fakeGuess = guess;

    if (this.guessTimer) {
      clearTimeout(this.guessTimer);
      this.guessTimer = null;
    }

    this.finishGuessing(guess);
    return true;
  }

  finishGuessing(guess) {
    if (this.guessTimer) {
      clearTimeout(this.guessTimer);
      this.guessTimer = null;
    }

    if (!guess) {
      // Підробний не відповів - художники перемагають
      this.awardPoints('fake_caught_wrong');
      this.endRound({ fakeIsCaught: true, fakeWins: false, guessCorrect: false });

      // Відправляємо результати раунду
      this.io.to(this.code).emit('round_ended_unicorn', {
        results: this.roundResults,
        state: this.getState()
      });
      return;
    }

    // Голосування за правильність відповіді
    this.state = 'voting_answer';
    this.votesForCorrectness.clear();

    // Відправляємо подію про початок голосування
    this.io.to(this.code).emit('voting_answer_started', {
      fakeGuess: guess,
      word: this.currentWord,
      state: this.getState()
    });

    // Таймер на голосування
    setTimeout(() => {
      // Час вийшов, завершуємо голосування незалежно від кількості голосів
      if (this.state === 'voting_answer') {
        this.finishVotingForCorrectness();
      }
    }, 15000); // 15 секунд для голосування
  }

  submitVoteForCorrectness(playerId, isCorrect) {
    // Підробний не голосує
    if (playerId === this.fakeArtistId) return false;

    this.votesForCorrectness.set(playerId, isCorrect);
    this.checkVotingAnswerProgress();
    return true;
  }

  checkVotingAnswerProgress() {
    // Рахуємо скільки гравців (окрім підробного) повинні проголосувати
    const totalVoters = this.players.size - 1; // Всі крім підробного

    if (this.votesForCorrectness.size >= totalVoters) {
      this.finishVotingForCorrectness();
    }
  }

  finishVotingForCorrectness() {
    // Підраховуємо голоси (тільки художників, МВ не було)
    let correctVotes = 0;
    let incorrectVotes = 0;

    for (let [playerId, vote] of this.votesForCorrectness) {
      if (vote) {
        correctVotes++;
      } else {
        incorrectVotes++;
      }
    }

    // Якщо нічия - не враховуємо голос МВ (його немає), художники вирішують
    const isCorrect = correctVotes > incorrectVotes;

    if (isCorrect) {
      // Відповідь правильна - підробний і МВ перемагають
      this.awardPoints('fake_caught_correct');
      this.endRound({ fakeIsCaught: true, fakeWins: true, guessCorrect: true });
    } else {
      // Відповідь неправильна - художники перемагають
      this.awardPoints('fake_caught_wrong');
      this.endRound({ fakeIsCaught: true, fakeWins: false, guessCorrect: false });
    }

    // Відправляємо результати раунду
    this.io.to(this.code).emit('round_ended_unicorn', {
      results: this.roundResults,
      state: this.getState()
    });
  }

  awardPoints(scenario) {
    switch (scenario) {
      case 'fake_not_caught':
        // Підробний не спійманий: підробний +2
        this.scores.set(this.fakeArtistId, this.scores.get(this.fakeArtistId) + 2);
        break;

      case 'fake_caught_correct':
        // Підробний спійманий, але вгадав: підробний +2
        this.scores.set(this.fakeArtistId, this.scores.get(this.fakeArtistId) + 2);
        break;

      case 'fake_caught_wrong':
        // Підробний спійманий і не вгадав: всі художники +1
        for (let playerId of this.players.keys()) {
          if (playerId !== this.fakeArtistId) {
            this.scores.set(playerId, this.scores.get(playerId) + 1);
          }
        }
        break;
    }
  }

  endRound(results) {
    this.state = 'round_end';

    // Зберігаємо результати для показу
    this.roundResults = {
      ...results,
      fakeArtistId: this.fakeArtistId,
      word: this.currentWord,
      theme: this.currentTheme,
      scores: Object.fromEntries(this.scores)
    };

    // Перевіряємо чи хтось набрав 5 очків
    let winner = null;
    for (let [playerId, score] of this.scores) {
      if (score >= 5) {
        winner = playerId;
        break;
      }
    }

    if (winner) {
      this.state = 'game_end';
      this.winner = winner;
    }
  }

  getState() {
    const playerList = Array.from(this.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      ready: p.ready || false,  // ВИПРАВЛЕНО: Беремо з об'єкта гравця
      color: p.color
    }));

    return {
      code: this.code,
      mode: this.mode,
      state: this.state,
      players: playerList,
      scores: Object.fromEntries(this.scores),
      hostId: this.hostId,
      currentRound: this.currentRound,

      // Theme selection
      availableThemes: this.state === 'theme_selection' ? this.availableThemes : undefined,

      // Drawing phase
      currentTheme: this.state === 'drawing' || this.state === 'voting_fake' || this.state === 'fake_guessing' || this.state === 'voting_answer' || this.state === 'round_end' ? this.currentTheme : undefined,
      currentWord: this.state === 'voting_answer' || this.state === 'round_end' ? this.currentWord : undefined,
      sharedDrawing: this.sharedDrawing,
      turnOrder: this.state === 'drawing' ? this.turnOrder : undefined,
      currentTurnIndex: this.state === 'drawing' ? this.currentTurnIndex : undefined,
      currentDrawingRound: this.state === 'drawing' ? this.currentDrawingRound : undefined,

      // Voting
      votingResults: this.state === 'round_end' || this.state === 'game_end' ? this.roundResults : undefined,

      // Fake guessing
      fakeGuess: this.state === 'voting_answer' || this.state === 'round_end' ? this.fakeGuess : undefined,

      // Game end
      winner: this.state === 'game_end' ? this.winner : undefined
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
  socket.on('create_room', ({ playerName, mode }) => {
    const roomCode = generateRoomCode();
    const playerId = socket.id;

    // Створюємо кімнату відповідного типу
    let room;
    if (mode === 'unicorn_canvas') {
      room = new FakeArtistGame(roomCode, playerId, io);
    } else {
      room = new GameRoom(roomCode, playerId);
    }

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

    // Unicorn Canvas (Fake Artist) режим
    if (room.mode === 'unicorn_canvas') {
      if (room.players.size < 3) {
        socket.emit('error', { message: 'Потрібно мінімум 3 гравці' });
        return;
      }

      // Починаємо вибір тем
      room.startThemeSelection();

      // ВИПРАВЛЕНО: Відправляємо кожному гравцю його персональний набір тем
      for (let [playerId, player] of room.players) {
        const playerThemes = room.playerDisplayedThemes.get(playerId);
        io.to(player.socketId).emit('theme_selection_started', {
          availableThemes: playerThemes,
          state: room.getState()
        });
      }
      return;
    }

    // Doodle Prophet режим (оригінальна логіка)
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

  // Старт Unicorn Canvas (Fake Artist) режиму
  socket.on('start_unicorn_canvas', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || currentPlayerId !== room.hostId) return;

    // Перевіряємо чи кімната в лобі
    if (room.state !== 'lobby') {
      socket.emit('error', { message: 'Гра вже почалася' });
      return;
    }

    if (room.players.size < 3) {
      socket.emit('error', { message: 'Потрібно мінімум 3 гравці' });
      return;
    }

    // Зберігаємо дані гравців
    const playersData = [];
    for (let [playerId, player] of room.players) {
      playersData.push({
        id: playerId,
        name: player.name,
        socketId: player.socketId,
        connected: player.connected
      });
    }

    const hostId = room.hostId;
    const roomCode = room.code;

    // Очищаємо стару кімнату
    room.cleanup();

    // Створюємо нову FakeArtistGame
    const newRoom = new FakeArtistGame(roomCode, hostId, io);

    // Копіюємо гравців
    for (let playerData of playersData) {
      newRoom.addPlayer(playerData.id, playerData.name, playerData.socketId);
      // Зберігаємо стан ready якщо був
      if (room.readyPlayers && room.readyPlayers.has(playerData.id)) {
        newRoom.readyPlayers.add(playerData.id);
      }
    }

    // Замінюємо кімнату
    rooms.set(roomCode, newRoom);

    // Починаємо вибір тем
    newRoom.startThemeSelection();

    // ВИПРАВЛЕНО: Відправляємо кожному гравцю його персональний набір тем
    for (let [playerId, player] of newRoom.players) {
      const playerThemes = newRoom.playerDisplayedThemes.get(playerId);
      io.to(player.socketId).emit('theme_selection_started', {
        availableThemes: playerThemes,
        state: newRoom.getState()
      });
    }

    console.log(`Room ${roomCode} converted to Unicorn Canvas mode`);
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
      // ВИПРАВЛЕНО: Додаємо correct та правильне assignment до відповіді
      console.log(`✅ Player ${currentPlayerId} guessed ${number} for ${targetId}: ${result.correct ? 'CORRECT' : 'INCORRECT'}`);

      socket.emit('guess_accepted', {
        targetId,
        number,
        correct: result.correct,
        // Відправляємо правильне assignment (letter, number, word) щоб клієнт знав яке слово насправді загадане
        targetAssignment: result.targetAssignment
      });

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

    // ВИПРАВЛЕНО: Підтримка обох режимів гри
    if (room.mode === 'unicorn_canvas') {
      // Для Unicorn Canvas (FakeArtistGame)
      room.currentRound = 0;
      room.scores.clear();
      room.state = 'lobby';
      room.readyPlayers.clear();
      room.usedThemes = []; // Скидаємо використані теми
      room.selectedThemesPool = [];

      // ВИПРАВЛЕНО: Скидаємо ready статус для всіх гравців
      for (let [playerId] of room.players) {
        room.scores.set(playerId, 0);
        room.setPlayerReady(playerId, false);
      }
    } else {
      // Для Doodle Prophet (GameRoom)
      room.currentRound = 0;
      room.scores.clear();
      room.state = 'lobby';
      room.readyPlayers.clear();
      room.usedWordSetIndices = []; // Скидаємо використані набори

      for (let [playerId] of room.players) {
        room.scores.set(playerId, 0);
        room.setPlayerReady(playerId, false);
      }
    }

    io.to(currentRoomCode).emit('game_reset', room.getState());
  });

  // ========== UNICORN CANVAS (FAKE ARTIST) EVENTS ==========

  // Вибір тем
  socket.on('submit_theme_votes', ({ selectedThemes }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.mode !== 'unicorn_canvas') return;

    room.submitThemeVotes(currentPlayerId, selectedThemes);
    // Автоматичний emit в startRound() коли всі проголосували
  });

  // Коли вибір тем завершено і раунд починається
  socket.on('themes_finalized', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.mode !== 'unicorn_canvas' || room.state !== 'drawing') return;

    // Відправляємо кожному його карточку
    for (let [playerId, player] of room.players) {
      const card = room.playerCards.get(playerId);
      io.to(player.socketId).emit('round_started_unicorn', {
        round: room.currentRound,
        theme: room.currentTheme,
        card: card,
        turnOrder: room.turnOrder,
        currentTurnIndex: room.currentTurnIndex,
        currentDrawingRound: room.currentDrawingRound,
        state: room.getState()
      });
    }
  });

  // Малювання (штрих)
  socket.on('unicorn_drawing_stroke', ({ stroke }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.mode !== 'unicorn_canvas' || room.state !== 'drawing') return;

    const success = room.addDrawingStroke(currentPlayerId, stroke);
    if (success) {
      // Broadcast штрих всім
      io.to(currentRoomCode).emit('drawing_stroke_added', {
        stroke: {
          ...stroke,
          playerId: currentPlayerId,
          color: room.playerColors.get(currentPlayerId)
        },
        sharedDrawing: room.sharedDrawing
      });
    }
  });

  // ВИПРАВЛЕНО: Батчинг штрихів (оптимізація)
  socket.on('unicorn_drawing_strokes', ({ strokes }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.mode !== 'unicorn_canvas' || room.state !== 'drawing') return;
    if (!strokes || strokes.length === 0) return;

    // Додаємо всі штрихи
    let success = false;
    strokes.forEach(stroke => {
      if (room.addDrawingStroke(currentPlayerId, stroke)) {
        success = true;
      }
    });

    if (success) {
      // Broadcast всі штрихи разом
      io.to(currentRoomCode).emit('drawing_strokes_added', {
        strokes: strokes.map(stroke => ({
          ...stroke,
          playerId: currentPlayerId,
          color: room.playerColors.get(currentPlayerId)
        })),
        sharedDrawing: room.sharedDrawing
      });
    }
  });

  // Завершення штриху (гравець відпустив мишу)
  socket.on('stroke_finished', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.mode !== 'unicorn_canvas' || room.state !== 'drawing') return;

    room.finishTurn(currentPlayerId);
    // Автоматичний emit в nextTurn() або startVotingForFake()
  });

  // Таймер ходу вийшов
  socket.on('turn_timeout', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.mode !== 'unicorn_canvas' || room.state !== 'drawing') return;
    if (currentPlayerId !== room.turnOrder[room.currentTurnIndex]) return;

    room.nextTurn();
    // Автоматичний emit в nextTurn() або startVotingForFake()
  });

  // Голосування за підробного художника
  socket.on('vote_fake_artist', ({ suspectId }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.mode !== 'unicorn_canvas' || room.state !== 'voting_fake') return;

    room.submitVoteForFake(currentPlayerId, suspectId);
    // Автоматичний emit в finishVotingForFake()
  });

  // Коли голосування завершено (не використовується - автоматичний таймер)
  socket.on('voting_fake_finished', () => {
    // Голосування завершується автоматично через таймер або коли всі проголосували
    // Автоматичний emit в finishVotingForFake()
  });

  // Підробний вгадує слово
  socket.on('submit_fake_guess', ({ guess }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.mode !== 'unicorn_canvas' || room.state !== 'fake_guessing') return;

    room.submitGuess(currentPlayerId, guess);
    // Автоматичний emit в finishGuessing()
  });

  // Голосування за правильність відповіді
  socket.on('vote_answer_correctness', ({ isCorrect }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.mode !== 'unicorn_canvas' || room.state !== 'voting_answer') return;

    room.submitVoteForCorrectness(currentPlayerId, isCorrect);
    // Автоматичний emit в finishVotingForCorrectness()
  });

  // Коли голосування за відповідь завершено (не використовується - автоматичний таймер)
  socket.on('voting_answer_finished', () => {
    // Голосування завершується автоматично через таймер або коли всі проголосували
    // Автоматичний emit в finishVotingForCorrectness()
  });

  // Наступний раунд
  socket.on('start_next_round', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.mode !== 'unicorn_canvas' || currentPlayerId !== room.hostId) return;

    if (room.state === 'game_end') {
      socket.emit('error', { message: 'Гра завершена' });
      return;
    }

    // Починаємо новий раунд
    room.startRound();

    // Відправляємо кожному його карточку
    for (let [playerId, player] of room.players) {
      const card = room.playerCards.get(playerId);
      io.to(player.socketId).emit('round_started_unicorn', {
        round: room.currentRound,
        theme: room.currentTheme,
        card: card,
        turnOrder: room.turnOrder,
        currentTurnIndex: room.currentTurnIndex,
        currentDrawingRound: room.currentDrawingRound,
        state: room.getState()
      });
    }
  });

  // ========== END UNICORN CANVAS EVENTS ==========

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