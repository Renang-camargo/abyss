import { afterEach, describe, expect, it } from 'vitest';
import { LIMITS } from '@abyss/shared';
import { closeAll, connect, emit, phaseOf, startServer, waitFor, type Client } from './helpers.js';
import type { AbyssApp } from '../src/app.js';

let app: AbyssApp | null = null;
let clients: Client[] = [];

afterEach(async () => {
  if (app) await closeAll(app, clients);
  app = null;
  clients = [];
});

async function setup(n: number, extra = {}) {
  const s = await startServer(extra);
  app = s.app;
  const cs: Client[] = [];
  for (let i = 0; i < n; i++) cs.push(await connect(s.url));
  clients = cs;
  return { ...s, cs };
}

/** Responde uma resposta válida (de raridade variada) da pergunta atual. */
function answerFor(app: AbyssApp, c: Client, idx: number): string {
  const qid = c.last()!.question!.id;
  const q = app.bank.get(qid)!;
  return q.answers[(idx * 7) % q.answers.length]!.name;
}

describe('salas', () => {
  it('cria sala com código exclusivo, entra por código e mostra os conectados', async () => {
    const { cs } = await setup(2);
    const [a, b] = cs as [Client, Client];
    const r1 = await emit(a, 'room:create', { name: 'Ana', character: 'polvo' });
    expect(r1.ok).toBe(true);
    expect(r1.snapshot.code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    expect(r1.sessionToken.length).toBeGreaterThan(20);

    const r2 = await emit(b, 'room:join', { name: 'Ana', character: 'raia', code: r1.snapshot.code.toLowerCase() });
    expect(r2.ok).toBe(true);
    await waitFor(() => a.last()?.players.length === 2);
    const players = a.last()!.players;
    expect(players.map((p) => p.name)).toEqual(['Ana', 'Ana']); // mesmo nome, IDs diferentes
    expect(new Set(players.map((p) => p.id)).size).toBe(2);
    expect(players.find((p) => p.isHost)?.id).toBe(r1.playerId);
    // token secreto nunca vaza no estado público
    expect(JSON.stringify(a.last())).not.toContain(r2.sessionToken);
  });

  it('nome vazio vira ANÔNIMO e personagem inválido é corrigido', async () => {
    const { cs } = await setup(1);
    const r = await emit(cs[0]!, 'room:create', { name: '   ', character: 'dragao-hacker' });
    expect(r.snapshot.players[0].name).toBe(LIMITS.DEFAULT_NAME);
    expect(r.snapshot.players[0].character).toBe('tubarao');
  });

  it('código inexistente e saída da sala', async () => {
    const { cs } = await setup(2);
    const [a, b] = cs as [Client, Client];
    expect((await emit(b, 'room:join', { name: 'x', character: 'lula', code: 'ZZZZZ' })).error).toBe('ROOM_NOT_FOUND');
    const r = await emit(a, 'room:create', { name: 'A', character: 'lula' });
    await emit(b, 'room:join', { name: 'B', character: 'lula', code: r.snapshot.code });
    await waitFor(() => a.last()?.players.length === 2);
    expect((await emit(b, 'room:leave')).ok).toBe(true);
    await waitFor(() => a.last()?.players.length === 1);
    // anfitrião sai ⇒ sala some
    await emit(a, 'room:leave');
    expect(app!.manager.rooms.size).toBe(0);
  });

  it('35 jogadores entram; o 36º é recusado', async () => {
    const { cs } = await setup(36);
    const host = cs[0]!;
    const r = await emit(host, 'room:create', { name: 'Host', character: 'baleia' });
    const code = r.snapshot.code;
    const results = await Promise.all(cs.slice(1, 35).map((c, i) => emit(c, 'room:join', { name: `P${i}`, character: 'raia', code })));
    expect(results.every((x) => x.ok)).toBe(true);
    await waitFor(() => host.last()?.players.length === 35);
    const r36 = await emit(cs[35]!, 'room:join', { name: 'P36', character: 'raia', code });
    expect(r36.ok).toBe(false);
    expect(r36.error).toBe('ROOM_FULL');
  });

  it('permissões: só o anfitrião inicia; mínimo de 2 jogadores; sem entrada após o início', async () => {
    const { cs } = await setup(3);
    const [a, b, late] = cs as [Client, Client, Client];
    const r = await emit(a, 'room:create', { name: 'A', character: 'lula' });
    expect((await emit(a, 'room:start')).error).toBe('NOT_ENOUGH_PLAYERS');
    await emit(b, 'room:join', { name: 'B', character: 'lula', code: r.snapshot.code });
    expect((await emit(b, 'room:start')).error).toBe('NOT_HOST');
    expect((await emit(b, 'room:settings', { roundSeconds: 30 })).error).toBe('NOT_HOST');
    expect((await emit(a, 'room:settings', { roundSeconds: 7 })).error).toBe('INVALID_PAYLOAD');
    expect((await emit(a, 'room:settings', { roundSeconds: 15, duplicateRule: 'exclusive' })).ok).toBe(true);
    expect((await emit(a, 'room:start')).ok).toBe(true);
    const j = await emit(late, 'room:join', { name: 'L', character: 'lula', code: r.snapshot.code });
    expect(j.error).toBe('MATCH_IN_PROGRESS');
  });
});

describe('segurança de eventos', () => {
  it('recusa payloads malformados, eventos sem ack e ações fora da sala', async () => {
    const { cs } = await setup(1);
    const c = cs[0]!;
    expect((await emit(c, 'room:create', { name: 123, character: 'lula' })).error).toBe('INVALID_PAYLOAD');
    expect((await emit(c, 'room:join', { code: 'A'.repeat(500), name: 'x', character: 'lula' })).error).toBe('INVALID_PAYLOAD');
    expect((await emit(c, 'round:answer', { text: 'oi', round: 1 })).error).toBe('NOT_IN_ROOM');
    expect((await emit(c, 'room:start')).error).toBe('NOT_IN_ROOM');
    expect((await emit(c, 'room:settings', { hack: true })).error).toBe('INVALID_PAYLOAD');
    // sem callback: ignorado silenciosamente (não derruba nada)
    (c.emit as any)('room:create', { name: 'x', character: 'lula' });
    await new Promise((r) => setTimeout(r, 50));
    expect(app!.manager.rooms.size).toBe(0);
  });

  it('limita a taxa de eventos por socket', async () => {
    const { cs } = await startServer({ realtime: { eventBurst: 5, eventsPerSecond: 1 } }).then(async (s) => {
      app = s.app;
      const c = await connect(s.url);
      clients = [c];
      return { cs: [c] };
    });
    const res = await Promise.all(Array.from({ length: 20 }, () => emit(cs[0]!, 'room:leave')));
    expect(res.filter((r) => r.error === 'RATE_LIMITED').length).toBeGreaterThanOrEqual(10);
  });
});

describe('partida completa', () => {
  it('2 jogadores: 10 rodadas sincronizadas, validação, pontuação, pódio e persistência', async () => {
    const { cs, repo } = await setup(2);
    const [a, b] = cs as [Client, Client];
    const r = await emit(a, 'room:create', { name: 'Ana', character: 'polvo' });
    await emit(b, 'room:join', { name: 'Bia', character: 'raia', code: r.snapshot.code });
    expect((await emit(a, 'room:start')).ok).toBe(true);

    for (let round = 1; round <= LIMITS.ROUNDS; round++) {
      await waitFor(() => a.last()?.phase === 'question' && a.last()?.round === round && b.last()?.round === round);
      const sa = a.last()!;
      const sb = b.last()!;
      // todos recebem a mesma pergunta e o mesmo prazo do servidor
      expect(sa.question!.id).toBe(sb.question!.id);
      expect(sa.phaseEndsAt).toBe(sb.phaseEndsAt);
      // o cliente nunca recebe a lista de respostas
      expect(JSON.stringify(sa)).not.toMatch(/"answers"|aliases|tier/);

      const ra = await emit(a, 'round:answer', { text: answerFor(app!, a, round), round });
      expect(ra.ok).toBe(true);
      // proteção contra resposta repetida
      expect((await emit(a, 'round:answer', { text: 'outra', round })).error).toBe('ALREADY_ANSWERED');
      // rodada errada
      expect((await emit(b, 'round:answer', { text: 'x', round: round + 1 > 10 ? 1 : round + 1 })).error).toBe('ROUND_CLOSED');
      // Bia responde algo inválido nas rodadas pares
      const text = round % 2 === 0 ? 'zzzqqqxxx' : answerFor(app!, b, round + 3);
      expect((await emit(b, 'round:answer', { text, round })).ok).toBe(true);

      await waitFor(() => a.results.length === round && b.results.length === round);
      const res = a.results[round - 1]!;
      expect(res.round).toBe(round);
      const bia = res.answers.find((x) => x.name === 'Bia')!;
      if (round % 2 === 0) {
        expect(bia.valid).toBe(false);
        expect(bia.points).toBe(0);
      } else expect(bia.valid).toBe(true);
      const ana = res.answers.find((x) => x.name === 'Ana')!;
      expect(ana.valid).toBe(true);
      expect(ana.points).toBeGreaterThan(0);
    }

    await waitFor(() => a.finals.length === 1 && b.finals.length === 1);
    expect(phaseOf(a)).toBe('finished');
    const final = a.finals[0]!;
    expect(final.standings).toHaveLength(2);
    expect(final.standings.map((s) => s.rank)).toEqual([1, 2]);
    // integridade: pontuação final = soma dos pontos de cada rodada
    for (const s of final.standings) {
      const sum = a.results.reduce((t, r) => t + (r.answers.find((x) => x.playerId === s.playerId)?.points ?? 0), 0);
      expect(s.score).toBe(sum);
    }
    expect(final.standings[0]!.score).toBeGreaterThanOrEqual(final.standings[1]!.score);
    expect(final.bestAnswer?.points).toBeGreaterThan(0);

    // persistência
    await waitFor(() => repo.rounds.length === 10);
    const m = [...repo.matches.values()][0]!;
    expect(m.standings).toHaveLength(2);
    expect(repo.answerStats.size).toBeGreaterThan(0);

    // anfitrião reinicia: volta ao lobby com os mesmos jogadores
    expect((await emit(b, 'room:restart')).error).toBe('NOT_HOST');
    expect((await emit(a, 'room:restart')).ok).toBe(true);
    await waitFor(() => b.last()?.phase === 'lobby');
    expect(b.last()!.players.every((p) => p.score === 0)).toBe(true);
  });

  it('35 jogadores respondendo simultaneamente; duplicadas perdem pontos', async () => {
    const { cs } = await setup(35);
    const host = cs[0]!;
    const r = await emit(host, 'room:create', { name: 'Host', character: 'baleia' });
    await Promise.all(cs.slice(1).map((c, i) => emit(c, 'room:join', { name: `J${i}`, character: 'lula', code: r.snapshot.code })));
    await waitFor(() => host.last()?.players.length === 35);
    expect((await emit(host, 'room:start')).ok).toBe(true);

    await waitFor(() => cs.every((c) => c.last()?.phase === 'question' && c.last()?.round === 1));
    const q = app!.bank.get(host.last()!.question!.id)!;
    const common = q.answers[0]!.name;
    // 30 respondem a mesma coisa, 5 respondem coisas diferentes — tudo ao mesmo tempo
    const acks = await Promise.all(
      cs.map((c, i) => emit(c, 'round:answer', { text: i < 30 ? common : q.answers[10 + i]!.name, round: 1 })),
    );
    expect(acks.every((x) => x.ok)).toBe(true);
    await waitFor(() => cs.every((c) => c.results.length === 1));
    const res = host.results[0]!;
    const dup = res.answers.filter((x) => x.matched === q.answers[0]!.name);
    expect(dup).toHaveLength(30);
    expect(dup.every((x) => x.duplicates === 30 && x.points < x.basePoints)).toBe(true);
    // todos os 35 clientes receberam exatamente o mesmo resultado
    const sig = JSON.stringify(res);
    expect(cs.every((c) => JSON.stringify(c.results[0]) === sig)).toBe(true);
  });

  it('respostas após o fim do tempo são bloqueadas pelo servidor', async () => {
    const { cs } = await setup(2);
    const [a, b] = cs as [Client, Client];
    const r = await emit(a, 'room:create', { name: 'A', character: 'lula' });
    await emit(b, 'room:join', { name: 'B', character: 'lula', code: r.snapshot.code });
    await emit(a, 'room:start');
    await waitFor(() => a.last()?.phase === 'question');
    await waitFor(() => a.last()?.phase === 'reveal'); // ninguém respondeu: tempo acaba
    expect((await emit(a, 'round:answer', { text: 'baleia', round: 1 })).error).toBe('ROUND_CLOSED');
    expect(a.results[0]!.answers.every((x) => x.reason === 'no-answer' && x.points === 0)).toBe(true);
  });
});

describe('desconexão e reconexão', () => {
  it('jogador cai no meio da partida, volta com o token e mantém identidade e pontos', async () => {
    const s = await setup(2);
    const [a, b] = s.cs as [Client, Client];
    const r = await emit(a, 'room:create', { name: 'A', character: 'lula' });
    const jb = await emit(b, 'room:join', { name: 'B', character: 'raia', code: r.snapshot.code });
    await emit(a, 'room:start');
    await waitFor(() => b.last()?.phase === 'question');
    await emit(b, 'round:answer', { text: answerFor(app!, b, 1), round: 1 });
    await waitFor(() => b.results.length === 1);
    const pointsBefore = b.results[0]!.answers.find((x) => x.playerId === jb.playerId)!.points;

    b.disconnect();
    await waitFor(() => a.last()!.players.find((p) => p.id === jb.playerId)?.connected === false);

    const b2 = await connect(s.url);
    clients.push(b2);
    const rr = await emit(b2, 'room:resume', { sessionToken: jb.sessionToken });
    expect(rr.ok).toBe(true);
    expect(rr.playerId).toBe(jb.playerId);
    expect(rr.snapshot.players.find((p: any) => p.id === jb.playerId).score).toBe(pointsBefore);
    await waitFor(() => a.last()!.players.find((p) => p.id === jb.playerId)?.connected === true);

    // continua jogando normalmente
    await waitFor(() => b2.last()?.phase === 'question' && b2.last()?.round === 2);
    expect((await emit(b2, 'round:answer', { text: answerFor(app!, b2, 2), round: 2 })).ok).toBe(true);
  });

  it('token inválido ou de sessão encerrada é recusado', async () => {
    const { cs } = await setup(1);
    expect((await emit(cs[0]!, 'room:resume', { sessionToken: 'x'.repeat(30) })).error).toBe('SESSION_EXPIRED');
  });

  it('mesma sessão aberta em outra aba derruba a anterior', async () => {
    const s = await setup(2);
    const [a, b] = s.cs as [Client, Client];
    const r = await emit(a, 'room:create', { name: 'A', character: 'lula' });
    const jb = await emit(b, 'room:join', { name: 'B', character: 'lula', code: r.snapshot.code });
    let kicked = false;
    b.on('room:kicked', () => (kicked = true));
    const b2 = await connect(s.url);
    clients.push(b2);
    expect((await emit(b2, 'room:resume', { sessionToken: jb.sessionToken })).ok).toBe(true);
    await waitFor(() => kicked);
    await waitFor(() => !b.connected);
    expect(a.last()!.players).toHaveLength(2);
  });

  it('no lobby, quem não volta é removido; jogo continua para os demais', async () => {
    const s = await setup(3);
    const [a, b, c] = s.cs as [Client, Client, Client];
    const r = await emit(a, 'room:create', { name: 'A', character: 'lula' });
    await emit(b, 'room:join', { name: 'B', character: 'lula', code: r.snapshot.code });
    await emit(c, 'room:join', { name: 'C', character: 'lula', code: r.snapshot.code });
    await waitFor(() => a.last()?.players.length === 3);
    c.disconnect();
    await waitFor(() => a.last()?.players.length === 2, 3000);
    expect((await emit(a, 'room:start')).ok).toBe(true);
  });

  it('anfitrião sai durante a partida ⇒ outro jogador vira anfitrião', async () => {
    const s = await setup(3);
    const [a, b, c] = s.cs as [Client, Client, Client];
    const r = await emit(a, 'room:create', { name: 'A', character: 'lula' });
    const jb = await emit(b, 'room:join', { name: 'B', character: 'lula', code: r.snapshot.code });
    await emit(c, 'room:join', { name: 'C', character: 'lula', code: r.snapshot.code });
    await emit(a, 'room:start');
    await waitFor(() => b.last()?.phase === 'question');
    await emit(a, 'room:leave');
    await waitFor(() => b.last()?.hostId === jb.playerId);
    expect(b.last()!.players.find((p) => p.name === 'A')?.left).toBe(true);
  });
});

describe('carga', () => {
  it('35 jogadores jogam as 10 rodadas inteiras até o pódio', async () => {
    const { cs, repo } = await setup(35);
    const host = cs[0]!;
    const r = await emit(host, 'room:create', { name: 'Host', character: 'baleia' });
    await Promise.all(cs.slice(1).map((c, i) => emit(c, 'room:join', { name: `J${i}`, character: 'lula', code: r.snapshot.code })));
    await waitFor(() => host.last()?.players.length === 35);
    await emit(host, 'room:start');
    for (let round = 1; round <= LIMITS.ROUNDS; round++) {
      await waitFor(() => cs.every((c) => c.last()?.phase === 'question' && c.last()?.round === round));
      const q = app!.bank.get(host.last()!.question!.id)!;
      const acks = await Promise.all(
        cs.map((c, i) => emit(c, 'round:answer', { text: i % 9 === 0 ? 'resposta errada qualquer' : q.answers[(i * 3 + round) % q.answers.length]!.name, round })),
      );
      expect(acks.every((x) => x.ok)).toBe(true);
      await waitFor(() => cs.every((c) => c.results.length === round));
    }
    await waitFor(() => cs.every((c) => c.finals.length === 1));
    const f = host.finals[0]!;
    expect(f.standings).toHaveLength(35);
    expect(new Set(f.standings.map((s) => s.rank)).size).toBe(35);
    for (const s of f.standings) {
      const sum = host.results.reduce((t, rr) => t + (rr.answers.find((x) => x.playerId === s.playerId)?.points ?? 0), 0);
      expect(s.score).toBe(sum);
    }
    await waitFor(() => repo.rounds.length === 10);
    expect(repo.rounds.reduce((t, rr) => t + rr.answers.length, 0)).toBe(350);
  });
});
