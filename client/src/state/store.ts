import { create } from 'zustand';
import type { FinalResult, RoomSnapshot, RoundResult } from '@abyss/shared';

export type PreScreen = 'splash' | 'character' | 'identity' | 'menu' | 'create' | 'join';
export type Connection = 'connecting' | 'online' | 'reconnecting' | 'offline';

export interface Session {
  token: string;
  playerId: string;
  code: string;
}

const PROFILE_KEY = 'abyss.profile';
const SESSION_KEY = 'abyss.session';

function readJSON<T>(storage: Storage | undefined, key: string): T | null {
  try {
    const v = storage?.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function writeJSON(storage: Storage | undefined, key: string, value: unknown) {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(value));
  } catch {
    /* modo privado: segue sem persistir */
  }
}
const local = typeof localStorage !== 'undefined' ? localStorage : undefined;
const sess = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;

export interface FatalError {
  title: string;
  message: string;
}

interface State {
  screen: PreScreen;
  profile: { name: string; character: string } | null;
  draftCharacter: string;
  connection: Connection;
  session: Session | null;
  room: RoomSnapshot | null;
  myAnswer: string | null;
  lastRound: RoundResult | null;
  final: FinalResult | null;
  /** serverTime - Date.now() */
  offset: number;
  toast: { id: number; text: string } | null;
  fatal: FatalError | null;
  /** Profundidade visual (0 = superfície, 1 = abismo). */
  depth: number;
  inviteCode: string | null;

  go(screen: PreScreen): void;
  setProfile(p: { name: string; character: string }): void;
  setDraftCharacter(c: string): void;
  setSession(s: Session | null): void;
  setDepth(d: number): void;
  showToast(text: string): void;
  clearRoom(fatal?: FatalError | null): void;
}

export const useGame = create<State>((set, get) => ({
  screen: 'splash',
  profile: readJSON(local, PROFILE_KEY),
  draftCharacter: readJSON<{ character: string }>(local, PROFILE_KEY)?.character ?? 'tubarao',
  connection: 'connecting',
  session: readJSON(sess, SESSION_KEY),
  room: null,
  myAnswer: null,
  lastRound: null,
  final: null,
  offset: 0,
  toast: null,
  fatal: null,
  depth: 0.12,
  inviteCode: null,

  go: (screen) => set({ screen, fatal: null }),
  setProfile: (profile) => {
    writeJSON(local, PROFILE_KEY, profile);
    set({ profile, draftCharacter: profile.character });
  },
  setDraftCharacter: (draftCharacter) => set({ draftCharacter }),
  setSession: (session) => {
    writeJSON(sess, SESSION_KEY, session);
    set({ session });
  },
  setDepth: (depth) => {
    if (Math.abs(get().depth - depth) > 0.001) set({ depth });
  },
  showToast: (text) => set({ toast: { id: Date.now(), text } }),
  clearRoom: (fatal = null) => {
    writeJSON(sess, SESSION_KEY, null);
    set({ session: null, room: null, myAnswer: null, lastRound: null, final: null, fatal, screen: 'menu' });
  },
}));

/** Relógio do servidor (para contagens regressivas sincronizadas). */
export function serverNow(): number {
  return Date.now() + useGame.getState().offset;
}

import { useRef } from 'react';
/** Sala atual; durante a animação de saída mantém o último valor (evita tela quebrada ao sair). */
export function useRoom(): RoomSnapshot {
  const room = useGame((s) => s.room);
  const last = useRef(room);
  if (room) last.current = room;
  return last.current!;
}
