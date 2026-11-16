/**
 * Conexão em tempo real. O cliente só ENVIA intenções (criar, entrar, responder);
 * todo estado (fase, prazo, pontos) vem do servidor.
 */
import { io, type Socket } from 'socket.io-client';
import {
  ERROR_MESSAGES,
  type Ack,
  type ClientToServerEvents,
  type ErrorCode,
  type JoinedPayload,
  type ResumePayload,
  type RoomSettings,
  type ServerToClientEvents,
} from '@abyss/shared';
import { useGame } from '../state/store';

type S = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Endereço do servidor. Vazio = mesmo site (servidor serve o cliente).
 * Defina VITE_SERVER_URL quando o cliente estiver em outro domínio (ex.: Vercel).
 */
export const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export const socket: S = io(SERVER_URL || undefined, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 600,
  reconnectionDelayMax: 4000,
  timeout: 8000,
});

const set = useGame.setState;

function ack<T>(event: keyof ClientToServerEvents, ...args: unknown[]): Promise<Ack<T>> {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, error: 'INTERNAL', message: 'Sem conexão com o servidor. Tentando reconectar…' });
      return;
    }
    const timer = setTimeout(() => resolve({ ok: false, error: 'INTERNAL', message: 'O servidor demorou a responder.' }), 8000);
    (socket.emit as (...a: unknown[]) => void)(event, ...args, (r: Ack<T>) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
}

/** Sincroniza o relógio (mediana de 5 medições, compensando metade da latência). */
async function syncClock() {
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const server = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 2000);
      socket.emit('time:sync', (n) => {
        clearTimeout(timer);
        resolve(n);
      });
    });
    if (server === null) continue;
    const t1 = Date.now();
    samples.push(server + (t1 - t0) / 2 - t1);
  }
  if (samples.length) {
    samples.sort((a, b) => a - b);
    set({ offset: samples[Math.floor(samples.length / 2)]! });
  }
}

function applyJoined(p: JoinedPayload) {
  const s = { token: p.sessionToken, playerId: p.playerId, code: p.snapshot.code };
  useGame.getState().setSession(s);
  set({ room: p.snapshot, myAnswer: null, lastRound: null, final: null, fatal: null });
}

async function tryResume() {
  const s = useGame.getState().session;
  if (!s) return;
  const r = await ack<ResumePayload>('room:resume', { sessionToken: s.token });
  if (r.ok) {
    applyJoined(r);
    set({ myAnswer: r.myAnswer, lastRound: r.lastRound, final: r.final });
  } else {
    useGame.getState().clearRoom({
      title: 'Não foi possível voltar à sala',
      message: r.error === 'SESSION_EXPIRED' ? 'A sala foi encerrada ou você ficou tempo demais fora.' : r.message,
    });
  }
}

socket.on('connect', () => {
  set({ connection: 'online' });
  void syncClock();
  void tryResume();
});
socket.on('disconnect', (reason) => {
  set({ connection: reason === 'io client disconnect' ? 'offline' : 'reconnecting' });
});
socket.io.on('reconnect_attempt', () => set({ connection: 'reconnecting' }));
socket.io.on('reconnect_failed', () => set({ connection: 'offline' }));
socket.on('connect_error', () => {
  if (useGame.getState().connection !== 'online') set({ connection: 'reconnecting' });
});

// O navegador avisa antes do servidor perceber: mostra "Reconectando…" na hora
// e força o transporte a fechar para que o Socket.IO tente reconectar sozinho.
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => {
    set({ connection: 'reconnecting' });
    socket.io.engine?.close();
  });
  window.addEventListener('online', () => {
    if (!socket.connected) socket.connect();
  });
}

socket.on('room:state', (room) => {
  const prev = useGame.getState().room;
  const patch: Partial<ReturnType<typeof useGame.getState>> = { room };
  // nova rodada ⇒ limpa a resposta local
  if (room.phase === 'question' && (prev?.phase !== 'question' || prev.round !== room.round)) patch.myAnswer = null;
  if (room.phase === 'lobby') Object.assign(patch, { lastRound: null, final: null, myAnswer: null });
  // corrige o relógio continuamente com cada snapshot (sem saltos bruscos)
  const measured = room.serverNow - Date.now();
  const cur = useGame.getState().offset;
  if (Math.abs(measured - cur) > 1500) patch.offset = measured;
  set(patch);
});
socket.on('round:result', (r) => set({ lastRound: r }));
socket.on('match:final', (f) => set({ final: f }));
socket.on('room:closed', ({ reason }) =>
  useGame.getState().clearRoom({ title: 'A sala foi encerrada', message: `Motivo: ${reason}.` }),
);
socket.on('room:kicked', ({ reason }) => {
  useGame.setState({ session: null });
  useGame.getState().clearRoom({ title: 'Você saiu desta janela', message: reason });
});

export function errorText(code: ErrorCode, fallback?: string) {
  return ERROR_MESSAGES[code] ?? fallback ?? 'Algo deu errado.';
}

export const api = {
  async create(settings?: Partial<RoomSettings>) {
    const p = useGame.getState().profile!;
    const r = await ack<JoinedPayload>('room:create', { ...p, settings });
    if (r.ok) applyJoined(r);
    return r;
  },
  async join(code: string) {
    const p = useGame.getState().profile!;
    const r = await ack<JoinedPayload>('room:join', { ...p, code });
    if (r.ok) applyJoined(r);
    return r;
  },
  async leave() {
    await ack('room:leave');
    useGame.getState().clearRoom();
  },
  settings: (s: Partial<RoomSettings>) => ack('room:settings', s),
  start: () => ack('room:start'),
  restart: () => ack('room:restart'),
  async answer(text: string) {
    const room = useGame.getState().room;
    if (!room) return { ok: false as const, error: 'NOT_IN_ROOM' as ErrorCode, message: '' };
    const r = await ack<{ accepted: string }>('round:answer', { text, round: room.round });
    if (r.ok) set({ myAnswer: r.accepted });
    return r;
  },
  reconnect() {
    socket.connect();
  },
};
