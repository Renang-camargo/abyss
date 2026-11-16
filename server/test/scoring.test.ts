import { describe, expect, it } from 'vitest';
import { parseAbyss } from '../src/questions/parser.js';
import { RarityModel, tierFromPopularity } from '../src/scoring/rarity.js';
import { duplicateFactor, scoreRound } from '../src/scoring/scoring.js';

const q = parseAbyss(
  [
    '@ teste',
    'categoria: Teste',
    'enunciado: Animal',
    '1: gato; cachorro',
    '2: coelho; hamster; papagaio',
    '3: capivara; tatu; anta; lhama',
    '4: ocapi; pangolim; tarsier',
    '5: solenodonte; saola; aiai; quokka',
  ].join('\n'),
)[0]!;
const get = (id: string) => (id === q.id ? q : undefined);

describe('raridade baseada em dados', () => {
  it('sem histórico, reproduz a classificação cadastrada', () => {
    const r = new RarityModel(get);
    for (const a of q.answers) expect(r.tier(q.id, a.id), a.name).toBe(a.tier);
  });

  it('com histórico, uma resposta "rara" que vira moda sobe para a superfície', () => {
    const r = new RarityModel(get, { priorStrength: 40 });
    expect(r.tier(q.id, 'saola')).toBe(5);
    r.bump(q.id, 'saola', 60);
    expect(r.tier(q.id, 'saola')).toBe(1);
  });

  it('uma resposta comum que ninguém mais dá desce de nível ao longo do tempo', () => {
    const r = new RarityModel(get, { priorStrength: 40 });
    r.bump(q.id, 'cachorro', 400);
    expect(r.tier(q.id, 'gato')).toBeGreaterThan(1);
  });

  it('carrega estatísticas persistidas', () => {
    const r = new RarityModel(get);
    r.load([{ questionId: q.id, answerId: 'quokka', count: 100 }]);
    expect(r.count(q.id, 'quokka')).toBe(100);
    expect(r.tier(q.id, 'quokka')).toBe(1);
  });

  it('limiares da escala', () => {
    expect(tierFromPopularity(1)).toBe(1);
    expect(tierFromPopularity(0.3)).toBe(2);
    expect(tierFromPopularity(0.1)).toBe(3);
    expect(tierFromPopularity(0.05)).toBe(4);
    expect(tierFromPopularity(0.001)).toBe(5);
  });
});

describe('pontuação da rodada', () => {
  it('resposta comum vale pouco, rara vale muito, inválida vale zero', () => {
    const s = scoreRound(
      [
        { playerId: 'a', valid: true, answerKey: 'gato', tier: 1 },
        { playerId: 'b', valid: true, answerKey: 'saola', tier: 5 },
        { playerId: 'c', valid: false, answerKey: null, tier: null },
        { playerId: 'd', valid: true, answerKey: 'capivara', tier: 3 },
      ],
      'decay',
    );
    expect(s.map((x) => x.points)).toEqual([50, 500, 0, 200]);
  });

  it('duplicadas — regra "decay" reduz conforme mais jogadores repetem', () => {
    const two = scoreRound(
      [
        { playerId: 'a', valid: true, answerKey: 'tatu', tier: 3 },
        { playerId: 'b', valid: true, answerKey: 'tatu', tier: 3 },
      ],
      'decay',
    );
    expect(two.every((x) => x.points === Math.round(200 / 1.35))).toBe(true);
    expect(two[0]!.duplicates).toBe(2);
    expect(duplicateFactor('decay', 1)).toBe(1);
    expect(duplicateFactor('decay', 35)).toBe(0.3); // piso
  });

  it('duplicadas — "none" mantém e "exclusive" zera', () => {
    const inputs = [
      { playerId: 'a', valid: true, answerKey: 'tatu', tier: 3 as const },
      { playerId: 'b', valid: true, answerKey: 'tatu', tier: 3 as const },
      { playerId: 'c', valid: true, answerKey: 'anta', tier: 3 as const },
    ];
    expect(scoreRound(inputs, 'none').map((x) => x.points)).toEqual([200, 200, 200]);
    expect(scoreRound(inputs, 'exclusive').map((x) => x.points)).toEqual([0, 0, 200]);
  });

  it('respostas inválidas não contam como duplicadas', () => {
    const s = scoreRound(
      [
        { playerId: 'a', valid: true, answerKey: 'tatu', tier: 3 },
        { playerId: 'b', valid: false, answerKey: 'tatu', tier: 3 },
      ],
      'exclusive',
    );
    expect(s[0]!.points).toBe(200);
    expect(s[1]!.points).toBe(0);
  });
});
