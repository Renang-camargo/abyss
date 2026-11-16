/**
 * Parser do formato `.abyss` — banco de perguntas legível e editável por humanos.
 *
 *   # comentário
 *   categoria: Oceanos e vida marinha      ← padrão do arquivo (opcional)
 *   fonte: WoRMS                            ← padrão do arquivo (opcional)
 *
 *   @ mar-animal-marinho                    ← início de pergunta (ID único)
 *   enunciado: Animal marinho
 *   revisao: revisado | pendente
 *   rejeitar: carro; boto (é de rio)        ← respostas explicitamente inválidas
 *   1: tubarão|shark; baleia; polvo          ← raridade 1 (muito comum) … 5 (muito rara)
 *   5: peixe-ogro|anoplogaster cornuta
 *
 * Cada item separado por `;`. O primeiro nome é o canônico (exibido);
 * os demais, separados por `|`, são sinônimos/aliases/nomes científicos.
 * Linhas de raridade podem se repetir — os itens são acumulados.
 */
import type { DepthTier } from '@abyss/shared';

export interface AnswerDef {
  id: string;
  name: string;
  aliases: string[];
  tier: DepthTier;
}

export interface QuestionDef {
  id: string;
  category: string;
  prompt: string;
  source: string;
  review: 'revisado' | 'pendente';
  answers: AnswerDef[];
  rejected: { name: string; note: string | null }[];
  /** Itens repetidos que foram mesclados (aliases unidos, raridade mais comum mantida). */
  merged: string[];
  file: string;
  line: number;
}

export class QuestionParseError extends Error {
  constructor(file: string, line: number, msg: string) {
    super(`${file}:${line} — ${msg}`);
  }
}

export function slug(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\+\+/g, 'pp')
    .replace(/\+/g, 'plus')
    .replace(/#/g, 'sharp')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function parseAbyss(text: string, file = '<memória>'): QuestionDef[] {
  const out: QuestionDef[] = [];
  let fileCategory = '';
  let fileSource = '';
  let cur: QuestionDef | null = null;

  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) return;

    if (line.startsWith('@')) {
      const id = line.slice(1).trim();
      if (!/^[a-z0-9-]+$/.test(id)) throw new QuestionParseError(file, lineNo, `ID inválido "${id}"`);
      cur = {
        id,
        category: fileCategory,
        prompt: '',
        source: fileSource,
        review: 'pendente',
        answers: [],
        rejected: [],
        merged: [],
        file,
        line: lineNo,
      };
      out.push(cur);
      return;
    }

    const m = /^([a-z0-9]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) throw new QuestionParseError(file, lineNo, `linha não reconhecida: "${line}"`);
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();

    if (!cur) {
      if (key === 'categoria') fileCategory = value;
      else if (key === 'fonte') fileSource = value;
      else throw new QuestionParseError(file, lineNo, `"${key}" antes da primeira pergunta`);
      return;
    }
    const q: QuestionDef = cur;

    switch (key) {
      case 'categoria':
        q.category = value;
        break;
      case 'enunciado':
        q.prompt = value;
        break;
      case 'fonte':
        q.source = value;
        break;
      case 'revisao':
        if (value !== 'revisado' && value !== 'pendente')
          throw new QuestionParseError(file, lineNo, 'revisao deve ser "revisado" ou "pendente"');
        q.review = value;
        break;
      case 'rejeitar':
        for (const item of splitItems(value)) {
          const nm = /^(.*?)\s*\((.*)\)\s*$/.exec(item);
          q.rejected.push(nm ? { name: nm[1]!.trim(), note: nm[2]!.trim() } : { name: item, note: null });
        }
        break;
      case '1':
      case '2':
      case '3':
      case '4':
      case '5': {
        const tier = Number(key) as DepthTier;
        for (const item of splitItems(value)) {
          const names = item
            .split('|')
            .map((n) => n.trim())
            .filter(Boolean);
          if (!names.length) continue;
          const name = names[0]!;
          const id = slug(name);
          const existing = q.answers.find((a) => a.id === id);
          if (existing) {
            // Mesmo item listado duas vezes: une os aliases e mantém a raridade mais comum.
            for (const n of names) if (n !== existing.name && !existing.aliases.includes(n)) existing.aliases.push(n);
            existing.tier = Math.min(existing.tier, tier) as DepthTier;
            q.merged.push(name);
          } else {
            q.answers.push({ id, name, aliases: names.slice(1), tier });
          }
        }
        break;
      }
      default:
        throw new QuestionParseError(file, lineNo, `campo desconhecido "${key}"`);
    }
  });

  return out;
}

/** Divide por ";" ignorando ";" dentro de parênteses (notas de rejeição). */
function splitItems(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}
