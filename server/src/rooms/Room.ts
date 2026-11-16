/**
 * Uma sala = um grupo de jogadores + o motor da partida.
 * O servidor é a única autoridade: relógio, fases, validação e pontos vivem aqui.
 */
import { randomUUID } from 'node:crypto';
import {
  LIMITS,
  type DepthTier,
  type ErrorCode,
  type FinalResult,
  type PublicPlayer,
  type RoomPhase,
  type RoomSettings,
  type RoomSnapshot,
  type RoundAnswerResult,
  type RoundResult,
  type Standing,
} from '@abyss/shared';
import type { GameTimings } from '../config.js';
import type { QuestionBank } from '../questions/bank.js';
import type { QuestionDef } from '../questions/parser.js';
import type { Repository } from '../persistence/repository.js';
import type { RarityModel } from '../scoring/rarity.js';
import { scoreRound } from '../scoring/scoring.js';
import type { ValidationService } from '../validation/service.js';
import type { ValidationResult } from '../validation/validator.js';
import { sanitizeFreeText } from '../validation/normalize.js';

export interface PlayerState {
  id: string;
  token: string;
  name: string;
  character: string;
  socketId: string | null;
  connected: boolean;
  left: boolean;
  score: number;
  joinedAt: number;
  disconnectedAt: number | null;
  stats: { bestPoints: number; validCount: number; totalAnswerMs: number };
}

interface Submission {
  raw: string;
  elapsedMs: number;
  validation: Promise<ValidationResult>;
}

export interface RoomDeps {
  timings: GameTimings;
  bank: QuestionBank;
  validation: ValidationService;
  rarity: RarityModel;
  repo: Repository;
  /** Envia para a sala inteira (to = null) ou para um socket específico. */
  emit: (to: string | null, event: string, payload: unknown) => void;
  onDestroy: (room: Room) => void;
  log: (msg: string, extra?: object) => void;
  now?: () => number;
  random?: () => number;
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: ErrorCode };

export class Room {
  readonly players = new Map<string, PlayerState>();
  phase: RoomPhase = 'lobby';
  hostId = '';
  settings: RoomSettings;
  round = 0;
  questions: QuestionDef[] = [];
  phaseEndsAt: number | null = null;
  matchId: string | null = null;
  lastRound: RoundResult | null = null;
  final: FinalResult | null = null;
  private submissions = new Map<string, Submission>();
  private roundStartedAt = 0;
  private closing = false;
  private timer: NodeJS.Timeout | null = null;
  private emptyTimer: NodeJS.Timeout | null = null;
  private lobbyTimers = new Map<string, NodeJS.Timeout>();
  private bestAnswer: FinalResult['bestAnswer'] = null;
  destroyed = false;

  constructor(
    readonly code: string,
    private readonly deps: RoomDeps,
    settings?: Partial<RoomSettings>,
  ) {
    this.settings = {
      roundSeconds: LIMITS.DEFAULT_ROUND_SECONDS,
      duplicateRule: 'decay',
      categories: [],
      ...settings,
    };
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  // ───────────────────────── jogadores ─────────────────────────

  activePlayers(): PlayerState[] {
    return [...this.players.values()].filter((p) => !p.left);
  }

  connectedPlayers(): PlayerState[] {
    return this.activePlayers().filter((p) => p.connected);
  }

  addPlayer(p: PlayerState): Result {
    if (this.phase !== 'lobby') return { ok: false, error: 'MATCH_IN_PROGRESS' };
    if (this.activePlayers().length >= LIMITS.MAX_PLAYERS) return { ok: false, error: 'ROOM_FULL' };
    this.players.set(p.id, p);
    if (!this.hostId) this.hostId = p.id;
    this.cancelEmptyTimer();
    this.broadcast();
    return { ok: true };
  }

  attachSocket(playerId: string, socketId: string) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.socketId = socketId;
    p.connected = true;
    p.disconnectedAt = null;
    const t = this.lobbyTimers.get(playerId);
    if (t) clearTimeout(t);
    this.lobbyTimers.delete(playerId);
    this.cancelEmptyTimer();
    this.broadcast();
  }

