import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// Funciona tanto rodando de src/ (tsx) quanto de dist/ (build).
const serverRoot = resolve(here, '..');

export interface GameTimings {
  countdownMs: number;
  revealMs: number;
  leaderboardMs: number;
  /** Tolerância de latência após o fim da rodada (o servidor ainda aceita). */
  lateGraceMs: number;
  /** Quando todos respondem, a rodada fecha após este atraso. */
  earlyCloseMs: number;
  /** Jogador desconectado no lobby é removido após este tempo. */
  lobbyDisconnectMs: number;
  /** Sala sem ninguém conectado é destruída após este tempo. */
  emptyRoomMs: number;
  /** Multiplicador aplicado ao tempo de resposta (testes/E2E). */
  roundScale: number;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig() {
  const scale = num('ABYSS_TIME_SCALE', 1);
  const timings: GameTimings = {
    countdownMs: 3500 * scale,
    revealMs: 9000 * scale,
    leaderboardMs: 5500 * scale,
    lateGraceMs: 400,
    earlyCloseMs: 900 * scale,
    lobbyDisconnectMs: 45_000,
    emptyRoomMs: 5 * 60_000,
    roundScale: scale,
  };
  return {
    port: num('PORT', 3000),
    host: process.env.HOST ?? '0.0.0.0',
    databaseUrl: process.env.DATABASE_URL ?? '',
    sqliteFile: process.env.SQLITE_FILE ?? join(serverRoot, 'data', 'abyss.sqlite'),
    questionsDir: process.env.QUESTIONS_DIR ?? join(serverRoot, 'data', 'questions'),
    lexiconFile: join(serverRoot, 'data', 'lexicon.txt'),
    clientDist: process.env.CLIENT_DIST ?? resolve(serverRoot, '..', 'client', 'dist'),
    corsOrigin: process.env.CORS_ORIGIN ?? '',
    anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
    aiModel: process.env.ABYSS_AI_MODEL ?? 'claude-haiku-5-5',
    priorStrength: num('ABYSS_PRIOR_STRENGTH', 40),
    timings,
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;
