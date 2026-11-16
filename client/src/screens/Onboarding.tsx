import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CHARACTERS, DEPTH_ZONES, DUPLICATE_RULES, LIMITS, getCharacter, type CategoryInfo, type DuplicateRule } from '@abyss/shared';
import { useGame } from '../state/store';
import { api, SERVER_URL } from '../net/socket';
import { Creature } from '../components/Creature';
import { BackButton, Button, Shell, Wordmark, ZONE_COLORS } from '../components/ui';

function useDepth(d: number) {
  const setDepth = useGame((s) => s.setDepth);
  useEffect(() => setDepth(d), [d, setDepth]);
}

/* ───────────── 1. Tela inicial ───────────── */
export function Splash() {
  useDepth(0.06);
  const go = useGame((s) => s.go);
  const profile = useGame((s) => s.profile);
  const reduced = useReducedMotion();
  const letters = 'ABYSS'.split('');
  return (
    <Shell className="items-center justify-center text-center">
      <h1 className="sr-only">ABYSS</h1>
      <div className="flex gap-[0.08em]" aria-hidden>
        {letters.map((l, i) => (
          <motion.span
            key={i}
            initial={reduced ? false : { y: -120, opacity: 0, filter: 'blur(8px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            transition={{ delay: 0.15 + i * 0.12, duration: 1.1, ease: [0.2, 0.7, 0.2, 1] }}
            className="glow-text font-display text-[17vw] leading-none font-extrabold sm:text-9xl"
          >
            {l}
          </motion.span>
        ))}
      </div>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.1, duration: 0.8 }}
        className="mt-6 max-w-sm text-lg text-balance text-foam/85"
      >
        Todo mundo pensa em tubarão. Quem pensa em peixe-ogro desce até o abismo — e leva os pontos.
      </motion.p>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.5 }} className="mt-10 w-full max-w-xs">
        <Button className="w-full text-base" onClick={() => go(profile ? 'menu' : 'character')} autoFocus>
          Mergulhar
        </Button>
      </motion.div>
    </Shell>
  );
}

/* ───────────── 2. Escolha de personagem ───────────── */
export function CharacterSelect() {
  useDepth(0.18);
  const { draftCharacter, setDraftCharacter, go, profile } = useGame();
  const c = getCharacter(draftCharacter);
  return (
    <Shell wide>
      <BackButton onClick={() => go(profile ? 'menu' : 'splash')} />
      <h1 className="mt-2 font-display text-2xl font-semibold sm:text-3xl">Escolha quem vai mergulhar</h1>
      <div className="mt-6 grid flex-1 gap-6 md:grid-cols-[1fr_320px] md:items-start">
        <div role="radiogroup" aria-label="Personagens" className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {CHARACTERS.map((ch) => {
            const sel = ch.id === draftCharacter;
            return (
              <button
                key={ch.id}
                role="radio"
                aria-checked={sel}
                onClick={() => setDraftCharacter(ch.id)}
                className={`group flex aspect-square flex-col items-center justify-center rounded-3xl border transition ${
                  sel ? 'border-cyan bg-cyan/12 shadow-[0_0_30px_-6px_#19D5E8]' : 'border-foam/10 bg-deep/40 hover:border-foam/30'
                }`}
              >
                <Creature id={ch.id} size={72} className={`transition ${sel ? 'scale-110' : 'group-hover:scale-105'}`} />
                <span className="mt-1 text-[13px] font-semibold text-foam/90">{ch.name}</span>
              </button>
            );
          })}
        </div>
        <aside className="glass sticky top-6 flex flex-col items-center rounded-3xl p-6 text-center">
          <motion.div key={c.id} initial={{ scale: 0.7, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }}>
            <Creature id={c.id} size={170} bob />
          </motion.div>
          <h2 className="mt-3 font-display text-xl font-semibold">{c.name}</h2>
          <p className="mt-1 text-foam/75">{c.trait}</p>
          <Button className="mt-6 w-full" onClick={() => go('identity')}>
            Continuar com {c.name.toLowerCase()}
          </Button>
        </aside>
      </div>
    </Shell>
  );
}

