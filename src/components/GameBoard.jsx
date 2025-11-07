import { useRef, useState, useEffect, useCallback } from 'react';
import OtherPlayerDrawing from './OtherPlayerDrawing';
import ScoreRulesModal from './ScoreRulesModal';

function GameBoard({
    socket,
    playerId,
    roundData,
    drawings,
    setDrawings,
    myGuesses,
    usedNumbers,
    myGuessResults,
    showCorrectAnswers,
    allCorrectAssignments,
    isDrawingLocked,
    makeGuess,
    isHost,
    endRound,
    guessProgress
}) {
    const canvasRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentColor, setCurrentColor] = useState('#000000');
    const [currentSize, setCurrentSize] = useState(6);
    const [currentTool, setCurrentTool] = useState('pen');
    const [showScoreRules, setShowScoreRules] = useState(false);

    // Нове: Drag-and-Drop та Select стан
    const [selectedWord, setSelectedWord] = useState(null); // {letter, number, word}
    const [selectedPlayer, setSelectedPlayer] = useState(null); // playerId
    const [draggedWord, setDraggedWord] = useState(null); // {letter, number, word}
    const [hoveredPlayer, setHoveredPlayer] = useState(null); // playerId при hover під час drag
    const [wordAssignments, setWordAssignments] = useState({}); // playerId -> {letter, number, word}

    // НОВЕ: Таймер раунду (синхронізований з сервером)
    const [roundStartTime, setRoundStartTime] = useState(null); // Час початку раунду з сервера
    const [roundTimer, setRoundTimer] = useState(120); // Поточне значення таймера

    // Custom cursor refs (для производительности - без ререндеров)
    const customCursorRef = useRef(null);
    const showCustomCursorRef = useRef(false);

    const strokeBufferRef = useRef([]);
    const lastXRef = useRef(null);
    const lastYRef = useRef(null);

    // Оптимизация: кешируем контекст и размеры
    const ctxRef = useRef(null);
    const canvasBoundsRef = useRef(null);
    
    const colors = [
        '#000000', '#FF0000', '#00FF00', '#0000FF',
        '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500',
        '#800080', '#D2691E', '#FFC0CB', '#808080',
        '#FF6600', '#006400', '#8B4513', '#20B2AA'
    ];
    
    const sizes = [3, 6, 10, 15, 20];
    
    // Оптимізована синхронізація малювання (батчинг з інтервалом)
    useEffect(() => {
        let intervalId;

        const sendStrokes = () => {
            if (strokeBufferRef.current.length > 0 && socket) {
                console.log('📤 GameBoard sending strokes:', strokeBufferRef.current.length, strokeBufferRef.current.slice(0, 3));
                socket.emit('drawing_update', {
                    strokes: strokeBufferRef.current
                });
                strokeBufferRef.current = [];
            }
        };

        // Відправляємо кожні 150ms замість 60 разів/сек (зменшення трафіку в ~9 разів)
        intervalId = setInterval(sendStrokes, 150);

        return () => {
            clearInterval(intervalId);
            // Відправляємо залишки при unmount
            if (strokeBufferRef.current.length > 0 && socket) {
                socket.emit('drawing_update', {
                    strokes: strokeBufferRef.current
                });
            }
        };
    }, [socket]);

    // НОВЕ: Синхронізація roundStartTime з сервером
    useEffect(() => {
        if (roundData?.roundStartTime) {
            setRoundStartTime(roundData.roundStartTime);
        }
    }, [roundData]);

    // НОВЕ: Countdown таймер раунду (синхронізований з сервером)
    useEffect(() => {
        if (!roundStartTime) {
            setRoundTimer(120);
            return;
        }

        const updateTimer = () => {
            const elapsed = Math.floor((Date.now() - roundStartTime) / 1000);
            const remaining = Math.max(0, 120 - elapsed);
            setRoundTimer(remaining);
        };

        // Одразу оновлюємо таймер
        updateTimer();

        // Оновлюємо кожну секунду
        const intervalId = setInterval(updateTimer, 1000);

        return () => clearInterval(intervalId);
    }, [roundStartTime]);

    // Оптимізоване оновлення cursor через пряме DOM маніпулювання
    const updateCustomCursor = useCallback((x, y) => {
        if (!customCursorRef.current) return;

        customCursorRef.current.style.left = `${x}px`;
        customCursorRef.current.style.top = `${y}px`;

        // Обновляем размер и цвет
        if (currentTool === 'fill') {
            customCursorRef.current.style.width = `32px`;
            customCursorRef.current.style.height = `32px`;
            customCursorRef.current.style.backgroundColor = 'transparent';
        } else {
            const size = currentTool === 'eraser' ? currentSize * 2 : currentSize;
            customCursorRef.current.style.width = `${size}px`;
            customCursorRef.current.style.height = `${size}px`;
            customCursorRef.current.style.backgroundColor =
                currentTool === 'eraser' ? 'rgba(255, 255, 255, 0.8)' : currentColor;
        }

        // Обновляем класс
        customCursorRef.current.classList.remove('eraser-cursor', 'pen-cursor', 'fill-cursor');
        if (currentTool === 'eraser') {
            customCursorRef.current.classList.add('eraser-cursor');
        } else if (currentTool === 'fill') {
            customCursorRef.current.classList.add('fill-cursor');
        } else {
            customCursorRef.current.classList.add('pen-cursor');
        }
    }, [currentColor, currentSize, currentTool]);
    
    // Ініціалізація canvas з підтримкою High DPI
    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas) {
            // alpha: false теперь БЕЗОПАСНО - ластик рисует белым, не стирает
            const ctx = canvas.getContext('2d', {
                alpha: false,
                desynchronized: true
            });
            ctxRef.current = ctx;

            // ВИПРАВЛЕНО: Використовуємо фіксовані логічні розміри
            canvas.width = 640;
            canvas.height = 480;

            // CSS розмір для відображення
            canvas.style.width = '640px';
            canvas.style.height = '480px';

            // Налаштування контексту
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            // Білий фон
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, 640, 480);

            // Кешируем размеры canvas
            const updateBounds = () => {
                canvasBoundsRef.current = canvas.getBoundingClientRect();
            };
            updateBounds();

            // Обновляем при resize окна
            window.addEventListener('resize', updateBounds);
            return () => window.removeEventListener('resize', updateBounds);
        }
    }, []);
    
    const startDrawing = (e) => {
        if (isDrawingLocked || !ctxRef.current || !canvasBoundsRef.current) return;

        const ctx = ctxRef.current; // Используем кешированный контекст

        // Обработка инструмента заливки
        if (currentTool === 'fill') {
            // Закрашиваем весь canvas выбранным цветом
            ctx.fillStyle = currentColor;
            ctx.fillRect(0, 0, 640, 480);

            // Отправляем заливку как одно действие
            const strokeData = {
                color: currentColor,
                tool: 'fill',
                type: 'fill'
            };

            strokeBufferRef.current.push(strokeData);
            return; // Не запускаем обычное рисование
        }

        setIsDrawing(true);
        const rect = canvasBoundsRef.current; // Используем кешированное значение

        // ВИПРАВЛЕНО: Проста нормалізація без DPR
        const x = ((e.clientX || e.touches?.[0]?.clientX) - rect.left) * (640 / rect.width);
        const y = ((e.clientY || e.touches?.[0]?.clientY) - rect.top) * (480 / rect.height);

        lastXRef.current = x;
        lastYRef.current = y;

        // Малювання початкової точки
        if (currentTool === 'eraser') {
            // Рисуем белым цветом вместо стирания
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(x, y, currentSize, 0, 2 * Math.PI);
            ctx.fill();
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = currentColor;
            ctx.beginPath();
            ctx.arc(x, y, currentSize / 2, 0, 2 * Math.PI);
            ctx.fill();
        }

        const strokeData = {
            x: Math.round((x / 640) * 1000),  // Округлений integer 0-1000 (економія трафіку)
            y: Math.round((y / 480) * 1000),  // Округлений integer 0-1000 (економія трафіку)
            color: currentColor,
            size: currentSize,
            tool: currentTool,
            type: 'start'
        };

        console.log('➕ Adding START stroke to buffer:', strokeData);
        strokeBufferRef.current.push(strokeData);
    };
    
    const draw = useCallback((e) => {
        if (!isDrawing || isDrawingLocked || lastXRef.current === null || !ctxRef.current || !canvasBoundsRef.current) return;

        e.preventDefault();

        const rect = canvasBoundsRef.current; // Используем кешированное значение

        // ВИПРАВЛЕНО: Проста нормалізація без DPR
        const x = ((e.clientX || e.touches?.[0]?.clientX) - rect.left) * (640 / rect.width);
        const y = ((e.clientY || e.touches?.[0]?.clientY) - rect.top) * (480 / rect.height);

        const ctx = ctxRef.current; // Используем кешированный контекст

        // Малювання лінії
        ctx.globalCompositeOperation = 'source-over';

        if (currentTool === 'eraser') {
            // Рисуем белым цветом
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = currentSize * 2;
        } else {
            // Обычное рисование кистью
            ctx.strokeStyle = currentColor;
            ctx.lineWidth = currentSize;
        }

        ctx.beginPath();
        ctx.moveTo(lastXRef.current, lastYRef.current);
        ctx.lineTo(x, y);
        ctx.stroke();

        lastXRef.current = x;
        lastYRef.current = y;

        // ВИПРАВЛЕНО: Відправляємо округлені координати
        const strokeData = {
            x: Math.round((x / 640) * 1000),  // Округлений integer 0-1000 (економія трафіку)
            y: Math.round((y / 480) * 1000),  // Округлений integer 0-1000 (економія трафіку)
            color: currentColor,
            size: currentSize,
            tool: currentTool,
            type: 'draw'
        };

        console.log('➕ Adding DRAW stroke to buffer:', strokeData);
        strokeBufferRef.current.push(strokeData);
    }, [isDrawing, isDrawingLocked, currentColor, currentSize, currentTool]);
    
    const stopDrawing = () => {
        if (isDrawing) {
            setIsDrawing(false);
            lastXRef.current = null;
            lastYRef.current = null;

            const strokeData = {
                type: 'end'
            };
            console.log('➕ Adding END stroke to buffer:', strokeData);
            strokeBufferRef.current.push(strokeData);
        }
    };
    
    const clearCanvas = () => {
        if (isDrawingLocked || !ctxRef.current) return;

        const ctx = ctxRef.current; // Используем кешированный контекст

        // Скидаємо всі налаштування
        ctx.globalCompositeOperation = 'source-over';

        // Заповнюємо білим кольором
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 640, 480);

        strokeBufferRef.current = [];

        if (socket) {
            socket.emit('clear_canvas');
        }
    };

    // Обробники для нової системи відгадування
    const createGuess = (wordData, targetPlayerId) => {
        if (!wordData || !targetPlayerId) return;
        if (wordAssignments[targetPlayerId]) return; // Вже закріплено
        if (myGuesses[targetPlayerId]) return; // Вже відгадано

        console.log(`🎯 User selected: ${wordData.letter}${wordData.number} "${wordData.word}" for player ${targetPlayerId}`);

        // Закріплюємо вибір користувача (для візуальної підказки)
        setWordAssignments(prev => {
            const updated = { ...prev, [targetPlayerId]: wordData };
            console.log('💾 wordAssignments set (user choice):', updated);
            return updated;
        });

        // ВИПРАВЛЕНО: Відправляємо на сервер і букву, і номер
        makeGuess(targetPlayerId, wordData.number, wordData.letter);

        // Скидаємо селекти
        setSelectedWord(null);
        setSelectedPlayer(null);
    };

    // Select режим - клік на слово
    const handleWordClick = (letter, number, word) => {
        // Перевірка чи це не своє слово
        if (myAssignment?.letter === letter && myAssignment?.number === number) return;

        // Перевірка чи слово вже використане
        const isUsed = Object.values(wordAssignments).some(
            w => w.letter === letter && w.number === number
        );
        if (isUsed) return;

        const wordData = { letter, number, word };

        // Якщо вже вибраний гравець - створюємо пару
        if (selectedPlayer) {
            createGuess(wordData, selectedPlayer);
        } else {
            // Інакше просто вибираємо слово
            setSelectedWord(wordData);
        }
    };

    // Select режим - клік на рисунок гравця
    const handlePlayerClick = (targetPlayerId) => {
        if (wordAssignments[targetPlayerId]) return; // Вже закріплено
        if (myGuesses[targetPlayerId]) return; // Вже відгадано

        // Якщо вже вибране слово - створюємо пару
        if (selectedWord) {
            createGuess(selectedWord, targetPlayerId);
        } else {
            // Інакше просто вибираємо гравця
            setSelectedPlayer(targetPlayerId);
        }
    };

    // Клік на порожнє місце - скидає селект
    const handleBackgroundClick = (e) => {
        // Перевіряємо чи клік був не по слову чи рисунку
        if (!e.target.closest('.word-item') && !e.target.closest('.drawing-card')) {
            setSelectedWord(null);
            setSelectedPlayer(null);
        }
    };

    // Drag-and-Drop обробники
    const handleWordDragStart = (e, letter, number, word) => {
        // Перевірка чи це не своє слово
        if (myAssignment?.letter === letter && myAssignment?.number === number) {
            e.preventDefault();
            return;
        }

        // Перевірка чи слово вже використане
        const isUsed = Object.values(wordAssignments).some(
            w => w.letter === letter && w.number === number
        );
        if (isUsed) {
            e.preventDefault();
            return;
        }

        setDraggedWord({ letter, number, word });
        e.dataTransfer.effectAllowed = 'move';
    };

    const handlePlayerDragOver = (e, targetPlayerId) => {
        if (!draggedWord) return;
        if (wordAssignments[targetPlayerId]) return;
        if (myGuesses[targetPlayerId]) return;

        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setHoveredPlayer(targetPlayerId);
    };

    const handlePlayerDragLeave = () => {
        setHoveredPlayer(null);
    };

    const handlePlayerDrop = (e, targetPlayerId) => {
        e.preventDefault();
        if (!draggedWord) return;

        createGuess(draggedWord, targetPlayerId);

        setDraggedWord(null);
        setHoveredPlayer(null);
    };

    const handleDragEnd = () => {
        setDraggedWord(null);
        setHoveredPlayer(null);
    };

    // Touch обробники для мобільних пристроїв
    const handleWordTouchStart = (e, letter, number, word) => {
        // Перевірка чи це не своє слово
        if (myAssignment?.letter === letter && myAssignment?.number === number) {
            e.preventDefault();
            return;
        }

        // Перевірка чи слово вже використане
        const isUsed = Object.values(wordAssignments).some(
            w => w.letter === letter && w.number === number
        );
        if (isUsed) {
            e.preventDefault();
            return;
        }

        setDraggedWord({ letter, number, word });
    };

    const handleTouchMove = (e) => {
        if (!draggedWord) return;

        const touch = e.touches[0];
        const element = document.elementFromPoint(touch.clientX, touch.clientY);
        const drawingCard = element?.closest('.drawing-card');

        if (drawingCard) {
            const playerId = drawingCard.getAttribute('data-player-id');
            if (playerId && !wordAssignments[playerId]) {
                setHoveredPlayer(playerId);
            } else {
                setHoveredPlayer(null);
            }
        } else {
            setHoveredPlayer(null);
        }
    };

    const handleTouchEnd = (e) => {
        if (!draggedWord || !hoveredPlayer) {
            setDraggedWord(null);
            setHoveredPlayer(null);
            return;
        }

        createGuess(draggedWord, hoveredPlayer);

        setDraggedWord(null);
        setHoveredPlayer(null);
    };

    const myAssignment = roundData?.personalAssignment;
    const otherPlayers = roundData?.players?.filter(p => p.id !== playerId) || [];
    
    // Групуємо слова по картках
    const wordsByCard = {
        A: roundData?.wordSet?.A || [],
        B: roundData?.wordSet?.B || [],
        C: roundData?.wordSet?.C || [],
        D: roundData?.wordSet?.D || []
    };
    
    return (
        <>
            <div className="game-container" onClick={handleBackgroundClick}>
                {/* Основна зона гри */}
                <div className="game-main">
                    {/* Верхня частина */}
                    <div className="game-top">
                        {/* Ліва панель інструментів */}
                        <div className="tools-panel">
                            <div className="game-status">
                                <div className="round-info">Раунд {roundData?.round} з 4</div>
                                <button 
                                    className="help-button"
                                    onClick={() => setShowScoreRules(true)}
                                >
                                    ❓ Підказки
                                </button>
                            </div>
                            
                            <div className="tools-section">
                                <h3>Інструменти</h3>
                                
                                <div className="tool-group">
                                    <label>Тип:</label>
                                    <div className="tool-buttons">
                                        <button
                                            className={`tool-btn ${currentTool === 'pen' ? 'active' : ''}`}
                                            onClick={() => setCurrentTool('pen')}
                                            disabled={isDrawingLocked}
                                        >
                                            ✏️
                                        </button>
                                        <button
                                            className={`tool-btn ${currentTool === 'eraser' ? 'active' : ''}`}
                                            onClick={() => setCurrentTool('eraser')}
                                            disabled={isDrawingLocked}
                                            title="Ластик"
                                        >
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M20 20H7L2.5 15.5C1.83 14.83 1.83 13.67 2.5 13L13 2.5C13.67 1.83 14.83 1.83 15.5 2.5L21.5 8.5C22.17 9.17 22.17 10.33 21.5 11L17 15.5"/>
                                                <path d="M13 2.5L21.5 11"/>
                                            </svg>
                                        </button>
                                        <button
                                            className={`tool-btn ${currentTool === 'fill' ? 'active' : ''}`}
                                            onClick={() => setCurrentTool('fill')}
                                            disabled={isDrawingLocked}
                                            title="Заливка"
                                        >
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5">
                                                <path d="M12 2L10 8L4 10L10 12L12 18L14 12L20 10L14 8Z"/>
                                                <path d="M12 10C10.9 10 10 10.9 10 12L10 18L14 18L14 12C14 10.9 13.1 10 12 10Z"/>
                                                <path d="M8 20L16 20C17.1 20 18 20.9 18 22L6 22C6 20.9 6.9 20 8 20Z"/>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                                
                                <div className="tool-group">
                                    <label>Колір:</label>
                                    <div className="color-palette">
                                        {colors.map(color => (
                                            <button
                                                key={color}
                                                className={`color-btn ${currentColor === color ? 'active' : ''}`}
                                                style={{ backgroundColor: color }}
                                                onClick={() => setCurrentColor(color)}
                                                disabled={isDrawingLocked || currentTool === 'eraser'}
                                            />
                                        ))}
                                    </div>
                                </div>
                                
                                <div className="tool-group">
                                    <div className="size-selector">
                                        {sizes.map(size => (
                                            <button
                                                key={size}
                                                className={`size-btn ${currentSize === size ? 'active' : ''}`}
                                                onClick={() => setCurrentSize(size)}
                                                disabled={isDrawingLocked || currentTool === 'fill'}
                                                title={`Розмір: ${size}px`}
                                            >
                                                <div
                                                    className="size-dot"
                                                    style={{ width: size * 0.5, height: size * 0.5 }}
                                                />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                
                                <div className="action-buttons">
                                    <button
                                        className="action-btn btn-danger"
                                        onClick={clearCanvas}
                                        disabled={isDrawingLocked}
                                    >
                                        Очистити
                                    </button>

                                    {/* НОВЕ: Прогрес здогадок (тільки для хоста) */}
                                    {isHost && guessProgress && Object.keys(guessProgress).length > 0 && (
                                        <div style={{
                                            borderTop: '2px solid #e0e0e0',
                                            marginTop: '10px',
                                            paddingTop: '10px',
                                            marginBottom: '10px'
                                        }}>
                                            <label style={{
                                                fontSize: '0.8em',
                                                color: '#667eea',
                                                marginBottom: '8px',
                                                display: 'block',
                                                fontWeight: '600'
                                            }}>
                                                Прогрес здогадок:
                                            </label>
                                            <div style={{
                                                maxHeight: '200px',
                                                overflowY: 'auto',
                                                fontSize: '0.85em'
                                            }}>
                                                {Object.entries(guessProgress).map(([pid, data]) => {
                                                    const nameLength = data.name?.length || 0;
                                                    const fontSize = nameLength > 20 ? '0.7em' : nameLength > 15 ? '0.8em' : '1em';
                                                    return (
                                                        <div key={pid} style={{
                                                            padding: '4px 8px',
                                                            marginBottom: '3px',
                                                            background: data.guessed === data.total ? '#d4edda' : '#fff',
                                                            borderRadius: '4px',
                                                            border: '1px solid #e0e0e0'
                                                        }}>
                                                            <span style={{
                                                                fontWeight: 'bold',
                                                                color: '#333',
                                                                fontSize: fontSize,
                                                                wordBreak: 'break-word'
                                                            }}>
                                                                {data.name}
                                                            </span>
                                                            {' '}
                                                            <span style={{
                                                                color: data.guessed === data.total ? '#28a745' : '#666',
                                                                fontWeight: '600',
                                                                fontSize: fontSize
                                                            }}>
                                                                ({data.guessed}/{data.total})
                                                            </span>
                                                            {data.guessed === data.total && ' ✓'}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Кнопка завершення раунду (тільки для хоста) */}
                                    {isHost && otherPlayers.length > 0 && (
                                        <div style={{
                                            borderTop: '2px solid #e0e0e0',
                                            marginTop: '10px',
                                            paddingTop: '10px'
                                        }}>
                                            <label style={{
                                                fontSize: '0.8em',
                                                color: '#667eea',
                                                marginBottom: '5px',
                                                display: 'block',
                                                fontWeight: '600'
                                            }}>
                                                Управління (Хост):
                                            </label>

                                            <button
                                                className="action-btn btn-primary"
                                                onClick={endRound}
                                                title="Натисніть щоб завершити раунд і показати результати"
                                            >
                                                Завершити раунд
                                            </button>

                                            {!showCorrectAnswers && (
                                                <button
                                                    className="action-btn btn-success"
                                                    onClick={() => {
                                                        if (socket) {
                                                            socket.emit('reveal_answers');
                                                        }
                                                    }}
                                                    title="Показати всім правильні відповіді (які слова насправді були загадані)"
                                                    style={{ marginTop: '5px' }}
                                                >
                                                    Показати правильні відповіді
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        
                        {/* Центральна зона з канвасом */}
                        <div className="canvas-section">
                            {/* Завдання */}
                            {myAssignment && (
                                <div className="task-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
                                    {/* Таймер зліва */}
                                    <div style={{
                                        position: 'absolute',
                                        left: '15px',
                                        fontSize: '1.3em',
                                        fontWeight: 'bold',
                                        color: roundTimer <= 30 ? '#f44336' : '#333',
                                        minWidth: '50px'
                                    }}>
                                        {roundTimer}
                                    </div>

                                    {/* Слово-завдання по центру */}
                                    <div className="task-word" style={{
                                        flex: 1,
                                        fontSize: (() => {
                                            const word = myAssignment.word || '';
                                            const length = word.length;
                                            const wordCount = word.split(' ').length;
                                            // Адаптивний розмір шрифту
                                            if (wordCount > 1 || length > 15) return '1.1em';
                                            if (length > 10) return '1.2em';
                                            return '1.4em';
                                        })()
                                    }}>{myAssignment.word}</div>
                                </div>
                            )}
                            
                            {/* Мій канвас */}
                            <div className="my-canvas-wrapper">
                                <div className={`canvas-container ${isDrawingLocked ? 'locked' : ''}`}>
                                    {isDrawingLocked && (
                                        <div className="canvas-lock-overlay">
                                            <div className="lock-message">
                                                Малюнок заблоковано
                                            </div>
                                        </div>
                                    )}
                                    <canvas
                                        ref={canvasRef}
                                        width={640}
                                        height={480}
                                        onMouseDown={startDrawing}
                                        onMouseMove={(e) => {
                                            draw(e);
                                            // Обновляем позицию custom cursor без ререндера
                                            updateCustomCursor(e.clientX, e.clientY);
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!isDrawingLocked && customCursorRef.current) {
                                                showCustomCursorRef.current = true;
                                                customCursorRef.current.style.display = 'block';
                                                updateCustomCursor(e.clientX, e.clientY);
                                            }
                                        }}
                                        onMouseLeave={() => {
                                            stopDrawing();
                                            if (customCursorRef.current) {
                                                showCustomCursorRef.current = false;
                                                customCursorRef.current.style.display = 'none';
                                            }
                                        }}
                                        onMouseUp={stopDrawing}
                                        onTouchStart={startDrawing}
                                        onTouchMove={draw}
                                        onTouchEnd={stopDrawing}
                                        style={{
                                            cursor: isDrawingLocked ? 'not-allowed' : 'none',
                                            touchAction: 'none'
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    {/* Нижня секція з канвасами інших */}
                    <div className="others-section">
                        <div className="others-content">
                            <div className="others-grid">
                                {otherPlayers.map(player => (
                                    <OtherPlayerDrawing
                                        key={player.id}
                                        player={player}
                                        drawing={drawings[player.id] || []}
                                        guess={myGuesses[player.id]}
                                        // Нова система відгадування
                                        wordAssignment={wordAssignments[player.id]}
                                        guessResult={myGuessResults[player.id]}
                                        showCorrectAnswers={showCorrectAnswers}
                                        isSelected={selectedPlayer === player.id}
                                        isHovered={hoveredPlayer === player.id}
                                        onClick={() => handlePlayerClick(player.id)}
                                        onDragOver={(e) => handlePlayerDragOver(e, player.id)}
                                        onDragLeave={handlePlayerDragLeave}
                                        onDrop={(e) => handlePlayerDrop(e, player.id)}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
                
                {/* Права панель з картками */}
                <div className="cards-panel">
                    {/* Лівий стовпець: A + B (18 слів) */}
                    <div className="word-column">
                        {[...wordsByCard.A, ...wordsByCard.B].map((word, globalIndex) => {
                            const letter = globalIndex < 9 ? 'A' : 'B';
                            const number = globalIndex < 9 ? globalIndex + 1 : globalIndex - 8;
                            const isMyWord = myAssignment?.letter === letter && myAssignment?.number === number;
                            const isUsed = Object.values(wordAssignments).some(
                                w => w.letter === letter && w.number === number
                            );
                            const isSelected = selectedWord?.letter === letter && selectedWord?.number === number;

                            // ВИПРАВЛЕНО: Перевіряємо чи це слово - вибір користувача або правильна відповідь
                            // 1. Перевіряємо чи користувач вибрав це слово
                            const userSelectedPlayerId = Object.keys(wordAssignments).find(
                                pid => wordAssignments[pid].letter === letter && wordAssignments[pid].number === number
                            );
                            const userGuessResult = userSelectedPlayerId ? myGuessResults[userSelectedPlayerId] : null;

                            // 2. ВИПРАВЛЕНО: Перевіряємо чи це правильна відповідь (шукаємо у всіх правильних відповідях)
                            const correctAnswerPlayerId = Object.keys(allCorrectAssignments).find(
                                pid => allCorrectAssignments[pid]?.letter === letter &&
                                       allCorrectAssignments[pid]?.number === number
                            );

                            // ВИПРАВЛЕНО: Логіка відображення станів
                            const isPending = userGuessResult && !showCorrectAnswers; // Вибрано, але відповіді не показані
                            const isCorrect = showCorrectAnswers && ((userGuessResult?.correct === true) || (correctAnswerPlayerId !== undefined));
                            const isIncorrect = showCorrectAnswers && (userGuessResult?.correct === false) && (correctAnswerPlayerId === undefined); // Неправильно І НЕ є правильним для інших

                            return (
                                <div
                                    key={`${letter}-${number}`}
                                    className={`word-item ${isMyWord ? 'my-word' : ''} ${isUsed ? 'used' : ''} ${isSelected ? 'selected' : ''} ${isPending ? 'pending' : ''} ${isCorrect ? 'correct' : ''} ${isIncorrect ? 'incorrect' : ''}`}
                                    title={word}
                                    draggable={!isMyWord && !isUsed}
                                    onClick={() => handleWordClick(letter, number, word)}
                                    onDragStart={(e) => handleWordDragStart(e, letter, number, word)}
                                    onDragEnd={handleDragEnd}
                                    onTouchStart={(e) => handleWordTouchStart(e, letter, number, word)}
                                    onTouchMove={handleTouchMove}
                                    onTouchEnd={handleTouchEnd}
                                    style={{
                                        cursor: isMyWord || isUsed ? 'not-allowed' : 'pointer',
                                        touchAction: 'none'
                                    }}
                                >
                                    <span className="word-text">{word}</span>
                                </div>
                            );
                        })}
                    </div>

                    {/* Правий стовпець: C + D (18 слів) */}
                    <div className="word-column">
                        {[...wordsByCard.C, ...wordsByCard.D].map((word, globalIndex) => {
                            const letter = globalIndex < 9 ? 'C' : 'D';
                            const number = globalIndex < 9 ? globalIndex + 1 : globalIndex - 8;
                            const isMyWord = myAssignment?.letter === letter && myAssignment?.number === number;
                            const isUsed = Object.values(wordAssignments).some(
                                w => w.letter === letter && w.number === number
                            );
                            const isSelected = selectedWord?.letter === letter && selectedWord?.number === number;

                            // ВИПРАВЛЕНО: Перевіряємо чи це слово - вибір користувача або правильна відповідь
                            // 1. Перевіряємо чи користувач вибрав це слово
                            const userSelectedPlayerId = Object.keys(wordAssignments).find(
                                pid => wordAssignments[pid].letter === letter && wordAssignments[pid].number === number
                            );
                            const userGuessResult = userSelectedPlayerId ? myGuessResults[userSelectedPlayerId] : null;

                            // 2. ВИПРАВЛЕНО: Перевіряємо чи це правильна відповідь (шукаємо у всіх правильних відповідях)
                            const correctAnswerPlayerId = Object.keys(allCorrectAssignments).find(
                                pid => allCorrectAssignments[pid]?.letter === letter &&
                                       allCorrectAssignments[pid]?.number === number
                            );

                            // ВИПРАВЛЕНО: Логіка відображення станів
                            const isPending = userGuessResult && !showCorrectAnswers; // Вибрано, але відповіді не показані
                            const isCorrect = showCorrectAnswers && ((userGuessResult?.correct === true) || (correctAnswerPlayerId !== undefined));
                            const isIncorrect = showCorrectAnswers && (userGuessResult?.correct === false) && (correctAnswerPlayerId === undefined); // Неправильно І НЕ є правильним для інших

                            return (
                                <div
                                    key={`${letter}-${number}`}
                                    className={`word-item ${isMyWord ? 'my-word' : ''} ${isUsed ? 'used' : ''} ${isSelected ? 'selected' : ''} ${isPending ? 'pending' : ''} ${isCorrect ? 'correct' : ''} ${isIncorrect ? 'incorrect' : ''}`}
                                    title={word}
                                    draggable={!isMyWord && !isUsed}
                                    onClick={() => handleWordClick(letter, number, word)}
                                    onDragStart={(e) => handleWordDragStart(e, letter, number, word)}
                                    onDragEnd={handleDragEnd}
                                    onTouchStart={(e) => handleWordTouchStart(e, letter, number, word)}
                                    onTouchMove={handleTouchMove}
                                    onTouchEnd={handleTouchEnd}
                                    style={{
                                        cursor: isMyWord || isUsed ? 'not-allowed' : 'pointer',
                                        touchAction: 'none'
                                    }}
                                >
                                    <span className="word-text">{word}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
            
            {showScoreRules && (
                <ScoreRulesModal onClose={() => setShowScoreRules(false)} />
            )}

            {/* Custom cursor - всегда в DOM, обновляется напрямую через ref */}
            {!isDrawingLocked && (
                <div
                    ref={customCursorRef}
                    className="custom-cursor pen-cursor"
                    style={{
                        display: 'none',
                        left: 0,
                        top: 0,
                        width: currentSize,
                        height: currentSize,
                        backgroundColor: currentColor
                    }}
                />
            )}
        </>
    );
}

// Компонент для відображення малюнків інших гравців

export default GameBoard;
