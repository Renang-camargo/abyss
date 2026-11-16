import { describe, expect, it, beforeAll } from 'vitest';
import { join } from 'node:path';
import { QuestionBank } from '../src/questions/bank.js';
import { parseAbyss } from '../src/questions/parser.js';
import { AnswerValidator } from '../src/validation/validator.js';
import { ValidationService } from '../src/validation/service.js';
import { parseVerdict, type SemanticJudge } from '../src/validation/semantic.js';
import { normalize, phonetic, singular, sanitizeFreeText } from '../src/validation/normalize.js';
import { damerau, allowedEdits } from '../src/validation/fuzzy.js';

let bank: QuestionBank;
let v: AnswerValidator;

beforeAll(() => {
  bank = QuestionBank.fromDirectory(join(__dirname, '..', 'data', 'questions'));
  v = new AnswerValidator(bank);
});

const ok = (q: string, a: string) => v.validate(q, a);

describe('normalização', () => {
  it('remove acentos, caixa, hífens, pontuação e artigo inicial', () => {
    expect(normalize('  Água-Viva!! ')).toBe('agua viva');
    expect(normalize('O Tubarão')).toBe('tubarao');
    expect(normalize("Pão d'Água")).toBe('pao dagua');
    expect(normalize('C++')).toBe('c plusplus');
    expect(normalize('C#')).toBe('c sharp');
    expect(normalize('a')).toBe('a'); // artigo sozinho não é removido
  });
  it('singulariza plurais do português', () => {
    expect(singular('tubaroes')).toBe('tubarao');
    expect(singular('animais')).toBe('animal');
    expect(singular('flores')).toBe('flor');
    expect(singular('baleias')).toBe('baleia');
    expect(singular('atuns')).toBe('atum');
  });
  it('gera chave fonética estável para grafias equivalentes', () => {
    expect(phonetic('xita')).toBe(phonetic('chita'));
    expect(phonetic('brazil')).toBe(phonetic('brasil'));
    expect(phonetic('felipe')).toBe(phonetic('phelippe'));
  });
  it('sanitiza texto livre (controle, zero-width, tamanho)', () => {
    expect(sanitizeFreeText('ab\u0000c​d   e', 60)).toBe('abcd e');
    expect(sanitizeFreeText('x'.repeat(200), 60)).toHaveLength(60);
    expect(sanitizeFreeText(42 as unknown, 60)).toBe('');
  });
  it('Damerau-Levenshtein conta transposição como 1 e respeita o limite', () => {
    expect(damerau('baleia', 'baelia')).toBe(1);
    expect(damerau('polvo', 'povlo')).toBe(1);
    expect(damerau('abc', 'xyz', 1)).toBeGreaterThan(1);
    expect(allowedEdits(4)).toBe(0);
    expect(allowedEdits(6)).toBe(1);
    expect(allowedEdits(10)).toBe(2);
  });
});

describe('validação — respostas corretas do enunciado (Animal marinho)', () => {
  const exemplos = ['Tubarão', 'Baleia', 'Polvo', 'Lula', 'Água-viva', 'Peixe-espada', 'Cavalo-marinho', 'Peixe-lua', 'Narval', 'Peixe-dragão', 'Peixe-ogro'];
  for (const e of exemplos) it(`aceita "${e}"`, () => expect(ok('mar-animal-marinho', e).valid).toBe(true));
  it('rejeita "Carro" (fora da categoria)', () => {
    const r = ok('mar-animal-marinho', 'Carro');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('other-category');
  });
});

