import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Pause, Play, RotateCcw, Trophy, Zap } from 'lucide-react';
import { supabase, hasSupabaseConfig } from './supabase';

// ============================================================================
// CONFIGURATION - Easy to modify game parameters
// ============================================================================
const CONFIG = {
  // Grid settings
  GRID_SIZE: 15,           // Number of cells in each direction
  CELL_SIZE: 20,           // Base cell size in pixels (will scale)

  // Speed settings (ms between moves - lower = faster)
  INITIAL_SPEED: 150,      // Starting speed
  MIN_SPEED: 60,           // Maximum speed (fastest)
  SPEED_DECREASE: 5,       // Speed increase per food eaten

  // Scoring
  FOOD_SCORE: 1,           // Points per food eaten
  LEVEL_CLEAR_SCORE: 5,    // Bonus points for completing a level
  FOOD_PER_LEVEL: 8,       // Food needed to complete a level

  // Score unit (easy to change to "HUF" later)
  SCORE_UNIT_NAME: 'pont',
  NAME_MAX_CHARS: 8,

  // Visual
  SNAKE_HEAD_COLOR: '#22d3ee',      // Cyan
  SNAKE_BODY_COLOR: '#06b6d4',      // Lighter cyan
  SNAKE_GLOW_COLOR: 'rgba(34, 211, 238, 0.6)',
  FOOD_COLOR: '#fbbf24',            // Amber/gold (like HUF)
  FOOD_GLOW_COLOR: 'rgba(251, 191, 36, 0.8)',

  // LocalStorage keys
  HIGHSCORE_KEY: 'eurhuf_snake_highscore',
  HIGHLEVEL_KEY: 'eurhuf_snake_highlevel',
  HALL_OF_FAME_KEY: 'eurhuf_snake_hof',
  LASTNAME_KEY: 'eurhuf_snake_lastname',
  HALL_OF_FAME_TABLE: 'snake_hof',

  // UX tuning
  HOF_LOADING_TIMEOUT_MS: 1500,
};

const safeSetItem = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors (e.g., private mode or quota)
  }
};

const formatSupabaseError = (error: unknown) => {
  if (!error || typeof error !== 'object') return 'Ismeretlen hiba';
  const err = error as {
    message?: string;
    details?: string;
    hint?: string;
    code?: string;
  };
  return [err.message, err.details, err.hint, err.code].filter(Boolean).join(' | ') || 'Ismeretlen hiba';
};

interface HallOfFameEntry {
  id?: string;
  name: string;
  score: number;
  level: number;
  ts: number;
}

const loadHallOfFame = (): HallOfFameEntry[] => {
  try {
    const raw = localStorage.getItem(CONFIG.HALL_OF_FAME_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.name === 'string' && typeof item.score === 'number')
      .map((item) => ({
        name: item.name.slice(0, CONFIG.NAME_MAX_CHARS),
        score: item.score,
        level: typeof item.level === 'number' ? item.level : 1,
        ts: typeof item.ts === 'number' ? item.ts : Date.now(),
      }))
      .slice(0, 10);
  } catch {
    return [];
  }
};

// Hook for future HUF conversion (placeholder)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _scoreToHuf = (score: number): number => {
  // Future: return score * conversionRate;
  return score;
};

// ============================================================================
// Types
// ============================================================================
type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
type Position = { x: number; y: number };
type GameState = 'menu' | 'playing' | 'paused' | 'gameover' | 'levelclear';
type EnemyKind = 'ant' | 'crab' | 'void';

