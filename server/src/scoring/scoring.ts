import { zoneForTier, type DepthTier, type DuplicateRule } from '@abyss/shared';

export interface ScoredInput {
  playerId: string;
  valid: boolean;
  answerKey: string | null; // id canônico da resposta (duplicatas = mesmo id)
  tier: DepthTier | null;
}

export interface ScoredOutput {
  playerId: string;
  basePoints: number;
  points: number;
  duplicates: number; // quantos jogadores deram a mesma resposta (incluindo ele)
}

export const DECAY_STEP = 0.35;
export const DECAY_FLOOR = 0.3;

/** Multiplicador aplicado quando `n` jogadores deram a mesma resposta. */
export function duplicateFactor(rule: DuplicateRule, n: number): number {
  if (n <= 1 || rule === 'none') return 1;
  if (rule === 'exclusive') return 0;
  return Math.max(DECAY_FLOOR, 1 / (1 + DECAY_STEP * (n - 1)));
}

export function basePointsFor(tier: DepthTier | null): number {
  return tier ? zoneForTier(tier).points : 0;
}

/** Calcula os pontos da rodada. Função pura — fácil de testar e auditar. */
export function scoreRound(inputs: ScoredInput[], rule: DuplicateRule): ScoredOutput[] {
  const freq = new Map<string, number>();
  for (const i of inputs) if (i.valid && i.answerKey) freq.set(i.answerKey, (freq.get(i.answerKey) ?? 0) + 1);

  return inputs.map((i) => {
    if (!i.valid || !i.answerKey || !i.tier) return { playerId: i.playerId, basePoints: 0, points: 0, duplicates: 0 };
    const n = freq.get(i.answerKey) ?? 1;
    const base = basePointsFor(i.tier);
    return {
      playerId: i.playerId,
      basePoints: base,
      points: Math.round(base * duplicateFactor(rule, n)),
      duplicates: n,
    };
  });
}
