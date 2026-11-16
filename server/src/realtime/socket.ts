/**
 * Comunicação em tempo real. Cada evento do cliente é:
 *   1) limitado por taxa (token bucket por socket);
 *   2) validado com zod (eventos forjados/malformados são recusados);
 *   3) executado pelo RoomManager — a única fonte de verdade.
 */
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import {
  DUPLICATE_RULES,
  ERROR_MESSAGES,
  LIMITS,
  type ClientToServerEvents,
  type ErrorCode,
  type ServerToClientEvents,
} from '@abyss/shared';
import type { RoomManager } from '../rooms/RoomManager.js';
import type { Result } from '../rooms/Room.js';
import { KeyedWindowLimiter, TokenBucket } from './rateLimit.js';

const profile = z.object({
  name: z.string().max(200).optional().default(''),
  character: z.string().max(40),
});

const settings = z
  .object({
    roundSeconds: z.number().int().optional(),
    duplicateRule: z.enum(Object.keys(DUPLICATE_RULES) as [string, ...string[]]).optional(),
    categories: z.array(z.string().max(80)).max(40).optional(),
  })
  .strict();

const schemas = {
  create: profile.extend({ settings: settings.optional() }),
  join: profile.extend({ code: z.string().min(1).max(12) }),
  resume: z.object({ sessionToken: z.string().min(10).max(100) }),
  answer: z.object({ text: z.string().max(500), round: z.number().int().min(1).max(LIMITS.ROUNDS) }),
  settings,
};

type AckFn = (r: unknown) => void;
type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type S = Socket<ClientToServerEvents, ServerToClientEvents>;

function fail(code: ErrorCode) {
  return { ok: false as const, error: code, message: ERROR_MESSAGES[code] };
}

function toAck<T extends object>(r: Result<T>) {
  return r.ok ? r : fail(r.error);
}

export interface RealtimeOptions {
  roomCreateLimit?: { max: number; windowMs: number };
  eventBurst?: number;
  eventsPerSecond?: number;
  log: (msg: string, extra?: object) => void;
}

export function attachRealtime(io: IO, manager: RoomManager, opts: RealtimeOptions) {
  const createLimiter = new KeyedWindowLimiter(opts.roomCreateLimit?.max ?? 8, opts.roomCreateLimit?.windowMs ?? 60_000);

  io.on('connection', (socket: S) => {
    const ip = (socket.handshake.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || socket.handshake.address;
    const bucket = new TokenBucket(opts.eventBurst ?? 20, opts.eventsPerSecond ?? 8);

    /** Envolve um handler com rate limit, validação de ack e captura de erros. */
    const on = <P>(event: string, schema: z.ZodType<P> | null, handler: (payload: P) => unknown) => {
      socket.on(event as never, ((...args: unknown[]) => {
        const cb = args[args.length - 1];
        const ack: AckFn = typeof cb === 'function' ? (cb as AckFn) : () => undefined;
        if (typeof cb !== 'function') return; // todo evento exige ack; sem ack = forjado
        if (!bucket.take()) return ack(fail('RATE_LIMITED'));
        let payload: P = undefined as P;
        if (schema) {
          const parsed = schema.safeParse(args[0]);
          if (!parsed.success) return ack(fail('INVALID_PAYLOAD'));
          payload = parsed.data;
        }
        try {
          ack(handler(payload));
        } catch (e) {
          opts.log('erro em handler', { event, error: String(e) });
          ack(fail('INTERNAL'));
        }
      }) as never);
    };

    on('time:sync', null, () => Date.now());

    on('room:create', schemas.create, (p) => {
      if (!createLimiter.allow(ip)) return fail('RATE_LIMITED');
      return toAck(manager.create(socket.id, p, p.settings as never));
    });

    on('room:join', schemas.join, (p) => toAck(manager.join(socket.id, p.code, p)));
    on('room:resume', schemas.resume, (p) => toAck(manager.resume(socket.id, p.sessionToken)));
    on('room:leave', null, () => toAck(manager.leave(socket.id)));
    on('room:settings', schemas.settings, (p) => toAck(manager.withRoom(socket.id, (room, id) => room.updateSettings(id, p as never))));
    on('room:start', null, () => toAck(manager.withRoom(socket.id, (room, id) => room.start(id))));
    on('room:restart', null, () => toAck(manager.withRoom(socket.id, (room, id) => room.restart(id))));
    on('round:answer', schemas.answer, (p) => toAck(manager.withRoom(socket.id, (room, id) => room.submit(id, p.text, p.round))));

    socket.on('disconnect', () => manager.onDisconnect(socket.id));
  });
}
