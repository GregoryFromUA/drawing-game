import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

function App() {
  // States
  const [socket, setSocket] = useState(null);
  const [gameState, setGameState] = useState('menu');
  const [playerName, setPlayerName] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [currentRoomCode, setCurrentRoomCode] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [error, setError] = useState('');
  const [isHost, setIsHost] = useState(false);
  
  // Підключення до Socket.IO
  useEffect(() => {
    const socketUrl = window.location.hostname === 'localhost' 
      ? 'http://localhost:3001'
      : window.location.origin;
    
    const newSocket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    newSocket.on('connect', () => {
      console.log('Connected to server');
      setError('');
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setError('З\'єднання з сервером втрачено');
    });

    newSocket.on('player_id', (id) => {
      setPlayerId(id);
      console.log('Player ID received:', id);
    });

    newSocket.on('room_created', (data) => {
      setCurrentRoomCode(data.roomCode);
      setIsHost(true);
      setGameState('lobby');
      setRoomData(data.room);
      setError('');
    });

    newSocket.on('room_joined', (data) => {
      setCurrentRoomCode(data.roomCode);
      setIsHost(false);
      setGameState('lobby');
      setRoomData(data.room);
      setError('');
    });

    newSocket.on('room_updated', (room) => {
      setRoomData(room);
    });

    newSocket.on('error', (message) => {
      setError(message);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  // Функції для роботи з кімнатою
  const createRoom = () => {
    if (!playerName.trim()) {
      setError('Введіть ваше ім\'я');
      return;
    }
    if (socket) {
      socket.emit('create_room', { playerName: playerName.trim(), gameMode: 'doodle' });
    }
  };

  const joinRoom = () => {
    if (!playerName.trim()) {
      setError('Введіть ваше ім\'я');
      return;
    }
    if (!roomCode.trim()) {
      setError('Введіть код кімнати');
      return;
    }
    if (socket) {
      socket.emit('join_room', { 
        playerName: playerName.trim(), 
        roomCode: roomCode.trim().toUpperCase() 
      });
    }
  };

  const startGame = () => {
    if (socket && isHost) {
      socket.emit('start_game');
    }
  };

  const toggleReady = () => {
    if (socket) {
      socket.emit('toggle_ready');
    }
  };

  // Рендер меню
  if (gameState === 'menu') {
    return (
      <div className="lobby-container">
        <div className="lobby">
          <h1>🎨 Гра в малювання</h1>
          <div className="lobby-content">
            <div className="lobby-left">
              <div className="input-group">
                <label>Ваше ім'я:</label>
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Введіть ім'я"
                  maxLength={20}
                />
              </div>
              
              <button className="btn btn-primary" onClick={createRoom}>
                Створити кімнату
              </button>

              <div style={{ textAlign: 'center', margin: '10px 0', color: '#999' }}>
                або
              </div>

              <div className="input-group">
                <label>Код кімнати:</label>
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="Введіть код"
                  maxLength={6}
                />
              </div>

              <button className="btn btn-success" onClick={joinRoom}>
                Приєднатися
              </button>
              
              {error && <div className="error">{error}</div>}
            </div>

            <div className="lobby-right">
              <div className="rules-section">
                <h3>Про гру</h3>
                <ul>
                  <li>Мінімум 3 гравці для початку</li>
                  <li>4 раунди по 2 хвилини</li>
                  <li>Малюйте та відгадуйте!</li>
                  <li>Чим швидше відгадаєте - більше очок</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Рендер лобі
  if (gameState === 'lobby' && roomData) {
    const players = roomData.players || [];
    const minPlayers = 3;
    const allReady = players.every(p => p.ready || p.id === roomData.hostId);
    const canStart = isHost && players.length >= minPlayers && allReady;

    return (
      <div className="lobby-container">
        <div className="lobby">
          <h1>🎨 Лобі гри</h1>
          <div className="lobby-content">
            <div className="lobby-left">
              <div className="room-code">
                <h2>Код кімнати</h2>
                <div 
                  className="clickable-code"
                  onClick={() => {
                    navigator.clipboard.writeText(currentRoomCode);
                    // TODO: показати повідомлення про копіювання
                  }}
                  title="Натисніть щоб скопіювати"
                >
                  <div className="code">{currentRoomCode}</div>
                </div>
                <div className="code-hint">Натисніть щоб скопіювати</div>
              </div>

              <div className="players-list">
                <h3>Гравці ({players.length}/{minPlayers}+)</h3>
                {players.map(player => (
                  <div 
                    key={player.id}
                    className={`player-item ${player.ready ? 'ready' : ''} ${!player.connected ? 'disconnected' : ''}`}
                  >
                    <div className="player-name">
                      {player.id === roomData.hostId && '👑 '}
                      {player.name}
                      {player.id === playerId && ' (Ви)'}
                    </div>
                    <div className={`player-status ${player.ready ? 'ready' : 'waiting'}`}>
                      {player.ready ? '✓ Готовий' : 'Очікує'}
                    </div>
                  </div>
                ))}
              </div>

              {isHost ? (
                <button 
                  className="btn btn-primary" 
                  onClick={startGame}
                  disabled={!canStart}
                >
                  {canStart ? 'Почати гру' : `Потрібно ${minPlayers} гравців`}
                </button>
              ) : (
                <button 
                  className="btn btn-success" 
                  onClick={toggleReady}
                >
                  {roomData.players.find(p => p.id === playerId)?.ready ? 'Скасувати готовність' : 'Готовий!'}
                </button>
              )}
            </div>

            <div className="lobby-right">
              <div className="rules-section">
                <h3>Правила</h3>
                <ul>
                  <li>Кожен отримує своє слово для малювання</li>
                  <li>Одночасно всі малюють свої завдання</li>
                  <li>Відгадуйте малюнки інших гравців</li>
                  <li>Чим швидше відгадаєте - більше очок</li>
                  <li>За погані малюнки - штраф!</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // TODO: Додати компоненти для гри
  return (
    <div className="loading">
      <div className="loading-spinner"></div>
    </div>
  );
}

export default App;
