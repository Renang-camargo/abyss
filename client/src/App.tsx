import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGame } from './state/store';
import './net/socket';
import { OceanBackground } from './components/OceanBackground';
import { Button, ConnectionOverlay, Shell, Toast } from './components/ui';
import { CharacterSelect, CreateRoom, Identity, JoinRoom, Menu, Splash } from './screens/Onboarding';
import { Lobby } from './screens/Lobby';
import { Countdown, LeaderboardScreen, QuestionScreen, RevealScreen } from './screens/Match';
import { PodiumScreen } from './screens/Podium';

/* ───────────── 12. Erros ───────────── */
function FatalScreen() {
  const fatal = useGame((s) => s.fatal)!;
  const setDepth = useGame((s) => s.setDepth);
  useEffect(() => setDepth(0.2), [setDepth]);
  return (
    <Shell className="items-center justify-center text-center">
      <div className="glass max-w-md rounded-3xl p-8">
        <h1 className="font-display text-2xl font-semibold">{fatal.title}</h1>
        <p className="mt-3 text-foam/80">{fatal.message}</p>
        <Button className="mt-6 w-full" onClick={() => useGame.setState({ fatal: null, screen: 'menu' })}>
          Voltar ao menu
        </Button>
      </div>
    </Shell>
  );
}

function useCurrentView(): [string, React.ReactNode] {
  const { screen, room, profile, fatal } = useGame();
  if (fatal && !room) return ['fatal', <FatalScreen />];
  if (room) {
    switch (room.phase) {
      case 'lobby':
        return ['lobby', <Lobby />];
      case 'starting':
        return ['starting', <Countdown />];
      case 'question':
        return [`q${room.round}`, <QuestionScreen />];
      case 'reveal':
        return [`r${room.round}`, <RevealScreen />];
      case 'leaderboard':
        return [`l${room.round}`, <LeaderboardScreen />];
      case 'finished':
        return ['podium', <PodiumScreen />];
    }
  }
  const effective = !profile && !['splash', 'character', 'identity'].includes(screen) ? 'splash' : screen;
  const map = { splash: Splash, character: CharacterSelect, identity: Identity, menu: Menu, create: CreateRoom, join: JoinRoom };
  const C = map[effective];
  return [effective, <C />];
}

export default function App() {
  useEffect(() => {
    const code = new URLSearchParams(location.search).get('sala');
    if (code && /^[A-Za-z0-9]{4,8}$/.test(code)) {
      useGame.setState({ inviteCode: code.toUpperCase() });
      history.replaceState(null, '', location.pathname);
    }
  }, []);
  const [key, view] = useCurrentView();
  return (
    <>
      <OceanBackground />
      <AnimatePresence mode="wait">
        <motion.div key={key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
          {view}
        </motion.div>
      </AnimatePresence>
      <ConnectionOverlay />
      <Toast />
    </>
  );
}
