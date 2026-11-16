/**
 * Motor de validação híbrido (camadas 1–4; a camada 5, IA, fica em semantic.ts).
 *
 *  1. Normalização          — acento, caixa, pontuação, hífen, artigo inicial
 *  2. Base de conhecimento  — nome canônico + sinônimos/aliases/nomes científicos
 *     2a. forma singular    — "tubarões" → "tubarão"
 *     2b. forma compacta    — "cavalomarinho" → "cavalo-marinho"
 *  3. Chave fonética        — "xita" ≈ "chita", "brazil" ≈ "brasil" (precisa ser única)
 *  4. Guarda semântica      — se o texto é uma entidade CONHECIDA de outra categoria
 *                             ("carro" em "Animal marinho"), é inválido; nada de fuzzy.
 *  5. Fuzzy controlado      — Damerau-Levenshtein com limite por tamanho, exigindo
 *                             que não exista entidade de outra categoria tão próxima
 *                             quanto, e que o melhor candidato seja único.
 *
 * Princípio: na dúvida, rejeita. Falso positivo é pior que falso negativo.
 */
import type { MatchVia, ValidationReason, DepthTier } from '@abyss/shared';
import type { QuestionBank } from '../questions/bank.js';
import type { AnswerDef, QuestionDef } from '../questions/parser.js';
import { allowedEdits, damerau } from './fuzzy.js';
import { compact, normalize, phonetic, singular } from './normalize.js';

export interface ValidationResult {
  valid: boolean;
  reason: ValidationReason;
  via: MatchVia | null;
  answerId: string | null;
  canonical: string | null;
  /** Raridade cadastrada (prior). A raridade final vem do RarityModel. */
  curatedTier: DepthTier | null;
  normalized: string;
  /** Para respostas rejeitadas explicitamente, a explicação cadastrada. */
  note?: string | null;
}

interface QIndex {
  q: QuestionDef;
  answers: Map<string, AnswerDef>;
  /** chave (normalizada | singular | compacta) → ids de resposta */
  keys: Map<string, Set<string>>;
  phon: Map<string, Set<string>>;
  canonicalKey: Map<string, string>; // answerId → normalize(name)
  rejected: Map<string, string | null>;
  /** chaves normalizadas por tamanho (para fuzzy) */
  fuzzyKeys: { key: string; answerId: string }[];
}

function add(map: Map<string, Set<string>>, k: string, v: string) {
  if (!k) return;
  let s = map.get(k);
  if (!s) map.set(k, (s = new Set()));
  s.add(v);
}

export function variantsOf(text: string): { norm: string; sing: string; comp: string; compSing: string } {
  const norm = normalize(text);
  const sing = singular(norm);
  return { norm, sing, comp: compact(norm), compSing: compact(sing) };
}

export class AnswerValidator {
  private readonly idx = new Map<string, QIndex>();
  /** Léxico global: chave → ids das perguntas onde ela é válida. */
  private readonly lexicon = new Map<string, Set<string>>();
  private readonly lexiconPhon = new Map<string, Set<string>>();
  /** Léxico global agrupado por tamanho, para fuzzy da guarda semântica. */
  private readonly lexiconByLen = new Map<number, string[]>();

  constructor(bank: QuestionBank, extraLexicon: string[] = []) {
    for (const q of bank.questions) {
      const qi: QIndex = {
        q,
        answers: new Map(),
        keys: new Map(),
        phon: new Map(),
        canonicalKey: new Map(),
        rejected: new Map(),
        fuzzyKeys: [],
      };
      for (const a of q.answers) {
        qi.answers.set(a.id, a);
        qi.canonicalKey.set(a.id, normalize(a.name));
        for (const n of [a.name, ...a.aliases]) {
          const v = variantsOf(n);
          for (const k of [v.norm, v.sing, v.comp, v.compSing]) {
            add(qi.keys, k, a.id);
            add(this.lexicon, k, q.id);
          }
          const ph = phonetic(v.sing);
          add(qi.phon, ph, a.id);
          add(this.lexiconPhon, ph, q.id);
          qi.fuzzyKeys.push({ key: v.norm, answerId: a.id });
          if (v.sing !== v.norm) qi.fuzzyKeys.push({ key: v.sing, answerId: a.id });
        }
      }
      for (const r of q.rejected) {
        const v = variantsOf(r.name);
        for (const k of [v.norm, v.sing, v.comp, v.compSing]) qi.rejected.set(k, r.note);
      }
      this.idx.set(q.id, qi);
    }
    // Palavras comuns que não são resposta de nada, mas sabemos o que são.
    for (const w of extraLexicon) {
      const v = variantsOf(w);
      for (const k of [v.norm, v.sing, v.comp]) add(this.lexicon, k, '__lexico__');
    }
    for (const k of this.lexicon.keys()) {
      const arr = this.lexiconByLen.get(k.length) ?? [];
      arr.push(k);
      this.lexiconByLen.set(k.length, arr);
    }
  }