interface EnemyCell extends Position {
  kind: EnemyKind;
  phase: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

interface SnakeGameProps {
  isDarkMode: boolean;
  onClose: () => void;
  isVisible: boolean;
}

// ============================================================================
// Component
// ============================================================================
export default function SnakeGame({ isDarkMode, onClose, isVisible }: SnakeGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMoveRef = useRef<number>(0);
  const inputQueueRef = useRef<Direction[]>([]);
  const autoPausedRef = useRef(false);
  const hasStartedRef = useRef(false);
  const gameStateRef = useRef<GameState>('menu');

  // Game state
  const [gameState, setGameState] = useState<GameState>('menu');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    const saved = localStorage.getItem(CONFIG.HIGHSCORE_KEY);
    return saved ? parseInt(saved, 10) : 0;
  });
  const [isNewRecord, setIsNewRecord] = useState(false);
  const [level, setLevel] = useState(1);
  const [highLevel, setHighLevel] = useState(() => {
    const saved = localStorage.getItem(CONFIG.HIGHLEVEL_KEY);
    return saved ? parseInt(saved, 10) : 1;
  });
  const [foodEatenThisLevel, setFoodEatenThisLevel] = useState(0);
  const [canvasSize, setCanvasSize] = useState({ width: 300, height: 300 });
  const [hallOfFame, setHallOfFame] = useState<HallOfFameEntry[]>(() => loadHallOfFame());
  const [playerName, setPlayerName] = useState(() => {
    const saved = localStorage.getItem(CONFIG.LASTNAME_KEY);
    return saved ? saved : '';
  });
  const [hasSavedScore, setHasSavedScore] = useState(false);
  const [hofLoading, setHofLoading] = useState(hasSupabaseConfig);
  const [hofError, setHofError] = useState<string | null>(null);

  // Game objects (refs for animation loop access)
  const snakeRef = useRef<Position[]>([{ x: 7, y: 7 }]);
  const directionRef = useRef<Direction>('RIGHT');
  const foodRef = useRef<Position>({ x: 10, y: 7 });
  const speedRef = useRef(CONFIG.INITIAL_SPEED);
  const particlesRef = useRef<Particle[]>([]);
  const enemiesRef = useRef<EnemyCell[]>([]);
  const backgroundOffsetRef = useRef(0);
  const hofRequestIdRef = useRef(0);
  const hallOfFameRef = useRef<HallOfFameEntry[]>([]);
  const hofIsMountedRef = useRef(false);
  const loadHallOfFameOnlineRef = useRef<((showLoading?: boolean) => Promise<void>) | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);

  // Touch handling
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // ============================================================================
  // Responsive canvas sizing
  // ============================================================================
  const updateSize = useCallback(() => {
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.clientWidth - 16; // padding
    if (containerWidth <= 0) return;

    const maxSize = Math.min(containerWidth, 350);
    const size = Math.floor(maxSize / CONFIG.GRID_SIZE) * CONFIG.GRID_SIZE;
    if (size > 0) {
      setCanvasSize({ width: size, height: size });
    }
  }, []);

  useEffect(() => {
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [updateSize]);

  useEffect(() => {
    if (!isVisible) return;
    const frame = requestAnimationFrame(() => updateSize());
    return () => cancelAnimationFrame(frame);
  }, [isVisible, updateSize]);

  useEffect(() => {
    if (!isVisible) {
      if (gameState === 'playing') {
        setGameState('paused');
      }
      if (hasStartedRef.current && gameState !== 'gameover' && gameState !== 'menu') {
        autoPausedRef.current = true;
      }
      return;
    }

    if (autoPausedRef.current && hasStartedRef.current && gameState === 'paused') {
      autoPausedRef.current = false;
      setGameState('playing');
    }
  }, [isVisible, gameState]);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    hallOfFameRef.current = hallOfFame;
  }, [hallOfFame]);

  // ========================================================================
  // Online Hall of Fame (Supabase)
  // ========================================================================
  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) return;

    hofIsMountedRef.current = true;
    let timeoutId: number | null = null;

    const loadHallOfFameOnline = async (showLoading = false) => {
      const requestId = ++hofRequestIdRef.current;

      if (showLoading) {
        setHofLoading(true);
      }
      setHofError(null);

      if (showLoading) {
        timeoutId = window.setTimeout(() => {
          if (!hofIsMountedRef.current) return;
          if (hofRequestIdRef.current !== requestId) return;
          if (hallOfFameRef.current.length === 0) {
            setHofLoading(false);
            setHofError('Online lista lassú. Megmutatom a helyi listát.');
          }
        }, CONFIG.HOF_LOADING_TIMEOUT_MS);
      }

      const { data, error } = await supabase
        .from(CONFIG.HALL_OF_FAME_TABLE)
        .select('id,name,score,level,created_at')
        .order('score', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(10);

      if (!hofIsMountedRef.current) return;
      if (hofRequestIdRef.current !== requestId) return;

      if (error) {
        console.error('Hall of Fame betöltési hiba:', error);
        setHofError(`Online lista hiba: ${formatSupabaseError(error)}`);
        setHofLoading(false);
        return;
      }

      const entries: HallOfFameEntry[] = (data ?? [])
        .map((row) => {
            const name = typeof row.name === 'string' ? row.name.slice(0, CONFIG.NAME_MAX_CHARS) : '';
          const score = typeof row.score === 'number' ? row.score : 0;
          const level = typeof row.level === 'number' ? row.level : 1;
          const createdAt = typeof row.created_at === 'string' ? row.created_at : '';
          let ts = Date.parse(createdAt);
          if (!Number.isFinite(ts)) {
            ts = Date.now();
          }
          return {
            id: row.id ? String(row.id) : undefined,
            name,
            score,
            level,
            ts,
          };
        })
        .filter((entry) => entry.name && Number.isFinite(entry.score));

      setHallOfFame(entries);
      safeSetItem(CONFIG.HALL_OF_FAME_KEY, JSON.stringify(entries));
      setHofError(null);
      setHofLoading(false);
    };

    loadHallOfFameOnlineRef.current = loadHallOfFameOnline;
    loadHallOfFameOnline(true);

    const channel = supabase
      .channel('snake-hof')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: CONFIG.HALL_OF_FAME_TABLE },
        () => {
          void loadHallOfFameOnline(false);
        }
      )
      .subscribe();

    return () => {
      hofIsMountedRef.current = false;
      loadHallOfFameOnlineRef.current = null;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      void supabase.removeChannel(channel);
    };
  }, []);

  // ============================================================================
  // Initialize/Reset game
  // ============================================================================
  const spawnEnemiesForLevel = useCallback((targetLevel: number, snake: Position[]) => {
    const enemyCount = Math.max(0, targetLevel - 1);
    if (enemyCount === 0) {
      enemiesRef.current = [];
      return;
    }

    const blocked = new Set<string>();
    const kinds: EnemyKind[] = ['ant', 'crab', 'void'];
    const toKey = (x: number, y: number) => `${x},${y}`;

    snake.forEach((segment) => blocked.add(toKey(segment.x, segment.y)));

    // Keep the immediate head area clear on level start.
    const head = snake[0];
    if (head) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const x = head.x + dx;
          const y = head.y + dy;
          if (x >= 0 && x < CONFIG.GRID_SIZE && y >= 0 && y < CONFIG.GRID_SIZE) {
            blocked.add(toKey(x, y));
          }
        }
      }
    }

    const enemies: EnemyCell[] = [];
    let attempts = 0;
    while (enemies.length < enemyCount && attempts < 4000) {
      attempts++;
      const x = Math.floor(Math.random() * CONFIG.GRID_SIZE);
      const y = Math.floor(Math.random() * CONFIG.GRID_SIZE);
      const key = toKey(x, y);
      if (blocked.has(key)) continue;

      blocked.add(key);
      enemies.push({
        x,
        y,
        kind: kinds[Math.floor(Math.random() * kinds.length)],
        phase: Math.random() * Math.PI * 2,
      });
    }

    enemiesRef.current = enemies;
  }, []);

  const spawnFood = useCallback(() => {
    const snake = snakeRef.current;
    const enemies = enemiesRef.current;
    const isBlocked = (pos: Position) =>
      snake.some(seg => seg.x === pos.x && seg.y === pos.y) ||
      enemies.some(enemy => enemy.x === pos.x && enemy.y === pos.y);
    let newFood: Position;
    let attempts = 0;

    do {
      newFood = {
        x: Math.floor(Math.random() * CONFIG.GRID_SIZE),
        y: Math.floor(Math.random() * CONFIG.GRID_SIZE),
      };
      attempts++;
    } while (
      isBlocked(newFood) &&
      attempts < 300
    );

    if (isBlocked(newFood)) {
      for (let y = 0; y < CONFIG.GRID_SIZE; y++) {
        for (let x = 0; x < CONFIG.GRID_SIZE; x++) {
          const candidate = { x, y };
          if (!isBlocked(candidate)) {
            newFood = candidate;
            y = CONFIG.GRID_SIZE;
            break;
          }
        }
      }
    }

    foodRef.current = newFood;
  }, []);

  const initGame = useCallback((keepScore = false) => {
    const centerX = Math.floor(CONFIG.GRID_SIZE / 2);
    const centerY = Math.floor(CONFIG.GRID_SIZE / 2);
    const effectiveLevel = keepScore ? level : 1;

    snakeRef.current = [
      { x: centerX, y: centerY },
      { x: centerX - 1, y: centerY },
      { x: centerX - 2, y: centerY },
    ];
    directionRef.current = 'RIGHT';
    inputQueueRef.current = [];
    speedRef.current = CONFIG.INITIAL_SPEED - (effectiveLevel - 1) * 10; // Faster on higher levels
    speedRef.current = Math.max(speedRef.current, CONFIG.MIN_SPEED);
    particlesRef.current = [];
    spawnEnemiesForLevel(effectiveLevel, snakeRef.current);

    if (!keepScore) {
      setScore(0);
      setLevel(1);
      setFoodEatenThisLevel(0);
    }

    spawnFood();
  }, [level, spawnFood, spawnEnemiesForLevel]);

  // ============================================================================
  // Audio effects
  // ============================================================================
  const ensureAudio = useCallback(() => {
    if (typeof window === 'undefined') return;
    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    if (!audioCtxRef.current) {
      const ctx = new AudioContextCtor();
      const gain = ctx.createGain();
      gain.gain.value = 0.12;
      gain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      audioGainRef.current = gain;
    }

    if (audioCtxRef.current.state === 'suspended') {
      void audioCtxRef.current.resume();
    }
  }, []);

  const playTone = useCallback((frequency: number, duration: number, type: OscillatorType, delay = 0, volume = 0.12) => {
    const ctx = audioCtxRef.current;
    const master = audioGainRef.current;
    if (!ctx || !master) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    osc.connect(gain);
    gain.connect(master);

    const now = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }, []);

  const playCoinSound = useCallback(() => {
    playTone(880, 0.08, 'triangle', 0, 0.12);
    playTone(1320, 0.07, 'triangle', 0.08, 0.1);
  }, [playTone]);

  const playGameOverSound = useCallback(() => {
    const ctx = audioCtxRef.current;
    const master = audioGainRef.current;
    if (!ctx || !master) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.45);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + 0.55);
  }, []);

  const playVictorySound = useCallback(() => {
    playTone(523.25, 0.12, 'sine', 0, 0.12);
    playTone(659.25, 0.12, 'sine', 0.12, 0.12);
    playTone(783.99, 0.16, 'sine', 0.24, 0.12);
  }, [playTone]);

  const playHallOfFameSound = useCallback(() => {
    playTone(784, 0.1, 'triangle', 0, 0.14);
    playTone(988, 0.1, 'triangle', 0.1, 0.12);
    playTone(1319, 0.14, 'triangle', 0.2, 0.12);
  }, [playTone]);

  // ============================================================================
  // Particle effects
  // ============================================================================
  const createParticles = useCallback((x: number, y: number, count: number, color: string) => {
    const cellSize = canvasSize.width / CONFIG.GRID_SIZE;
    const centerX = x * cellSize + cellSize / 2;
    const centerY = y * cellSize + cellSize / 2;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = 2 + Math.random() * 3;
      particlesRef.current.push({
        x: centerX,
        y: centerY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        color,
        size: 3 + Math.random() * 4,
      });
    }
  }, [canvasSize]);

  const createLevelClearParticles = useCallback(() => {
    const colors = ['#22d3ee', '#fbbf24', '#a855f7', '#ec4899', '#10b981'];
    for (let i = 0; i < 50; i++) {
      particlesRef.current.push({
        x: Math.random() * canvasSize.width,
        y: canvasSize.height + 10,
        vx: (Math.random() - 0.5) * 4,
        vy: -5 - Math.random() * 8,
        life: 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 4 + Math.random() * 6,
      });
    }
  }, [canvasSize]);

  // ============================================================================
  // Game logic
  // ============================================================================
  const moveSnake = useCallback(() => {
    const snake = snakeRef.current;
    const food = foodRef.current;

    // Process input queue
    if (inputQueueRef.current.length > 0) {
      const nextDir = inputQueueRef.current.shift()!;
      const currentDir = directionRef.current;

      // Prevent 180-degree turns
      const isValidTurn = !(
        (currentDir === 'UP' && nextDir === 'DOWN') ||
        (currentDir === 'DOWN' && nextDir === 'UP') ||
        (currentDir === 'LEFT' && nextDir === 'RIGHT') ||
        (currentDir === 'RIGHT' && nextDir === 'LEFT')
      );

      if (isValidTurn) {
        directionRef.current = nextDir;
      }
    }

    const head = { ...snake[0] };

    switch (directionRef.current) {
      case 'UP': head.y--; break;
      case 'DOWN': head.y++; break;
      case 'LEFT': head.x--; break;
      case 'RIGHT': head.x++; break;
    }

    // Wall collision
    if (head.x < 0 || head.x >= CONFIG.GRID_SIZE || head.y < 0 || head.y >= CONFIG.GRID_SIZE) {
      playGameOverSound();
      setGameState('gameover');
      return;
    }

    // Self collision (exclude tail since it will move)
    const willCollide = snake.slice(0, -1).some(seg => seg.x === head.x && seg.y === head.y);
    if (willCollide) {
      playGameOverSound();
      setGameState('gameover');
      return;
    }

    // Enemy collision
    const hitEnemy = enemiesRef.current.some(enemy => enemy.x === head.x && enemy.y === head.y);
    if (hitEnemy) {
      createParticles(head.x, head.y, 18, '#ef4444');
      playGameOverSound();
      setGameState('gameover');
      return;
    }

    // Move snake
    snake.unshift(head);

    // Food collision
    if (head.x === food.x && head.y === food.y) {
      playCoinSound();
      // Don't remove tail (snake grows)
      createParticles(food.x, food.y, 12, CONFIG.FOOD_COLOR);

      setScore(prev => {
        const newScore = prev + CONFIG.FOOD_SCORE;
        if (newScore > highScore) {
          setHighScore(newScore);
          safeSetItem(CONFIG.HIGHSCORE_KEY, newScore.toString());
          setIsNewRecord(true);
        }
        return newScore;
      });

      setFoodEatenThisLevel(prev => {
        const newCount = prev + 1;
        if (newCount >= CONFIG.FOOD_PER_LEVEL) {
          // Level complete!
          setTimeout(() => {
            playVictorySound();
            setGameState('levelclear');
            createLevelClearParticles();
            setScore(s => {
              const newScore = s + CONFIG.LEVEL_CLEAR_SCORE;
              if (newScore > highScore) {
                setHighScore(newScore);
                safeSetItem(CONFIG.HIGHSCORE_KEY, newScore.toString());
                setIsNewRecord(true);
              }
              return newScore;
            });
          }, 100);
        }
        return newCount;
      });

      // Speed up
      speedRef.current = Math.max(speedRef.current - CONFIG.SPEED_DECREASE, CONFIG.MIN_SPEED);
      if (!Number.isFinite(speedRef.current)) {
        speedRef.current = CONFIG.INITIAL_SPEED;
      }

      spawnFood();
    } else {
      snake.pop();
    }
  }, [highScore, createParticles, createLevelClearParticles, spawnFood, playCoinSound, playGameOverSound, playVictorySound]);

  // ============================================================================
  // Rendering
  // ============================================================================
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cellSize = canvasSize.width / CONFIG.GRID_SIZE;
    const snake = snakeRef.current;
    const food = foodRef.current;
    const enemies = enemiesRef.current;
    const animationTime = Date.now() * 0.004;

    // Clear canvas
    ctx.fillStyle = isDarkMode ? '#18181b' : '#fafaf9';
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

    // Animated background grid
    backgroundOffsetRef.current += 0.2;
    ctx.strokeStyle = isDarkMode ? 'rgba(63, 63, 70, 0.3)' : 'rgba(214, 211, 209, 0.5)';
    ctx.lineWidth = 1;

    for (let i = 0; i <= CONFIG.GRID_SIZE; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cellSize, 0);
      ctx.lineTo(i * cellSize, canvasSize.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cellSize);
      ctx.lineTo(canvasSize.width, i * cellSize);
      ctx.stroke();
    }

    // Draw food with pulsing glow
    const pulseScale = 1 + Math.sin(Date.now() / 150) * 0.15;
    const foodCenterX = food.x * cellSize + cellSize / 2;
    const foodCenterY = food.y * cellSize + cellSize / 2;
    const foodRadius = (cellSize / 2 - 2) * pulseScale;

    // Food glow
    const foodGlow = ctx.createRadialGradient(
      foodCenterX, foodCenterY, 0,
      foodCenterX, foodCenterY, foodRadius * 2
    );
    foodGlow.addColorStop(0, CONFIG.FOOD_GLOW_COLOR);
    foodGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = foodGlow;
    ctx.fillRect(food.x * cellSize - cellSize, food.y * cellSize - cellSize, cellSize * 3, cellSize * 3);

    // Food body (HUF coin style)
    ctx.beginPath();
    ctx.arc(foodCenterX, foodCenterY, foodRadius, 0, Math.PI * 2);
    ctx.fillStyle = CONFIG.FOOD_COLOR;
    ctx.fill();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Ft symbol on food
    ctx.fillStyle = isDarkMode ? '#18181b' : '#ffffff';
    ctx.font = `bold ${Math.floor(cellSize * 0.4)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Ft', foodCenterX, foodCenterY);

    const drawRoundedRect = (x: number, y: number, size: number, radius: number) => {
      const ctxWithRoundRect = ctx as CanvasRenderingContext2D & {
        roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
      };

      if (typeof ctxWithRoundRect.roundRect === 'function') {
        ctxWithRoundRect.roundRect(x, y, size, size, radius);
        return;
      }

      const r = Math.min(radius, size / 2);
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + size, y, x + size, y + size, r);
      ctx.arcTo(x + size, y + size, x, y + size, r);
      ctx.arcTo(x, y + size, x, y, r);
      ctx.arcTo(x, y, x + size, y, r);
      ctx.closePath();
    };

    const drawEnemy = (enemy: EnemyCell) => {
      const x = enemy.x * cellSize;
      const y = enemy.y * cellSize;
      const cx = x + cellSize / 2;
      const cy = y + cellSize / 2;
      const t = animationTime + enemy.phase;

      if (enemy.kind === 'void') {
        const pulse = 1 + Math.sin(t * 1.6) * 0.07;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(pulse, pulse);

        const outer = cellSize * 0.42;
        ctx.fillStyle = isDarkMode ? '#111827' : '#1f2937';
        ctx.beginPath();
        ctx.arc(0, 0, outer, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(99, 102, 241, 0.45)';
        ctx.lineWidth = Math.max(1.5, cellSize * 0.07);
        for (let i = 0; i < 4; i++) {
          const start = t * 1.6 + i * (Math.PI / 2);
          ctx.beginPath();
          ctx.arc(0, 0, outer * 0.72, start, start + Math.PI * 0.9);
          ctx.stroke();
        }

        ctx.fillStyle = '#020617';
        ctx.beginPath();
        ctx.arc(0, 0, outer * 0.38, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }

      if (enemy.kind === 'ant') {
        const legSwing = Math.sin(t * 5) * cellSize * 0.04;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = Math.max(1.5, cellSize * 0.07);

        for (let i = -1; i <= 1; i++) {
          const yOffset = i * cellSize * 0.16;
          ctx.beginPath();
          ctx.moveTo(-cellSize * 0.12, yOffset);
          ctx.lineTo(-cellSize * 0.38, yOffset - legSwing + i * 2);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(cellSize * 0.12, yOffset);
          ctx.lineTo(cellSize * 0.38, yOffset + legSwing + i * 2);
          ctx.stroke();
        }

        ctx.fillStyle = '#dc2626';
        ctx.beginPath();
        ctx.arc(0, -cellSize * 0.2, cellSize * 0.12, 0, Math.PI * 2);
        ctx.arc(0, 0, cellSize * 0.15, 0, Math.PI * 2);
        ctx.arc(0, cellSize * 0.2, cellSize * 0.16, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#111827';
        ctx.beginPath();
        ctx.arc(-cellSize * 0.05, -cellSize * 0.22, cellSize * 0.02, 0, Math.PI * 2);
        ctx.arc(cellSize * 0.05, -cellSize * 0.22, cellSize * 0.02, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }

      const clawSwing = Math.sin(t * 4) * 0.3;
      ctx.save();
      ctx.translate(cx, cy);

      ctx.strokeStyle = '#ea580c';
      ctx.lineWidth = Math.max(1.5, cellSize * 0.065);
      for (let i = -1; i <= 1; i++) {
        const yOffset = cellSize * 0.06 + i * cellSize * 0.12;
        ctx.beginPath();
        ctx.moveTo(-cellSize * 0.16, yOffset);
        ctx.lineTo(-cellSize * 0.34, yOffset + cellSize * 0.09);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(cellSize * 0.16, yOffset);
        ctx.lineTo(cellSize * 0.34, yOffset + cellSize * 0.09);
        ctx.stroke();
      }

      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.ellipse(0, cellSize * 0.06, cellSize * 0.24, cellSize * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = Math.max(2, cellSize * 0.09);
      ctx.beginPath();
      ctx.arc(-cellSize * 0.28, -cellSize * 0.03, cellSize * 0.1, Math.PI * (0.3 + clawSwing), Math.PI * 1.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cellSize * 0.28, -cellSize * 0.03, cellSize * 0.1, Math.PI * (1.65), Math.PI * (2.7 - clawSwing));
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(-cellSize * 0.08, -cellSize * 0.14, cellSize * 0.05, 0, Math.PI * 2);
      ctx.arc(cellSize * 0.08, -cellSize * 0.14, cellSize * 0.05, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.arc(-cellSize * 0.08, -cellSize * 0.14, cellSize * 0.022, 0, Math.PI * 2);
      ctx.arc(cellSize * 0.08, -cellSize * 0.14, cellSize * 0.022, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    enemies.forEach((enemy) => drawEnemy(enemy));

    // Draw snake
    snake.forEach((segment, index) => {
      const isHead = index === 0;
      const x = segment.x * cellSize + 2;
      const y = segment.y * cellSize + 2;
      const size = cellSize - 4;
      const radius = size / 2;

      // Glow effect for head
      if (isHead) {
        ctx.shadowColor = CONFIG.SNAKE_GLOW_COLOR;
        ctx.shadowBlur = 15;
      }

      // Gradient for body segments
      const segmentGradient = ctx.createLinearGradient(x, y, x + size, y + size);
      if (isHead) {
        segmentGradient.addColorStop(0, CONFIG.SNAKE_HEAD_COLOR);
        segmentGradient.addColorStop(1, '#0891b2');
      } else {
        const fade = Math.max(0.4, 1 - index * 0.05);
        segmentGradient.addColorStop(0, `rgba(6, 182, 212, ${fade})`);
        segmentGradient.addColorStop(1, `rgba(8, 145, 178, ${fade})`);
      }

      // Draw rounded rectangle
      ctx.beginPath();
      drawRoundedRect(x, y, size, radius * 0.6);
      ctx.fillStyle = segmentGradient;
      ctx.fill();

      // Draw eyes on head
      if (isHead) {
        ctx.shadowBlur = 0;
        const eyeSize = size * 0.15;
        const eyeOffsetX = size * 0.25;
        const eyeOffsetY = size * 0.25;

        ctx.fillStyle = '#ffffff';

        // Position eyes based on direction
        let eye1X = x + size / 2 - eyeOffsetX;
        let eye1Y = y + eyeOffsetY;
        let eye2X = x + size / 2 + eyeOffsetX;
        let eye2Y = y + eyeOffsetY;

        if (directionRef.current === 'DOWN') {
          eye1Y = y + size - eyeOffsetY;
          eye2Y = y + size - eyeOffsetY;
        } else if (directionRef.current === 'LEFT') {
          eye1X = x + eyeOffsetY;
          eye1Y = y + size / 2 - eyeOffsetX;
          eye2X = x + eyeOffsetY;
          eye2Y = y + size / 2 + eyeOffsetX;
        } else if (directionRef.current === 'RIGHT') {
          eye1X = x + size - eyeOffsetY;
          eye1Y = y + size / 2 - eyeOffsetX;
          eye2X = x + size - eyeOffsetY;
          eye2Y = y + size / 2 + eyeOffsetX;
        }

        ctx.beginPath();
        ctx.arc(eye1X, eye1Y, eyeSize, 0, Math.PI * 2);
        ctx.arc(eye2X, eye2Y, eyeSize, 0, Math.PI * 2);
        ctx.fill();

        // Pupils
        ctx.fillStyle = '#18181b';
        ctx.beginPath();
        ctx.arc(eye1X, eye1Y, eyeSize * 0.5, 0, Math.PI * 2);
        ctx.arc(eye2X, eye2Y, eyeSize * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    ctx.shadowBlur = 0;

    // Draw particles
    particlesRef.current = particlesRef.current.filter(p => p.life > 0);
    particlesRef.current.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1; // gravity
      p.life -= 0.02;

      if (p.life <= 0) {
        return;
      }

      const safeLife = Math.max(0, Math.min(1, p.life));
      const safeRadius = Math.max(0.1, p.size * safeLife);

      ctx.globalAlpha = safeLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, safeRadius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

  }, [isDarkMode, canvasSize]);

  // ============================================================================
  // Game loop
  // ============================================================================
  useEffect(() => {
    if (!isVisible) return;
    let frame = 0;

    const gameLoop = (timestamp: number) => {
      const state = gameStateRef.current;

      if (state === 'playing') {
        const speed = Number.isFinite(speedRef.current) ? speedRef.current : CONFIG.INITIAL_SPEED;
        if (timestamp - lastMoveRef.current >= speed) {
          moveSnake();
          lastMoveRef.current = timestamp;
        }
      } else {
        lastMoveRef.current = timestamp;
      }

      render();
      frame = requestAnimationFrame(gameLoop);
    };

    frame = requestAnimationFrame(gameLoop);

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
    };
  }, [isVisible, moveSnake, render]);

  // ============================================================================
  // Input handling
  // ============================================================================
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState !== 'playing') return;
      ensureAudio();

    let newDir: Direction | null = null;

      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          newDir = 'UP';
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          newDir = 'DOWN';
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          newDir = 'LEFT';
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          newDir = 'RIGHT';
          break;
        case ' ':
        case 'Escape':
          setGameState('paused');
          return;
      }

      if (newDir && inputQueueRef.current.length < 2) {
        e.preventDefault();
        inputQueueRef.current.push(newDir);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState, ensureAudio]);

  // Touch handling
  const handleTouchStart = (e: React.TouchEvent) => {
    if (gameState !== 'playing') return;
    ensureAudio();
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || gameState !== 'playing') return;

    const touchEnd = {
      x: e.changedTouches[0].clientX,
      y: e.changedTouches[0].clientY,
    };

    const dx = touchEnd.x - touchStartRef.current.x;
    const dy = touchEnd.y - touchStartRef.current.y;
    const minSwipe = 30;

    if (Math.abs(dx) < minSwipe && Math.abs(dy) < minSwipe) return;

    let newDir: Direction;
    if (Math.abs(dx) > Math.abs(dy)) {
      newDir = dx > 0 ? 'RIGHT' : 'LEFT';
    } else {
      newDir = dy > 0 ? 'DOWN' : 'UP';
    }

    if (inputQueueRef.current.length < 2) {
      inputQueueRef.current.push(newDir);
    }

    touchStartRef.current = null;
  };

  // ============================================================================
  // Game controls
  // ============================================================================
  const startGame = () => {
    ensureAudio();
    hasStartedRef.current = true;
    setHasSavedScore(false);
    setIsNewRecord(false);
    initGame();
    setGameState('playing');
    lastMoveRef.current = 0;
  };

  const resumeGame = () => {
    ensureAudio();
    hasStartedRef.current = true;
    setHasSavedScore(false);
    setGameState('playing');
  };

  const nextLevel = () => {
    const newLevel = level + 1;
    setLevel(newLevel);
    if (newLevel > highLevel) {
      setHighLevel(newLevel);
      safeSetItem(CONFIG.HIGHLEVEL_KEY, newLevel.toString());
    }
    speedRef.current = Math.max(CONFIG.INITIAL_SPEED - (newLevel - 1) * 10, CONFIG.MIN_SPEED);
    setFoodEatenThisLevel(0);

    // Keep snake but reset position
    const centerX = Math.floor(CONFIG.GRID_SIZE / 2);
    const centerY = Math.floor(CONFIG.GRID_SIZE / 2);
    snakeRef.current = [
      { x: centerX, y: centerY },
      { x: centerX - 1, y: centerY },
      { x: centerX - 2, y: centerY },
    ];
    directionRef.current = 'RIGHT';
    inputQueueRef.current = [];
    spawnEnemiesForLevel(newLevel, snakeRef.current);
    spawnFood();
    setGameState('playing');
  };

  const handleClose = () => {
    if (hasStartedRef.current && gameState !== 'gameover' && gameState !== 'menu') {
      autoPausedRef.current = true;
    }
    if (gameState === 'playing') {
      setGameState('paused');
    }
    onClose();
  };

  const handleNameChange = (value: string) => {
    const sanitized = value
      .normalize('NFC')
      .replace(/\s+/g, '')
      .replace(/[^0-9A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű]/g, '')
      .slice(0, CONFIG.NAME_MAX_CHARS)
      .toLocaleUpperCase('hu-HU');
    setPlayerName(sanitized);
  };

  const getHofCutoff = () => {
    if (hallOfFame.length < 10) return null;
    return hallOfFame.reduce((min, entry) => Math.min(min, entry.score), hallOfFame[0].score);
  };

  const qualifiesForHof = (candidateScore: number) => {
    if (candidateScore <= 0) return false;
    if (hallOfFame.length < 10) return true;
    const cutoff = getHofCutoff();
    return cutoff !== null && candidateScore > cutoff;
  };

  const mergeHallOfFame = (entry: HallOfFameEntry) => {
    setHallOfFame((prev) => {
      const next = [entry, ...prev]
        .sort((a, b) => (b.score - a.score) || (b.ts - a.ts))
        .slice(0, 10);
      safeSetItem(CONFIG.HALL_OF_FAME_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleSaveScore = async () => {
    if (hasSavedScore || score <= 0) return;
    if (hasSupabaseConfig && hofLoading && hallOfFame.length === 0) return;
    if (!qualifiesForHof(score)) return;
    const name = playerName.trim().slice(0, CONFIG.NAME_MAX_CHARS);
    if (!name) return;

    ensureAudio();

    const entry: HallOfFameEntry = {
      name,
      score,
      level,
      ts: Date.now(),
    };

    safeSetItem(CONFIG.LASTNAME_KEY, name);

    if (hasSupabaseConfig && supabase) {
      try {
        setHofError(null);
        const { error } = await supabase
          .from(CONFIG.HALL_OF_FAME_TABLE)
          .insert({ name, score, level });

        if (!error) {
          mergeHallOfFame(entry);
          playHallOfFameSound();
          void loadHallOfFameOnlineRef.current?.(false);
          setHasSavedScore(true);
          return;
        }

        throw error;
      } catch (error) {
        const details = formatSupabaseError(error);
        console.error('Hall of Fame mentési hiba:', error);
        setHofError(`Online mentés sikertelen: ${details}`);
      }
    }

    mergeHallOfFame(entry);
    playHallOfFameSound();
    setHasSavedScore(true);
  };

  // ============================================================================
  // UI Components
  // ============================================================================
  const ProgressBar = () => (
    <div className={`w-full h-2 rounded-full overflow-hidden ${isDarkMode ? 'bg-zinc-800' : 'bg-stone-200'}`}>
      <div
        className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-300"
        style={{ width: `${(foodEatenThisLevel / CONFIG.FOOD_PER_LEVEL) * 100}%` }}
      />
    </div>
  );

  const onlineTopScore =
    hasSupabaseConfig && !hofLoading && hallOfFame.length > 0
      ? hallOfFame[0].score
      : null;

  return (
    <div className="w-full animate-slide-up" ref={containerRef}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className={`w-6 h-6 ${isDarkMode ? 'text-cyan-400' : 'text-cyan-600'}`} />
          <h2 className={`text-xl font-bold ${isDarkMode ? 'text-zinc-100' : 'text-stone-800'}`}>
            HUF Snake Turbo
          </h2>
        </div>
        <button
          onClick={handleClose}
          className={`p-2 rounded-xl transition-all ${
            isDarkMode
              ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
              : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
          }`}
          aria-label="Vissza"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* HUD */}
      <div className={`flex justify-between items-center mb-3 p-3 rounded-xl ${
        isDarkMode ? 'bg-zinc-800/50' : 'bg-stone-100'
      }`}>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-zinc-500' : 'text-stone-500'}`}>
              Score
            </div>
            <div className={`text-lg font-bold font-mono ${isDarkMode ? 'text-cyan-400' : 'text-cyan-600'}`}>
              {score}
            </div>
          </div>
          <div className="text-center">
            <div className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-zinc-500' : 'text-stone-500'}`}>
              Saját
            </div>
            <div className={`text-lg font-bold font-mono ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`}>
              {highScore}
            </div>
          </div>
          {onlineTopScore !== null && (
            <div className="text-center">
              <div className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-zinc-500' : 'text-stone-500'}`}>
                Top
              </div>
              <div className={`text-lg font-bold font-mono ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                {onlineTopScore}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="text-center">
            <div className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-zinc-500' : 'text-stone-500'}`}>
              Level
            </div>
            <div className={`text-lg font-bold font-mono ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
              {level}
            </div>
          </div>

          {gameState === 'playing' && (
            <button
              onClick={() => setGameState('paused')}
              className={`p-2 rounded-lg transition-all ${
                isDarkMode
                  ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                  : 'bg-stone-200 text-stone-600 hover:bg-stone-300'
              }`}
              aria-label="Szünet"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {gameState === 'playing' && (
        <div className="mb-3">
          <ProgressBar />
          <div className={`text-xs text-center mt-1 ${isDarkMode ? 'text-zinc-500' : 'text-stone-500'}`}>
            {foodEatenThisLevel}/{CONFIG.FOOD_PER_LEVEL} étel a következő szintig
          </div>
        </div>
      )}

      {/* Game Canvas */}
      <div
        className={`relative rounded-2xl overflow-hidden border-2 ${
          isDarkMode ? 'border-zinc-700' : 'border-stone-300'
        }`}
        style={{ touchAction: 'none' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          className="block mx-auto"
          style={{ maxWidth: '100%' }}
        />

        {/* Menu overlay */}
        {gameState === 'menu' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className={`text-center p-6 rounded-2xl ${isDarkMode ? 'bg-zinc-900/90' : 'bg-white/90'}`}>
              <Zap className={`w-12 h-12 mx-auto mb-3 ${isDarkMode ? 'text-cyan-400' : 'text-cyan-600'}`} />
              <h3 className={`text-2xl font-bold mb-2 ${isDarkMode ? 'text-zinc-100' : 'text-stone-800'}`}>
                HUF Snake Turbo
              </h3>
              <p className={`text-sm mb-4 ${isDarkMode ? 'text-zinc-400' : 'text-stone-600'}`}>
                Gyűjtsd össze a forintokat!
              </p>
              <button
                onClick={startGame}
                className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-emerald-500 text-white font-bold rounded-xl
                  hover:from-cyan-400 hover:to-emerald-400 transition-all transform hover:scale-105 shadow-lg"
              >
                Új játék
              </button>
              <div className={`mt-4 text-xs ${isDarkMode ? 'text-zinc-500' : 'text-stone-500'}`}>
                Mobil: Swipe | Desktop: Nyilak/WASD
              </div>
            </div>
          </div>
        )}

        {/* Pause overlay */}
        {gameState === 'paused' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className={`text-center p-6 rounded-2xl ${isDarkMode ? 'bg-zinc-900/90' : 'bg-white/90'}`}>
              <Pause className={`w-10 h-10 mx-auto mb-3 ${isDarkMode ? 'text-cyan-400' : 'text-cyan-600'}`} />
              <h3 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-zinc-100' : 'text-stone-800'}`}>
                Szünet
              </h3>
              <div className="flex gap-3">
                <button
                  onClick={resumeGame}
                  className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-emerald-500 text-white font-bold rounded-xl
                    hover:from-cyan-400 hover:to-emerald-400 transition-all"
                >
                  <Play className="w-5 h-5 inline mr-1" />
                  Folytatás
                </button>
                <button
                  onClick={startGame}
                  className={`px-5 py-2 rounded-xl font-medium transition-all ${
                    isDarkMode
                      ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                      : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                  }`}
                >
                  <RotateCcw className="w-4 h-4 inline mr-1" />
                  Újra
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Game Over overlay */}
        {gameState === 'gameover' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className={`text-center p-6 rounded-2xl ${isDarkMode ? 'bg-zinc-900/90' : 'bg-white/90'}`}>
              <div className="text-4xl mb-2">💶</div>
              <h3 className={`text-xl font-bold mb-2 ${isDarkMode ? 'text-zinc-100' : 'text-stone-800'}`}>
                Vége a játéknak!
              </h3>
              <div className={`text-3xl font-bold font-mono mb-1 ${isDarkMode ? 'text-cyan-400' : 'text-cyan-600'}`}>
                {score} {CONFIG.SCORE_UNIT_NAME}
              </div>
              {(() => {
                const hasOnline = hasSupabaseConfig && !hofLoading && hallOfFame.length > 0;
                const topScore = hasOnline ? hallOfFame[0].score : null;
                const isGlobalRecord = topScore !== null && score > topScore;
                const showBadge = hasOnline ? isGlobalRecord : isNewRecord;
                const label = hasOnline ? 'Új rekord!' : 'Saját rekord!';

                if (!showBadge || score <= 0) return null;

                return (
                  <div className="flex items-center justify-center gap-1 text-amber-500 mb-3">
                    <Trophy className="w-4 h-4" />
                    <span className="text-sm font-medium">{label}</span>
                  </div>
                );
              })()}
              <div className={`text-sm mb-4 ${isDarkMode ? 'text-zinc-400' : 'text-stone-600'}`}>
                Elért szint: {level}
              </div>
              {score > 0 && (
                <div className="mb-4">
                  {hasSupabaseConfig && hofLoading && hallOfFame.length === 0 && (
                    <div className={`text-xs ${isDarkMode ? 'text-zinc-400' : 'text-stone-500'}`}>
                      Toplista ellenőrzése...
                    </div>
                  )}
                  {(!hasSupabaseConfig || !hofLoading || hallOfFame.length > 0) && (
                    <>
                      {qualifiesForHof(score) ? (
                        <>
                          <label className={`block text-xs mb-2 ${isDarkMode ? 'text-zinc-400' : 'text-stone-500'}`}>
                            Név (max {CONFIG.NAME_MAX_CHARS} betű)
                          </label>
                          <div className="flex gap-2 justify-center">
                            <input
                              type="text"
                              value={playerName}
                              onChange={(e) => handleNameChange(e.target.value)}
                              maxLength={CONFIG.NAME_MAX_CHARS}
                              className={`w-28 px-3 py-2 text-center text-sm font-bold rounded-lg border ${
                                isDarkMode
                                  ? 'bg-zinc-800 border-zinc-700 text-zinc-100'
                                  : 'bg-stone-50 border-stone-300 text-stone-800'
                              }`}
                              placeholder="NEV"
                            />
                            <button
                              onClick={handleSaveScore}
                              disabled={hasSavedScore || playerName.trim().length === 0}
                              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                                hasSavedScore || playerName.trim().length === 0
                                  ? (isDarkMode
                                    ? 'bg-zinc-800 text-zinc-500'
                                    : 'bg-stone-200 text-stone-400')
                                  : 'bg-emerald-500 text-white hover:bg-emerald-400'
                              }`}
                            >
                              {hasSavedScore ? 'Mentve' : 'Mentés'}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className={`text-xs ${isDarkMode ? 'text-zinc-400' : 'text-stone-500'}`}>
                          Ez most nem fér be a Top 10-be.
                          {getHofCutoff() !== null && (
                            <> Belépési küszöb: {getHofCutoff()} {CONFIG.SCORE_UNIT_NAME}.</>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              <button
                onClick={startGame}
                className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-emerald-500 text-white font-bold rounded-xl
                  hover:from-cyan-400 hover:to-emerald-400 transition-all transform hover:scale-105 shadow-lg"
              >
                <RotateCcw className="w-4 h-4 inline mr-2" />
                Újra
              </button>
            </div>
          </div>
        )}

        {/* Level Clear overlay */}
        {gameState === 'levelclear' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className={`text-center p-6 rounded-2xl ${isDarkMode ? 'bg-zinc-900/90' : 'bg-white/90'}`}>
              <div className="text-4xl mb-2">🎉</div>
              <h3 className={`text-xl font-bold mb-2 ${isDarkMode ? 'text-zinc-100' : 'text-stone-800'}`}>
                {level}. szint teljesítve!
              </h3>
              <div className={`text-lg mb-1 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                +{CONFIG.LEVEL_CLEAR_SCORE} bónusz {CONFIG.SCORE_UNIT_NAME}!
              </div>
              <div className={`text-2xl font-bold font-mono mb-4 ${isDarkMode ? 'text-cyan-400' : 'text-cyan-600'}`}>
                Összesen: {score}
              </div>
              <button
                onClick={nextLevel}
                className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-bold rounded-xl
                  hover:from-emerald-400 hover:to-cyan-400 transition-all transform hover:scale-105 shadow-lg"
              >
                <Zap className="w-4 h-4 inline mr-2" />
                Következő szint
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer info */}
      <div className={`mt-3 text-center text-xs ${isDarkMode ? 'text-zinc-600' : 'text-stone-400'}`}>
        Rekord szint: {highLevel} | Akadályok: {Math.max(0, level - 1)} | {CONFIG.FOOD_PER_LEVEL} étel = 1 szint (+{CONFIG.LEVEL_CLEAR_SCORE} bónusz)
      </div>

      {(hallOfFame.length > 0 || hasSupabaseConfig || hofError) && (
        <div className={`mt-4 rounded-2xl border p-3 ${isDarkMode ? 'bg-zinc-900/70 border-zinc-800' : 'bg-white/80 border-stone-200'}`}>
          <div className={`text-xs uppercase tracking-wide mb-2 ${isDarkMode ? 'text-zinc-500' : 'text-stone-500'}`}>
            {hasSupabaseConfig && !hofError ? 'Hall of Fame (online)' : 'Hall of Fame (helyi)'}
          </div>
          {getHofCutoff() !== null && (
            <div className={`text-xs mb-2 ${isDarkMode ? 'text-zinc-500' : 'text-stone-500'}`}>
              Belépési küszöb: {getHofCutoff()} {CONFIG.SCORE_UNIT_NAME}
            </div>
          )}
          {hofLoading && hallOfFame.length === 0 && (
            <div className={`text-xs mb-2 ${isDarkMode ? 'text-zinc-500' : 'text-stone-500'}`}>
              Betöltés...
            </div>
          )}
          {hofLoading && hallOfFame.length > 0 && (
            <div className={`text-xs mb-2 ${isDarkMode ? 'text-zinc-500' : 'text-stone-500'}`}>
              Frissítés...
            </div>
          )}
          {hofError && (
            <div className={`text-xs mb-2 ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`}>
              {hofError}
            </div>
          )}
          <div className="space-y-1">
            {hallOfFame.length === 0 && !hofLoading && (
              <div className={`text-xs ${isDarkMode ? 'text-zinc-500' : 'text-stone-500'}`}>
                Még nincs bejegyzés.
              </div>
            )}
            {hallOfFame.map((entry, index) => (
              <div key={entry.id ?? `${entry.name}-${entry.ts}-${index}`} className="flex items-center justify-between text-sm">
                <span className={`${isDarkMode ? 'text-zinc-200' : 'text-stone-700'}`}>
                  {index + 1}. {entry.name}
                </span>
                <span className={`${isDarkMode ? 'text-cyan-400' : 'text-cyan-600'}`}>
                  {entry.score} {CONFIG.SCORE_UNIT_NAME}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
