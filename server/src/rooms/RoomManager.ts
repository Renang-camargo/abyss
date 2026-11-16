import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { LIMITS, CHARACTER_IDS, type ErrorCode, type JoinedPayload, type ResumePayload, type RoomSettings } from '@abyss/shared';
import { Room, type PlayerState, type Result, type RoomDeps } from './Room.js';
import { sanitizeFreeText } from '../validation/normalize.js';

/** Sem caracteres ambíguos (0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface Session {
  roomCode: string;
  playerId: string;
}

export type ManagerDeps = Omit<RoomDeps, 'emit' | 'onDestroy'> & {
  emitToRoom: (roomCode: string, event: string, payload: unknown) => void;
  emitToSocket: (socketId: string, event: string, payload: unknown) => void;
  /** Coloca o socket no canal da sala (Socket.IO room). */
  joinChannel: (socketId: string, roomCode: string) => void;
  leaveChannel: (socketId: string, roomCode: string) => void;
  disconnectSocket: (socketId: string) => void;
};

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  /** token secreto → sessão (o token nunca é transmitido a outros jogadores). */
  private readonly sessions = new Map<string, Session>();
  /** socketId → sessão atual */
  private readonly sockets = new Map<string, Session>();

  constructor(private readonly deps: ManagerDeps) {}

  private newCode(): string {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let c = '';
      for (let i = 0; i < LIMITS.ROOM_CODE_LENGTH; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
    throw new Error('sem códigos disponíveis');
  }

  static cleanName(name: unknown): string {
    const n = sanitizeFreeText(name, LIMITS.NAME_MAX);
    return n || LIMITS.DEFAULT_NAME;
  }

  static cleanCharacter(c: unknown): string {
    return typeof c === 'string' && CHARACTER_IDS.includes(c) ? c : CHARACTER_IDS[0]!;
  }

  private newPlayer(socketId: string, name: unknown, character: unknown): PlayerState {
    return {
      id: randomUUID(),
      token: randomBytes(24).toString('base64url'),
      name: RoomManager.cleanName(name),
      character: RoomManager.cleanCharacter(character),
      socketId,
      connected: true,
      left: false,
      score: 0,
      joinedAt: Date.now(),
      disconnectedAt: null,
      stats: { bestPoints: 0, validCount: 0, totalAnswerMs: 0 },
    };
  }

  private makeRoom(settings?: Partial<RoomSettings>): Room {
    const code = this.newCode();
    const room = new Room(
      code,
      {
        ...this.deps,
        emit: (to, event, payload) => (to ? this.deps.emitToSocket(to, event, payload) : this.deps.emitToRoom(code, event, payload)),
        onDestroy: (r) => this.onRoomDestroyed(r),
      },
      settings,
    );
    this.rooms.set(code, room);
    return room;
  }

  private onRoomDestroyed(room: Room) {
    this.rooms.delete(room.code);
    for (const p of room.players.values()) {
      this.sessions.delete(p.token);
      if (p.socketId) {
        this.sockets.delete(p.socketId);
        this.deps.leaveChannel(p.socketId, room.code);
      }
    }
    this.deps.log('sala encerrada', { room: room.code });
  }

  sessionOf(socketId: string): (Session & { room: Room }) | null {
    const s = this.sockets.get(socketId);
    if (!s) return null;
    const room = this.rooms.get(s.roomCode);
    if (!room || !room.players.has(s.playerId)) {
      this.sockets.delete(socketId);
      return null;
    }
    return { ...s, room };
  }

  /** Um socket só pode estar em uma sala por vez. */
  private detachSocket(socketId: string) {
    const s = this.sessionOf(socketId);
    if (s) {
      s.room.leave(s.playerId);
      this.deps.leaveChannel(socketId, s.roomCode);
      this.sockets.delete(socketId);
    }
  }

  private bind(socketId: string, room: Room, player: PlayerState): JoinedPayload {
    this.sessions.set(player.token, { roomCode: room.code, playerId: player.id });
    this.sockets.set(socketId, { roomCode: room.code, playerId: player.id });
    this.deps.joinChannel(socketId, room.code);
    return { playerId: player.id, sessionToken: player.token, snapshot: room.snapshot() };
  }

  create(socketId: string, profile: { name: unknown; character: unknown }, settings?: Partial<RoomSettings>): Result<JoinedPayload> {
    this.detachSocket(socketId);
    const room = this.makeRoom();
    const player = this.newPlayer(socketId, profile.name, profile.character);
    room.addPlayer(player);
    if (settings) room.updateSettings(player.id, settings);
    this.deps.log('sala criada', { room: room.code });
    const payload = this.bind(socketId, room, player);
    room.broadcast();
    return { ok: true, ...payload, snapshot: room.snapshot() };
  }

  join(socketId: string, code: unknown, profile: { name: unknown; character: unknown }): Result<JoinedPayload> {
    const c = typeof code === 'string' ? code.trim().toUpperCase() : '';
    const room = this.rooms.get(c);
    if (!room) return { ok: false, error: 'ROOM_NOT_FOUND' };
    const existing = this.sessionOf(socketId);
    if (existing?.roomCode === c) return { ok: false, error: 'INVALID_STATE' };
    const player = this.newPlayer(socketId, profile.name, profile.character);
    const r = room.addPlayer(player);
    if (!r.ok) return r;
    this.detachSocket(socketId);
    const payload = this.bind(socketId, room, player);
    room.broadcast();
    return { ok: true, ...payload, snapshot: room.snapshot() };
  }

  /** Reconexão: o token devolve a mesma identidade, pontuação e lugar na partida. */
  resume(socketId: string, token: unknown): Result<ResumePayload> {
    if (typeof token !== 'string') return { ok: false, error: 'INVALID_PAYLOAD' };
    const s = this.sessions.get(token);
    const room = s ? this.rooms.get(s.roomCode) : undefined;
    const player = s && room ? room.players.get(s.playerId) : undefined;
    if (!s || !room || !player || player.left) return { ok: false, error: 'SESSION_EXPIRED' };

    // A mesma sessão aberta em outra aba: a anterior é desligada.
    if (player.socketId && player.socketId !== socketId) {
      const old = player.socketId;
      this.deps.emitToSocket(old, 'room:kicked', { reason: 'Sua sessão foi aberta em outra janela.' });
      this.sockets.delete(old);
      this.deps.leaveChannel(old, room.code);
      this.deps.disconnectSocket(old);
    }
    const current = this.sessionOf(socketId);
    if (current && current.playerId !== player.id) this.detachSocket(socketId);

    this.sockets.set(socketId, { roomCode: room.code, playerId: player.id });
    this.deps.joinChannel(socketId, room.code);
    room.attachSocket(player.id, socketId);
    return {
      ok: true,
      playerId: player.id,
      sessionToken: token,
      snapshot: room.snapshot(),
      myAnswer: room.myAnswer(player.id),
      lastRound: room.phase === 'reveal' || room.phase === 'leaderboard' ? room.lastRound : null,
      final: room.phase === 'finished' ? room.final : null,
    };
  }

  leave(socketId: string): Result {
    const s = this.sessionOf(socketId);
    if (!s) return { ok: false, error: 'NOT_IN_ROOM' };
    const player = s.room.players.get(s.playerId);
    if (player) this.sessions.delete(player.token);
    this.detachSocket(socketId);
    return { ok: true };
  }

  onDisconnect(socketId: string) {
    const s = this.sessionOf(socketId);
    this.sockets.delete(socketId);
    if (!s) return;
    const p = s.room.players.get(s.playerId);
    if (p?.socketId === socketId) s.room.disconnect(s.playerId);
  }

  withRoom<T extends object>(socketId: string, fn: (room: Room, playerId: string) => Result<T>): Result<T> {
    const s = this.sessionOf(socketId);
    if (!s) return { ok: false, error: 'NOT_IN_ROOM' as ErrorCode };
    return fn(s.room, s.playerId);
  }

  shutdown() {
    for (const r of [...this.rooms.values()]) r.destroy('servidor reiniciando');
  }
}