/* ───────────── 3. Identificação ───────────── */
export function Identity() {
  useDepth(0.22);
  const { draftCharacter, go, setProfile, profile } = useGame();
  const [name, setName] = useState(profile?.name ?? '');
  const confirm = (e?: React.FormEvent) => {
    e?.preventDefault();
    setProfile({ name: name.trim() || LIMITS.DEFAULT_NAME, character: draftCharacter });
    go('menu');
  };
  return (
    <Shell>
      <BackButton onClick={() => go('character')} />
      <form onSubmit={confirm} className="flex flex-1 flex-col items-center justify-center text-center">
        <Creature id={draftCharacter} size={150} bob />
        <label htmlFor="name" className="mt-6 font-display text-2xl font-semibold">
          Como devemos te chamar?
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, LIMITS.NAME_MAX))}
          placeholder={LIMITS.DEFAULT_NAME}
          autoComplete="nickname"
          autoFocus
          maxLength={LIMITS.NAME_MAX}
          className="glass mt-5 h-14 w-full max-w-sm rounded-2xl px-5 text-center text-xl font-semibold outline-none focus:border-cyan"
        />
        <p className="mt-2 text-sm text-foam/60">
          {name.trim() ? `${LIMITS.NAME_MAX - name.length} caracteres livres` : `Sem nome, você entra como ${LIMITS.DEFAULT_NAME}.`}
        </p>
        <Button type="submit" className="mt-8 w-full max-w-sm">
          Confirmar entrada
        </Button>
      </form>
    </Shell>
  );
}

