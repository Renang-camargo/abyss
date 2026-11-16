import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { DEPTH_ZONES, zoneForTier, type DepthTier, type RoundAnswerResult } from '@abyss/shared';
import { useGame, useRoom } from '../state/store';
import { api } from '../net/socket';
import { Creature } from '../components/Creature';
import { Button, DepthBadge, Shell, TimerRing, ZONE_COLORS, useRemaining } from '../components/ui';

const TIER_DEPTH: Record<DepthTier, number> = { 1: 0.14, 2: 0.3, 3: 0.52, 4: 0.74, 5: 0.97 };

function RoundHeader({ right }: { right?: React.ReactNode }) {
  const room = useRoom();
  return (
    <header className="flex items-center justify-between gap-3">
      <div>
        <p className="num font-display text-sm font-semibold text-foam/80">
          Rodada {room.round} de {room.totalRounds}
        </p>
        <div className="mt-1 flex gap-1" aria-hidden>
          {Array.from({ length: room.totalRounds }, (_, i) => (
            <span key={i} className={`h-1.5 w-4 rounded-full ${i < room.round ? 'bg-turq' : 'bg-foam/15'}`} />
          ))}
        </div>
      </div>
      {right}
    </header>
  );
}

/* ───────────── contagem antes da 1ª rodada ───────────── */
export function Countdown() {
  const room = useRoom();
  const setDepth = useGame((s) => s.setDepth);
  useEffect(() => setDepth(0.4), [setDepth]);
  const ms = useRemaining(room.phaseEndsAt);
  const n = Math.max(1, Math.ceil(ms / 1000));
  return (
    <Shell className="items-center justify-center text-center">
      <p className="font-display text-xl text-foam/80">Prendam a respiração</p>
      <AnimatePresence mode="popLayout">
        <motion.span
          key={n}
          initial={{ scale: 1.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0, y: 40 }}
          className="num glow-text mt-4 font-display text-[9rem] leading-none font-extrabold"
        >
          {n}
        </motion.span>
      </AnimatePresence>
      <p className="mt-6 text-foam/70">{room.totalRounds} rodadas. Pense além do óbvio.</p>
    </Shell>
  );
}

/* ───────────── 8. Tela da partida ───────────── */
export function QuestionScreen() {
  const room = useRoom();
  const myAnswer = useGame((s) => s.myAnswer);
  const me = useGame((s) => s.session?.playerId);
  const setDepth = useGame((s) => s.setDepth);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const q = room.question!;
  const ms = useRemaining(room.phaseEndsAt);
  const closed = ms <= 0;

  useEffect(() => {
    setDepth(0.4);
    setText('');
    setError('');
    inputRef.current?.focus();
  }, [room.round, setDepth]);

  const active = room.players.filter((p) => !p.left && p.connected);
  const answered = active.filter((p) => p.answered).length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending || myAnswer) return;
    setSending(true);
    const r = await api.answer(text);
    setSending(false);
    if (!r.ok) setError(r.message);
  };

  return (
    <main className="mx-auto flex h-dvh w-full max-w-2xl flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(0.75rem+var(--safe-bottom))]">
      <RoundHeader right={<TimerRing endsAt={room.phaseEndsAt} total={room.settings.roundSeconds * 1000} />} />

      <section className="flex flex-1 flex-col justify-center py-4" aria-live="polite">
        <p className="text-foam/70">{q.category}</p>
        <motion.h1
          key={q.id}
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
          className="mt-2 font-display text-[clamp(2rem,8vw,3.6rem)] leading-[1.05] font-semibold text-balance"
        >
          {q.prompt}
        </motion.h1>
        <ul className="mt-6 flex flex-wrap gap-1.5" aria-label={`${answered} de ${active.length} já responderam`}>
          {active.map((p) => (
            <li
              key={p.id}
              title={`${p.name}${p.answered ? ' já respondeu' : ''}`}
              className={`grid h-9 w-9 place-items-center rounded-full border transition ${p.answered ? 'border-turq bg-turq/20' : 'border-foam/15 bg-deep/40 opacity-60'} ${p.id === me ? 'ring-2 ring-cyan/60' : ''}`}
            >
              <Creature id={p.character} size={26} />
            </li>
          ))}
        </ul>
        <p className="num mt-2 text-sm text-foam/65">
          {answered} de {active.length} já responderam
        </p>
      </section>

      {myAnswer ? (
        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="glass rounded-3xl p-5">
          <p className="text-sm text-foam/70">Sua resposta foi enviada</p>
          <p className="mt-1 font-display text-2xl font-semibold break-words">{myAnswer}</p>
          <p className="mt-2 text-sm text-foam/60">O servidor revela os pontos quando o tempo acabar.</p>
        </motion.div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <div className="flex gap-2">
            <label htmlFor="answer" className="sr-only">
              Sua resposta para {q.prompt}
            </label>
            <input
              ref={inputRef}
              id="answer"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError('');
              }}
              disabled={closed || sending}
              placeholder={closed ? 'Tempo esgotado' : 'Sua resposta'}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="send"
              maxLength={60}
              className="glass h-16 min-w-0 flex-1 rounded-2xl px-5 text-xl font-semibold outline-none focus:border-cyan"
            />
            <Button type="submit" className="h-16 px-5" disabled={!text.trim() || closed || sending} aria-label="Enviar resposta">
              Enviar
            </Button>
          </div>
          <p role="alert" className="min-h-5 text-sm text-coral">
            {error}
          </p>
        </form>
      )}
    </main>
  );
}

