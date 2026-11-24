import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

export default function SnakeGame({ isActive, onGameOver, onStart, compact = false, showUi = true }) {
  const canvasRef = useRef(null);
  const [score, setScore] = useState(0);
  const [gameStarted, setGameStarted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const gameRef = useRef(null);
  const snakeRef = useRef([]);
  const directionRef = useRef({ x: 1, y: 0 });
  const foodRef = useRef({ x: 10, y: 10 });
  const scoreRef = useRef(0);

  const GRID_SIZE = 20;
  const CELL_SIZE = compact ? 12 : 15;

  const speed = useMemo(() => {
    const base = compact ? 130 : 120;
    const ramp = Math.floor(score / 50) * 8;
    return Math.max(70, base - ramp);
  }, [score, compact]);

  const placeFood = useCallback(() => {
    const maxX = Math.floor(GRID_SIZE);
    const maxY = Math.floor(GRID_SIZE);
    foodRef.current = {
      x: Math.floor(Math.random() * maxX),
      y: Math.floor(Math.random() * maxY),
    };
  }, []);

  const initGame = useCallback(() => {
    snakeRef.current = [
      { x: 10, y: 10 },
      { x: 9, y: 10 },
      { x: 8, y: 10 },
    ];
    directionRef.current = { x: 1, y: 0 };
    scoreRef.current = 0;
    setScore(0);
    setGameOver(false);
    placeFood();
  }, [placeFood]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle grid for depth
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += CELL_SIZE) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += CELL_SIZE) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    snakeRef.current.forEach((segment, index) => {
      ctx.fillStyle = index === 0 ? '#22c55e' : '#34d399';
      ctx.fillRect(
        segment.x * CELL_SIZE,
        segment.y * CELL_SIZE,
        CELL_SIZE - 1,
        CELL_SIZE - 1
      );
    });

    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(
      foodRef.current.x * CELL_SIZE,
      foodRef.current.y * CELL_SIZE,
      CELL_SIZE - 1,
      CELL_SIZE - 1
    );
  }, [CELL_SIZE]);

  const update = useCallback(() => {
    if (!gameStarted || gameOver) return;

    const head = snakeRef.current[0];
    const newHead = {
      x: head.x + directionRef.current.x,
      y: head.y + directionRef.current.y,
    };

    if (
      newHead.x < 0 ||
      newHead.x >= GRID_SIZE ||
      newHead.y < 0 ||
      newHead.y >= GRID_SIZE ||
      snakeRef.current.some(s => s.x === newHead.x && s.y === newHead.y)
    ) {
      setGameOver(true);
      setGameStarted(false);
      if (onGameOver) onGameOver(scoreRef.current);
      return;
    }

    snakeRef.current.unshift(newHead);

    if (newHead.x === foodRef.current.x && newHead.y === foodRef.current.y) {
      scoreRef.current += 10;
      setScore(scoreRef.current);
      placeFood();
    } else {
      snakeRef.current.pop();
    }

    draw();
  }, [gameStarted, gameOver, draw, placeFood, onGameOver]);

  useEffect(() => {
    if (!isActive) return;
    
    initGame();
    draw();

    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !gameStarted) {
        e.preventDefault();
        setGameStarted(true);
        if (onStart) onStart();
      }

      if (!gameStarted || gameOver) return;

      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          if (directionRef.current.y !== 1) {
            directionRef.current = { x: 0, y: -1 };
          }
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          if (directionRef.current.y !== -1) {
            directionRef.current = { x: 0, y: 1 };
          }
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          if (directionRef.current.x !== 1) {
            directionRef.current = { x: -1, y: 0 };
          }
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          if (directionRef.current.x !== -1) {
            directionRef.current = { x: 1, y: 0 };
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, initGame, draw, gameStarted, gameOver, onStart]);

  useEffect(() => {
    if (!isActive || !gameStarted || gameOver) return;

    gameRef.current = setInterval(update, speed);
    return () => {
      if (gameRef.current) clearInterval(gameRef.current);
    };
  }, [isActive, gameStarted, gameOver, update, speed]);

  if (!isActive) return null;

  return (
    <div className="flex flex-col items-center">
      {showUi && (
        <div className="mb-2 text-center">
          <span className="text-2xl font-bold text-emerald-400">{score}</span>
          <span className="text-gray-400 text-sm ml-2">pts</span>
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={GRID_SIZE * CELL_SIZE}
        height={GRID_SIZE * CELL_SIZE}
        className="rounded-lg border border-slate-700/70 shadow-inner"
      />
      {showUi && gameOver && (
        <div className="mt-3 text-center">
          <p className="text-rose-300 font-semibold">Game Over!</p>
          <button
            onClick={() => {
              initGame();
              setGameStarted(true);
              if (onStart) onStart();
            }}
            className="mt-2 px-4 py-1 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-500"
          >
            Play Again
          </button>
        </div>
      )}
    </div>
  );
}