describe('validação — variações', () => {
  it('sinônimos e nomes alternativos', () => {
    expect(ok('mar-animal-marinho', 'baleia-assassina').canonical).toBe('orca');
    expect(ok('mar-animal-marinho', 'medusa').canonical).toBe('água-viva');
    expect(ok('fru-fruta', 'bergamota').canonical).toBe('tangerina');
    expect(ok('fru-fruta', 'mexerica').canonical).toBe('tangerina');
    expect(ok('fru-legume-verdura', 'aipim').canonical).toBe('mandioca');
    expect(ok('fru-legume-verdura', 'macaxeira').canonical).toBe('mandioca');
  });
  it('nomes científicos', () => {
    expect(ok('mar-animal-marinho', 'Mola mola').canonical).toBe('peixe-lua');
    expect(ok('mar-animal-marinho', 'Anoplogaster cornuta').canonical).toBe('peixe-ogro');
  });
  it('acentuação diferente ou ausente', () => {
    expect(ok('mar-animal-marinho', 'tubarao').valid).toBe(true);
    expect(ok('cie-elemento', 'OXIGENIO').valid).toBe(true);
    expect(ok('geo-pais', 'alemanhã').valid).toBe(true);
    expect(ok('fru-fruta', 'maca').canonical).toBe('maçã');
  });
  it('singular e plural', () => {
    expect(ok('mar-animal-marinho', 'tubarões').canonical).toBe('tubarão');
    expect(ok('nat-mamifero', 'gatos').canonical).toBe('gato');
    expect(ok('nat-flor', 'rosas').canonical).toBe('rosa');
  });
  it('abreviações e siglas', () => {
    expect(ok('fut-jogador', 'CR7').canonical).toBe('cristiano ronaldo');
    expect(ok('geo-pais', 'EUA').canonical).toBe('estados unidos');
    expect(ok('cie-elemento', 'Fe').canonical).toBe('ferro');
    expect(ok('pes-presidente-brasil', 'FHC').canonical).toBe('fernando henrique cardoso');
  });
  it('espaços, hífens e grafia junta', () => {
    expect(ok('mar-animal-marinho', 'cavalomarinho').canonical).toBe('cavalo-marinho');
    expect(ok('mar-animal-marinho', 'estrela do mar').canonical).toBe('estrela-do-mar');
  });
  it('erros de digitação simples (fuzzy e fonético)', () => {
    expect(ok('tec-linguagem', 'javscript').canonical).toBe('javascript');
    expect(ok('tec-linguagem', 'pyhton').canonical).toBe('python');
    expect(ok('jog-pokemon', 'charizar').canonical).toBe('charizard');
    expect(ok('fru-fruta', 'abacachi').canonical).toBe('abacaxi');
    expect(ok('geo-pais', 'brazil').canonical).toBe('brasil');
    expect(ok('mar-animal-marinho', 'baleya').canonical).toBe('baleia');
  });
  it('linguagens com símbolos não colidem (C, C++, C#)', () => {
    expect(ok('tec-linguagem', 'C').canonical).toBe('c');
    expect(ok('tec-linguagem', 'C++').canonical).toBe('c++');
    expect(ok('tec-linguagem', 'c#').canonical).toBe('c#');
  });
  it('respostas raras são reconhecidas com raridade alta cadastrada', () => {
    expect(ok('mar-animal-marinho', 'peixe-ogro').curatedTier).toBe(5);
    expect(ok('cie-elemento', 'oganessônio').curatedTier).toBeGreaterThanOrEqual(4);
    expect(ok('mar-profundezas', 'peixe-caracol').valid).toBe(true);
  });
});

describe('validação — precisão (sem falsos positivos)', () => {
  it('palavras curtas não viram outra por fuzzy ("rato" ≠ "pato")', () => {
    expect(ok('nat-ave', 'rato').valid).toBe(false);
    expect(ok('nat-ave', 'gato').valid).toBe(false);
  });
  it('fora da categoria', () => {
    for (const [q, a] of [
      ['mar-animal-marinho', 'cachorro'],
      ['mar-animal-marinho', 'cavalo'],
      ['fru-fruta', 'computador'],
      ['geo-pais', 'pikachu'],
      ['cie-elemento', 'messi'],
      ['tec-linguagem', 'banana'],
    ] as const)
      expect(ok(q, a).valid, `${q} / ${a}`).toBe(false);
  });
  it('rejeições explícitas com explicação', () => {
    const r = ok('mar-mamifero-marinho', 'tubarão');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('rejected');
    expect(r.note).toContain('peixe');
    expect(ok('tec-linguagem', 'html').reason).toBe('rejected');
    expect(ok('geo-capital', 'Rio de Janeiro').note).toContain('brasília');
    expect(ok('pes-presidente-brasil', 'dom pedro ii').reason).toBe('rejected');
  });
  it('lixo, vazio e respostas absurdas', () => {
    expect(ok('mar-animal-marinho', 'asdfgh').valid).toBe(false);
    expect(ok('mar-animal-marinho', '   ').reason).toBe('empty');
    expect(ok('mar-animal-marinho', '!!!').reason).toBe('empty');
    expect(ok('mar-animal-marinho', 'tubarão voador gigante de fogo').valid).toBe(false);
  });
  it('ambiguidade: candidato fuzzy empatado entre duas respostas é recusado', () => {
    const b = new QuestionBank(
      parseAbyss(['@ t-amb', 'categoria: Teste', 'enunciado: Teste', ...Array.from({ length: 20 }, (_, i) => `1: item${i}`), '1: canela; janela'].join('\n')),
    );
    const vv = new AnswerValidator(b);
    expect(vv.validate('t-amb', 'canela').valid).toBe(true);
    expect(vv.validate('t-amb', 'xanela').reason).toBe('ambiguous'); // a 1 edição de "canela" e de "janela"
  });

  it('varredura: nomes de outras categorias quase nunca são aceitos (taxa de falso positivo < 2%)', () => {
    // Para cada pergunta, testa 30 respostas canônicas de OUTRAS perguntas que não constam nesta.
    let tested = 0;
    let accepted = 0;
    const examples: string[] = [];
    const qs = bank.questions;
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i]!;
      const own = new Set(q.answers.flatMap((a) => [a.name, ...a.aliases].map(normalize)));
      const other = qs[(i * 7 + 13) % qs.length]!;
      if (other.category === q.category) continue;
      for (const a of other.answers.slice(0, 30)) {
        if (own.has(normalize(a.name))) continue;
        tested++;
        const r = v.validate(q.id, a.name);
        if (r.valid) {
          accepted++;
          if (examples.length < 15) examples.push(`${q.id} ← "${a.name}" ⇒ ${r.canonical} (${r.via})`);
        }
      }
    }
    const rate = accepted / tested;
    console.log(`falsos positivos: ${accepted}/${tested} (${(rate * 100).toFixed(2)}%)`, examples);
    expect(tested).toBeGreaterThan(2000);
    expect(rate).toBeLessThan(0.02);
  });

  it('varredura: erros de digitação de 1 letra em respostas longas são aceitos (recall > 85%)', () => {
    let tested = 0;
    let recovered = 0;
    for (const q of bank.questions) {
      for (const a of q.answers.filter((x) => normalize(x.name).length >= 8).slice(0, 8)) {
        const n = a.name;
        const pos = Math.floor(n.length / 2);
        const typo = n.slice(0, pos) + n.slice(pos + 1); // apaga uma letra no meio
        tested++;
        if (v.validate(q.id, typo).answerId === a.id) recovered++;
      }
    }
    const rate = recovered / tested;
    console.log(`typos recuperados: ${recovered}/${tested} (${(rate * 100).toFixed(1)}%)`);
    expect(rate).toBeGreaterThan(0.85);
  });
});

