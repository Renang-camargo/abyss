// Ferramenta de curadoria: remove itens marcados como incertos ("?"),
// comentários entre parênteses em respostas e aliases de 1 caractere.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
const norm = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
let removed = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.abyss'))) {
  const lines = readFileSync(join(dir, f), 'utf8').split('\n').map((line) => {
    const m = /^(\s*)([1-5]|rejeitar)(\s*:\s*)(.*)$/.exec(line);
    if (!m) return line;
    const isAnswer = m[2] !== 'rejeitar';
    const items = m[4].split(';').map((s) => s.trim()).filter(Boolean).filter((it) => {
      if (it.includes('?')) { removed++; return false; }
      return true;
    }).map((it) => {
      if (!isAnswer) return it;
      const cleaned = it.replace(/\([^)]*\)/g, '').trim();
      const names = []; const seen = new Set();
      for (const n of cleaned.split('|').map((x) => x.trim()).filter(Boolean)) {
        const k = norm(n);
        if (k.length < 1 || seen.has(k)) continue;
        seen.add(k); names.push(n);
      }
      return names.join('|');
    }).filter(Boolean);
    return `${m[1]}${m[2]}${m[3]}${items.join('; ')}`;
  });
  writeFileSync(join(dir, f), lines.join('\n'));
}
console.log(`itens incertos removidos: ${removed}`);
