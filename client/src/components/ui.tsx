import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { zoneForTier, type DepthTier } from '@abyss/shared';
import { serverNow, useGame } from '../state/store';
import { api } from '../net/socket';

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'quiet' }) {
  const base = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-6 font-display text-[15px] font-semibold transition active:scale-[.97] disabled:cursor-not-allowed';
  const v =
    variant === 'primary'
      ? 'btn-primary'
      : variant === 'ghost'
        ? 'glass text-foam hover:border-cyan/50'
        : 'text-foam/70 hover:text-foam underline-offset-4 hover:underline min-h-10 px-2';
  return (
    <button className={`${base} ${v} ${className}`} {...rest}>
      {children}
    </button>
  );
}

/** Coluna central com largura de leitura e respiro seguro no celular. */
export function Shell({ children, wide = false, className = '' }: { children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <main
      className={`mx-auto flex min-h-dvh w-full flex-col px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[calc(1.25rem+var(--safe-bottom))] ${wide ? 'max-w-5xl' : 'max-w-xl'} ${className}`}
    >
      {children}
    </main>
  );
}

export function BackButton({ onClick, label = 'Voltar' }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="-ml-2 flex min-h-11 items-center gap-1 self-start rounded-xl px-2 text-foam/75 hover:text-foam">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
        <path d="M12.5 4 6.5 10l6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
      {label}
    </button>
  );
}

/** Contagem regressiva sincronizada com o relógio do servidor. */
export function useRemaining(endsAt: number | null) {
  const [ms, setMs] = useState(() => (endsAt ? Math.max(0, endsAt - serverNow()) : 0));
  useEffect(() => {
    if (!endsAt) return setMs(0);
    let raf = 0;
    const tick = () => {
      setMs(Math.max(0, endsAt - serverNow()));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [endsAt]);
  return ms;
}

export function TimerRing({ endsAt, total, size = 64 }: { endsAt: number | null; total: number; size?: number }) {
  const ms = useRemaining(endsAt);
  const frac = total > 0 ? Math.min(1, ms / total) : 0;
  const r = size / 2 - 5;
  const C = 2 * Math.PI * r;
  const secs = Math.ceil(ms / 1000);
  const urgent = secs <= 5;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} role="timer" aria-label={`${secs} segundos restantes`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(243 250 255 / .12)" strokeWidth="5" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={urgent ? '#FF6B7A' : '#35E0C1'}
          strokeWidth="5"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
        />
      </svg>
      <span className={`num absolute font-display text-lg font-semibold ${urgent ? 'text-coral' : ''}`}>{secs}</span>
    </div>
  );
}

export const ZONE_COLORS: Record<DepthTier, string> = {
  1: '#9EEBFF',
  2: '#35E0C1',
  3: '#19D5E8',
  4: '#9B82F0',
  5: '#FFB45C',
};

export function DepthBadge({ tier, small = false }: { tier: DepthTier; small?: boolean }) {
  const z = zoneForTier(tier);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 ${small ? 'py-0.5 text-xs' : 'py-1 text-sm'} font-semibold`}
      style={{ color: ZONE_COLORS[tier], borderColor: `${ZONE_COLORS[tier]}55`, background: `${ZONE_COLORS[tier]}14` }}
    >
      <svg width="8" height="10" viewBox="0 0 8 10" aria-hidden>
        <path d="M4 10 0 4h8z" fill="currentColor" opacity={0.25 + tier * 0.15} />
      </svg>
      {z.label}
    </span>
  );
}

export function Toast() {
  const toast = useGame((s) => s.toast);
  const [visible, setVisible] = useState<typeof toast>(null);
  useEffect(() => {
    if (!toast) return;
    setVisible(toast);
    const t = setTimeout(() => setVisible(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4" aria-live="polite">
      <AnimatePresence>
        {visible && (
          <motion.div
            key={visible.id}
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            className="glass rounded-2xl px-4 py-3 text-sm shadow-2xl"
          >
            {visible.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Tela 12 — reconexão (sobreposta à partida, sem perder o estado). */
export function ConnectionOverlay() {
  const connection = useGame((s) => s.connection);
  const inRoom = useGame((s) => !!s.session);
  const show = connection !== 'online' && (inRoom || connection === 'offline');
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 grid place-items-center bg-abyss/75 px-6 backdrop-blur-sm"
          role="alertdialog"
          aria-labelledby="reconn-title"
        >
          <div className="glass flex max-w-sm flex-col items-center gap-4 rounded-3xl p-8 text-center">
            <div className="relative grid h-20 w-20 place-items-center">
              {[0, 0.6, 1.2].map((d) => (
                <span key={d} className="absolute inset-0 rounded-full border border-cyan/60" style={{ animation: `sonar 1.8s ease-out ${d}s infinite` }} />
              ))}
              <span className="h-3 w-3 rounded-full bg-cyan shadow-[0_0_14px_#19D5E8]" />
            </div>
            <h2 id="reconn-title" className="font-display text-xl font-semibold">
              {connection === 'offline' ? 'Sem sinal do servidor' : 'Reconectando…'}
            </h2>
            <p className="text-foam/75">
              {connection === 'offline'
                ? 'Não conseguimos falar com o servidor. Confira sua internet e tente de novo.'
                : 'Sua conexão caiu. Seu lugar e seus pontos estão guardados — voltamos assim que o sinal retornar.'}
            </p>
            {connection === 'offline' && (
              <Button onClick={() => api.reconnect()} className="w-full">
                Tentar de novo
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Wordmark({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  return (
    <span className={`glow-text font-display font-extrabold tracking-[0.18em] ${size === 'lg' ? 'text-6xl sm:text-8xl' : 'text-lg'}`} aria-label="ABYSS">
      ABYSS
    </span>
  );
}
