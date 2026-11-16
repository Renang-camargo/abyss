/**
 * Fundo submarino vivo. Um único valor — `depth` (0 superfície → 1 abismo) —
 * controla a cor da água, os raios de luz, as bolhas, a neve marinha,
 * a bioluminescência e as paredes do cânion. Mudar a profundidade = "mergulhar".
 */
import { useEffect, useRef } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from 'framer-motion';
import { useGame } from '../state/store';

const STOPS: [number, string, string][] = [
  [0.0, '#2a9fc0', '#063B5C'],
  [0.3, '#0d6488', '#022a49'],
  [0.55, '#063B5C', '#021B33'],
  [0.78, '#1b1a52', '#010D1C'],
  [1.0, '#06091a', '#00040b'],
];

function hex(c: string) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number) {
  const A = hex(a);
  const B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i]! - v) * t)).join(',')})`;
}
function waterAt(d: number, which: 1 | 2) {
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [d0, ...c0] = STOPS[i]!;
    const [d1, ...c1] = STOPS[i + 1]!;
    if (d <= d1) return mix(c0[which - 1]!, c1[which - 1]!, (d - d0) / (d1 - d0));
  }
  return STOPS[STOPS.length - 1]![which];
}

function Particles({ depth, reduced }: { depth: MotionValue<number>; reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let w = 0;
    let h = 0;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const area = Math.min(1, (window.innerWidth * window.innerHeight) / (1400 * 900));
    const n = Math.round(26 + 44 * area);
    type P = { x: number; y: number; r: number; v: number; ph: number; kind: 'bubble' | 'snow' | 'glow' };
    const ps: P[] = Array.from({ length: n }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.6 + Math.random() * 2.6,
      v: 0.2 + Math.random() * 0.8,
      ph: Math.random() * Math.PI * 2,
      kind: i % 3 === 0 ? 'bubble' : i % 3 === 1 ? 'snow' : 'glow',
    }));
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const d = depth.get();
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        if (!reduced) {
          if (p.kind === 'bubble') p.y -= p.v * dt * 0.09;
          else if (p.kind === 'snow') p.y += p.v * dt * 0.012;
          else p.y -= p.v * dt * 0.006;
          p.ph += dt * p.v;
          if (p.y < -0.05) p.y = 1.05;
          if (p.y > 1.05) p.y = -0.05;
        }
        const x = p.x * w + Math.sin(p.ph) * 8;
        const y = p.y * h;
        if (p.kind === 'bubble') {
          const a = 0.45 * (1 - d * 0.7);
          ctx.strokeStyle = `rgba(243,250,255,${a})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, p.r * 1.6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = `rgba(243,250,255,${a * 0.6})`;
          ctx.beginPath();
          ctx.arc(x - p.r * 0.5, y - p.r * 0.5, p.r * 0.45, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.kind === 'snow') {
          ctx.fillStyle = `rgba(200,230,240,${0.12 + d * 0.35})`;
          ctx.fillRect(x, y, p.r * 0.7, p.r * 0.7);
        } else {
          const a = Math.max(0, d - 0.35) * (0.5 + 0.5 * Math.sin(p.ph * 2)) * 1.2;
          if (a <= 0.01) continue;
          const g = ctx.createRadialGradient(x, y, 0, x, y, p.r * 5);
          const col = p.r > 2 ? '255,180,92' : p.r > 1.4 ? '121,87,213' : '53,224,193';
          g.addColorStop(0, `rgba(${col},${a})`);
          g.addColorStop(1, `rgba(${col},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, p.r * 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [depth, reduced]);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />;
}

function Manta() {
  return (
    <svg viewBox="0 0 200 90" className="h-full w-full" aria-hidden>
      <path d="M100 18 C130 20 160 30 196 56 C160 54 132 58 112 66 L104 88 L96 66 C76 58 40 54 4 56 C40 30 70 20 100 18Z" fill="#021B33" />
    </svg>
  );
}

function Jelly({ hue }: { hue: string }) {
  return (
    <svg viewBox="0 0 60 120" className="h-full w-full" aria-hidden>
      <defs>
        <radialGradient id={`bell-${hue.slice(1)}`} cx="50%" cy="45%">
          <stop offset="0%" stopColor="#F3FAFF" stopOpacity=".9" />
          <stop offset="60%" stopColor={hue} stopOpacity=".55" />
          <stop offset="100%" stopColor={hue} stopOpacity="0" />
        </radialGradient>
      </defs>
      {[18, 26, 34, 42].map((x, i) => (
        <path key={x} d={`M${x} 34 q${i % 2 ? 5 : -5} 20 0 40 q${i % 2 ? -5 : 5} 20 0 40`} stroke={hue} strokeOpacity=".45" strokeWidth="1.4" fill="none" />
      ))}
      <ellipse cx="30" cy="26" rx="26" ry="18" fill={`url(#bell-${hue.slice(1)})`} />
    </svg>
  );
}

export function OceanBackground() {
  const target = useGame((s) => s.depth);
  const reduced = !!useReducedMotion();
  const depth = useMotionValue(target);
  useEffect(() => {
    const c = animate(depth, target, { duration: reduced ? 0 : 2.2, ease: [0.45, 0, 0.2, 1] });
    return () => c.stop();
  }, [target, depth, reduced]);

  const background = useTransform(depth, (d) => `linear-gradient(180deg, ${waterAt(d, 1)} 0%, ${waterAt(d, 2)} 78%)`);
  const rays = useTransform(depth, (d) => Math.max(0, 1 - d * 1.55));
  const surface = useTransform(depth, (d) => Math.max(0, 1 - d * 3));
  const walls = useTransform(depth, (d) => Math.min(1, Math.max(0, (d - 0.25) * 1.6)));
  const wallsX = useTransform(depth, (d) => `${(1 - d) * -14}%`);
  const seabedY = useTransform(depth, (d) => `${Math.max(0, 70 - d * 90)}%`);
  const jelly = useTransform(depth, (d) => Math.max(0, Math.min(1, (d - 0.4) * 2.5)));
  const manta = useTransform(depth, (d) => Math.max(0, 0.5 - d * 0.7));
  const vignette = useTransform(depth, (d) => d * 0.9);

  return (
    <motion.div className="fixed inset-0 -z-10 overflow-hidden" style={{ background }} aria-hidden>
      {/* ondulação da superfície */}
      <motion.div
        className="absolute inset-x-0 top-0 h-[40vh]"
        style={{
          opacity: surface,
          backgroundImage:
            'radial-gradient(ellipse 120px 26px at 30% 40%, rgba(243,250,255,.16), transparent 70%), radial-gradient(ellipse 160px 30px at 70% 60%, rgba(243,250,255,.12), transparent 70%)',
          backgroundSize: '340px 140px, 420px 160px',
          animation: reduced ? undefined : 'caustic 18s linear infinite',
          maskImage: 'linear-gradient(180deg, black, transparent)',
        }}
      />
      {/* raios de luz atravessando a água */}
      <motion.div className="absolute inset-0" style={{ opacity: rays }}>
        {[
          { l: '8%', w: '9vw', o: 0.32, dl: '0s' },
          { l: '24%', w: '5vw', o: 0.22, dl: '-3s' },
          { l: '42%', w: '12vw', o: 0.28, dl: '-6s' },
          { l: '63%', w: '6vw', o: 0.2, dl: '-2s' },
          { l: '78%', w: '10vw', o: 0.26, dl: '-8s' },
        ].map((r, i) => (
          <div
            key={i}
            className="absolute -top-[10%] h-[95%] blur-xl"
            style={
              {
                left: r.l,
                width: r.w,
                '--ray-o': r.o,
                opacity: r.o,
                background: 'linear-gradient(180deg, rgba(220,250,255,.9), rgba(120,220,240,.25) 45%, transparent 85%)',
                transformOrigin: 'top',
                animation: reduced ? undefined : `ray-sway ${11 + i * 2}s ease-in-out ${r.dl} infinite`,
              } as React.CSSProperties
            }
          />
        ))}
      </motion.div>
      {/* manta distante */}
      <motion.div
        className="absolute top-[18%] h-[9vw] max-h-24 w-[20vw] max-w-56"
        style={{ opacity: manta, animation: reduced ? undefined : 'drift 70s linear infinite' }}
      >
        <Manta />
      </motion.div>
      {/* águas-vivas bioluminescentes (só no fundo) */}
      <motion.div className="absolute inset-0" style={{ opacity: jelly }}>
        <div className="anim-bob absolute left-[3%] top-[34%] h-32 w-16" style={{ animationDuration: '7s' }}>
          <Jelly hue="#35E0C1" />
        </div>
        <div className="anim-bob absolute right-[4%] top-[12%] h-24 w-12" style={{ animationDuration: '9s' }}>
          <Jelly hue="#7957D5" />
        </div>
        <div className="anim-bob absolute right-[9%] top-[70%] h-16 w-8" style={{ animationDuration: '6s' }}>
          <Jelly hue="#19D5E8" />
        </div>
      </motion.div>
      <Particles depth={depth} reduced={reduced} />
      {/* paredes do cânion */}
      <motion.svg
        className="absolute inset-y-0 left-0 h-full w-[26vw] min-w-28"
        viewBox="0 0 100 400"
        preserveAspectRatio="none"
        style={{ opacity: walls, x: wallsX }}
      >
        <polygon points="0,0 34,0 52,60 30,120 58,190 26,250 48,320 20,400 0,400" fill="#010a16" />
        <polygon points="34,0 52,60 30,120 40,130 64,60" fill="#03182a" opacity=".8" />
      </motion.svg>
      <motion.svg
        className="absolute inset-y-0 right-0 h-full w-[26vw] min-w-28 -scale-x-100"
        viewBox="0 0 100 400"
        preserveAspectRatio="none"
        style={{ opacity: walls, x: useTransform(wallsX, (v) => v.replace('-', '')) }}
      >
        <polygon points="0,0 28,0 46,70 24,140 52,200 30,270 56,340 18,400 0,400" fill="#010a16" />
        <polygon points="28,0 46,70 24,140 36,150 60,70" fill="#03182a" opacity=".8" />
      </motion.svg>
      {/* leito marinho */}
      <motion.svg className="absolute inset-x-0 bottom-0 h-[34vh] w-full" viewBox="0 0 1000 200" preserveAspectRatio="none" style={{ y: seabedY }}>
        <polygon points="0,120 80,96 160,120 260,88 360,110 470,80 560,104 680,76 780,108 880,90 1000,112 1000,200 0,200" fill="#02101f" />
        <polygon points="0,150 120,130 240,152 380,126 520,150 650,128 800,152 920,134 1000,146 1000,200 0,200" fill="#010a16" />
        <circle cx="300" cy="96" r="3" fill="#FFB45C" opacity=".7" />
        <circle cx="720" cy="84" r="2.4" fill="#35E0C1" opacity=".7" />
      </motion.svg>
      {/* pressão: vinheta nas bordas conforme desce */}
      <motion.div
        className="absolute inset-0"
        style={{ opacity: vignette, background: 'radial-gradient(ellipse at 50% 45%, transparent 35%, rgba(0,3,10,.85) 100%)' }}
      />
    </motion.div>
  );
}
