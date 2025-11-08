import { useRef, useState, useEffect } from 'react';

// Компонент для відображення малюнків інших гравців
function OtherPlayerDrawing({
  player,
  drawing,
  guess,
  // Нова система відгадування
  wordAssignment,
  guessResult,
  showCorrectAnswers,
  isSelected,
  isHovered,
  onClick,
  onDragOver,
  onDragLeave,
  onDrop
}) {
  const canvasRef = useRef(null);
  const [canvasSize] = useState({ width: 266, height: 200 });
  const lastDrawnIndexRef = useRef(0);
  const isDrawingPathRef = useRef(false);
  const lastXRef = useRef(null);
  const lastYRef = useRef(null);

  // Ініціалізація canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });

    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Білий фон
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

    lastDrawnIndexRef.current = 0;
  }, [canvasSize]);

  // Інкрементальна відрисовка - тільки нові strokes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });

    // Перевіряємо на clear_canvas подію
    if (drawing.length === 0 && lastDrawnIndexRef.current > 0) {
      // Canvas очищено
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);
      lastDrawnIndexRef.current = 0;
      isDrawingPathRef.current = false;
      lastXRef.current = null;
      lastYRef.current = null;
      return;
    }

    // Малюємо тільки нові strokes починаючи з lastDrawnIndex
    for (let i = lastDrawnIndexRef.current; i < drawing.length; i++) {
      const stroke = drawing[i];

      if (stroke.type === 'fill') {
        // Обробка заливки canvas
        ctx.fillStyle = stroke.color;
        ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);
        isDrawingPathRef.current = false;
        lastXRef.current = null;
        lastYRef.current = null;
      } else if (stroke.type === 'start') {
        const x = (stroke.x / 1000) * canvasSize.width;
        const y = (stroke.y / 1000) * canvasSize.height;

        ctx.globalCompositeOperation = 'source-over';
        if (stroke.tool === 'eraser') {
          // Малюємо білим
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(x, y, stroke.size * (canvasSize.width / 640), 0, 2 * Math.PI);
          ctx.fill();
        } else {
          ctx.fillStyle = stroke.color;
          ctx.beginPath();
          ctx.arc(x, y, (stroke.size * (canvasSize.width / 640)) / 2, 0, 2 * Math.PI);
          ctx.fill();
        }

        lastXRef.current = x;
        lastYRef.current = y;
        isDrawingPathRef.current = true;
      } else if (stroke.type === 'draw' && isDrawingPathRef.current && lastXRef.current !== null) {
        const x = (stroke.x / 1000) * canvasSize.width;
        const y = (stroke.y / 1000) * canvasSize.height;

        ctx.globalCompositeOperation = 'source-over';
        if (stroke.tool === 'eraser') {
          // Малюємо білим
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = stroke.size * 2 * (canvasSize.width / 640);
        } else {
          ctx.strokeStyle = stroke.color;
          ctx.lineWidth = stroke.size * (canvasSize.width / 640);
        }

        ctx.beginPath();
        ctx.moveTo(lastXRef.current, lastYRef.current);
        ctx.lineTo(x, y);
        ctx.stroke();

        lastXRef.current = x;
        lastYRef.current = y;
      } else if (stroke.type === 'end') {
        isDrawingPathRef.current = false;
        lastXRef.current = null;
        lastYRef.current = null;
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // Оновлюємо індекс останнього намальованого stroke
    lastDrawnIndexRef.current = drawing.length;
  }, [drawing, canvasSize]);

  // Логіка відображення станів
  const isPending = wordAssignment && !showCorrectAnswers;
  const isCorrect = showCorrectAnswers && ((guessResult?.correct === true) || guessResult?.targetAssignment);
  const isIncorrect = showCorrectAnswers && (guessResult?.correct === false);

  // Логіка відображення слова
  let displayWord = null;
  let wordColor = '#2196f3';

  if (wordAssignment) {
    if (isPending) {
      displayWord = wordAssignment.word;
      wordColor = '#2196f3';
    } else if (guessResult?.correct === true) {
      displayWord = wordAssignment.word;
      wordColor = '#4caf50';
    } else if (guessResult?.correct === false) {
      displayWord = guessResult?.targetAssignment?.word || wordAssignment.word;
      wordColor = '#f44336';
    } else {
      displayWord = wordAssignment.word;
      wordColor = '#2196f3';
    }
  } else if (guessResult?.targetAssignment && showCorrectAnswers) {
    displayWord = guessResult.targetAssignment.word;
    wordColor = '#4caf50';
  }

  const hasAssignment = displayWord !== null;

  return (
    <div
      className={`drawing-card ${hasAssignment ? 'matched' : ''} ${isSelected ? 'selected' : ''} ${isHovered ? 'drag-over' : ''} ${isPending ? 'pending' : ''} ${isCorrect ? 'correct' : ''} ${isIncorrect ? 'incorrect' : ''}`}
      data-player-id={player.id}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        cursor: hasAssignment ? 'not-allowed' : 'pointer'
      }}
    >
      <div className="drawing-player-name">
        {player.name}
        {hasAssignment && (
          <div style={{
            fontSize: '0.75em',
            color: wordColor,
            marginTop: '2px',
            fontWeight: '600'
          }}>
            {displayWord}
          </div>
        )}
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          borderRadius: '8px',
          background: 'white',
          border: '1px solid #e0e0e0'
        }}
      />
    </div>
  );
}

export default OtherPlayerDrawing;