describe('banco de perguntas', () => {
  it('tem 150+ perguntas, 20+ nichos, sem erros de curadoria', () => {
    expect(bank.questions.length).toBeGreaterThanOrEqual(150);
    expect(bank.categories().length).toBeGreaterThanOrEqual(24);
    expect(bank.check().filter((i) => i.level === 'error')).toEqual([]);
  });
  it('toda pergunta tem ID, categoria, enunciado, fonte, status e 20+ respostas com raridade', () => {
    for (const q of bank.questions) {
      expect(q.id).toMatch(/^[a-z0-9-]+$/);
      expect(q.category).toBeTruthy();
      expect(q.prompt).toBeTruthy();
      expect(q.source).toBeTruthy();
      expect(['revisado', 'pendente']).toContain(q.review);
      expect(q.answers.length).toBeGreaterThanOrEqual(20);
      expect(q.answers.every((a) => a.tier >= 1 && a.tier <= 5)).toBe(true);
    }
  });
  it('parser aponta arquivo e linha em erros', () => {
    expect(() => parseAbyss('@ x\nfoo bar', 'a.abyss')).toThrow(/a\.abyss:2/);
    expect(() => parseAbyss('@ x\nrevisao: talvez', 'a.abyss')).toThrow(/revisao/);
  });
});

describe('camada semântica (IA) — opcional', () => {
  const fakeJudge = (verdict: { valid: boolean; confidence: number } | 'throw' | 'slow'): SemanticJudge => ({
    name: 'fake',
    async judge(_i, signal) {
      if (verdict === 'throw') throw new Error('rede');
      if (verdict === 'slow')
        return new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('abort'))));
      return { ...verdict, canonical: 'resposta nova' };
    },
  });
  const unknown = 'criatura-desconhecida-xyz';

  it('sem IA, resposta fora da base é inválida', async () => {
    const s = new ValidationService(v, (id) => bank.get(id));
    expect((await s.validate('mar-animal-marinho', unknown)).valid).toBe(false);
  });
  it('IA confiante aprova com teto de raridade 3 e registra para curadoria', async () => {
    const logged: string[] = [];
    const s = new ValidationService(v, (id) => bank.get(id), {
      judge: fakeJudge({ valid: true, confidence: 0.97 }),
      onUnmatched: (_q, n) => logged.push(n),
    });
    const r = await s.validate('mar-animal-marinho', unknown);
    expect(r.valid).toBe(true);
    expect(r.via).toBe('ai');
    expect(r.curatedTier).toBe(3);
    expect(logged).toHaveLength(1);
  });
  it('IA pouco confiante, com erro ou lenta ⇒ inválida (jogo segue sem ela)', async () => {
    for (const j of [fakeJudge({ valid: true, confidence: 0.6 }), fakeJudge('throw'), fakeJudge('slow')]) {
      const s = new ValidationService(v, (id) => bank.get(id), { judge: j, aiTimeoutMs: 50 });
      expect((await s.validate('mar-animal-marinho', unknown)).valid).toBe(false);
    }
  });
  it('IA nunca é consultada para entidades conhecidas de outra categoria', async () => {
    let calls = 0;
    const s = new ValidationService(v, (id) => bank.get(id), {
      judge: { name: 'spy', judge: async () => (calls++, { valid: true, confidence: 1 }) },
    });
    expect((await s.validate('mar-animal-marinho', 'carro')).valid).toBe(false);
    expect(calls).toBe(0);
  });
  it('interpreta a resposta JSON do modelo com segurança', () => {
    expect(parseVerdict('blá {"valid": true, "confidence": 0.95} fim')).toEqual({ valid: true, confidence: 0.95, canonical: undefined });
    expect(parseVerdict('não sei')).toBeNull();
    expect(parseVerdict('{"valid": "sim"}')).toBeNull();
  });
});
