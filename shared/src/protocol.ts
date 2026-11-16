/**
 * Contrato de comunicação em tempo real entre cliente e servidor.
 * Tudo que chega do cliente é revalidado no servidor (zod) — estes tipos
 * descrevem o formato esperado, não garantem nada sozinhos.
 */
import type { DepthTier } from './depth.js';

export const LIMITS = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 35,
  ROUNDS: 10,
  NAME_MAX: 20,
  ANSWER_MAX: 60,
  ROOM_CODE_LENGTH: 5,
  ROUND_SECONDS_OPTIONS: [10, 15, 20, 30] as const,
  DEFAULT_ROUND_SECONDS: 20,
  DEFAULT_NAME: 'ANÔNIMO',
} as const;

export type DuplicateRule = 'decay' | 'none' | 'exclusive';

export const DUPLICATE_RULES: Record<DuplicateRule, { label: string; description: string }> = {
  decay: { label: 'Dividir o oceano', description: 'Respostas repetidas valem menos a cada jogador que também as escolheu.' },
  none: { label: 'Sem penalidade', description: 'Respostas repetidas mantêm a pontuação integral.' },
  exclusive: { label: 'Só o que é único', description: 'Respostas repetidas por 2+ jogadores valem zero.' },
};

export interface RoomSettings {
  roundSeconds: number;
  duplicateRule: DuplicateRule;
  /** Nichos habilitados; lista vazia = todos. */
  categories: string[];
}

export type RoomPhase = 'lobby' | 'starting' | 'question' | 'reveal' | 'leaderboard' | 'finished';

export interface PublicPlayer {
  id: string;
  name: string;
  character: string;
  isHost: boolean;
  connected: boolean;
  left: boolean;
  score: number;
  /** Já enviou resposta na rodada atual (nunca revela o conteúdo). */
  answered: boolean;
}

export interface PublicQuestion {
  id: string;
  category: string;
  prompt: string;
}

export interface RoomSnapshot {
  code: string;
  phase: RoomPhase;
  hostId: string;
  players: PublicPlayer[];
  settings: RoomSettings;
  round: number; // 1..10 (0 no lobby)
  totalRounds: number;
  question: PublicQuestion | null;
  /** Instante (ms, relógio do servidor) em que a fase atual termina. */
  phaseEndsAt: number | null;
  serverNow: number;
  matchId: string | null;
}

export interface RoundAnswerResult {
  playerId: string;
  name: string;
  character: string;
  raw: string;
  valid: boolean;
  matched: string | null;
  tier: DepthTier | null;
  basePoints: number;
  points: number;
  duplicates: number;
  reason: ValidationReason;
  via: MatchVia | null;
  /** Explicação cadastrada quando a resposta foi rejeitada (ex.: "é um peixe"). */
  note: string | null;
}

export type MatchVia = 'exact' | 'alias' | 'plural' | 'phonetic' | 'fuzzy' | 'ai';

export type ValidationReason =
  | 'ok'
  | 'empty'
  | 'no-answer'
  | 'not-found'
  | 'other-category'
  | 'rejected'
  | 'ambiguous';

export interface RoundResult {
  round: number;
  question: PublicQuestion;
  answers: RoundAnswerResult[];
  /** Respostas profundas que ninguém deu, para inspirar. */
  deepExamples: { name: string; tier: DepthTier }[];
  standings: Standing[];
}

export interface Standing {
  playerId: string;
  name: string;
  character: string;
  score: number;
  rank: number;
  delta: number;
  left: boolean;
}

export interface FinalResult {
  matchId: string;
  standings: Standing[];
  bestAnswer: { playerId: string; name: string; answer: string; tier: DepthTier; points: number; prompt: string } | null;
}

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'MATCH_IN_PROGRESS'
  | 'NOT_HOST'
  | 'NOT_ENOUGH_PLAYERS'
  | 'INVALID_PAYLOAD'
  | 'RATE_LIMITED'
  | 'NOT_IN_ROOM'
  | 'ALREADY_ANSWERED'
  | 'ROUND_CLOSED'
  | 'SESSION_EXPIRED'
  | 'INVALID_STATE'
  | 'INTERNAL';

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  ROOM_NOT_FOUND: 'Sala não encontrada. Confira o código.',
  ROOM_FULL: 'Esta sala já está cheia (35 jogadores).',
  MATCH_IN_PROGRESS: 'A partida desta sala já começou.',
  NOT_HOST: 'Só o anfitrião pode fazer isso.',
  NOT_ENOUGH_PLAYERS: 'São necessários pelo menos 2 jogadores conectados.',
  INVALID_PAYLOAD: 'Dados inválidos.',
  RATE_LIMITED: 'Calma! Muitas ações em pouco tempo.',
  NOT_IN_ROOM: 'Você não está em uma sala.',
  ALREADY_ANSWERED: 'Você já respondeu nesta rodada.',
  ROUND_CLOSED: 'O tempo acabou — respostas bloqueadas.',
  SESSION_EXPIRED: 'Sua sessão expirou.',
  INVALID_STATE: 'Ação indisponível neste momento.',
  INTERNAL: 'Erro interno. Tente novamente.',
};

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: ErrorCode; message: string };

export interface Profile {
  name: string;
  character: string;
}

export interface JoinedPayload {
  playerId: string;
  sessionToken: string;
  snapshot: RoomSnapshot;
}

export interface ResumePayload extends JoinedPayload {
  myAnswer: string | null;
  lastRound: RoundResult | null;
  final: FinalResult | null;
}

export interface ClientToServerEvents {
  'time:sync': (cb: (serverNow: number) => void) => void;
  'room:create': (p: Profile & { settings?: Partial<RoomSettings> }, cb: (r: Ack<JoinedPayload>) => void) => void;
  'room:join': (p: Profile & { code: string }, cb: (r: Ack<JoinedPayload>) => void) => void;
  'room:resume': (p: { sessionToken: string }, cb: (r: Ack<ResumePayload>) => void) => void;
  'room:leave': (cb: (r: Ack) => void) => void;
  'room:settings': (p: Partial<RoomSettings>, cb: (r: Ack) => void) => void;
  'room:start': (cb: (r: Ack) => void) => void;
  'room:restart': (cb: (r: Ack) => void) => void;
  'round:answer': (p: { text: string; round: number }, cb: (r: Ack<{ accepted: string }>) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (s: RoomSnapshot) => void;
  'round:result': (r: RoundResult) => void;
  'match:final': (f: FinalResult) => void;
  'room:closed': (p: { reason: string }) => void;
  'room:kicked': (p: { reason: string }) => void;
}

export interface CategoryInfo {
  name: string;
  questions: number;
}
