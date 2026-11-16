/**
 * Implementações SQL (PostgreSQL e SQLite) do Repository.
 * As consultas usam "?" e são convertidas para "$1, $2…" no PostgreSQL.
 */
import {
  SCHEMA_SQL,
  type AnswerStatRow,
  type FinalStandingRecord,
  type MatchRecord,
  type Repository,
  type RoundRecord,
} from './repository.js';

interface Executor {
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

abstract class SqlRepository implements Repository {
  abstract readonly kind: 'postgres' | 'sqlite';
  protected abstract db: Executor;

  async init() {
    await this.db.exec(SCHEMA_SQL);
  }

  async loadAnswerStats(): Promise<AnswerStatRow[]> {
    const rows = await this.db.all<{ question_id: string; answer_id: string; count: number | string }>(
      'SELECT question_id, answer_id, count FROM answer_stats',
    );
    return rows.map((r) => ({ questionId: r.question_id, answerId: r.answer_id, count: Number(r.count) }));
  }

  async createMatch(m: MatchRecord) {
    await this.db.run('INSERT INTO matches (id, room_code, started_at, player_count, settings) VALUES (?, ?, ?, ?, ?)', [
      m.id,
      m.roomCode,
      m.startedAt,
      m.playerCount,
      JSON.stringify(m.settings),
    ]);
  }

  async recordRound(r: RoundRecord) {
    await this.db.tx(async () => {
      for (const a of r.answers) {
        await this.db.run(
          `INSERT INTO round_answers (match_id, round, question_id, player_id, player_name, raw, normalized, answer_id, valid, reason, via, tier, points)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [r.matchId, r.round, r.questionId, a.playerId, a.playerName, a.raw, a.normalized, a.answerId, a.valid ? 1 : 0, a.reason, a.via, a.tier, a.points],
        );
        if (a.valid && a.answerId) {
          await this.db.run(
            `INSERT INTO answer_stats (question_id, answer_id, count) VALUES (?, ?, 1)
             ON CONFLICT (question_id, answer_id) DO UPDATE SET count = answer_stats.count + 1`,
            [r.questionId, a.answerId],
          );
        }
      }
    });
  }

  async finishMatch(matchId: string, endedAt: number, standings: FinalStandingRecord[]) {
    await this.db.tx(async () => {
      await this.db.run('UPDATE matches SET ended_at = ? WHERE id = ?', [endedAt, matchId]);
      for (const s of standings) {
        await this.db.run(
          'INSERT INTO match_players (match_id, player_id, name, character_id, final_score, final_rank) VALUES (?, ?, ?, ?, ?, ?)',
          [matchId, s.playerId, s.name, s.character, s.score, s.rank],
        );
      }
    });
  }

  async recordUnmatched(questionId: string, normalized: string, raw: string, aiVerdict: string | null) {
    if (!normalized) return;
    await this.db.run(
      `INSERT INTO unmatched_answers (question_id, normalized, sample_raw, ai_verdict, count) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT (question_id, normalized) DO UPDATE SET count = unmatched_answers.count + 1, ai_verdict = COALESCE(EXCLUDED.ai_verdict, unmatched_answers.ai_verdict)`,
      [questionId, normalized.slice(0, 80), raw.slice(0, 80), aiVerdict],
    );
  }

  async stats() {
    const [m] = await this.db.all<{ n: number | string }>('SELECT COUNT(*) AS n FROM matches');
    const [a] = await this.db.all<{ n: number | string }>('SELECT COUNT(*) AS n FROM round_answers');
    const [u] = await this.db.all<{ n: number | string }>('SELECT COUNT(*) AS n FROM unmatched_answers');
    return { matches: Number(m?.n ?? 0), answers: Number(a?.n ?? 0), unmatched: Number(u?.n ?? 0) };
  }

  async close() {
    await this.db.close();
  }
}

export class SqliteRepository extends SqlRepository {
  readonly kind = 'sqlite' as const;
  protected db!: Executor;

  constructor(private readonly file: string) {
    super();
  }

  override async init() {
    // node:sqlite é nativo do Node ≥ 22.5 — nenhum binário para baixar.
    const { DatabaseSync } = await import('node:sqlite');
    const conn = new DatabaseSync(this.file);
    conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    let depth = 0;
    this.db = {
      async run(sql, params = []) {
        conn.prepare(sql).run(...(params as never[]));
      },
      async all<T>(sql: string, params: unknown[] = []) {
        return conn.prepare(sql).all(...(params as never[])) as T[];
      },
      async exec(sql) {
        conn.exec(sql);
      },
      async tx(fn) {
        if (depth++ === 0) conn.exec('BEGIN');
        try {
          const r = await fn();
          if (--depth === 0) conn.exec('COMMIT');
          return r;
        } catch (e) {
          if (--depth === 0) conn.exec('ROLLBACK');
          throw e;
        }
      },
      async close() {
        conn.close();
      },
    };
    await super.init();
  }
}

export class PostgresRepository extends SqlRepository {
  readonly kind = 'postgres' as const;
  protected db!: Executor;

  constructor(private readonly url: string) {
    super();
  }

  override async init() {
    const pg = await import('pg');
    const pool = new pg.default.Pool({ connectionString: this.url, max: 10 });
    const toPg = (sql: string) => {
      let i = 0;
      return sql.replace(/\?/g, () => `$${++i}`);
    };
    // Transações usam um cliente dedicado; fora delas, o pool.
    let txClient: import('pg').PoolClient | null = null;
    const q = (sql: string, params: unknown[] = []) => (txClient ?? pool).query(toPg(sql), params);
    let chain: Promise<unknown> = Promise.resolve();
    this.db = {
      async run(sql, params) {
        await q(sql, params);
      },
      async all<T>(sql: string, params?: unknown[]) {
        return (await q(sql, params)).rows as T[];
      },
      async exec(sql) {
        await pool.query(sql);
      },
      tx<T>(fn: () => Promise<T>) {
        // Serializa transações para não misturar clientes.
        const next = chain.then(async () => {
          txClient = await pool.connect();
          try {
            await txClient.query('BEGIN');
            const r = await fn();
            await txClient.query('COMMIT');
            return r;
          } catch (e) {
            await txClient.query('ROLLBACK');
            throw e;
          } finally {
            txClient.release();
            txClient = null;
          }
        });
        chain = next.catch(() => undefined);
        return next;
      },
      async close() {
        await pool.end();
      },
    };
    await super.init();
  }
}
