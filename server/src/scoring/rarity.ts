/**
 * Raridade baseada em dados (modelo bayesiano simples).
 *
 * Cada resposta tem um peso a priori derivado da raridade cadastrada pela curadoria.
 * A cada rodada jogada, a frequência real das respostas é registrada no banco.
 *
 *   evidência(i) = K · prior(i) + contagem_histórica(i)
 *   r(i)         = evidência(i) / max_j evidência(j)          (popularidade relativa)
 *
 * r ≥ 0.50 → Superfície · ≥ 0.20 → Águas rasas · ≥ 0.08 → Intermediária
 * ≥ 0.03 → Profunda · abaixo → Abismo
 *
 * Sem dados, r reproduz a curadoria. Com o tempo (K pseudo-observações),
 * a frequência real domina: se todo mundo começar a responder "narval",
 * ele sobe para águas rasas — e deixa de valer 500.
 */
import type { DepthTier } from '@abyss/shared';
import type { QuestionDef } from '../questions/parser.js';

export const PRIOR_WEIGHTS: Record<DepthTier, number> = { 1: 40, 2: 15, 3: 6, 4: 2.5, 5: 1 };
export const TIER_THRESHOLDS = [0.5, 0.2, 0.08, 0.03] as const;

export interface RarityOptions {
  /** Peso do prior em "respostas equivalentes". Maior = curadoria pesa mais. */
  priorStrength: number;
}

export class RarityModel {
  /** questionId → (answerId → contagem histórica) */
  private readonly counts = new Map<string, Map<string, number>>();
  private readonly priorCache = new Map<string, { shares: Map<string, number> }>();

  constructor(
    private readonly getQuestion: (id: string) => QuestionDef | undefined,
    private readonly opts: RarityOptions = { priorStrength: 40 },
  ) {}

  load(rows: Iterable<{ questionId: string; answerId: string; count: number }>) {
    for (const r of rows) this.bump(r.questionId, r.answerId, r.count);
  }

  bump(questionId: string, answerId: string, n = 1) {
    let m = this.counts.get(questionId);
    if (!m) this.counts.set(questionId, (m = new Map()));
    m.set(answerId, (m.get(answerId) ?? 0) + n);
  }

  count(questionId: string, answerId: string): number {
    return this.counts.get(questionId)?.get(answerId) ?? 0;
  }

  private priors(q: QuestionDef) {
    let p = this.priorCache.get(q.id);
    if (!p) {
      const total = q.answers.reduce((s, a) => s + PRIOR_WEIGHTS[a.tier], 0);
      const shares = new Map(q.answers.map((a) => [a.id, PRIOR_WEIGHTS[a.tier] / total]));
      p = { shares };
      this.priorCache.set(q.id, p);
    }
    return p;
  }

  private evidence(q: QuestionDef, answerId: string, priorShare: number): number {
    return this.opts.priorStrength * priorShare + this.count(q.id, answerId);
  }

  /** Popularidade relativa (0–1] da resposta dentro da pergunta. */
  relativePopularity(questionId: string, answerId: string, fallbackTier: DepthTier = 3): number {
    const q = this.getQuestion(questionId);
    if (!q) return 1;
    const { shares } = this.priors(q);
    let max = 0;
    for (const a of q.answers) max = Math.max(max, this.evidence(q, a.id, shares.get(a.id)!));
    // Respostas fora da base (aprovadas pela IA) usam o prior do tier de fallback.
    const totalW = q.answers.reduce((s, a) => s + PRIOR_WEIGHTS[a.tier], 0);
    const share = shares.get(answerId) ?? PRIOR_WEIGHTS[fallbackTier] / totalW;
    const mine = this.evidence(q, answerId, share);
    return max > 0 ? Math.min(1, mine / max) : 1;
  }

  tier(questionId: string, answerId: string, fallbackTier: DepthTier = 3): DepthTier {
    return tierFromPopularity(this.relativePopularity(questionId, answerId, fallbackTier));
  }
}

export function tierFromPopularity(r: number): DepthTier {
  if (r >= TIER_THRESHOLDS[0]) return 1;
  if (r >= TIER_THRESHOLDS[1]) return 2;
  if (r >= TIER_THRESHOLDS[2]) return 3;
  if (r >= TIER_THRESHOLDS[3]) return 4;
  return 5;
}
