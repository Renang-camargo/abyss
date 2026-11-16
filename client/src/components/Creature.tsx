/**
 * 12 criaturas originais em estilo low-poly facetado (luz/sombra por triângulos).
 * Desenhadas em SVG puro: leves, nítidas em qualquer tamanho e sem assets externos.
 */
import { getCharacter, type CharacterDef } from '@abyss/shared';
import type { ReactNode } from 'react';

const INK = '#0A1F33';

function Eye({ x, y, r = 5.5, look = 1 }: { x: number; y: number; r?: number; look?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#F3FAFF" />
      <circle cx={x + look * r * 0.28} cy={y + r * 0.08} r={r * 0.58} fill={INK} />
      <circle cx={x + look * r * 0.05} cy={y - r * 0.32} r={r * 0.22} fill="#F3FAFF" />
    </g>
  );
}

type Draw = (c: CharacterDef) => ReactNode;

const shade = (hex: string, amt: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('')}`;
};

const DRAW: Record<string, Draw> = {
  tubarao: (c) => (
    <>
      <polygon points="6,38 28,60 6,84 16,60" fill={c.secondary} />
      <polygon points="24,58 52,38 92,42 112,60" fill={c.primary} />
      <polygon points="24,58 112,60 60,60" fill={shade(c.primary, 0.08)} />
      <polygon points="24,60 60,60 112,60 90,74 50,77" fill={c.accent} />
      <polygon points="50,77 90,74 70,79" fill={shade(c.accent, -0.12)} />
      <polygon points="52,40 62,14 74,42" fill={c.secondary} />
      <polygon points="62,14 74,42 66,41" fill={shade(c.secondary, -0.08)} />
      <polygon points="58,72 66,96 78,74" fill={c.secondary} />
      <path d="M76 52 L74 62 M80 52 L78 62 M84 52 L82 62" stroke={shade(c.secondary, -0.1)} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M96 66 Q104 68 110 62" stroke={INK} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <Eye x={95} y={53} r={4.6} />
    </>
  ),
  polvo: (c) => (
    <>
      {[
        'M36 64 Q22 84 30 100 Q34 106 40 100',
        'M48 66 Q42 92 52 106',
        'M72 66 Q78 92 68 106',
        'M84 64 Q98 84 90 100 Q86 106 80 100',
      ].map((d, i) => (
        <path key={i} d={d} stroke={i % 2 ? c.secondary : c.primary} strokeWidth="10" fill="none" strokeLinecap="round" />
      ))}
      <polygon points="60,12 32,30 26,60 60,68" fill={c.primary} />
      <polygon points="60,12 88,30 94,60 60,68" fill={c.secondary} />
      <polygon points="60,12 46,24 60,30 74,24" fill={shade(c.primary, 0.12)} />
      <polygon points="26,60 60,68 94,60 60,74" fill={shade(c.secondary, -0.08)} />
      <circle cx="40" cy="30" r="3" fill={c.accent} opacity=".7" />
      <circle cx="78" cy="26" r="2.4" fill={c.accent} opacity=".7" />
      <Eye x={47} y={48} r={6} />
      <Eye x={73} y={48} r={6} />
    </>
  ),
  baleia: (c) => (
    <>
      <polygon points="4,40 24,58 4,78 14,58" fill={c.secondary} />
      <polygon points="20,56 54,32 96,38 114,60 60,58" fill={c.primary} />
      <polygon points="20,56 60,58 114,60 98,78 50,82" fill={c.secondary} />
      <path d="M60 64 L100 64 M58 70 L96 70 M58 76 L88 76" stroke={c.accent} strokeWidth="2" strokeLinecap="round" opacity=".8" />
      <polygon points="58,70 70,94 82,72" fill={shade(c.secondary, -0.1)} />
      <path d="M78 30 Q74 18 70 14 M80 30 Q82 18 88 14" stroke={c.accent} strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <Eye x={96} y={58} r={4.2} />
    </>
  ),
  golfinho: (c) => (
    <>
      <polygon points="14,64 2,50 8,64 2,78" fill={c.secondary} />
      <polygon points="12,64 40,46 80,40 104,50 80,54" fill={c.primary} />
      <polygon points="12,64 80,54 104,50 118,56 104,60 80,66 44,74" fill={shade(c.primary, -0.06)} />
      <polygon points="44,74 80,66 104,60 92,68 60,76" fill={c.accent} />
      <polygon points="62,44 70,24 80,42" fill={c.secondary} />
      <polygon points="52,70 58,90 70,72" fill={c.secondary} />
      <path d="M104 60 Q110 62 116 58" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <Eye x={96} y={51} r={4} />
    </>
  ),
  tartaruga: (c) => (
    <>
      <polygon points="30,40 12,30 18,48" fill={c.accent} />
      <polygon points="90,40 108,30 102,48" fill={c.accent} />
      <polygon points="32,84 14,100 28,96" fill={c.accent} />
      <polygon points="88,84 106,100 92,96" fill={c.accent} />
      <ellipse cx="60" cy="22" rx="12" ry="11" fill={shade(c.accent, 0.05)} />
      <polygon points="60,30 92,44 96,70 80,94 40,94 24,70 28,44" fill={c.secondary} />
      <polygon points="60,40 78,50 74,70 46,70 42,50" fill={c.primary} />
      <polygon points="60,40 42,50 28,44" fill={shade(c.primary, 0.1)} />
      <polygon points="60,40 78,50 92,44" fill={shade(c.primary, -0.05)} />
      <polygon points="46,70 74,70 80,94 40,94" fill={shade(c.primary, -0.12)} />
      <polygon points="42,50 46,70 24,70 28,44" fill={shade(c.primary, -0.02)} />
      <polygon points="78,50 74,70 96,70 92,44" fill={shade(c.primary, 0.04)} />
      <Eye x={54} y={20} r={3.4} look={-1} />
      <Eye x={66} y={20} r={3.4} />
    </>
  ),
  'agua-viva': (c) => (
    <>
      <defs>
        <radialGradient id="jg" cx="50%" cy="40%">
          <stop offset="0%" stopColor={c.accent} stopOpacity="0.95" />
          <stop offset="100%" stopColor={c.primary} stopOpacity="0.55" />
        </radialGradient>
      </defs>
      {[38, 50, 62, 74, 84].map((x, i) => (
        <path
          key={x}
          d={`M${x} 60 q${i % 2 ? 6 : -6} 12 0 24 q${i % 2 ? -6 : 6} 12 0 24`}
          stroke={i % 2 ? c.primary : c.accent}
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          opacity=".85"
        />
      ))}
      <polygon points="60,14 92,34 98,60 22,60 28,34" fill="url(#jg)" />
      <polygon points="60,14 28,34 22,60 46,60" fill={c.accent} opacity=".25" />
      <polygon points="22,60 98,60 90,66 30,66" fill={c.secondary} opacity=".9" />
      <circle cx="44" cy="30" r="3" fill="#fff" opacity=".7" />
      <Eye x={50} y={44} r={4.5} />
      <Eye x={70} y={44} r={4.5} />
    </>
  ),
  'peixe-palhaco': (c) => (
    <>
      <polygon points="14,60 2,42 6,60 2,78" fill={c.primary} />
      <polygon points="16,60 44,32 84,34 112,58 84,84 44,86" fill={c.primary} />
      <polygon points="44,32 84,34 112,58 70,56" fill={shade(c.primary, 0.08)} />
      <polygon points="40,36 52,32 50,88 38,84" fill={c.accent} />
      <polygon points="74,34 86,36 88,82 74,86" fill={c.accent} />
      <polygon points="38,36 40,36 38,84 36,84" fill={INK} />
      <polygon points="52,32 54,32 52,88 50,88" fill={INK} />
      <polygon points="56,32 74,18 76,34" fill={c.secondary} />
      <polygon points="56,86 70,100 74,84" fill={c.secondary} />
      <path d="M102 66 Q106 66 110 62" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <Eye x={98} y={54} r={4.6} />
    </>
  ),
  raia: (c) => (
    <>
      <path d="M60 84 Q62 104 76 114" stroke={c.secondary} strokeWidth="3" fill="none" strokeLinecap="round" />
      <polygon points="60,22 112,60 60,86 8,60" fill={c.primary} />
      <polygon points="60,22 8,60 60,58" fill={shade(c.primary, 0.1)} />
      <polygon points="60,22 112,60 60,58" fill={c.secondary} />
      <polygon points="8,60 60,58 60,86" fill={shade(c.primary, -0.05)} />
      <polygon points="60,58 112,60 60,86" fill={shade(c.secondary, -0.06)} />
      <circle cx="40" cy="58" r="2" fill={c.accent} />
      <circle cx="80" cy="58" r="2" fill={c.accent} />
      <Eye x={52} y={42} r={4} />
      <Eye x={68} y={42} r={4} />
    </>
  ),
  lula: (c) => (
    <>
      {[44, 52, 60, 68, 76].map((x, i) => (
        <path key={x} d={`M${x} 76 Q${x + (i - 2) * 4} 96 ${x + (i - 2) * 6} 112`} stroke={i % 2 ? c.secondary : c.primary} strokeWidth="6" fill="none" strokeLinecap="round" />
      ))}
      <polygon points="60,6 82,30 78,78 42,78 38,30" fill={c.primary} />
      <polygon points="60,6 38,30 42,78 60,78" fill={shade(c.primary, 0.1)} />
      <polygon points="60,6 42,18 30,8" fill={c.secondary} />
      <polygon points="60,6 78,18 90,8" fill={c.secondary} />
      <circle cx="54" cy="34" r="2.2" fill={c.accent} />
      <circle cx="66" cy="28" r="1.8" fill={c.accent} />
      <Eye x={50} y={60} r={5.2} />
      <Eye x={70} y={60} r={5.2} />
    </>
  ),
  caranguejo: (c) => (
    <>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <path d={`M30 ${66 + i * 7} L12 ${76 + i * 9}`} stroke={c.secondary} strokeWidth="4" strokeLinecap="round" />
          <path d={`M90 ${66 + i * 7} L108 ${76 + i * 9}`} stroke={c.secondary} strokeWidth="4" strokeLinecap="round" />
        </g>
      ))}
      <path d="M34 56 L20 40" stroke={c.secondary} strokeWidth="5" strokeLinecap="round" />
      <path d="M86 56 L100 40" stroke={c.secondary} strokeWidth="5" strokeLinecap="round" />
      <polygon points="8,34 22,22 28,38 18,36" fill={c.primary} />
      <polygon points="8,34 18,36 16,46" fill={c.secondary} />
      <polygon points="112,34 98,22 92,38 102,36" fill={c.primary} />
      <polygon points="112,34 102,36 104,46" fill={c.secondary} />
      <polygon points="24,64 40,48 80,48 96,64 82,84 38,84" fill={c.primary} />
      <polygon points="40,48 80,48 96,64 60,62" fill={shade(c.primary, 0.1)} />
      <polygon points="38,84 82,84 96,64 24,64" fill={shade(c.primary, -0.06)} />
      <path d="M50 48 L48 34 M70 48 L72 34" stroke={c.secondary} strokeWidth="3" strokeLinecap="round" />
      <Eye x={48} y={32} r={5} look={-1} />
      <Eye x={72} y={32} r={5} />
      <path d="M52 70 Q60 76 68 70" stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" />
    </>
  ),
  'cavalo-marinho': (c) => (
    <>
      <path d="M58 72 Q52 96 64 104 Q76 108 74 96 Q72 88 64 92" stroke={c.secondary} strokeWidth="8" fill="none" strokeLinecap="round" />
      <polygon points="56,30 74,30 70,58 62,78 50,74 46,52" fill={c.primary} />
      <polygon points="56,30 46,52 50,74 58,56" fill={shade(c.primary, 0.12)} />
      <polygon points="62,46 74,48 70,58" fill={c.secondary} />
      <path d="M54 44 L62 44 M52 54 L62 54 M54 64 L62 64" stroke={shade(c.primary, -0.2)} strokeWidth="1.6" strokeLinecap="round" />
      <polygon points="54,14 74,18 78,30 56,32" fill={c.primary} />
      <polygon points="74,18 100,24 100,30 78,30" fill={c.secondary} />
      <polygon points="54,14 60,4 66,16" fill={c.secondary} />
      <polygon points="44,50 34,44 38,58" fill={c.accent} opacity=".9" />
      <Eye x={68} y={23} r={4} />
    </>
  ),
  'peixe-abissal': (c) => (
    <>
      <path d="M58 26 Q66 6 86 10" stroke={shade(c.secondary, 0.25)} strokeWidth="2" fill="none" />
      <circle className="anim-lure" cx="88" cy="12" r="6" fill={c.accent} />
      <polygon points="14,58 2,42 6,58 2,74" fill={c.secondary} />
      <polygon points="14,58 40,28 84,26 112,48 108,70 72,92 34,86" fill={c.secondary} />
      <polygon points="40,28 84,26 112,48 60,46" fill={shade(c.secondary, 0.08)} />
      <polygon points="66,62 112,48 108,70 72,92" fill={shade(c.secondary, -0.06)} />
      <path d="M68 62 L112 52" stroke={c.primary} strokeWidth="1.5" />
      {[72, 80, 88, 96, 104].map((x, i) => (
        <polygon key={x} points={`${x},${60 - i * 2.2} ${x + 3},${69 - i * 2.2} ${x + 6},${59 - i * 2.4}`} fill="#F3FAFF" />
      ))}
      {[76, 86, 96].map((x, i) => (
        <polygon key={x} points={`${x},${82 - i * 5} ${x + 3},${72 - i * 5} ${x + 6},${80 - i * 5.3}`} fill="#F3FAFF" />
      ))}
      <circle cx="30" cy="54" r="1.6" fill={c.primary} />
      <circle cx="40" cy="66" r="1.4" fill={c.primary} />
      <circle cx="50" cy="40" r="1.4" fill={c.primary} />
      <Eye x={78} y={40} r={6.5} />
    </>
  ),
};

export function Creature({
  id,
  size = 96,
  bob = false,
  className = '',
  title,
}: {
  id: string;
  size?: number;
  bob?: boolean;
  className?: string;
  title?: string;
}) {
  const c = getCharacter(id);
  const draw = DRAW[c.id] ?? DRAW.tubarao!;
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={`${bob ? 'anim-bob' : ''} ${className}`}
      role="img"
      aria-label={title ?? c.name}
      style={{ overflow: 'visible' }}
    >
      {draw(c)}
    </svg>
  );
}
