import { io as ioc, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, RoomSnapshot, RoundResult, FinalResult } from '@abyss/shared';
import { createApp, type AbyssApp } from '../src/app.js';
import { MemoryRepository } from '../src/persistence/repository.js';

export type Client = Socket<ServerToClientEvents, ClientToServerEvents> & {
  states: RoomSnapshot[];
  results: RoundResult[];
  finals: FinalResult[];
  last(): RoomSnapshot | undefined;
};

/** Tempos acelerados: rodada de 10 s vira 300 ms. */
export const FAST = {
  countdownMs: 60,
  revealMs: 80,
  leaderboardMs: 50,
  lateGraceMs: 60,
  earlyCloseMs: 40,
  lobbyDisconnectMs: 400,
  emptyRoomMs: 2000,
  roundScale: 0.03,
};

export async function startServer(extra: Parameters<typeof createApp>[0] = {}) {
  const repo = new MemoryRepository();
  const app = await createApp({
    repo,
    quiet: true,
    judge: null,
    ...extra,
    config: { timings: FAST, ...(extra.config ?? {}) } as never,
    realtime: { roomCreateLimit: { max: 1000, windowMs: 60_000 }, eventBurst: 50, eventsPerSecond: 50, ...(extra.realtime ?? {}) },
  });
  const port = await app.listen(0);
  return { app, repo, url: `http://127.0.0.1:${port}` };
}

export function connect(url: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const s = ioc(url, { transports: ['websocket'], forceNew: true, reconnection: false }) as Client;
    s.states = [];
    s.results = [];
    s.finals = [];
    s.last = () => s.states[s.states.length - 1];
    s.on('room:state', (st) => s.states.push(st));
    s.on('round:result', (r) => s.results.push(r));
    s.on('match:final', (f) => s.finals.push(f));
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

export function emit<T = any>(s: Client, event: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve) => (s.emit as any)(event, ...args, (r: T) => resolve(r)));
}

export async function waitFor(pred: () => boolean, timeout = 15_000, step = 10): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeout) throw new Error('waitFor: tempo esgotado');
    await new Promise((r) => setTimeout(r, step));
  }
}

export const phaseOf = (c: Client) => c.last()?.phase;

export async function closeAll(app: AbyssApp, clients: Client[]) {
  for (const c of clients) c.disconnect();
  await app.close();
}
