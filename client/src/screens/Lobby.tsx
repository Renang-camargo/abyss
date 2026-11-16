import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DUPLICATE_RULES, LIMITS, type DuplicateRule } from '@abyss/shared';
import { useGame, useRoom } from '../state/store';
import { api } from '../net/socket';
import { Creature } from '../components/Creature';
import { Button, Shell } from '../components/ui';
import { Chip } from './Onboarding';

/* ───────────── 7. Lobby multiplayer ───────────── */
export function Lobby() {
  const room = useRoom();
  const me = useGame((s) => s.session?.playerId);
  const setDepth = useGame((s) => s.setDepth);
  const showToast = useGame((s) => s.showToast);
  const [copied, setCopied] = useState(false);
  useEffect(() => setDepth(0.34), [setDepth]);

  const isHost = room.hostId === me;
  const players = room.players.filter((p) => !p.left);
  const connected = players.filter((p) => p.connected).length;
  const canStart = connected >= LIMITS.MIN_PLAYERS;
  const link = `${location.origin}/?sala=${room.code}`;

  const copy = async () => {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'ABYSS', text: `Entra na minha sala do ABYSS: ${room.code}`, url: link });
      else await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* usuário cancelou */
    }
  };
  const run = async (p: Promise<{ ok: boolean; message?: string }>) => {
    const r = await p;
    if (!r.ok && 'message' in r) showToast(r.message!);
  };

  return (
    <Shell wide>
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-foam/70">Código da sala</p>
          <p className="num glow-text font-display text-5xl font-extrabold tracking-[0.22em] sm:text-6xl" aria-label={`Código ${room.code.split('').join(' ')}`}>
            {room.code}
          </p>
        </div>
        <Button variant="quiet" onClick={() => api.leave()}>
          Sair
        </Button>
      </header>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="ghost" onClick={copy} className="min-h-10 text-sm">
          {copied ? 'Convite copiado' : 'Copiar convite'}
        </Button>
      </div>

      <section className="mt-8" aria-labelledby="players-h">
        <div className="flex items-baseline justify-between">
          <h2 id="players-h" className="font-display text-lg font-semibold">
            Na água
          </h2>
          <span className="num text-foam/70">
            {players.length} de {LIMITS.MAX_PLAYERS}
          </span>
        </div>
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
          <AnimatePresence initial={false}>
            {players.map((p) => (
              <motion.li
                key={p.id}
                layout
                initial={{ opacity: 0, y: 20, scale: 0.9 }}
                animate={{ opacity: p.connected ? 1 : 0.45, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className={`relative flex flex-col items-center rounded-2xl border px-1 pt-2 pb-2 ${p.id === me ? 'border-cyan/60 bg-cyan/10' : 'border-foam/10 bg-deep/40'}`}
              >
                <Creature id={p.character} size={56} bob={p.connected} />
                <span className="mt-1 w-full truncate px-1 text-center text-[13px] font-semibold">{p.name}</span>
                <span className="text-[11px] text-foam/60">{p.isHost ? 'Anfitrião' : p.connected ? (p.id === me ? 'Você' : ' ') : 'Reconectando'}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </section>

      <section className="glass mt-8 rounded-3xl p-5" aria-labelledby="cfg-h">
        <h2 id="cfg-h" className="font-display text-lg font-semibold">
          Regras desta sala
        </h2>
        {isHost ? (
          <div className="mt-3 grid gap-5 md:grid-cols-2">
            <div>
              <p className="text-sm text-foam/70">Tempo por rodada</p>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {LIMITS.ROUND_SECONDS_OPTIONS.map((s) => (
                  <Chip key={s} on={room.settings.roundSeconds === s} onClick={() => run(api.settings({ roundSeconds: s }))}>
                    {s} s
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm text-foam/70">Respostas repetidas</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(Object.keys(DUPLICATE_RULES) as DuplicateRule[]).map((k) => (
                  <Chip key={k} small on={room.settings.duplicateRule === k} onClick={() => run(api.settings({ duplicateRule: k }))}>
                    {DUPLICATE_RULES[k].label}
                  </Chip>
                ))}
              </div>
              <p className="mt-2 text-sm text-foam/60">{DUPLICATE_RULES[room.settings.duplicateRule].description}</p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-foam/80">
            {room.settings.roundSeconds} segundos para responder. {DUPLICATE_RULES[room.settings.duplicateRule].description} Assuntos:{' '}
            {room.settings.categories.length ? room.settings.categories.join(', ') : 'todos'}.
          </p>
        )}
        <p className="mt-3 text-sm text-foam/60">{LIMITS.ROUNDS} rodadas, e todos recebem a mesma pergunta ao mesmo tempo.</p>
      </section>

      <div className="sticky bottom-0 mt-auto pt-6 pb-2">
        {isHost ? (
          <>
            <Button className="h-14 w-full text-base" disabled={!canStart} onClick={() => run(api.start())}>
              Começar o mergulho
            </Button>
            {!canStart && <p className="mt-2 text-center text-sm text-foam/70">Falta pelo menos mais uma pessoa. Mande o convite.</p>}
          </>
        ) : (
          <p className="glass rounded-2xl p-4 text-center text-foam/85">Esperando o anfitrião começar a partida.</p>
        )}
      </div>
    </Shell>
  );
}