  /** Queda de conexão (não é saída voluntária). */
  disconnect(playerId: string) {
    const p = this.players.get(playerId);
    if (!p || !p.connected) return;
    p.connected = false;
    p.socketId = null;
    p.disconnectedAt = this.now();
    if (this.phase === 'lobby') {
      // No lobby, quem não volta em alguns segundos sai da sala.
      this.lobbyTimers.set(
        playerId,
        setTimeout(() => this.removePlayer(playerId), this.deps.timings.lobbyDisconnectMs),
      );
    }
    if (!this.connectedPlayers().length) this.startEmptyTimer();
    this.maybeCloseEarly();
    this.broadcast();
  }

  /** Saída voluntária. */
  leave(playerId: string) {
    const p = this.players.get(playerId);
    if (!p) return;
    if (this.phase === 'lobby' || this.phase === 'finished') {
      this.removePlayer(playerId);
      return;
    }
    p.left = true;
    p.connected = false;
    p.socketId = null;
    this.transferHostIfNeeded();
    if (!this.activePlayers().length) return this.destroy('todos saíram');
    if (!this.connectedPlayers().length) this.startEmptyTimer();
    this.maybeCloseEarly();
    this.broadcast();
  }

  private removePlayer(playerId: string) {
    const t = this.lobbyTimers.get(playerId);
    if (t) clearTimeout(t);
    this.lobbyTimers.delete(playerId);
    if (!this.players.delete(playerId)) return;
    this.transferHostIfNeeded();
    if (!this.activePlayers().length) return this.destroy('sala vazia');
    this.broadcast();
  }

  private transferHostIfNeeded() {
    const host = this.players.get(this.hostId);
    if (host && !host.left) return;
    const next = this.connectedPlayers()[0] ?? this.activePlayers()[0];
    this.hostId = next?.id ?? '';
  }

  private startEmptyTimer() {
    if (this.emptyTimer) return;
    this.emptyTimer = setTimeout(() => this.destroy('sem jogadores conectados'), this.deps.timings.emptyRoomMs);
  }

  private cancelEmptyTimer() {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
  }

  // ───────────────────────── configurações ─────────────────────────

  updateSettings(byPlayerId: string, patch: Partial<RoomSettings>): Result {
    if (byPlayerId !== this.hostId) return { ok: false, error: 'NOT_HOST' };
    if (this.phase !== 'lobby') return { ok: false, error: 'INVALID_STATE' };
    const valid = new Set(this.deps.bank.categories().map((c) => c.name));
    if (patch.roundSeconds !== undefined) {
      if (!(LIMITS.ROUND_SECONDS_OPTIONS as readonly number[]).includes(patch.roundSeconds))
        return { ok: false, error: 'INVALID_PAYLOAD' };
      this.settings.roundSeconds = patch.roundSeconds;
    }
    if (patch.duplicateRule !== undefined) this.settings.duplicateRule = patch.duplicateRule;
    if (patch.categories !== undefined) {
      if (patch.categories.some((c) => !valid.has(c))) return { ok: false, error: 'INVALID_PAYLOAD' };
      this.settings.categories = [...new Set(patch.categories)];
    }
    this.broadcast();
    return { ok: true };
  }

  // ───────────────────────── partida ─────────────────────────

  start(byPlayerId: string): Result {
    if (byPlayerId !== this.hostId) return { ok: false, error: 'NOT_HOST' };
    if (this.phase !== 'lobby') return { ok: false, error: 'INVALID_STATE' };
    if (this.connectedPlayers().length < LIMITS.MIN_PLAYERS) return { ok: false, error: 'NOT_ENOUGH_PLAYERS' };

    // Quem ainda estava desconectado no lobby fica de fora.
    for (const p of [...this.players.values()]) if (!p.connected) this.removePlayer(p.id);
    for (const p of this.players.values()) {
      p.score = 0;
      p.stats = { bestPoints: 0, validCount: 0, totalAnswerMs: 0 };
    }
    this.questions = this.pickQuestions(LIMITS.ROUNDS);
    this.matchId = randomUUID();
    this.round = 0;
    this.lastRound = null;
    this.final = null;
    this.bestAnswer = null;
    this.deps.repo
      .createMatch({
        id: this.matchId,
        roomCode: this.code,
        startedAt: this.now(),
        playerCount: this.activePlayers().length,
        settings: this.settings,
      })
      .catch((e) => this.deps.log('persistência: createMatch falhou', { error: String(e) }));
    this.setPhase('starting', this.deps.timings.countdownMs, () => this.beginRound(1));
    return { ok: true };
  }