/* ───────────── 9. Resultado da rodada (a descida) ───────────── */
const REASON: Record<string, (prompt: string) => string> = {
  'not-found': () => 'Não reconhecida',
  'other-category': (p) => `Não é ${p.toLowerCase()}`,
  ambiguous: () => 'Ambígua demais',
  empty: () => 'Vazia',
  'no-answer': () => 'Sem resposta',
  rejected: () => 'Não vale',
};

function reasonText(a: RoundAnswerResult, prompt: string) {
  if (a.reason === 'rejected' && a.note) return `Não vale: ${a.note}`;
  return REASON[a.reason]?.(prompt) ?? 'Não pontuou';
}

/** Posição (0–1) no medidor para uma profundidade em metros (escala logarítmica). */
const gaugePos = (m: number) => Math.log10(1 + m) / Math.log10(1 + 8000);

function Descent({ mine }: { mine: RoundAnswerResult | undefined }) {
  const reduced = useReducedMotion();
  const tier = mine?.valid ? mine.tier : null;
  const meters = tier ? zoneForTier(tier).meters : 0;
  const mv = useMotionValue(0);
  const shown = useTransform(mv, (v) => Math.round(v).toLocaleString('pt-BR'));
  const top = useTransform(mv, (v) => `${gaugePos(v) * 100}%`);
  useEffect(() => {
    const c = animate(mv, meters, { duration: reduced ? 0 : 1.2 + (tier ?? 0) * 0.35, ease: [0.3, 0, 0.15, 1], delay: 0.35 });
    return () => c.stop();
  }, [meters, tier, mv, reduced]);
  const char = useGame((s) => s.profile?.character ?? 'tubarao');

  return (
    <div className="relative flex gap-4">
      {/* medidor de profundidade */}
      <div className="relative h-[46vh] max-h-96 min-h-64 w-14 shrink-0 rounded-full border border-foam/12 bg-deep/40" aria-hidden>
        {DEPTH_ZONES.map((z) => (
          <div key={z.tier} className="absolute left-0 w-full" style={{ top: `${gaugePos(z.meters) * 100}%` }}>
            <span className="absolute -left-1 h-px w-3" style={{ background: ZONE_COLORS[z.tier] }} />
          </div>
        ))}
        <motion.div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ top }}>
          <div className="relative">
            <span className="absolute inset-0 -m-3 rounded-full blur-md" style={{ background: tier ? `${ZONE_COLORS[tier]}55` : 'transparent' }} />
            <Creature id={char} size={52} />
          </div>
        </motion.div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <p className="text-foam/70">Sua resposta</p>
        <p className="font-display text-2xl font-semibold break-words">{mine?.raw || 'Nada enviado'}</p>
        {mine?.valid && mine.matched && mine.matched.toLowerCase() !== mine.raw.toLowerCase() && (
          <p className="text-sm text-foam/65">reconhecida como {mine.matched}</p>
        )}
        <p className="mt-5 flex items-baseline gap-2">
          <motion.span className="num font-display text-6xl leading-none font-extrabold sm:text-7xl" style={{ color: tier ? ZONE_COLORS[tier] : '#F3FAFF' }}>
            {shown}
          </motion.span>
          <span className="font-display text-2xl text-foam/70">m</span>
        </p>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : 1.4 + (tier ?? 0) * 0.35 }} className="mt-4">
          {mine?.valid && tier ? (
            <>
              <DepthBadge tier={tier} />
              <p className="num mt-3 font-display text-3xl font-semibold">
                +{mine.points}
                {mine.points < mine.basePoints && (
                  <span className="ml-2 text-base font-normal text-foam/65">
                    de {mine.basePoints}, repetida por {mine.duplicates}
                  </span>
                )}
              </p>
            </>
          ) : (
            <p className="text-xl text-coral">{mine ? reasonText(mine, useGame.getState().lastRound!.question.prompt) : 'Sem resposta'}. Nenhum ponto nesta rodada.</p>
          )}
        </motion.div>
      </div>
    </div>
  );
}