/* ───────────── 4. Menu principal ───────────── */
export function Menu() {
  useDepth(0.28);
  const { profile, go, inviteCode } = useGame();
  const [busy, setBusy] = useState(false);
  const show = useGame((s) => s.showToast);
  const joinInvite = async () => {
    if (!inviteCode) return;
    setBusy(true);
    const r = await api.join(inviteCode);
    setBusy(false);
    if (!r.ok) show(r.message);
    useGame.setState({ inviteCode: null });
  };
  if (!profile) return null;
  return (
    <Shell>
      <header className="flex items-center justify-between">
        <Wordmark size="sm" />
        <button onClick={() => go('character')} className="glass flex items-center gap-2 rounded-full py-1 pr-4 pl-1" aria-label="Trocar personagem e nome">
          <Creature id={profile.character} size={36} />
          <span className="max-w-[9rem] truncate font-semibold">{profile.name}</span>
        </button>
      </header>

      {inviteCode && (
        <div className="glass mt-6 flex items-center justify-between gap-3 rounded-2xl p-4">
          <p>
            Você foi convidado para a sala <strong className="font-display tracking-widest">{inviteCode}</strong>.
          </p>
          <Button onClick={joinInvite} disabled={busy}>
            Entrar
          </Button>
        </div>
      )}

      <section className="mt-10 flex flex-col gap-3">
        <h1 className="font-display text-3xl font-semibold">Pronto para descer?</h1>
        <p className="text-foam/75">Crie uma sala e chame até 34 pessoas, ou entre com o código que alguém te passou.</p>
        <Button className="mt-4 h-14" onClick={() => go('create')}>
          Criar sala
        </Button>
        <Button variant="ghost" className="h-14" onClick={() => go('join')}>
          Entrar com código
        </Button>
      </section>

      <section className="glass mt-10 rounded-3xl p-5" aria-labelledby="como-jogar">
        <h2 id="como-jogar" className="font-display text-lg font-semibold">
          Como a profundidade vira ponto
        </h2>
        <p className="mt-1 text-sm text-foam/75">
          A cada rodada aparece uma categoria. Você tem poucos segundos para responder algo que se encaixe. Quanto menos gente costuma pensar na sua resposta, mais fundo ela desce.
        </p>
        <ol className="mt-4 space-y-1.5">
          {DEPTH_ZONES.map((z) => (
            <li key={z.tier} className="flex items-center gap-3">
              <span className="h-2.5 rounded-full" style={{ width: 14 + z.tier * 14, background: ZONE_COLORS[z.tier] }} />
              <span className="flex-1">{z.label}</span>
              <span className="hidden text-sm text-foam/60 sm:inline">{z.rarity}</span>
              <span className="num w-16 text-right font-display font-semibold">{z.points}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-foam/60">Respostas fora da categoria valem zero. Se vários jogadores repetirem a mesma resposta, ela vale menos.</p>
      </section>
    </Shell>
  );
}

/* ───────────── 5. Criar sala ───────────── */
export function CreateRoom() {
  useDepth(0.3);
  const { go, showToast } = useGame();
  const [roundSeconds, setRoundSeconds] = useState<number>(LIMITS.DEFAULT_ROUND_SECONDS);
  const [rule, setRule] = useState<DuplicateRule>('decay');
  const [cats, setCats] = useState<CategoryInfo[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`${SERVER_URL}/api/categories`)
      .then((r) => r.json())
      .then(setCats)
      .catch(() => setCats([]));
  }, []);
  const toggle = (n: string) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
  const create = async () => {
    setBusy(true);
    const r = await api.create({ roundSeconds, duplicateRule: rule, categories: picked });
    setBusy(false);
    if (!r.ok) showToast(r.message);
  };
  return (
    <Shell>
      <BackButton onClick={() => go('menu')} />
      <h1 className="mt-2 font-display text-2xl font-semibold">Nova sala</h1>

      <fieldset className="mt-6">
        <legend className="font-semibold">Tempo para responder</legend>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {LIMITS.ROUND_SECONDS_OPTIONS.map((s) => (
            <Chip key={s} on={s === roundSeconds} onClick={() => setRoundSeconds(s)}>
              {s} s
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="font-semibold">Quando duas pessoas dão a mesma resposta</legend>
        <div className="mt-2 grid gap-2">
          {(Object.keys(DUPLICATE_RULES) as DuplicateRule[]).map((k) => (
            <label
              key={k}
              className={`flex cursor-pointer gap-3 rounded-2xl border p-3 transition ${rule === k ? 'border-cyan bg-cyan/10' : 'border-foam/10 bg-deep/40'}`}
            >
              <input type="radio" name="rule" checked={rule === k} onChange={() => setRule(k)} className="mt-1 accent-cyan" />
              <span>
                <span className="block font-semibold">{DUPLICATE_RULES[k].label}</span>
                <span className="block text-sm text-foam/70">{DUPLICATE_RULES[k].description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="font-semibold">Assuntos</legend>
        <p className="text-sm text-foam/65">{picked.length ? `${picked.length} selecionados` : 'Nenhum marcado: vale tudo.'}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {cats.map((c) => (
            <Chip key={c.name} on={picked.includes(c.name)} onClick={() => toggle(c.name)} small>
              {c.name}
            </Chip>
          ))}
        </div>
      </fieldset>

      <div className="sticky bottom-0 mt-auto pt-6 pb-2">
        <Button className="h-14 w-full" onClick={create} disabled={busy}>
          {busy ? 'Criando…' : 'Criar sala'}
        </Button>
      </div>
    </Shell>
  );
}

export function Chip({ on, children, onClick, small = false }: { on: boolean; children: React.ReactNode; onClick: () => void; small?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-xl border font-semibold transition ${small ? 'px-3 py-1.5 text-sm' : 'h-11'} ${
        on ? 'border-cyan bg-cyan/15 text-foam' : 'border-foam/12 bg-deep/40 text-foam/75 hover:border-foam/30'
      }`}
    >
      {children}
    </button>
  );
}

/* ───────────── 6. Entrar em sala por código ───────────── */
export function JoinRoom() {
  useDepth(0.3);
  const { go, inviteCode } = useGame();
  const [code, setCode] = useState(inviteCode ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < LIMITS.ROOM_CODE_LENGTH) return setError(`O código tem ${LIMITS.ROOM_CODE_LENGTH} caracteres.`);
    setBusy(true);
    const r = await api.join(code);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      ref.current?.select();
    }
  };
  return (
    <Shell>
      <BackButton onClick={() => go('menu')} />
      <form onSubmit={submit} className="flex flex-1 flex-col items-center justify-center text-center">
        <label htmlFor="code" className="font-display text-2xl font-semibold">
          Código da sala
        </label>
        <p className="mt-1 text-foam/70">Peça para quem criou a sala.</p>
        <input
          ref={ref}
          id="code"
          value={code}
          onChange={(e) => {
            setError('');
            setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, LIMITS.ROOM_CODE_LENGTH));
          }}
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          aria-invalid={!!error}
          aria-describedby="code-err"
          className="glass num mt-6 h-20 w-full max-w-xs rounded-3xl text-center font-display text-4xl font-semibold tracking-[0.35em] outline-none focus:border-cyan"
        />
        <p id="code-err" role="alert" className="mt-3 min-h-6 text-coral">
          {error}
        </p>
        <Button type="submit" className="mt-4 h-14 w-full max-w-xs" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar na sala'}
        </Button>
      </form>
    </Shell>
  );
}
