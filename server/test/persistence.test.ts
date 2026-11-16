import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIMITS } from '@abyss/shared';
import { PostgresRepository, SqliteRepository } from '../src/persistence/sql.js';
import type { Repository } from '../src/persistence/repository.js';
import { connect, emit, startServer, waitFor } from './helpers.js';

async function exercise(repo: Repository) {
  await repo.init();
  const matchId = `m-${Date.now()}-${Math.random()}`;
  await repo.createMatch({ id: matchId, roomCode: 'ABCDE', startedAt: Date.now(), playerCount: 2, settings: { roundSeconds: 20 } });
  const answers = [
    { playerId: 'p1', playerName: 'Ana', raw: 'Tubarão', normalized: 'tubarao', answerId: 'tubarao', valid: true, reason: 'ok', via: 'exact', tier: 1 as const, points: 50 },
    { playerId: 'p2', playerName: 'Bia', raw: 'carro', normalized: 'carro', answerId: null, valid: false, reason: 'other-category', via: null, tier: null, points: 0 },
  ];
  await repo.recordRound({ matchId, round: 1, questionId: 'q-persist', answers });
  await repo.recordRound({ matchId, round: 2, questionId: 'q-persist', answers: [answers[0]!] });
  await repo.recordUnmatched('q-persist', 'carro', 'carro', null);
  await repo.recordUnmatched('q-persist', 'carro', 'Carro', 'inválida (0.10)');
  await repo.finishMatch(matchId, Date.now(), [
    { playerId: 'p1', name: 'Ana', character: 'polvo', score: 100, rank: 1 },
    { playerId: 'p2', name: 'Bia', character: 'raia', score: 0, rank: 2 },
  ]);
  const stats = await repo.loadAnswerStats();
  const row = stats.find((s) => s.questionId === 'q-persist' && s.answerId === 'tubarao');
  expect(row?.count).toBeGreaterThanOrEqual(2);
  const s = await repo.stats();
  expect(s.matches).toBeGreaterThanOrEqual(1);
  expect(s.unmatched).toBeGreaterThanOrEqual(1);
  await repo.close();
}

describe('persistência', () => {
  it('SQLite embutido (padrão sem serviços externos)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'abyss-'));
    await exercise(new SqliteRepository(join(dir, 'test.sqlite')));
    // reabrir mantém os dados (frequência histórica sobrevive a reinícios)
    const again = new SqliteRepository(join(dir, 'test.sqlite'));
    await again.init();
    expect((await again.loadAnswerStats()).find((r) => r.answerId === 'tubarao')?.count).toBe(2);
    await again.close();
  });

  const pgUrl = process.env.PG_TEST_URL;
  it.skipIf(!pgUrl)('PostgreSQL', async () => {
    await exercise(new PostgresRepository(pgUrl!));
  });

  it('servidor com SQLite: partida completa grava histórico e a raridade é recarregada no reinício', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'abyss-'));
    const file = join(dir, 'game.sqlite');
    const repo = new SqliteRepository(file);
    const { app, url } = await startServer({ repo });
    const a = await connect(url);
    const b = await connect(url);
    const r = await emit(a, 'room:create', { name: 'A', character: 'lula' });
    await emit(b, 'room:join', { name: 'B', character: 'lula', code: r.snapshot.code });
    await emit(a, 'room:start');
    for (let round = 1; round <= LIMITS.ROUNDS; round++) {
      await waitFor(() => a.last()?.phase === 'question' && a.last()?.round === round);
      const q = app.bank.get(a.last()!.question!.id)!;
      await Promise.all([emit(a, 'round:answer', { text: q.answers[0]!.name, round }), emit(b, 'round:answer', { text: q.answers[1]!.name, round })]);
    }
    await waitFor(() => a.finals.length === 1);
    a.disconnect();
    b.disconnect();
    await app.close();
    const reopened = new SqliteRepository(file);
    await reopened.init();
    const s = await reopened.stats();
    expect(s.matches).toBe(1);
    expect(s.answers).toBe(20);
    expect((await reopened.loadAnswerStats()).length).toBeGreaterThanOrEqual(10);
    await reopened.close();
  });
});
