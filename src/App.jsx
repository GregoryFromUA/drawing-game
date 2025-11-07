import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import GameBoard from './components/GameBoard';
import OtherPlayerDrawing from './components/OtherPlayerDrawing';
import ScoreRulesModal from './components/ScoreRulesModal';


// Конфігурація
const SERVER_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3001' 
    : 'https://doodle-prophet-unicorn-canvas-cobra.onrender.com';

// Функції для копіювання в буфер обміну
function copyToClipboard(text, onSuccess) {
    // Сучасний спосіб через Clipboard API
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text)
            .then(() => onSuccess())
            .catch(err => {
                // Fallback на старий метод
                fallbackCopyToClipboard(text, onSuccess);
            });
    } else {
        // Fallback для старих браузерів
        fallbackCopyToClipboard(text, onSuccess);
    }
}

function fallbackCopyToClipboard(text, onSuccess) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        document.execCommand('copy');
        onSuccess();
    } catch (err) {
        console.error('Не вдалося скопіювати:', err);
    } finally {
        textArea.remove();
    }
}

// Головний компонент гри
function App() {
    const [socket, setSocket] = useState(null);
    const [gameState, setGameState] = useState('menu');
    const [roomCode, setRoomCode] = useState('');
    const [playerId, setPlayerId] = useState('');
    const [playerName, setPlayerName] = useState('');
    const [roomData, setRoomData] = useState(null);
    const [roundData, setRoundData] = useState(null);
    const [drawings, setDrawings] = useState({});
    const [myGuesses, setMyGuesses] = useState({});
    const [usedNumbers, setUsedNumbers] = useState(new Set());
    const [myGuessResults, setMyGuessResults] = useState({}); // НОВЕ: Зберігає правильність моїх здогадок
    const [showCorrectAnswers, setShowCorrectAnswers] = useState(false); // НОВЕ: Чи показувати правильні відповіді
    const [allCorrectAssignments, setAllCorrectAssignments] = useState({}); // НОВЕ: Всі правильні відповіді всіх гравців
    const [isDrawingLocked, setIsDrawingLocked] = useState(false);
    const [roundResults, setRoundResults] = useState(null);
    const [finalResults, setFinalResults] = useState(null);
    const [error, setError] = useState('');
    const [isHost, setIsHost] = useState(false);
    const [codeCopied, setCodeCopied] = useState(false);
    const [guessProgress, setGuessProgress] = useState({}); // НОВЕ: Прогрес здогадок гравців (для хоста)

    // Unicorn Canvas (Fake Artist) state
    const [unicornMode, setUnicornMode] = useState(false); // Чи гра в режимі Unicorn Canvas
    const [availableThemes, setAvailableThemes] = useState([]); // Доступні теми для вибору
    const [selectedThemes, setSelectedThemes] = useState([]); // Обрані теми гравцем
    const [playerCard, setPlayerCard] = useState(null); // Картка гравця {word: string, isFake: boolean}
    const [currentTheme, setCurrentTheme] = useState(null); // Поточна тема раунду
    const [sharedDrawing, setSharedDrawing] = useState([]); // Спільний канвас
    const [turnOrder, setTurnOrder] = useState([]); // Порядок ходів
    const [currentTurnIndex, setCurrentTurnIndex] = useState(0); // Індекс поточного гравця
    const [currentDrawingRound, setCurrentDrawingRound] = useState(1); // 1 або 2
    const [unicornRoundResults, setUnicornRoundResults] = useState(null); // Результати раунду
    const [fakeArtistGuess, setFakeArtistGuess] = useState(''); // Здогадка підробного
    const [themeSelectionTimeLeft, setThemeSelectionTimeLeft] = useState(30); // Таймер вибору тем

    // ВИПРАВЛЕНО: Динамічні таймери для різних фаз
    const [drawingTimeLeft, setDrawingTimeLeft] = useState(60); // Таймер рисування
    const [votingTimeLeft, setVotingTimeLeft] = useState(30); // Таймер голосування
    const [guessingTimeLeft, setGuessingTimeLeft] = useState(60); // Таймер відгадування

    // Canvas refs and state для малювання
    const canvasRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentStroke, setCurrentStroke] = useState([]);

    // ВИПРАВЛЕНО: useRef для Unicorn Canvas (винесені з умовного блоку)
    const canvasBoundsRef = useRef(null);
    const strokeBufferRef = useRef([]);
    const lastXRef = useRef(null);
    const lastYRef = useRef(null);
    const customCursorRef = useRef(null);
    const ctxRef = useRef(null);
    const lastDrawnIndexRef = useRef(0); // Індекс останнього намальованого штриху

    // State для голосувань в Unicorn Canvas
    const [myVoteForFake, setMyVoteForFake] = useState(null);
    const [fakeGuessInput, setFakeGuessInput] = useState('');
    const [myVoteForAnswer, setMyVoteForAnswer] = useState(null);
    const [showRules, setShowRules] = useState(false);

    // Ініціалізація Socket.io
    useEffect(() => {
        const newSocket = io(SERVER_URL);
        
        newSocket.on('connect', () => {
            console.log('Connected to server');
        });
        
        newSocket.on('room_created', ({ roomCode, playerId, state }) => {
            setRoomCode(roomCode);
            setPlayerId(playerId);
            setRoomData(state);
            setGameState('lobby');
            setIsHost(true);
            localStorage.setItem('gameSession', JSON.stringify({ roomCode, playerId, playerName }));
        });
        
        newSocket.on('joined_room', ({ roomCode, playerId, state }) => {
            setRoomCode(roomCode);
            setPlayerId(playerId);
            setRoomData(state);
            setGameState('lobby');
            setIsHost(state.hostId === playerId);
            // ВИПРАВЛЕНО: Синхронізуємо показ правильних відповідей
            if (state?.answersRevealed !== undefined) {
                setShowCorrectAnswers(state.answersRevealed);
            }
            localStorage.setItem('gameSession', JSON.stringify({ roomCode, playerId, playerName }));
        });
        
        newSocket.on('player_joined', (state) => {
            setRoomData(state);
            // ВИПРАВЛЕНО: Синхронізуємо показ правильних відповідей
            if (state?.answersRevealed !== undefined) {
                setShowCorrectAnswers(state.answersRevealed);
            }
        });

        newSocket.on('player_ready_changed', (state) => {
            setRoomData(state);
            // ВИПРАВЛЕНО: Синхронізуємо показ правильних відповідей
            if (state?.answersRevealed !== undefined) {
                setShowCorrectAnswers(state.answersRevealed);
            }
        });
        
        newSocket.on('round_started', (data) => {
            setRoundData(data);
            setGameState('playing');
            setDrawings({});
            setMyGuesses({});
            setUsedNumbers(new Set());
            setMyGuessResults({}); // НОВЕ: Очищаємо результати здогадок
            setShowCorrectAnswers(false); // НОВЕ: Скидаємо показ правильних відповідей
            setAllCorrectAssignments({}); // НОВЕ: Очищаємо всі правильні відповіді
            // НЕ очищаємо guessProgress - він оновиться автоматично через guess_progress_update
            setIsDrawingLocked(false);
        });
        
        newSocket.on('drawing_updated', ({ playerId, strokes }) => {
            setDrawings(prev => ({
                ...prev,
                [playerId]: [...(prev[playerId] || []), ...strokes]
            }));
        });
        
        newSocket.on('canvas_cleared', ({ playerId }) => {
            setDrawings(prev => ({
                ...prev,
                [playerId]: []
            }));
        });
        
        newSocket.on('drawing_locked', ({ playerId: lockedPlayerId }) => {
            if (lockedPlayerId === playerId) {
                setIsDrawingLocked(true);
            }
        });

        newSocket.on('guess_accepted', ({ targetId, number, letter, correct, targetAssignment }) => {
            console.log('✅ guess_accepted:', { targetId, number, letter, correct, targetAssignment }); // DEBUG
            setMyGuesses(prev => ({ ...prev, [targetId]: { letter, number } }));
            setUsedNumbers(prev => new Set([...prev, `${letter}${number}`]));

            // НЕ обновляем wordAssignments - оставляем выбор пользователя для визуальной подсказки
            // Вместо этого сохраняем правильный ответ в myGuessResults
            setMyGuessResults(prev => {
                const newResults = {
                    ...prev,
                    [targetId]: {
                        letter,
                        number,
                        correct,
                        // Сохраняем правильное assignment от сервера
                        targetAssignment: targetAssignment
                    }
                };
                console.log('📊 myGuessResults updated:', newResults);
                return newResults;
            });
        });

        // НОВЕ: Обробник показу правильних відповідей
        newSocket.on('answers_revealed', ({ state, assignments }) => {
            console.log('📢 Answers revealed by host', state, assignments);
            if (state?.answersRevealed) {
                setShowCorrectAnswers(true);
            }
            if (assignments) {
                setAllCorrectAssignments(assignments);
                console.log('📋 All correct assignments:', assignments);
            }
        });

        // НОВЕ: Обробник оновлення прогресу здогадок (тільки для хоста)
        newSocket.on('guess_progress_update', ({ progress }) => {
            setGuessProgress(progress);
            console.log('📊 Guess progress updated:', progress);
        });

        newSocket.on('round_ended', (results) => {
            setRoundResults(results);
            setGameState('round_end');
        });
        
        newSocket.on('game_ended', (results) => {
            setFinalResults(results);
            setGameState('game_end');
        });
        
        newSocket.on('game_reset', (state) => {
            setRoomData(state);
            setGameState('lobby');
            setRoundData(null);
            setRoundResults(null);
            setFinalResults(null);
            // ВИПРАВЛЕНО: Очищаємо весь state Unicorn Canvas
            setAvailableThemes([]);
            setSelectedThemes([]);
            setPlayerCard(null);
            setCurrentTheme(null);
            setSharedDrawing([]);
            setTurnOrder([]);
            setCurrentTurnIndex(0);
            setCurrentDrawingRound(1);
            setUnicornRoundResults(null);
            setFakeArtistGuess('');
            setMyVoteForFake(null);
            setFakeGuessInput('');
            setMyVoteForAnswer(null);
            setIsDrawing(false);
            setCurrentStroke([]);
            // Очищаємо буфер штрихів
            if (strokeBufferRef.current) {
                strokeBufferRef.current = [];
            }
        });
        
        newSocket.on('error', ({ message }) => {
            setError(message);
        });
        
        newSocket.on('player_disconnected', ({ playerId: disconnectedId, state }) => {
            setRoomData(state);
        });

        // ========== UNICORN CANVAS EVENTS ==========

        newSocket.on('theme_selection_started', ({ availableThemes, state }) => {
            console.log('Theme selection started', availableThemes);
            setUnicornMode(true);
            setAvailableThemes(availableThemes);
            setGameState('theme_selection');
            setRoomData(state);
            setThemeSelectionTimeLeft(20); // Скидаємо таймер
        });

        newSocket.on('round_started_unicorn', ({ round, theme, card, turnOrder, currentTurnIndex, currentDrawingRound, state }) => {
            console.log('Unicorn round started', { round, theme, card });
            setCurrentTheme(theme);
            setPlayerCard(card);
            setTurnOrder(turnOrder);
            setCurrentTurnIndex(currentTurnIndex);
            setCurrentDrawingRound(currentDrawingRound);
            setSharedDrawing([]);
            // ВИПРАВЛЕНО: Скидаємо індекс при новому раунді
            lastDrawnIndexRef.current = 0;
            // ВИПРАВЛЕНО: НЕ очищаємо тут - useEffect зробить це при реініціалізації
            setGameState('unicorn_drawing');
            setRoomData(state);
        });

        newSocket.on('drawing_stroke_added', ({ stroke, sharedDrawing }) => {
            setSharedDrawing(sharedDrawing);
        });

        // ВИПРАВЛЕНО: Батчинг штрихів (оптимізація)
        newSocket.on('drawing_strokes_added', ({ strokes, sharedDrawing }) => {
            setSharedDrawing(sharedDrawing);
        });

        newSocket.on('next_turn', ({ currentTurnIndex, currentDrawingRound, currentPlayerId, state }) => {
            setCurrentTurnIndex(currentTurnIndex);
            setCurrentDrawingRound(currentDrawingRound);
            setRoomData(state);
        });

        newSocket.on('voting_for_fake_started', ({ state }) => {
            console.log('Voting for fake started');
            setGameState('voting_fake');
            setRoomData(state);
        });

        newSocket.on('fake_guessing_started', ({ fakeArtistId, state }) => {
            console.log('Fake guessing started', fakeArtistId);
            setGameState('fake_guessing');
            setRoomData(state);
        });

        newSocket.on('voting_answer_started', ({ fakeGuess, word, state }) => {
            console.log('Voting answer started', { fakeGuess, word });
            setFakeArtistGuess(fakeGuess);
            setGameState('voting_answer');
            setRoomData(state);
        });

        newSocket.on('round_ended_unicorn', ({ results, state }) => {
            console.log('Unicorn round ended', results);
            setUnicornRoundResults(results);
            setGameState('unicorn_round_end');
            setRoomData(state);
        });

        // ========== END UNICORN CANVAS EVENTS ==========

        setSocket(newSocket);
        
        // Спроба відновити сесію
        const savedSession = localStorage.getItem('gameSession');
        if (savedSession) {
            const { roomCode: savedRoom, playerId: savedId, playerName: savedName } = JSON.parse(savedSession);
            if (savedRoom && savedId && savedName) {
                setPlayerName(savedName);
                newSocket.emit('join_room', { 
                    roomCode: savedRoom, 
                    playerName: savedName, 
                    playerId: savedId 
                });
            }
        }
        
        return () => {
            newSocket.close();
        };
    }, []);

    // Таймер вибору тем
    useEffect(() => {
        if (gameState === 'theme_selection') {
            const timer = setInterval(() => {
                setThemeSelectionTimeLeft(prev => {
                    if (prev <= 0) return 0;
                    return prev - 1;
                });
            }, 1000);

            return () => clearInterval(timer);
        }
    }, [gameState]);

    // Автоматично відправляємо вибір коли таймер закінчується
    useEffect(() => {
        if (gameState === 'theme_selection' && themeSelectionTimeLeft === 0 && socket) {
            console.log('Auto-submitting themes:', selectedThemes);
            socket.emit('submit_theme_votes', { selectedThemes });
        }
    }, [gameState, themeSelectionTimeLeft, socket, selectedThemes]);

    // ВИПРАВЛЕНО: Таймер фази малювання
    useEffect(() => {
        if (gameState === 'unicorn_drawing') {
            setDrawingTimeLeft(60); // Скидаємо при вході в фазу
            const timer = setInterval(() => {
                setDrawingTimeLeft(prev => {
                    if (prev <= 0) return 0;
                    return prev - 1;
                });
            }, 1000);
            return () => clearInterval(timer);
        }
    }, [gameState, currentTurnIndex]); // Скидати при зміні ходу

    // ВИПРАВЛЕНО: Таймер голосування
    useEffect(() => {
        if (gameState === 'voting_fake') {
            setVotingTimeLeft(30); // Скидаємо при вході в фазу
            const timer = setInterval(() => {
                setVotingTimeLeft(prev => {
                    if (prev <= 0) return 0;
                    return prev - 1;
                });
            }, 1000);
            return () => clearInterval(timer);
        }
    }, [gameState]);

    // ВИПРАВЛЕНО: Таймер відгадування
    useEffect(() => {
        if (gameState === 'fake_guessing') {
            setGuessingTimeLeft(30); // Скидаємо при вході в фазу
            const timer = setInterval(() => {
                setGuessingTimeLeft(prev => {
                    if (prev <= 0) return 0;
                    return prev - 1;
                });
            }, 1000);
            return () => clearInterval(timer);
        }
    }, [gameState]);

    // ВИПРАВЛЕНО: Інкрементальне малювання - тільки НОВІ штрихи!
    useEffect(() => {
        if (gameState !== 'unicorn_drawing' || !ctxRef.current) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = ctxRef.current;

        // Малюємо тільки НОВІ штрихи (від lastDrawnIndexRef до кінця)
        for (let i = lastDrawnIndexRef.current; i < sharedDrawing.length; i++) {
            const stroke = sharedDrawing[i];

            // ВИПРАВЛЕНО: Пропускаємо свої власні штрихи (вони вже намальовані локально)
            if (stroke.playerId === playerId) {
                continue;
            }

            if (stroke.type === 'fill') {
                // Обработка заливки всего canvas
                ctx.fillStyle = stroke.color || '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            } else if (stroke.type === 'start') {
                ctx.beginPath();
                ctx.strokeStyle = stroke.color || '#000000';
                ctx.fillStyle = stroke.color || '#000000';
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                const x = (stroke.x / 1000) * canvas.width;  // Декодуємо з integer 0-1000
                const y = (stroke.y / 1000) * canvas.height;  // Декодуємо з integer 0-1000
                // Малюємо початкову точку
                ctx.arc(x, y, 1.5, 0, 2 * Math.PI);
                ctx.fill();
                ctx.beginPath();
                ctx.moveTo(x, y);
            } else if (stroke.type === 'draw') {
                const x = (stroke.x / 1000) * canvas.width;  // Декодуємо з integer 0-1000
                const y = (stroke.y / 1000) * canvas.height;  // Декодуємо з integer 0-1000
                ctx.lineTo(x, y);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x, y);
            }
        }

        // Оновлюємо індекс останнього намальованого штриху
        lastDrawnIndexRef.current = sharedDrawing.length;
    }, [gameState, sharedDrawing]);

    // Скидання стану малювання при зміні gameState
    useEffect(() => {
        if (gameState !== 'unicorn_drawing') {
            setIsDrawing(false);
            setCurrentStroke([]);
        }
        if (gameState !== 'voting_fake') {
            setMyVoteForFake(null);
        }
        if (gameState !== 'fake_guessing') {
            setFakeGuessInput('');
        }
        if (gameState !== 'voting_answer') {
            setMyVoteForAnswer(null);
        }
    }, [gameState]);

    // ВИПРАВЛЕНО: Ініціалізація canvas для Unicorn Canvas
    useEffect(() => {
        if (gameState !== 'unicorn_drawing' && gameState !== 'voting_fake' && gameState !== 'fake_guessing' && gameState !== 'voting_answer') return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        // ВИПРАВЛЕНО: Завжди реініціалізуємо при вході у фазу малювання
        if (gameState === 'unicorn_drawing' || !ctxRef.current) {
            // Ініціалізуємо контекст з оптимізаціями
            const ctx = canvas.getContext('2d', {
                alpha: false,  // ВИПРАВЛЕНО: false для білого фону!
                desynchronized: true  // КРИТИЧНО для performance!
            });
            ctxRef.current = ctx;

            canvas.width = 800;
            canvas.height = 600;

            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            // ВИПРАВЛЕНО: Заливаємо білим фоном!
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Кешуємо bounds
            const updateBounds = () => {
                canvasBoundsRef.current = canvas.getBoundingClientRect();
            };
            updateBounds();
            window.addEventListener('resize', updateBounds);
            return () => window.removeEventListener('resize', updateBounds);
        }
    }, [gameState]);

    // ВИПРАВЛЕНО: Батчинг з інтервалом для оптимізації трафіку
    useEffect(() => {
        if (gameState !== 'unicorn_drawing' && gameState !== 'voting_fake' && gameState !== 'fake_guessing' && gameState !== 'voting_answer') return;

        let intervalId;

        const sendStrokes = () => {
            if (strokeBufferRef.current.length > 0 && socket) {
                socket.emit('unicorn_drawing_strokes', {
                    strokes: strokeBufferRef.current
                });
                strokeBufferRef.current = [];
            }
        };

        // Відправляємо кожні 150ms (зменшення трафіку в ~9 разів)
        intervalId = setInterval(sendStrokes, 150);

        return () => {
            clearInterval(intervalId);
            // Відправляємо залишки при unmount
            if (strokeBufferRef.current.length > 0 && socket) {
                socket.emit('unicorn_drawing_strokes', {
                    strokes: strokeBufferRef.current
                });
            }
        };
    }, [gameState, socket]);

    // ВИПРАВЛЕНО: useCallback для курсора (винесено з умовного блоку)
    const updateCustomCursor = useCallback((x, y) => {
        if (!customCursorRef.current) return;
        customCursorRef.current.style.left = `${x}px`;
        customCursorRef.current.style.top = `${y}px`;
    }, []);

    // Обробники подій
    const createRoom = () => {
        if (playerName.trim() && socket) {
            socket.emit('create_room', { playerName });
        }
    };
    
    const joinRoom = () => {
        if (playerName.trim() && roomCode.trim() && socket) {
            socket.emit('join_room', { roomCode: roomCode.toUpperCase(), playerName });
        }
    };
    
    const toggleReady = () => {
        if (socket && roomData) {
            const isReady = roomData.players.find(p => p.id === playerId)?.ready;
            socket.emit('player_ready', { ready: !isReady });
        }
    };
    
    const startGame = () => {
        if (socket && isHost) {
            socket.emit('start_game');
        }
    };

    const startUnicornCanvas = () => {
        if (socket && isHost) {
            socket.emit('start_unicorn_canvas');
        }
    };

    const makeGuess = (targetId, number, letter) => {
        if (socket && !myGuesses[targetId]) {
            socket.emit('make_guess', { targetId, number, letter });
        }
    };

    const endRound = () => {
        if (socket && isHost) {
            socket.emit('end_round');
        }
    };

    const nextRound = () => {
        if (socket && isHost) {
            socket.emit('next_round');
        }
    };
    
    const newGame = () => {
        if (socket && isHost) {
            socket.emit('new_game');
        }
    };
    
    const handleCopyCode = () => {
        copyToClipboard(roomCode, () => {
            setCodeCopied(true);
            setTimeout(() => setCodeCopied(false), 2000);
        });
    };
    
    // Рендер різних екранів
    if (gameState === 'menu') {
        const hasRoomCode = roomCode.trim().length > 0;
        const hasPlayerName = playerName.trim().length > 0;
        const canJoin = hasRoomCode && hasPlayerName;
        
        return (
            <div className="lobby-container">
                <div className="lobby">
                    <h1>Doodle Prophet Unicorn Canvas Cobra</h1>
                    
                    {error && <div className="error-message">{error}</div>}
                    
                    <div className="input-group">
                        <label>Ваше ім'я:</label>
                        <input
                            type="text"
                            value={playerName}
                            onChange={(e) => setPlayerName(e.target.value)}
                            placeholder={hasRoomCode && !hasPlayerName ? "Введіть своє ім'я ТУТ" : "Captain Obvious"}
                            maxLength={15}
                            style={hasRoomCode && !hasPlayerName ? {borderColor: '#ff9800', borderWidth: '2px'} : {}}
                        />
                    </div>
                    
                    <button 
                        className="btn btn-primary"
                        onClick={createRoom}
                        disabled={!playerName.trim()}
                        style={{ width: '100%', marginBottom: '15px' }}
                    >
                        Створити кімнату
                    </button>
                    
                    <div style={{ margin: '15px 0', textAlign: 'center' }}>
                        <span style={{ color: '#999' }}>— або —</span>
                    </div>
                    
                    <div className="input-group">
                        <label>Код кімнати:</label>
                        <input
                            type="text"
                            value={roomCode}
                            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                            placeholder="Введіть код кімнати"
                            maxLength={6}
                        />
                    </div>
                    
                    <button 
                        className={`btn ${canJoin ? 'btn-success' : 'btn-secondary'}`}
                        onClick={joinRoom}
                        disabled={!canJoin}
                        style={{ width: '100%' }}
                    >
                        Приєднатися до кімнати
                    </button>
                </div>
            </div>
        );
    }
    
    if (gameState === 'lobby') {
        return (
            <div className="lobby-container">
                <div className="lobby">
                    <h1>Кімната очікування</h1>
                    
                    <div className="lobby-content">
                        <div className="lobby-left">
                            <div className="room-code">
                                <h2>Код кімнати:</h2>
                                <div 
                                    className="code clickable-code"
                                    onClick={handleCopyCode}
                                    title="Натисніть щоб скопіювати"
                                >
                                    {roomCode}
                                    {codeCopied && <span className="copy-success">✓ Скопійовано!</span>}
                                </div>
                                <div className="code-hint">Натисніть на код щоб скопіювати</div>
                            </div>
                            
                            <div className="rules-section">
                                <h3>ПРАВИЛА МАЛЮВАННЯ</h3>
                                <ul>
                                    <li>НЕ малюйте літери чи цифри. Наприклад, якщо у вас слово "книга", ви не можете намалювати літери К-Н-И-Г-А</li>
                                    <li>НЕ використовуйте символи чи цифри, які прямо вказують на ваше завдання.</li>
                                    <li>Вам потрібно передавати ідею, суть, концепцію слова через візуальні образи.</li>
                                </ul>
                            </div>
                        </div>
                        
                        <div className="lobby-right">
                            <div className="players-list">
                                <h3>Гравці ({roomData?.players?.length || 0}/12):</h3>
                                {roomData?.players?.map(player => (
                                    <div
                                        key={player.id}
                                        className={`player-item ${player.ready ? 'ready' : ''} ${!player.connected ? 'disconnected' : ''}`}
                                    >
                                        <span className="player-name" style={{ color: player.color || '#000', fontWeight: 'bold' }}>
                                            {player.name}
                                            {player.id === playerId && ' (Ви)'}
                                            {player.id === roomData.hostId && ' 👑'}
                                        </span>
                                        <span className={`player-status ${player.ready ? 'ready-badge' : ''}`}>
                                            {!player.connected ? 'Відкл.' : player.ready ? 'Готовий' : 'Не готовий'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            
                            <div className="lobby-buttons">
                                <button 
                                    className={`btn ${roomData?.players?.find(p => p.id === playerId)?.ready ? 'btn-danger' : 'btn-success'}`}
                                    onClick={toggleReady}
                                >
                                    {roomData?.players?.find(p => p.id === playerId)?.ready ? 'Не готовий' : 'Готовий'}
                                </button>
                                
                                {isHost && (
                                    <>
                                        <button
                                            className="btn btn-primary"
                                            onClick={startGame}
                                            disabled={roomData?.players?.length < 3 || !roomData?.players?.every(p => p.ready)}
                                        >
                                            {roomData?.players?.length < 3 ? 'Мінімум 3' : 'Doodle Prophet'}
                                        </button>
                                        <button
                                            className="btn btn-primary"
                                            onClick={startUnicornCanvas}
                                            disabled={roomData?.players?.length < 3 || !roomData?.players?.every(p => p.ready)}
                                        >
                                            {roomData?.players?.length < 3 ? 'Мінімум 3' : 'Unicorn Canvas'}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // UNICORN CANVAS: Вибір тем
    if (gameState === 'theme_selection') {
        const handleThemeToggle = (theme) => {
            setSelectedThemes(prev => {
                if (prev.includes(theme)) {
                    return prev.filter(t => t !== theme);
                } else if (prev.length < 5) {
                    return [...prev, theme];
                }
                return prev;
            });
        };

        return (
            <div className="lobby-container">
                <div className="lobby">
                    <h1>Оберіть 5 тем для гри</h1>
                    <p>Таймер: {themeSelectionTimeLeft} сек.</p>
                    <p>Обрано: {selectedThemes.length}/5</p>
                    <p style={{color: '#999', fontSize: '14px', marginTop: '5px'}}>
                        Теми відправляться автоматично коли закінчиться таймер
                    </p>

                    <div className="theme-grid" style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: '10px',
                        maxWidth: '800px',
                        margin: '20px auto'
                    }}>
                        {availableThemes.map(theme => (
                            <button
                                key={theme}
                                onClick={() => handleThemeToggle(theme)}
                                className={`btn ${selectedThemes.includes(theme) ? 'btn-success' : 'btn-secondary'}`}
                                disabled={!selectedThemes.includes(theme) && selectedThemes.length >= 5}
                                style={{
                                    padding: '15px',
                                    fontSize: '14px',
                                    opacity: (!selectedThemes.includes(theme) && selectedThemes.length >= 5) ? 0.5 : 1
                                }}
                            >
                                {theme}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // UNICORN CANVAS: Фаза малювання (та додаткові фази з канвасом)
    if (gameState === 'unicorn_drawing' || gameState === 'voting_fake' || gameState === 'fake_guessing' || gameState === 'voting_answer') {
        const currentPlayerId = turnOrder[currentTurnIndex];
        const isMyTurn = currentPlayerId === playerId;
        const currentPlayer = roomData?.players?.find(p => p.id === currentPlayerId);

        const startDrawing = (e) => {
            if (!isMyTurn || !canvasBoundsRef.current || !ctxRef.current) return;

            const canvas = canvasRef.current;
            const rect = canvasBoundsRef.current;
            const x = (e.clientX - rect.left) * (canvas.width / rect.width);
            const y = (e.clientY - rect.top) * (canvas.height / rect.height);

            setIsDrawing(true);
            lastXRef.current = x;
            lastYRef.current = y;

            const ctx = ctxRef.current;
            // ВИПРАВЛЕНО: Малюємо ЦВЕТОМ ИГРОКА одразу!
            const myColor = roomData?.players?.find(p => p.id === playerId)?.color || '#000000';

            ctx.strokeStyle = myColor;
            ctx.fillStyle = myColor;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(x, y, 1.5, 0, 2 * Math.PI);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(x, y);

            // ВИПРАВЛЕНО: Відправляємо округлені координати для економії трафіку
            const stroke = { type: 'start', x: Math.round((x / canvas.width) * 1000), y: Math.round((y / canvas.height) * 1000), color: myColor, playerId };
            strokeBufferRef.current.push(stroke);
        };

        const draw = (e) => {
            if (!isMyTurn || !isDrawing || !canvasBoundsRef.current || !ctxRef.current || lastXRef.current === null) return;

            e.preventDefault();

            const canvas = canvasRef.current;
            const rect = canvasBoundsRef.current;
            const x = (e.clientX - rect.left) * (canvas.width / rect.width);
            const y = (e.clientY - rect.top) * (canvas.height / rect.height);

            // ВИПРАВЛЕНО: Малюємо локально ОДРАЗУ ЦВЕТОМ ИГРОКА!
            const ctx = ctxRef.current;
            const myColor = roomData?.players?.find(p => p.id === playerId)?.color || '#000000';

            ctx.strokeStyle = myColor;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(lastXRef.current, lastYRef.current);
            ctx.lineTo(x, y);
            ctx.stroke();

            lastXRef.current = x;
            lastYRef.current = y;

            // ВИПРАВЛЕНО: Відправляємо округлені координати для економії трафіку
            const stroke = { type: 'draw', x: Math.round((x / canvas.width) * 1000), y: Math.round((y / canvas.height) * 1000), color: myColor, playerId };
            strokeBufferRef.current.push(stroke);

            // Оновлюємо custom cursor
            updateCustomCursor(e.clientX, e.clientY);
        };

        const stopDrawing = () => {
            if (!isMyTurn || !isDrawing) return;

            setIsDrawing(false);
            lastXRef.current = null;
            lastYRef.current = null;

            const stroke = { type: 'end' };
            strokeBufferRef.current.push(stroke);

            // ВИПРАВЛЕНО: requestAnimationFrame сам відправить залишки
            // Хід завершено
            if (socket) {
                socket.emit('stroke_finished');
            }
        };

        return (
            <div className="game-container" style={{ padding: '20px' }}>
                <div style={{ display: 'flex', gap: '20px' }}>
                    {/* Ліва панель: Картка та порядок гравців */}
                    <div style={{ width: '250px' }}>
                        <div className="player-card" style={{
                            padding: '20px',
                            background: '#f0f0f0',
                            borderRadius: '10px',
                            marginBottom: '20px'
                        }}>
                            <h3>Ваша картка</h3>
                            <div style={{ fontSize: '18px', marginTop: '10px' }}>
                                <strong>Категорія:</strong> {currentTheme}
                            </div>
                            <div style={{
                                fontSize: (() => {
                                    const word = playerCard?.word || '';
                                    const length = word.length;
                                    const wordCount = word.split(' ').length;
                                    // Адаптивний розмір шрифту залежно від довжини
                                    if (wordCount > 1 || length > 15) return '20px';
                                    if (length > 10) return '26px';
                                    return '32px';
                                })(),
                                fontWeight: 'bold',
                                marginTop: '15px',
                                padding: '20px',
                                background: playerCard?.isFake ? '#ffcccc' : '#ccffcc',
                                borderRadius: '5px',
                                textAlign: 'center',
                                lineHeight: '1.3'
                            }}>
                                {playerCard?.word}
                            </div>
                        </div>

                        <div className="turn-order" style={{
                            padding: '15px',
                            background: '#f9f9f9',
                            borderRadius: '10px'
                        }}>
                            <h3>Порядок ходів (Раунд {currentDrawingRound}/2)</h3>
                            {turnOrder.map((pid, index) => {
                                const player = roomData?.players?.find(p => p.id === pid);
                                const isCurrent = index === currentTurnIndex;
                                const isDone = index < currentTurnIndex || (currentDrawingRound === 2 && index < currentTurnIndex);

                                return (
                                    <div key={pid} style={{
                                        padding: '8px',
                                        marginTop: '5px',
                                        background: isCurrent ? '#4CAF50' : (isDone ? '#e0e0e0' : 'white'),
                                        borderRadius: '5px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px'
                                    }}>
                                        <div style={{
                                            width: '20px',
                                            height: '20px',
                                            borderRadius: '50%',
                                            background: player?.color || '#ccc'
                                        }}></div>
                                        <span style={{
                                            fontWeight: isCurrent ? 'bold' : 'normal',
                                            color: isCurrent ? 'white' : (player?.color || '#000')
                                        }}>
                                            {player?.name || 'Гравець'}
                                            {pid === playerId && ' (Ви)'}
                                            {isCurrent && ' 🎨'}
                                            {isDone && ' ✓'}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>

                        <div style={{ marginTop: '20px', textAlign: 'center' }}>
                            <h3>
                                {isMyTurn ? 'Ваш хід!' : (
                                    <>
                                        Малює: <span style={{ color: currentPlayer?.color || '#000' }}>{currentPlayer?.name}</span>
                                    </>
                                )}
                            </h3>
                            <div style={{ fontSize: '24px', color: drawingTimeLeft <= 10 ? '#ff0000' : '#666' }}>
                                ⏱️ {drawingTimeLeft} сек.
                            </div>
                        </div>

                        {/* Кнопка "Правила гри" */}
                        <div style={{ marginTop: '20px', textAlign: 'center' }}>
                            <button
                                onClick={() => setShowRules(true)}
                                className="btn btn-secondary"
                                style={{ fontSize: '14px', padding: '10px 20px' }}
                            >
                                ❓ Правила гри
                            </button>
                        </div>
                    </div>

                    {/* Центр: Спільний канвас */}
                    <div style={{ flex: 1, position: 'relative' }}>
                        <h2 style={{ textAlign: 'center', marginBottom: '10px' }}>
                            Спільний малюнок
                        </h2>
                        <canvas
                            ref={canvasRef}
                            width={800}
                            height={600}
                            onMouseDown={startDrawing}
                            onMouseMove={(e) => {
                                draw(e);
                                updateCustomCursor(e.clientX, e.clientY);
                            }}
                            onMouseUp={stopDrawing}
                            onMouseLeave={() => {
                                stopDrawing();
                                if (customCursorRef.current) {
                                    customCursorRef.current.style.display = 'none';
                                }
                            }}
                            onMouseEnter={(e) => {
                                if (isMyTurn && customCursorRef.current) {
                                    customCursorRef.current.style.display = 'block';
                                    updateCustomCursor(e.clientX, e.clientY);
                                }
                            }}
                            style={{
                                border: '2px solid #333',
                                borderRadius: '10px',
                                background: 'white',
                                cursor: isMyTurn ? 'none' : 'not-allowed',
                                display: 'block',
                                margin: '0 auto',
                                touchAction: 'none'
                            }}
                        />
                        <div style={{ textAlign: 'center', marginTop: '10px', color: '#666' }}>
                            {isMyTurn ? 'Намалюйте одну лінію (відпустіть мишу щоб завершити хід)' : 'Чекайте свого ходу...'}
                        </div>

                        {/* ВИПРАВЛЕНО: Custom cursor */}
                        {isMyTurn && (
                            <div
                                ref={customCursorRef}
                                style={{
                                    position: 'fixed',
                                    width: '10px',
                                    height: '10px',
                                    borderRadius: '50%',
                                    backgroundColor: roomData?.players?.find(p => p.id === playerId)?.color || '#000000',
                                    pointerEvents: 'none',
                                    zIndex: 9999,
                                    transform: 'translate(-50%, -50%)',
                                    display: 'none',
                                    border: '2px solid white',
                                    boxShadow: '0 0 3px rgba(0,0,0,0.5)'
                                }}
                            />
                        )}
                    </div>

                    {/* Права панель: Очки */}
                    <div style={{ width: '200px' }}>
                        <div style={{
                            padding: '15px',
                            background: '#f9f9f9',
                            borderRadius: '10px'
                        }}>
                            <h3>Рахунок</h3>
                            {roomData?.players?.map(player => (
                                <div key={player.id} style={{
                                    padding: '8px',
                                    marginTop: '5px',
                                    background: 'white',
                                    borderRadius: '5px'
                                }}>
                                    <div style={{ fontWeight: 'bold', color: player.color || '#000' }}>
                                        {player.name}
                                        {player.id === playerId && ' (Ви)'}
                                    </div>
                                    <div style={{ fontSize: '20px', color: '#4CAF50' }}>
                                        {roomData?.scores?.[player.id] || 0} очок
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* МОДАЛЬНЕ ВІКНО: Правила гри */}
                {showRules && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10000
                    }}>
                        <div style={{
                            backgroundColor: 'white',
                            padding: '30px',
                            borderRadius: '15px',
                            maxWidth: '700px',
                            maxHeight: '80vh',
                            overflow: 'auto',
                            position: 'relative',
                            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)'
                        }}>
                            <button
                                onClick={() => setShowRules(false)}
                                style={{
                                    position: 'absolute',
                                    top: '15px',
                                    right: '15px',
                                    background: 'none',
                                    border: 'none',
                                    fontSize: '28px',
                                    cursor: 'pointer',
                                    color: '#666'
                                }}
                            >
                                ×
                            </button>

                            <h2 style={{ marginBottom: '20px', color: '#333' }}>Правила гри "Підробний художник"</h2>

                            <div style={{ lineHeight: '1.6', color: '#555' }}>
                                <h3 style={{ marginTop: '15px', color: '#4CAF50' }}>Хід гри:</h3>

                                <p><strong>1. Вибір тем</strong></p>
                                <p>Кожен гравець обирає 5 тем з 12 запропонованих. З обраних тем формується пул завдань для раунду.</p>

                                <p style={{ marginTop: '15px' }}><strong>2. Роздача карток</strong></p>
                                <p>Усім гравцям показується категорія. Справжні художники бачать загадане слово. Один підробний художник бачить "Х" замість слова.</p>

                                <p style={{ marginTop: '15px' }}><strong>3. Малювання</strong></p>
                                <p>Гравці по черзі малюють ОДНУ лінію на спільному полотні. Відпустив мишку - ваше малювання закінчилось.</p>
                                <p>Кожен робить 2 ходи. Підробний художник повинен малювати так, щоб не видати себе.</p>

                                <p style={{ marginTop: '15px' }}><strong>4. Голосування</strong></p>
                                <p>Після малювання всі гравці, в тому числі і підробний художник, голосують за підозрілого гравця.</p>
                                <p>Якщо більшість голосів набирає підробний художник - він розкривається.</p>
                                <p>Якщо більшість голосів вказують на справжнього художника - підробний набирає очки, бо його не викрили.</p>

                                <p style={{ marginTop: '15px' }}><strong>5. Відгадування</strong></p>
                                <p>Якщо підробного знайдено - він може спробувати вгадати слово. Якщо вгадає - отримує очки.</p>

                                <h3 style={{ marginTop: '20px', color: '#4CAF50' }}>Нарахування очок:</h3>
                                <ul style={{ marginLeft: '20px' }}>
                                    <li>Підробний НЕ знайдений → Підробний: <strong>+2 очка</strong></li>
                                    <li>Підробний знайдений, але вгадав слово → Підробний: <strong>+2 очка</strong></li>
                                    <li>Підробний знайдений і НЕ вгадав → Художники: <strong>+1 очко кожен</strong></li>
                                </ul>

                                <div style={{
                                    marginTop: '20px',
                                    padding: '15px',
                                    backgroundColor: '#e8f5e9',
                                    borderRadius: '8px',
                                    borderLeft: '4px solid #4CAF50'
                                }}>
                                    <strong>💡 Порада:</strong> Підробний художник повинен уважно спостерігати за малюнками інших і малювати щось схоже.
                                </div>
                            </div>

                            <div style={{ marginTop: '25px', textAlign: 'center' }}>
                                <button
                                    onClick={() => setShowRules(false)}
                                    className="btn btn-primary"
                                    style={{ padding: '10px 30px', fontSize: '16px' }}
                                >
                                    Зрозуміло
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* МОДАЛЬНА СЕКЦІЯ: Голосування за підробного художника */}
                {gameState === 'voting_fake' && (
                    <div className="modal-section" style={{ maxWidth: '800px', margin: '20px auto' }}>
                        <h2 style={{ fontSize: '22px', marginBottom: '10px', textAlign: 'center' }}>
                            Хто підробний художник? 🎭
                        </h2>
                        <p style={{ fontSize: '14px', marginBottom: '15px', textAlign: 'center', color: '#666' }}>
                            Проголосуйте за гравця, якого ви підозрюєте
                        </p>
                        <p style={{ fontSize: '16px', color: votingTimeLeft <= 5 ? '#ff0000' : '#666', textAlign: 'center', marginBottom: '15px' }}>
                            ⏱️ {votingTimeLeft} сек.
                        </p>

                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                            gap: '10px',
                            marginBottom: '10px'
                        }}>
                            {roomData?.players?.map(player => (
                                <button
                                    key={player.id}
                                    onClick={() => {
                                        setMyVoteForFake(player.id);
                                        if (socket) {
                                            socket.emit('vote_fake_artist', { suspectId: player.id });
                                        }
                                    }}
                                    className={`btn ${myVoteForFake === player.id ? 'btn-danger' : 'btn-secondary'}`}
                                    disabled={myVoteForFake !== null}
                                    style={{
                                        padding: '10px',
                                        fontSize: '14px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        justifyContent: 'center'
                                    }}
                                >
                                    <div style={{
                                        width: '20px',
                                        height: '20px',
                                        borderRadius: '50%',
                                        background: player.color || '#ccc'
                                    }}></div>
                                    <span style={{ fontSize: '13px', color: player.color || '#000', fontWeight: 'bold' }}>
                                        {player.name}
                                        {player.id === playerId && ' (Ви)'}
                                    </span>
                                </button>
                            ))}
                        </div>

                        {myVoteForFake && (
                            <div style={{ textAlign: 'center', marginTop: '10px', color: '#4CAF50', fontSize: '14px' }}>
                                ✓ Ваш голос збережено. Очікування інших гравців...
                            </div>
                        )}
                    </div>
                )}

                {/* МОДАЛЬНА СЕКЦІЯ: Підробний художник вгадує слово */}
                {gameState === 'fake_guessing' && (() => {
                    const isFakeArtist = playerCard?.isFake;

                    return (
                        <div className="modal-section" style={{ maxWidth: '600px', margin: '20px auto' }}>
                            {isFakeArtist ? (
                                <>
                                    <h2 style={{ fontSize: '22px', marginBottom: '10px', textAlign: 'center' }}>
                                        Вас спіймали! 🎭
                                    </h2>
                                    <p style={{ fontSize: '14px', marginBottom: '10px', textAlign: 'center' }}>
                                        Спробуйте вгадати загадане слово з категорії: <strong>{currentTheme}</strong>
                                    </p>
                                    <p style={{ fontSize: '16px', color: guessingTimeLeft <= 10 ? '#ff0000' : '#666', marginBottom: '15px', textAlign: 'center' }}>
                                        ⏱️ {guessingTimeLeft} сек.
                                    </p>

                                    <div style={{ textAlign: 'center' }}>
                                        <input
                                            type="text"
                                            value={fakeGuessInput}
                                            onChange={(e) => setFakeGuessInput(e.target.value)}
                                            placeholder="Введіть ваше припущення..."
                                            style={{
                                                padding: '10px',
                                                fontSize: '16px',
                                                width: '300px',
                                                maxWidth: '90%',
                                                borderRadius: '5px',
                                                border: '2px solid #ccc',
                                                marginBottom: '10px'
                                            }}
                                            onKeyPress={(e) => {
                                                if (e.key === 'Enter' && fakeGuessInput.trim()) {
                                                    if (socket) {
                                                        socket.emit('submit_fake_guess', { guess: fakeGuessInput.trim() });
                                                    }
                                                }
                                            }}
                                        />

                                        <div>
                                            <button
                                                onClick={() => {
                                                    if (socket && fakeGuessInput.trim()) {
                                                        socket.emit('submit_fake_guess', { guess: fakeGuessInput.trim() });
                                                    }
                                                }}
                                                className="btn btn-primary"
                                                disabled={!fakeGuessInput.trim()}
                                                style={{ fontSize: '16px', padding: '10px 30px' }}
                                            >
                                                Підтвердити відповідь
                                            </button>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <h2 style={{ fontSize: '22px', marginBottom: '10px', textAlign: 'center' }}>
                                        Підробного художника спіймано! 🎭
                                    </h2>
                                    <p style={{ fontSize: '16px', textAlign: 'center' }}>
                                        Зараз він намагається вгадати слово...
                                    </p>
                                    <div style={{ fontSize: '32px', margin: '20px 0', textAlign: 'center' }}>⏳</div>
                                </>
                            )}
                        </div>
                    );
                })()}

                {/* МОДАЛЬНА СЕКЦІЯ: Голосування за правильність відповіді */}
                {gameState === 'voting_answer' && (() => {
                    const isFakeArtist = playerCard?.isFake;

                    return (
                        <div className="modal-section" style={{ maxWidth: '700px', margin: '20px auto' }}>
                            <h2 style={{ fontSize: '22px', marginBottom: '10px', textAlign: 'center' }}>
                                Чи правильна відповідь? 🤔
                            </h2>

                            <div style={{
                                fontSize: '16px',
                                marginTop: '15px',
                                padding: '12px',
                                background: '#f9f9f9',
                                borderRadius: '8px',
                                marginBottom: '15px'
                            }}>
                                <div style={{ marginBottom: '8px' }}>
                                    <strong>Категорія:</strong> {currentTheme}
                                </div>
                                <div style={{ marginBottom: '8px' }}>
                                    <strong>Правильне слово:</strong> <span style={{ fontSize: '20px', color: '#4CAF50', fontWeight: 'bold' }}>{roomData?.currentWord || '...'}</span>
                                </div>
                                <div>
                                    <strong>Відповідь підробного:</strong> <span style={{ fontSize: '20px', color: '#FF5722', fontWeight: 'bold' }}>{fakeArtistGuess}</span>
                                </div>
                            </div>

                            {!isFakeArtist ? (
                                <>
                                    <p style={{ fontSize: '14px', marginBottom: '15px', textAlign: 'center' }}>
                                        Проголосуйте: чи правильно вгадав підробний художник?
                                    </p>

                                    <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
                                        <button
                                            onClick={() => {
                                                setMyVoteForAnswer(true);
                                                if (socket) {
                                                    socket.emit('vote_answer_correctness', { isCorrect: true });
                                                }
                                            }}
                                            className={`btn ${myVoteForAnswer === true ? 'btn-success' : 'btn-secondary'}`}
                                            disabled={myVoteForAnswer !== null}
                                            style={{ padding: '12px 30px', fontSize: '16px' }}
                                        >
                                            ✓ Правильно
                                        </button>
                                        <button
                                            onClick={() => {
                                                setMyVoteForAnswer(false);
                                                if (socket) {
                                                    socket.emit('vote_answer_correctness', { isCorrect: false });
                                                }
                                            }}
                                            className={`btn ${myVoteForAnswer === false ? 'btn-danger' : 'btn-secondary'}`}
                                            disabled={myVoteForAnswer !== null}
                                            style={{ padding: '12px 30px', fontSize: '16px' }}
                                        >
                                            ✗ Неправильно
                                        </button>
                                    </div>

                                    {myVoteForAnswer !== null && (
                                        <div style={{ textAlign: 'center', marginTop: '12px', color: '#4CAF50', fontSize: '14px' }}>
                                            ✓ Ваш голос збережено
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div style={{ fontSize: '16px', color: '#666', textAlign: 'center' }}>
                                    Інші гравці голосують...
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>
        );
    }

    if (gameState === 'playing') {
        return (
            <GameBoard
                socket={socket}
                playerId={playerId}
                roundData={roundData}
                drawings={drawings}
                setDrawings={setDrawings}
                myGuesses={myGuesses}
                usedNumbers={usedNumbers}
                myGuessResults={myGuessResults}
                showCorrectAnswers={showCorrectAnswers}
                allCorrectAssignments={allCorrectAssignments}
                isDrawingLocked={isDrawingLocked}
                makeGuess={makeGuess}
                isHost={isHost}
                endRound={endRound}
                guessProgress={guessProgress}
            />
        );
    }

    // UNICORN CANVAS: Результати раунду
    if (gameState === 'unicorn_round_end') {
        const results = unicornRoundResults || {};
        const isGameEnd = roomData?.state === 'game_end';

        return (
            <div className="results-modal">
                <div className="results-content">
                    <div className="results-header">
                        <h2>{isGameEnd ? 'Гра завершена!' : `Результати раунду ${roomData?.currentRound}`}</h2>
                    </div>

                    {/* ВИПРАВЛЕНО: Компактніші відступи */}
                    <div style={{ marginTop: '15px' }}>
                        <h3 style={{ marginBottom: '8px' }}>Розкриття ролей:</h3>
                        <div style={{
                            padding: '12px',
                            background: '#fff3cd',
                            borderRadius: '8px',
                            marginTop: '8px'
                        }}>
                            <div style={{ fontSize: '16px', marginBottom: '6px' }}>
                                <strong>Категорія:</strong> {results.theme}
                            </div>
                            <div style={{ fontSize: '16px', marginBottom: '6px' }}>
                                <strong>Загадане слово:</strong> {results.word}
                            </div>
                            <div style={{ fontSize: '16px', color: '#FF5722' }}>
                                <strong>Підробний художник:</strong> {roomData?.players?.find(p => p.id === results.fakeArtistId)?.name}
                            </div>
                        </div>
                    </div>

                    <div style={{ marginTop: '15px' }}>
                        <h3 style={{ marginBottom: '8px' }}>Що сталося:</h3>
                        <div style={{
                            padding: '10px',
                            background: results.fakeWins ? '#ffebee' : '#e8f5e9',
                            borderRadius: '8px',
                            fontSize: '16px',
                            marginTop: '8px'
                        }}>
                            {!results.fakeIsCaught && (
                                <p style={{ margin: 0 }}>🎭 Підробного художника не впіймали! Він виграв!</p>
                            )}
                            {results.fakeIsCaught && results.guessCorrect && (
                                <p style={{ margin: 0 }}>🎭 Підробного впіймали, але він правильно вгадав слово! Він виграв!</p>
                            )}
                            {results.fakeIsCaught && !results.guessCorrect && (
                                <p style={{ margin: 0 }}>✅ Підробного впіймали і він не вгадав слово! Художники перемогли!</p>
                            )}
                        </div>
                    </div>

                    <div className="scores-table" style={{ marginTop: '15px' }}>
                        <h3 style={{ marginBottom: '8px' }}>Рахунок:</h3>
                        <table style={{ width: '100%', marginTop: '8px' }}>
                            <thead>
                                <tr>
                                    <th>Гравець</th>
                                    <th>Очки</th>
                                    <th>Роль</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(results.scores || {})
                                    .sort(([,a], [,b]) => b - a)
                                    .map(([pid, score]) => {
                                        const player = roomData?.players?.find(p => p.id === pid);
                                        const isFake = pid === results.fakeArtistId;
                                        return (
                                            <tr key={pid}>
                                                <td>
                                                    {player?.name}
                                                    {pid === playerId && ' (Ви)'}
                                                </td>
                                                <td style={{ fontSize: '20px', fontWeight: 'bold', color: '#4CAF50' }}>
                                                    {score}
                                                </td>
                                                <td>
                                                    {isFake ? '🎭 Підробний' : '🎨 Художник'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                            </tbody>
                        </table>
                    </div>

                    {/* ВИПРАВЛЕНО: Компактніші відступи для кнопок */}
                    <div className="results-actions" style={{ marginTop: '15px' }}>
                        {isGameEnd ? (
                            <div>
                                <h2 style={{ color: '#4CAF50', marginBottom: '12px', fontSize: '1.3em' }}>
                                    🏆 Переможець: {roomData?.players?.find(p => p.id === roomData?.winner)?.name}!
                                </h2>
                                {isHost && (
                                    <button onClick={() => socket?.emit('new_game')} className="btn btn-primary">
                                        Нова гра
                                    </button>
                                )}
                            </div>
                        ) : (
                            <>
                                {isHost && (
                                    <button
                                        onClick={() => socket?.emit('start_next_round')}
                                        className="btn btn-primary"
                                    >
                                        Наступний раунд
                                    </button>
                                )}
                                {!isHost && <p style={{ margin: '10px 0' }}>Очікування наступного раунду...</p>}
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    if (gameState === 'round_end') {
        return (
            <div className="results-modal">
                <div className="results-content">
                    <div className="results-header">
                        <h2>Результати раунду {roundData?.round}</h2>
                    </div>
                    
                    <div className="scores-table">
                        <table style={{ width: '100%' }}>
                            <thead>
                                <tr>
                                    <th>Гравець</th>
                                    <th>Очки за раунд</th>
                                    <th>Загальні очки</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(roundResults?.totalScores || {})
                                    .sort(([,a], [,b]) => b - a)
                                    .map(([pid, score]) => {
                                        const player = roundData?.players?.find(p => p.id === pid);
                                        const details = roundResults?.scoreDetails?.[pid];

                                        // DEBUG: Логуємо дані для відладки
                                        if (details) {
                                            console.log(`Player ${player?.name}:`, {
                                                guessing: details.guessing,
                                                penalty: details.penalty,
                                                total: details.total
                                            });
                                        }

                                        // Формуємо формулу: 5+6+4-3=12
                                        let formula = '';
                                        if (details) {
                                            const parts = [];

                                            // Додаємо очки за відгадування
                                            if (Array.isArray(details.guessing)) {
                                                parts.push(...details.guessing.map(p => Number(p)));
                                            }

                                            // Додаємо штраф якщо є
                                            if (details.penalty !== 0) {
                                                parts.push(Number(details.penalty));
                                            }

                                            // Формуємо строку: обробляємо кожне число окремо
                                            if (parts.length > 0) {
                                                formula = parts.map((num, idx) => {
                                                    if (idx === 0) return String(num);
                                                    return num >= 0 ? `+${num}` : String(num);
                                                }).join('') + `=${details.total}`;
                                            } else {
                                                formula = `${details.total}`;
                                            }
                                        } else {
                                            formula = (roundResults?.roundScores[pid] || 0).toString();
                                        }

                                        return (
                                            <tr key={pid}>
                                                <td>
                                                    {player?.name}
                                                    {pid === playerId && ' (Ви)'}
                                                </td>
                                                <td className="score-change">
                                                    {formula}
                                                </td>
                                                <td style={{ fontWeight: 'bold' }}>
                                                    {score}
                                                </td>
                                            </tr>
                                        );
                                    })}
                            </tbody>
                        </table>
                    </div>
                    
                    {isHost && roundData?.round < 4 && (
                        <button className="btn btn-primary" onClick={nextRound}>
                            Наступний раунд
                        </button>
                    )}
                </div>
            </div>
        );
    }
    
    if (gameState === 'game_end') {
        const sortedScores = Object.entries(finalResults?.finalScores || {})
            .sort(([,a], [,b]) => b - a);
        const winner = roundData?.players?.find(p => p.id === sortedScores[0]?.[0]);
        
        return (
            <div className="results-modal">
                <div className="results-content">
                    <div className="winner-announcement">
                        <h3>🏆 Переможець!</h3>
                        <div className="winner-name">{winner?.name}</div>
                        <div className="final-score">{sortedScores[0]?.[1]} очок</div>
                    </div>
                    
                    <div className="scores-table">
                        <table style={{ width: '100%' }}>
                            <thead>
                                <tr>
                                    <th>Місце</th>
                                    <th>Гравець</th>
                                    <th>Очки</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedScores.map(([pid, score], index) => {
                                    const player = roundData?.players?.find(p => p.id === pid);
                                    return (
                                        <tr key={pid}>
                                            <td style={{ fontSize: '1.5em' }}>
                                                {index === 0 && '🥇'}
                                                {index === 1 && '🥈'}
                                                {index === 2 && '🥉'}
                                                {index > 2 && (index + 1)}
                                            </td>
                                            <td>
                                                {player?.name}
                                                {pid === playerId && ' (Ви)'}
                                            </td>
                                            <td style={{ fontWeight: 'bold', fontSize: '1.2em' }}>
                                                {score}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    
                    {isHost && (
                        <button className="btn btn-primary" onClick={newGame}>
                            Нова гра
                        </button>
                    )}
                </div>
            </div>
        );
    }
    
    return <div className="loading"><div className="loading-spinner"></div></div>;
}

// Компонент модального вікна з правилами
// НОВИЙ КОМПОНЕНТ ІГРОВОЇ ДОШКИ
// Компонент для відображення малюнків інших гравців
// Рендер додатку з новим API React 18

export default App;