  hasQuestion(id: string): boolean {
    return this.idx.has(id);
  }

  getAnswer(questionId: string, answerId: string): AnswerDef | undefined {
    return this.idx.get(questionId)?.answers.get(answerId);
  }

  validate(questionId: string, raw: string): ValidationResult {
    const qi = this.idx.get(questionId);
    if (!qi) throw new Error(`pergunta desconhecida: ${questionId}`);
    const v = variantsOf(raw);
    const base: ValidationResult = {
      valid: false,
      reason: 'not-found',
      via: null,
      answerId: null,
      canonical: null,
      curatedTier: null,
      normalized: v.norm,
    };
    if (!v.norm || !v.comp) return { ...base, reason: 'empty' };

    // Rejeições explícitas cadastradas (ex.: "tubarão" em "Mamífero marinho").
    for (const k of [v.norm, v.sing, v.comp, v.compSing]) {
      if (qi.rejected.has(k)) return { ...base, reason: 'rejected', note: qi.rejected.get(k) ?? null };
    }

    // 2. Base de conhecimento.
    const tryKeys: [string, MatchVia][] = [
      [v.norm, 'alias'],
      [v.comp, 'alias'],
      [v.sing, 'plural'],
      [v.compSing, 'plural'],
    ];
    for (const [k, via] of tryKeys) {
      const hit = qi.keys.get(k);
      if (hit?.size) {
        const id = this.pick(qi, hit);
        const isExact = qi.canonicalKey.get(id) === v.norm;
        return this.ok(qi, id, isExact ? 'exact' : via, v.norm);
      }
    }

    // 3. Fonética: mesma "pronúncia" de uma resposta desta pergunta ("brazil" → Brasil,
    //    "xita" → chita). Só aceita se a chave fonética apontar para UMA resposta.
    const ph = phonetic(v.sing);
    if (ph.length >= 4) {
      const hit = qi.phon.get(ph);
      if (hit?.size === 1) return this.ok(qi, [...hit][0]!, 'phonetic', v.norm);
    }

    // 4. Guarda semântica: é uma entidade conhecida, mas de outra categoria
    //    ("carro" em "Animal marinho"). Nada de fuzzy a partir daqui.
    for (const k of [v.norm, v.sing, v.comp, v.compSing]) {
      if (this.lexicon.has(k)) return { ...base, reason: 'other-category' };
    }
    if (ph.length >= 4 && this.lexiconPhon.has(ph)) return { ...base, reason: 'other-category' };

    // 5. Fuzzy controlado.
    const budget = allowedEdits(v.norm.length);
    if (budget === 0) return base;
    let best = budget + 1;
    let bestIds = new Set<string>();
    for (const { key, answerId } of qi.fuzzyKeys) {
      if (Math.abs(key.length - v.norm.length) > best) continue;
      for (const probe of [v.norm, v.sing]) {
        const d = damerau(probe, key, best);
        if (d < best) {
          best = d;
          bestIds = new Set([answerId]);
        } else if (d === best && d <= budget) {
          bestIds.add(answerId);
        }
      }
    }
    if (best > budget || bestIds.size === 0) return base;
    if (bestIds.size > 1) return { ...base, reason: 'ambiguous' };

    // Guarda semântica no fuzzy: existe algo de OUTRA categoria igualmente perto?
    if (this.closerElsewhere(v.norm, best, qi)) return { ...base, reason: 'other-category' };

    return this.ok(qi, [...bestIds][0]!, 'fuzzy', v.norm);
  }

  /** Verdadeiro se alguma chave do léxico que NÃO pertence a esta pergunta está a ≤ dist. */
  private closerElsewhere(text: string, dist: number, qi: QIndex): boolean {
    for (let len = text.length - dist; len <= text.length + dist; len++) {
      const bucket = this.lexiconByLen.get(len);
      if (!bucket) continue;
      for (const k of bucket) {
        if (qi.keys.has(k)) continue;
        if (damerau(text, k, dist) <= dist) return true;
      }
    }
    return false;
  }

  /** Se um alias aponta para várias respostas, escolhe a mais comum (conservador). */
  private pick(qi: QIndex, ids: Set<string>): string {
    let chosen = '';
    let tier = 9;
    for (const id of ids) {
      const t = qi.answers.get(id)!.tier;
      if (t < tier) {
        tier = t;
        chosen = id;
      }
    }
    return chosen;
  }

  private ok(qi: QIndex, id: string, via: MatchVia, norm: string): ValidationResult {
    const a = qi.answers.get(id)!;
    return {
      valid: true,
      reason: 'ok',
      via,
      answerId: id,
      canonical: a.name,
      curatedTier: a.tier,
      normalized: norm,
    };
  }
}
