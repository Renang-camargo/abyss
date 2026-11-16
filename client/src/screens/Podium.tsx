import { useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { Standing } from '@abyss/shared';
import { useGame, useRoom } from '../state/store';
import { api } from '../net/socket';
import { Creature } from '../components/Creature';
import { Button, DepthBadge, Shell } from '../components/ui';

const PLACE = {
  1: { h: 'h-44 sm:h-56', delay: 1.7, label: '1º', tone: '#FFB45C' },
  2: { h: 'h-32 sm:h-40', delay: 1.0, label: '2º', tone: '#9EEBFF' },
  3: { h: 'h-24 sm:h-28', delay: 0.4, label: '3º', tone: '#35E0C1' },
} as const;

function Stand({ s, place }: { s: Standing | undefined; place: 1 | 2 | 3 }) {
  const reduced = useReducedMotion();
  const p = PLACE[place];
  const winner = place === 1;
  return (
    <div className={`flex w-1/3 max-w-48 flex-col items-center justify-end ${s ? '' : 'opacity-35'}`}>
      {s && (
        <motion.div
          className="relative flex flex-col items-center"
          initial={reduced ? false : { y: 220, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: p.delay, type: 'spring', stiffness: 70, damping: 13 }}
        >
          {winner && (
            <motion.span
              aria-hidden
              className="absolute -top-6 h-48 w-48 rounded-full"
              style={{ background: 'radial-gradient(circle, rgba(255,180,92,.55), rgba(255,180,92,0) 65%)' }}
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: [0.3, 1.25, 1], opacity: 1 }}
              transition={{ delay: p.delay + 0.5, duration: 1.4 }}
            />
          )}
          <Creature id={s.character} size={winner ? 118 : 86} bob />
          <p className={`mt-1 max-w-full truncate text-center font-semibold ${winner ? 'text-lg' : ''}`}>{s.name}</p>
          <p className="num font-display text-xl font-semibold" style={{ color: p.tone }}>
            {s.score}
          </p>
        </motion.div>
      )}
      <motion.div
        className={`mt-2 w-full rounded-t-2xl ${p.h} flex justify-center pt-3`}
        style={{
          background: `linear-gradient(180deg, ${p.tone}33, rgba(2,27,51,.85) 70%)`,
          borderTop: `2px solid ${p.tone}`,
          clipPath: 'polygon(6% 0, 94% 0, 100% 100%, 0 100%)',
        }}
        initial={reduced ? false : { scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ delay: p.delay - 0.35, duration: 0.6, ease: 'easeOut' }}
        aria-hidden
      >
        <span className="font-display text-2xl font-extrabold" style={{ color: p.tone, transformOrigin: 'bottom' }}>
          {p.label}
        </span>
      </motion.div>
    </div>
  );
}

function Celebration() {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <div className="pointer-events-none fixed inset-0 -z-[1] overflow-hidden" aria-hidden>
      {Array.from({ length: 40 }, (_, i) => {
        const left = (i * 37) % 100;
        const col = ['#FFB45C', '#35E0C1', '#19D5E8', '#9B82F0'][i % 4];
        return (
          <motion.span
            key={i}
            className="absolute bottom-[-20px] rounded-full"
            style={{ left: `${left}%`, width: 4 + (i % 4) * 3, height: 4 + (i % 4) * 3, background: col, boxShadow: `0 0 10px ${col}` }}
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: '-110vh', opacity: [0, 1, 1, 0], x: [0, (i % 2 ? 1 : -1) * 30, 0] }}
            transition={{ delay: 2 + (i % 10) * 0.18, duration: 5 + (i % 5), ease: 'easeOut' }}
          />
        );
      })}
    </div>
  );
}

/* ───────────── 11. Pódio final ───────────── */
export function PodiumScreen() {
  const room = useRoom();
  const final = useGame((s) => s.final);
  const me = useGame((s) => s.session?.playerId);
  const setDepth = useGame((s) => s.setDepth);
  const showToast = useGame((s) => s.showToast);
  useEffect(() => setDepth(0.62), [setDepth]);
  if (!final) return null;
  const [first, second, third] = final.standings;
  const isHost = room.hostId === me;
  const myRank = final.standings.find((s) => s.playerId === me)?.rank;

  return (
    <Shell wide>
      <Celebration />
      <header className="text-center">
        <motion.h1 initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="font-display text-3xl font-semibold sm:text-4xl">
          {first?.playerId === me ? 'Você chegou mais fundo que todo mundo' : `${first?.name} chegou mais fundo`}
        </motion.h1>
        {myRank && first?.playerId !== me && <p className="mt-2 text-foam/75">Você terminou em {myRank}º lugar.</p>}
      </header>

      <div className="mt-8 flex items-end justify-center gap-2 sm:gap-4" role="list" aria-label="Pódio">
        <Stand s={second} place={2} />
        <Stand s={first} place={1} />
        <Stand s={third} place={3} />
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {final.bestAnswer && (
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 2.6 }}
            className="glass rounded-3xl p-5"
            aria-labelledby="best-h"
          >
            <h2 id="best-h" className="text-foam/70">
              Resposta mais profunda da partida
            </h2>
            <p className="mt-2 font-display text-3xl font-semibold break-words">{final.bestAnswer.answer}</p>
            <p className="mt-1 text-foam/75">
              {final.bestAnswer.name} em “{final.bestAnswer.prompt}”
            </p>
            <div className="mt-3 flex items-center gap-3">
              <DepthBadge tier={final.bestAnswer.tier} />
              <span className="num font-display font-semibold">+{final.bestAnswer.points}</span>
            </div>
          </motion.section>
        )}
        <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.8 }} aria-labelledby="rank-h">
          <h2 id="rank-h" className="font-display text-lg font-semibold">
            Classificação completa
          </h2>
          <ol className="mt-3 flex max-h-80 flex-col gap-1.5 overflow-y-auto pr-1">
            {final.standings.map((s) => (
              <li
                key={s.playerId}
                className={`flex items-center gap-3 rounded-2xl border px-3 py-2 ${s.playerId === me ? 'border-cyan/50 bg-cyan/10' : 'border-foam/8 bg-deep/45'} ${s.left ? 'opacity-50' : ''}`}
              >
                <span className="num w-7 text-center font-display font-semibold">{s.rank}</span>
                <Creature id={s.character} size={32} />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {s.name}
                  {s.left && <span className="ml-2 text-xs font-normal text-foam/60">saiu</span>}
                </span>
                <span className="num font-display font-semibold">{s.score}</span>
              </li>
            ))}
          </ol>
        </motion.section>
      </div>

      <div className="mt-8 flex flex-col items-center gap-2 pb-4 sm:flex-row sm:justify-center">
        {isHost ? (
          <Button
            className="h-14 w-full sm:w-64"
            onClick={async () => {
              const r = await api.restart();
              if (!r.ok) showToast(r.message);
            }}
          >
            Jogar de novo
          </Button>
        ) : (
          <p className="text-foam/70">O anfitrião pode iniciar outra partida nesta sala.</p>
        )}
        <Button variant="ghost" className="h-14 w-full sm:w-48" onClick={() => api.leave()}>
          Sair da sala
        </Button>
      </div>
    </Shell>
  );
}
