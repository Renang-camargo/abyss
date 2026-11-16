import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseAbyss, type QuestionDef } from './parser.js';
import { normalize } from '../validation/normalize.js';

export const MIN_ANSWERS_PER_QUESTION = 20;

export interface BankIssue {
  level: 'error' | 'warning';
  question: string;
  message: string;
}

export class QuestionBank {
  readonly questions: QuestionDef[];
  private readonly byId = new Map<string, QuestionDef>();

  constructor(questions: QuestionDef[]) {
    this.questions = questions;
    for (const q of questions) this.byId.set(q.id, q);
  }

  static fromDirectory(dir: string): QuestionBank {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.abyss'))
      .sort();
    const all: QuestionDef[] = [];
    for (const f of files) all.push(...parseAbyss(readFileSync(join(dir, f), 'utf8'), basename(f)));
    return new QuestionBank(all);
  }

  get(id: string): QuestionDef | undefined {
    return this.byId.get(id);
  }

  categories(): { name: string; questions: number }[] {
    const m = new Map<string, number>();
    for (const q of this.questions) m.set(q.category, (m.get(q.category) ?? 0) + 1);
    return [...m.entries()].map(([name, questions]) => ({ name, questions })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Verifica consistência do banco; erros impedem o servidor de subir. */
  check(): BankIssue[] {
    const issues: BankIssue[] = [];
    const seenIds = new Set<string>();
    for (const q of this.questions) {
      const where = `${q.id} (${q.file}:${q.line})`;
      if (seenIds.has(q.id)) issues.push({ level: 'error', question: where, message: 'ID duplicado' });
      seenIds.add(q.id);
      if (!q.prompt) issues.push({ level: 'error', question: where, message: 'sem enunciado' });
      if (!q.category) issues.push({ level: 'error', question: where, message: 'sem categoria' });
      if (q.answers.length < MIN_ANSWERS_PER_QUESTION)
        issues.push({ level: 'error', question: where, message: `apenas ${q.answers.length} respostas (mínimo ${MIN_ANSWERS_PER_QUESTION})` });
      if (!q.answers.some((a) => a.tier === 1))
        issues.push({ level: 'error', question: where, message: 'nenhuma resposta de raridade 1 (referência da escala)' });
      if (!q.answers.some((a) => a.tier >= 4))
        issues.push({ level: 'warning', question: where, message: 'nenhuma resposta rara (4–5)' });
      if (!q.source) issues.push({ level: 'warning', question: where, message: 'sem fonte' });

      if (q.merged.length)
        issues.push({ level: 'warning', question: where, message: `itens repetidos mesclados: ${q.merged.join(', ')}` });
      if (/[?()]/.test(q.answers.map((a) => [a.name, ...a.aliases].join('')).join('')))
        issues.push({ level: 'error', question: where, message: 'há "?" ou parênteses em respostas (marcas de incerteza não revisadas)' });
      const answerIds = new Set<string>();
      const keyOwner = new Map<string, string>();
      for (const a of q.answers) {
        if (answerIds.has(a.id)) issues.push({ level: 'error', question: where, message: `resposta duplicada "${a.name}"` });
        answerIds.add(a.id);
        for (const n of [a.name, ...a.aliases]) {
          const k = normalize(n);
          if (!k) {
            issues.push({ level: 'error', question: where, message: `alias vazio após normalização em "${a.name}"` });
            continue;
          }
          const owner = keyOwner.get(k);
          if (owner && owner !== a.id)
            issues.push({ level: 'warning', question: where, message: `"${n}" aponta para "${owner}" e "${a.id}"` });
          keyOwner.set(k, a.id);
        }
      }
      for (const r of q.rejected) {
        const owner = keyOwner.get(normalize(r.name));
        if (owner) issues.push({ level: 'error', question: where, message: `"${r.name}" está rejeitada e aceita ao mesmo tempo` });
      }
    }
    return issues;
  }
}
