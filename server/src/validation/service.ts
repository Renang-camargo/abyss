import type { QuestionDef } from '../questions/parser.js';
import { AnswerValidator, type ValidationResult } from './validator.js';
import { AI_MIN_CONFIDENCE, type SemanticJudge } from './semantic.js';

export interface ValidationServiceOptions {
  judge?: SemanticJudge | null;
  aiTimeoutMs?: number;
  /** Chamado com respostas não reconhecidas — alimenta a fila de curadoria. */
  onUnmatched?: (questionId: string, normalized: string, raw: string, aiVerdict: string | null) => void;
}

/** Orquestra base local (síncrona) + juiz semântico opcional (assíncrono, com timeout e cache). */
export class ValidationService {
  private readonly aiCache = new Map<string, ValidationResult>();

  constructor(
    readonly validator: AnswerValidator,
    private readonly getQuestion: (id: string) => QuestionDef | undefined,
    private readonly opts: ValidationServiceOptions = {},
  ) {}

  get aiEnabled(): boolean {
    return !!this.opts.judge;
  }

  async validate(questionId: string, raw: string): Promise<ValidationResult> {
    const local = this.validator.validate(questionId, raw);
    if (local.valid || local.reason !== 'not-found' || !this.opts.judge) {
      if (local.reason === 'not-found' || local.reason === 'other-category')
        this.opts.onUnmatched?.(questionId, local.normalized, raw, null);
      return local;
    }

    const cacheKey = `${questionId}::${local.normalized}`;
    const cached = this.aiCache.get(cacheKey);
    if (cached) return cached;

    const q = this.getQuestion(questionId);
    if (!q) return local;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.aiTimeoutMs ?? 2500);
    let result: ValidationResult = local;
    let verdictLabel: string | null = 'erro';
    try {
      const verdict = await this.opts.judge.judge({ prompt: q.prompt, category: q.category, answer: raw }, ctrl.signal);
      if (verdict) {
        verdictLabel = `${verdict.valid ? 'válida' : 'inválida'} (${verdict.confidence.toFixed(2)})`;
        if (verdict.valid && verdict.confidence >= AI_MIN_CONFIDENCE) {
          result = {
            ...local,
            valid: true,
            reason: 'ok',
            via: 'ai',
            answerId: `ai:${local.normalized}`,
            canonical: verdict.canonical || raw,
            curatedTier: 3, // teto: nunca mais que "Incomum" sem curadoria humana
          };
        }
      }
    } catch {
      verdictLabel = 'timeout';
    } finally {
      clearTimeout(timer);
    }
    this.aiCache.set(cacheKey, result);
    this.opts.onUnmatched?.(questionId, local.normalized, raw, verdictLabel);
    return result;
  }
}
