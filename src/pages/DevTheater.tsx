import { useEffect } from 'react';
import { PlayingView } from '@/components/blobbi/PlayingView';
import { BlobbiAppShell } from '@/components/shell/BlobbiAppShell';
import { LocationProvider } from '@/contexts/LocationContext';
import { useLocation } from '@/hooks/useLocation';
import type { Blobbi } from '@/hooks/useBlobbis';

/**
 * Development-only harness for the theater.
 *
 * **Not a production route.** `AppRouter` registers it behind
 * `import.meta.env.DEV`, which Vite replaces with a literal `false` in a build,
 * so the whole module is dead code the bundler drops. It is not an
 * authentication bypass: it grants no session, signs nothing, publishes nothing
 * and reads no private data. It exists because the theater's real entry path
 * requires a Nostr key *and* a published kind-31124 Blobbi on a live relay, and
 * a correction pass should not depend on writing test data to a public relay to
 * see whether a curtain opens.
 *
 * What it mounts is the REAL thing: the real `PlayingView`, the real
 * `InteractiveElements` stage branch, the real seats, the real movement and
 * arrival system, the real `TheaterStage`. Only the Blobbi identity is fixture
 * data, and only the starting location is forced.
 */
const FIXTURE_BLOBBI: Blobbi = {
  id: 'dev-theater-blobbi',
  stage: 'adult',
  adultType: 'bloomi',
  generation: 1,
  hunger: 80,
  happiness: 80,
  health: 100,
  hygiene: 80,
  energy: 80,
  experience: 0,
  careStreak: 0,
  baseColor: '#f7b267',
  secondaryColor: '#f4845f',
  eyeColor: '#2b2d42',
  name: 'Dev Blobbi',
};

function ForceStage() {
  const { currentLocation, setCurrentLocation } = useLocation();
  useEffect(() => {
    if (currentLocation !== 'stage') setCurrentLocation('stage');
  }, [currentLocation, setCurrentLocation]);
  return null;
}

export function DevTheater() {
  return (
    <LocationProvider>
      {/* The REAL shell, not a bare div.
          The harness used to mount `PlayingView` directly, which quietly made it
          a worse reproduction than the product: the shell owns fullscreen, and a
          fullscreen bug that reset the whole world was therefore invisible here.
          `BlobbiStage` inside the shell provides the movement-blocker context
          the world needs, exactly as it does on the real route. */}
      <BlobbiAppShell screen="playing" showGameChrome inWorld>
        <ForceStage />
        <PlayingView selectedBlobbi={FIXTURE_BLOBBI} />
      </BlobbiAppShell>
    </LocationProvider>
  );
}

export default DevTheater;
