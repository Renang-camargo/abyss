/**
 * Camada de persistência. Três implementações com o mesmo contrato:
 *   • PostgresRepository — produção (DATABASE_URL=postgres://…)
 *   • SqliteRepository   — padrão local, arquivo embutido, zero dependências externas
 *   • MemoryRepository   — testes
 */
import type { DepthTier } from '@abyss/shared';

export interface AnswerStatRow {
  questionId: string;
  answerId: string;
  count: number;
}

export interface MatchRecord {
  id: string;
  roomCode: string;
  startedAt: number;
  playerCount: number;
  settings: object;
}

export interface RoundAnswerRecord {
  playerId: string;
  playerName: string;
  raw: string;
  normalized: string;
  answerId: string | null;
  valid: boolean;
  reason: string;
  via: string | null;
  tier: DepthTier | null;
  points: number;
}

export interface RoundRecord {
  matchId: string;
  round: number;
  questionId: string;
  answers: RoundAnswerRecord[];
}

export interface FinalStandingRecord {
  playerId: string;
  name: string;
  character: string;
  score: number;
  rank: number;
}

export interface Repository {
  readonly kind: 'postgres' | 'sqlite' | 'memory';
  init(): Promise<void>;
  loadAnswerStats(): Promise<AnswerStatRow[]>;
  createMatch(m: MatchRecord): Promise<void>;
  recordRound(r: RoundRecord): Promise<void>;
  finishMatch(matchId: string, endedAt: number, standings: FinalStandingRecord[]): Promise<void>;
  recordUnmatched(questionId: string, normalized: string, raw: string, aiVerdict: string | null): Promise<void>;
  stats(): Promise<{ matches: number; answers: number; unmatched: number }>;
  close(): Promise<void>;
}

/** Esquema SQL comum (compatível com PostgreSQL e SQLite). */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  ended_at BIGINT,
  player_count INTEGER NOT NULL,
  settings TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS match_players (
  match_id TEXT NOT NULL REFERENCES matches(id),
  player_id TEXT NOT NULL,
  name TEXT NOT NULL,
  character_id TEXT NOT NULL,
  final_score INTEGER NOT NULL,
  final_rank INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id)
);
CREATE TABLE IF NOT EXISTS round_answers (
  match_id TEXT NOT NULL REFERENCES matches(id),
  round INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  raw TEXT NOT NULL,
  normalized TEXT NOT NULL,
  answer_id TEXT,
  valid INTEGER NOT NULL,
  reason TEXT NOT NULL,
  via TEXT,
  tier INTEGER,
  points INTEGER NOT NULL,
  PRIMARY KEY (match_id, round, player_id)
);
CREATE TABLE IF NOT EXISTS answer_stats (
  question_id TEXT NOT NULL,
  answer_id TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (question_id, answer_id)
);
CREATE TABLE IF NOT EXISTS unmatched_answers (
  question_id TEXT NOT NULL,
  normalized TEXT NOT NULL,
  sample_raw TEXT NOT NULL,
  ai_verdict TEXT,
  count INTEGER NOT NULL,
  PRIMARY KEY (question_id, normalized)
);
CREATE INDEX IF NOT EXISTS idx_round_answers_question ON round_answers(question_id);
`;

export class MemoryRepository implements Repository {
  readonly kind = 'memory' as const;
  readonly matches = new Map<string, MatchRecord & { endedAt?: number; standings?: FinalStandingRecord[] }>();
  readonly rounds: RoundRecord[] = [];
  readonly answerStats = new Map<string, number>();
  readonly unmatched = new Map<string, { raw: string; count: number; ai: string | null }>();

  async init() {}
  async loadAnswerStats(): Promise<AnswerStatRow[]> {
    return [...this.answerStats.entries()].map(([k, count]) => {
      const [questionId, answerId] = k.split('::') as [string, string];
      return { questionId, answerId, count };
    });
  }
  async createMatch(m: MatchRecord) {
    this.matches.set(m.id, { ...m });
  }
  async recordRound(r: RoundRecord) {
    this.rounds.push(r);
    for (const a of r.answers) {
      if (!a.valid || !a.answerId) continue;
      const k = `${r.questionId}::${a.answerId}`;
      this.answerStats.set(k, (this.answerStats.get(k) ?? 0) + 1);
    }
  }
  async finishMatch(matchId: string, endedAt: number, standings: FinalStandingRecord[]) {
    const m = this.matches.get(matchId);
    if (m) Object.assign(m, { endedAt, standings });
  }
  async recordUnmatched(questionId: string, normalized: string, raw: string, ai: string | null) {
    const k = `${questionId}::${normalized}`;
    const cur = this.unmatched.get(k);
    this.unmatched.set(k, { raw, ai, count: (cur?.count ?? 0) + 1 });
  }
  async stats() {
    return {
      matches: this.matches.size,
      answers: this.rounds.reduce((s, r) => s + r.answers.length, 0),
      unmatched: this.unmatched.size,
    };
  }
  async close() {}
}