/** Cada zona tem sua própria assinatura visual no momento da revelação. */
function ZoneFlourish({ tier }: { tier: DepthTier | null }) {
  const reduced = useReducedMotion();
  if (reduced || !tier) return null;
  if (tier === 1)
    return (
      <div className="pointer-events-none fixed inset-x-0 top-[12%] flex justify-center" aria-hidden>
        {[0, 0.4, 0.8].map((d) => (
          <motion.span
            key={d}
            className="absolute h-10 w-40 rounded-[50%] border-2 border-foam/50"
            initial={{ scale: 0.2, opacity: 0.9 }}
            animate={{ scale: 3.4, opacity: 0 }}
            transition={{ duration: 2.2, delay: d, ease: 'easeOut' }}
          />
        ))}
      </div>
    );
  if (tier === 2)
    return (
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <motion.svg viewBox="0 0 240 80" className="absolute top-[28%] w-72" initial={{ x: '-40vw' }} animate={{ x: '120vw' }} transition={{ duration: 5, ease: 'linear' }}>
          {Array.from({ length: 14 }, (_, i) => (
            <polygon key={i} points={`${(i % 7) * 32},${(i * 23) % 70 + 5} ${(i % 7) * 32 + 14},${(i * 23) % 70 + 1} ${(i % 7) * 32 + 14},${(i * 23) % 70 + 9}`} fill="#35E0C1" opacity=".75" />
          ))}
        </motion.svg>
      </div>
    );
  if (tier === 3) return null; // águas-vivas do próprio fundo surgem nesta faixa
  const sparks = Array.from({ length: tier === 5 ? 34 : 22 }, (_, i) => i);
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      {sparks.map((i) => {
        const a = (i / sparks.length) * Math.PI * 2;
        const dist = 120 + (i % 5) * 50;
        const col = tier === 5 ? (i % 3 ? '#FFB45C' : '#35E0C1') : i % 2 ? '#9B82F0' : '#19D5E8';
        return (
          <motion.span
            key={i}
            className="absolute top-1/2 left-1/2 h-2 w-2 rounded-full"
            style={{ background: col, boxShadow: `0 0 12px ${col}` }}
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
            animate={{ x: Math.cos(a) * dist, y: Math.sin(a) * dist, opacity: [0, 1, 0], scale: [0.4, 1.2, 0.6] }}
            transition={{ duration: 2.4, delay: 1.6 + (i % 6) * 0.05, ease: 'easeOut' }}
          />
        );
      })}
      {tier === 5 && (
        <motion.div
          className="absolute right-[-6vw] bottom-[6vh] opacity-0"
          initial={{ opacity: 0, x: 80 }}
          animate={{ opacity: 0.85, x: 0 }}
          transition={{ delay: 1.8, duration: 1.6 }}
        >
          <Creature id="peixe-abissal" size={260} />
        </motion.div>
      )}
    </div>
  );
}

