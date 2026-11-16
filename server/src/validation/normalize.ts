/**
 * Camada 1 — Normalização.
 *
 * Todas as chaves do índice e todas as respostas dos jogadores passam pelas
 * MESMAS funções, então qualquer transformação "agressiva" (ex.: singularizar)
 * é segura: as duas pontas colidem da mesma forma.
 */

const LEADING_ARTICLES = new Set(['o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'the', 'el', 'la', 'los', 'las']);

/** Minúsculas, sem acento, sem pontuação, espaços colapsados, sem artigo inicial. */
export function normalize(input: string): string {
  let s = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // diacríticos
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/\+\+/g, ' plusplus ') // C++ ≠ C
    .replace(/#/g, ' sharp ') // C# ≠ C
    .replace(/['’`´"“”]/g, '') // d'água → dagua
    .replace(/[^a-z0-9]+/g, ' ') // hífens, pontos, barras… viram espaço
    .trim()
    .replace(/\s+/g, ' ');

  const tokens = s.split(' ');
  if (tokens.length > 1 && LEADING_ARTICLES.has(tokens[0]!)) {
    s = tokens.slice(1).join(' ');
  }
  return s;
}

/** Remove espaços: "cavalo marinho" ≡ "cavalomarinho". */
export function compact(normalized: string): string {
  return normalized.replace(/ /g, '');
}

/**
 * Singularização heurística do português (com alguns plurais do inglês).
 * Aplicada token a token em texto já normalizado (sem acento).
 */
export function singularizeToken(t: string): string {
  if (t.length <= 3 || /\d/.test(t)) return t;
  if (t.endsWith('oes') || t.endsWith('aes')) return t.slice(0, -3) + 'ao'; // tubarões, pães
  if (t.length > 4 && t.endsWith('ais')) return t.slice(0, -3) + 'al'; // animais
  if (t.length > 4 && t.endsWith('eis')) return t.slice(0, -3) + 'el'; // papéis
  if (t.length > 4 && t.endsWith('ois')) return t.slice(0, -3) + 'ol'; // anzóis
  if (t.length > 4 && t.endsWith('uis')) return t.slice(0, -3) + 'ul'; // azuis
  if (t.endsWith('ns')) return t.slice(0, -2) + 'm'; // atuns
  if (/(r|z|s)es$/.test(t) && t.length > 4) return t.slice(0, -2); // flores, luzes, países
  if (t.endsWith('ies') && t.length > 4) return t.slice(0, -3) + 'y'; // ponies
  if (t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

export function singular(normalized: string): string {
  return normalized
    .split(' ')
    .map(singularizeToken)
    .join(' ');
}

/**
 * Chave fonética simplificada para PT-BR. Captura grafias como
 * "xita/chita", "filipe/phillipe", "kiwi/quiuí", "tsunami/tisunami" não, mas
 * cobre trocas comuns de s/ss/ç/z, c/k/qu, y/i, w/u, h mudo e letras dobradas.
 */
export function phonetic(normalized: string): string {
  let s = compact(normalized);
  s = s
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/sh|ch/g, 'x')
    .replace(/nh/g, 'N')
    .replace(/lh/g, 'L')
    .replace(/h/g, '')
    .replace(/ck/g, 'k')
    .replace(/qu(?=[ei])/g, 'k')
    .replace(/gu(?=[ei])/g, 'g')
    .replace(/g(?=[ei])/g, 'j')
    .replace(/c(?=[ei])/g, 's')
    .replace(/qu/g, 'k')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/y/g, 'i')
    .replace(/w/g, 'u')
    .replace(/(.)\1+/g, '$1');
  return s;
}

const INVISIBLE_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]', 'g');

/** Remove caracteres de controle e limita tamanho (sanitização de entrada livre). */
export function sanitizeFreeText(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(INVISIBLE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