  private pickQuestions(n: number): QuestionDef[] {
    const rnd = this.deps.random ?? Math.random;
    const all = this.deps.bank.questions;
    const cats = new Set(this.settings.categories);
    const preferred = cats.size ? all.filter((q) => cats.has(q.category)) : all;
    const shuffle = <T,>(arr: T[]) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    };
    // Variedade: evita repetir nicho em sequência quando possível.
    const pool = shuffle(preferred);
    const picked: QuestionDef[] = [];
    while (picked.length < n && pool.length) {
      const last = picked[picked.length - 1]?.category;
      const idx = pool.findIndex((q) => q.category !== last);
      picked.push(pool.splice(idx >= 0 ? idx : 0, 1)[0]!);
    }
    if (picked.length < n) {
      const extra = shuffle(all.filter((q) => !picked.includes(q)));
      picked.push(...extra.slice(0, n - picked.length));
    }
    return picked;
  }

  private beginRound(n: number) {
    this.round = n;
    this.submissions.clear();
    this.closing = false;
    this.roundStartedAt = this.now();
    const roundMs = this.settings.roundSeconds * 1000 * this.deps.timings.roundScale;
    this.phase = 'question';
    this.phaseEndsAt = this.now() + roundMs;
    this.schedule(roundMs + this.deps.timings.lateGraceMs, () => void this.closeRound());
    this.broadcast();
  }

  get currentQuestion(): QuestionDef | null {
    return this.phase === 'question' || this.phase === 'reveal' || this.phase === 'leaderboard' || this.phase === 'starting'
      ? (this.questions[this.round - 1] ?? null)
      : null;
  }

  submit(playerId: string, text: unknown, round: unknown): Result<{ accepted: string }> {
    const p = this.players.get(playerId);
    if (!p || p.left) return { ok: false, error: 'NOT_IN_ROOM' };
    if (this.phase !== 'question' || this.closing || round !== this.round) return { ok: false, error: 'ROUND_CLOSED' };
    if (this.phaseEndsAt === null || this.now() > this.phaseEndsAt + this.deps.timings.lateGraceMs)
      return { ok: false, error: 'ROUND_CLOSED' };
    if (this.submissions.has(playerId)) return { ok: false, error: 'ALREADY_ANSWERED' };
    const raw = sanitizeFreeText(text, LIMITS.ANSWER_MAX);
    if (!raw) return { ok: false, error: 'INVALID_PAYLOAD' };

    const q = this.questions[this.round - 1]!;
    const validation = this.deps.validation.validate(q.id, raw);
    validation.catch(() => undefined);
    this.submissions.set(playerId, { raw, elapsedMs: this.now() - this.roundStartedAt, validation });
    this.maybeCloseEarly();
    this.broadcast();
    return { ok: true, accepted: raw };
  }

  /** Todos os conectados responderam? Encurta a rodada. */
  private maybeCloseEarly() {
    if (this.phase !== 'question' || this.closing) return;
    const waiting = this.connectedPlayers().filter((p) => !this.submissions.has(p.id));
    if (waiting.length || !this.submissions.size) return;
    const closeAt = this.now() + this.deps.timings.earlyCloseMs;
    if (this.phaseEndsAt !== null && closeAt >= this.phaseEndsAt) return;
    this.phaseEndsAt = closeAt;
    this.schedule(this.deps.timings.earlyCloseMs, () => void this.closeRound());
  }

  private async closeRound() {
    if (this.closing || this.phase !== 'question' || this.destroyed) return;
    this.closing = true;
    this.clearTimer();
    const q = this.questions[this.round - 1]!;
    const round = this.round;

    const entries = await Promise.all(
      this.activePlayers().map(async (p) => {
        const sub = this.submissions.get(p.id);
        const v = sub ? await sub.validation.catch(() => null) : null;
        return { p, sub, v };
      }),
    );
    if (this.destroyed) return;

    const tiers = new Map<string, DepthTier | null>();
    for (const { p, v } of entries) {
      if (!v?.valid || !v.answerId) {
        tiers.set(p.id, null);
        continue;
      }
      let tier = this.deps.rarity.tier(q.id, v.answerId, v.curatedTier ?? 3);
      if (v.via === 'ai') tier = Math.min(tier, 3) as DepthTier; // teto para respostas fora da base
      tiers.set(p.id, tier);
    }

    const scored = scoreRound(
      entries.map(({ p, v }) => ({
        playerId: p.id,
        valid: !!v?.valid,
        answerKey: v?.valid ? v.answerId : null,
        tier: tiers.get(p.id) ?? null,
      })),
      this.settings.duplicateRule,
    );
    const byPlayer = new Map(scored.map((s) => [s.playerId, s]));
    const before = this.standings();
    const prevScore = new Map(before.map((s) => [s.playerId, s.score]));

    const answers: RoundAnswerResult[] = entries.map(({ p, sub, v }) => {
      const s = byPlayer.get(p.id)!;
      p.score += s.points;
      if (v?.valid) {
        p.stats.validCount++;
        p.stats.totalAnswerMs += sub?.elapsedMs ?? 0;
        p.stats.bestPoints = Math.max(p.stats.bestPoints, s.points);
      }
      const tier = tiers.get(p.id) ?? null;
      if (v?.valid && tier && s.points > 0) {
        const b = this.bestAnswer;
        if (!b || s.points > b.points || (s.points === b.points && tier > b.tier))
          this.bestAnswer = { playerId: p.id, name: p.name, answer: v.canonical ?? sub!.raw, tier, points: s.points, prompt: q.prompt };
      }
      return {
        playerId: p.id,
        name: p.name,
        character: p.character,
        raw: sub?.raw ?? '',
        valid: !!v?.valid,
        matched: v?.valid ? v.canonical : null,
        tier,
        basePoints: s.basePoints,
        points: s.points,
        duplicates: s.duplicates,
        reason: sub ? (v?.reason ?? 'not-found') : 'no-answer',
        via: v?.via ?? null,
        note: v?.note ?? null,
      };
    });
    answers.sort((a, b) => b.points - a.points || (b.tier ?? 0) - (a.tier ?? 0) || a.name.localeCompare(b.name));

    const given = new Set(entries.map((e) => e.v?.answerId).filter(Boolean));
    const rnd = this.deps.random ?? Math.random;
    const deep = q.answers
      .filter((a) => !given.has(a.id) && this.deps.rarity.tier(q.id, a.id, a.tier) >= 4)
      .map((a) => ({ a, k: rnd() }))
      .sort((x, y) => x.k - y.k)
      .slice(0, 3)
      .map(({ a }) => ({ name: a.name, tier: this.deps.rarity.tier(q.id, a.id, a.tier) }));

    const standings = this.standings().map((s) => ({ ...s, delta: s.score - (prevScore.get(s.playerId) ?? 0) }));
    this.lastRound = {
      round,
      question: { id: q.id, category: q.category, prompt: q.prompt },
      answers,
      deepExamples: deep,
      standings,
    };

    // A frequência histórica só é atualizada DEPOIS de pontuar esta rodada.
    for (const { v } of entries) if (v?.valid && v.answerId && !v.answerId.startsWith('ai:')) this.deps.rarity.bump(q.id, v.answerId);
    if (this.matchId) {
      this.deps.repo
        .recordRound({
          matchId: this.matchId,
          round,
          questionId: q.id,
          answers: entries
            .filter((e) => e.sub)
            .map(({ p, sub, v }) => ({
              playerId: p.id,
              playerName: p.name,
              raw: sub!.raw,
              normalized: v?.normalized ?? '',
              answerId: v?.valid ? v.answerId : null,
              valid: !!v?.valid,
              reason: v?.reason ?? 'not-found',
              via: v?.via ?? null,
              tier: tiers.get(p.id) ?? null,
              points: byPlayer.get(p.id)?.points ?? 0,
            })),
        })
        .catch((e) => this.deps.log('persistência: recordRound falhou', { error: String(e) }));
    }

    this.closing = false;
    this.deps.emit(null, 'round:result', this.lastRound);
    const isLast = round >= this.questions.length;
    this.setPhase('reveal', this.deps.timings.revealMs, () =>
      isLast ? this.finish() : this.setPhase('leaderboard', this.deps.timings.leaderboardMs, () => this.beginRound(round + 1)),
    );
  }

  private finish() {
    const standings = this.standings();
    this.final = { matchId: this.matchId!, standings, bestAnswer: this.bestAnswer };
    this.phase = 'finished';
    this.phaseEndsAt = null;
    this.clearTimer();
    if (!this.players.get(this.hostId)?.connected) {
      const next = this.connectedPlayers()[0];
      if (next) this.hostId = next.id;
    }
    this.deps.emit(null, 'match:final', this.final);
    this.broadcast();
    this.deps.repo
      .finishMatch(
        this.matchId!,
        this.now(),
        standings.map((s) => ({ playerId: s.playerId, name: s.name, character: s.character, score: s.score, rank: s.rank })),
      )
      .catch((e) => this.deps.log('persistência: finishMatch falhou', { error: String(e) }));
  }

  restart(byPlayerId: string): Result {
    if (byPlayerId !== this.hostId) return { ok: false, error: 'NOT_HOST' };
    if (this.phase !== 'finished') return { ok: false, error: 'INVALID_STATE' };
    for (const p of [...this.players.values()]) if (p.left || !p.connected) this.players.delete(p.id);
    this.transferHostIfNeeded();
    for (const p of this.players.values()) p.score = 0;
    Object.assign(this, { phase: 'lobby', round: 0, questions: [], phaseEndsAt: null, matchId: null, lastRound: null, final: null });
    this.broadcast();
    return { ok: true };
  }

  /** Classificação com desempates: pontos → melhor resposta → acertos → rapidez → ordem de entrada. */
  standings(): Standing[] {
    const list = [...this.players.values()].sort(
      (a, b) =>
        b.score - a.score ||
        b.stats.bestPoints - a.stats.bestPoints ||
        b.stats.validCount - a.stats.validCount ||
        a.stats.totalAnswerMs - b.stats.totalAnswerMs ||
        a.joinedAt - b.joinedAt,
    );
    return list.map((p, i) => ({
      playerId: p.id,
      name: p.name,
      character: p.character,
      score: p.score,
      rank: i + 1,
      delta: 0,
      left: p.left,
    }));
  }

  // ───────────────────────── estado público ─────────────────────────

  snapshot(): RoomSnapshot {
    const q = this.currentQuestion;
    const players: PublicPlayer[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      character: p.character,
      isHost: p.id === this.hostId,
      connected: p.connected,
      left: p.left,
      score: p.score,
      answered: this.phase === 'question' && this.submissions.has(p.id),
    }));
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players,
      settings: this.settings,
      round: this.round,
      totalRounds: LIMITS.ROUNDS,
      // A pergunta só é revelada quando a rodada começa (nunca na contagem regressiva).
      question: q && this.phase !== 'starting' ? { id: q.id, category: q.category, prompt: q.prompt } : null,
      phaseEndsAt: this.phaseEndsAt,
      serverNow: this.now(),
      matchId: this.matchId,
    };
  }

  myAnswer(playerId: string): string | null {
    return this.phase === 'question' ? (this.submissions.get(playerId)?.raw ?? null) : null;
  }

  broadcast() {
    if (!this.destroyed) this.deps.emit(null, 'room:state', this.snapshot());
  }

  // ───────────────────────── timers ─────────────────────────

  private setPhase(phase: RoomPhase, ms: number, next: () => void) {
    this.phase = phase;
    this.phaseEndsAt = this.now() + ms;
    this.schedule(ms, next);
    this.broadcast();
  }

  private schedule(ms: number, fn: () => void) {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        fn();
      } catch (e) {
        this.deps.log('erro no ciclo da partida', { room: this.code, error: String(e) });
      }
    }, Math.max(0, ms));
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  destroy(reason: string) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearTimer();
    this.cancelEmptyTimer();
    for (const t of this.lobbyTimers.values()) clearTimeout(t);
    this.lobbyTimers.clear();
    this.deps.emit(null, 'room:closed', { reason });
    this.deps.onDestroy(this);
  }
}