export function RevealScreen() {
  const room = useRoom();
  const result = useGame((s) => s.lastRound);
  const me = useGame((s) => s.session?.playerId);
  const setDepth = useGame((s) => s.setDepth);
  const mine = result?.answers.find((a) => a.playerId === me);
  const tier = mine?.valid ? mine.tier : null;
  useEffect(() => setDepth(tier ? TIER_DEPTH[tier] : 0.1), [tier, setDepth]);
  if (!result || result.round !== room.round) return <WaitingResults />;

  return (
    <Shell wide>
      <ZoneFlourish tier={tier} />
      <RoundHeader right={<p className="max-w-[55%] truncate text-right font-display font-semibold">{result.question.prompt}</p>} />
      <div className="mt-6 grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Descent mine={mine} />
        <section aria-labelledby="all-h">
          <h2 id="all-h" className="font-display text-lg font-semibold">
            Todas as respostas
          </h2>
          <ul className="mt-3 flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto pr-1">
            {result.answers.map((a, i) => (
              <motion.li
                key={a.playerId}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.6 + Math.min(i, 12) * 0.05 }}
                className={`flex items-center gap-3 rounded-2xl border px-3 py-2 ${a.playerId === me ? 'border-cyan/50 bg-cyan/10' : 'border-foam/8 bg-deep/45'}`}
              >
                <Creature id={a.character} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foam/70">{a.name}</p>
                  <p className={`truncate font-semibold ${a.valid ? '' : 'text-foam/55 line-through decoration-coral/60'}`}>{a.raw || '—'}</p>
                  {!a.valid && <p className="truncate text-xs text-coral/90">{reasonText(a, result.question.prompt)}</p>}
                  {a.valid && a.tier && (
                    <span className="mt-1 inline-block sm:hidden">
                      <DepthBadge tier={a.tier} small />
                    </span>
                  )}
                </div>
                {a.valid && a.tier && (
                  <span className="hidden sm:inline-flex">
                    <DepthBadge tier={a.tier} small />
                  </span>
                )}
                <span className="num w-14 text-right font-display font-semibold">{a.points ? `+${a.points}` : '0'}</span>
              </motion.li>
            ))}
          </ul>
          {result.deepExamples.length > 0 && (
            <p className="mt-4 text-sm text-foam/75">
              Ninguém pensou em{' '}
              {result.deepExamples.map((d, i) => (
                <span key={d.name}>
                  <strong style={{ color: ZONE_COLORS[d.tier] }}>{d.name}</strong>
                  {i < result.deepExamples.length - 2 ? ', ' : i === result.deepExamples.length - 2 ? ' ou ' : '.'}
                </span>
              ))}
            </p>
          )}
        </section>
      </div>
    </Shell>
  );
}

function WaitingResults() {
  return (
    <Shell className="items-center justify-center">
      <p className="font-display text-xl text-foam/80">Medindo a profundidade…</p>
    </Shell>
  );
}

/* ───────────── 10. Classificação parcial ───────────── */
export function LeaderboardScreen() {
  const room = useRoom();
  const result = useGame((s) => s.lastRound);
  const me = useGame((s) => s.session?.playerId);
  const setDepth = useGame((s) => s.setDepth);
  useEffect(() => setDepth(0.38), [setDepth]);
  const ms = useRemaining(room.phaseEndsAt);
  const standings = useMemo(() => result?.standings ?? [], [result]);
  // começa na ordem anterior e reordena — o movimento mostra quem subiu
  const [order, setOrder] = useState(() => [...standings].sort((a, b) => b.score - b.delta - (a.score - a.delta)));
  useEffect(() => {
    const t = setTimeout(() => setOrder(standings), 650);
    return () => clearTimeout(t);
  }, [standings]);

  return (
    <Shell>
      <RoundHeader right={<span className="num text-sm text-foam/70">Próxima pergunta em {Math.ceil(ms / 1000)} s</span>} />
      <h1 className="mt-6 font-display text-2xl font-semibold">Classificação</h1>
      <ol className="mt-4 flex flex-col gap-1.5">
        {order.map((s) => {
          const rank = standings.findIndex((x) => x.playerId === s.playerId) + 1;
          return (
            <motion.li
              key={s.playerId}
              layout
              transition={{ type: 'spring', stiffness: 260, damping: 28 }}
              className={`flex items-center gap-3 rounded-2xl border px-3 py-2 ${s.playerId === me ? 'border-cyan/50 bg-cyan/10' : 'border-foam/8 bg-deep/45'} ${s.left ? 'opacity-50' : ''}`}
            >
              <span className="num w-7 text-center font-display font-semibold text-foam/80">{rank}</span>
              <Creature id={s.character} size={34} />
              <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
              {s.delta > 0 && <span className="num text-sm font-semibold text-turq">+{s.delta}</span>}
              <span className="num w-16 text-right font-display text-lg font-semibold">{s.score}</span>
            </motion.li>
          );
        })}
      </ol>
      <Button variant="quiet" className="mt-6 self-center" onClick={() => api.leave()}>
        Sair da partida
      </Button>
    </Shell>
  );
}
