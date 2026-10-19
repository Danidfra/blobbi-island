import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LocationId } from '@/lib/location-types';
import { devV3Visual } from '@/lib/dev-v3-fixture';
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

/**
 * Other bodies for the same harness, chosen with `?blobbi=`: `baby` (a V1
 * baby, which floats), `v3-adult` and `v3-baby` (the dev V3 fixture), so the
 * ground shadow, the float, the walk and the facing can be checked on every
 * form without a login. The default stays the V1 adult above.
 */
const FIXTURES: Record<string, Blobbi> = {
  'v1-adult': FIXTURE_BLOBBI,
  baby: { ...FIXTURE_BLOBBI, id: 'dev-theater-baby', stage: 'baby', adultType: undefined, name: 'Dev Baby' },
  'v3-adult': { ...FIXTURE_BLOBBI, id: 'dev-theater-v3-adult', ...devV3Visual('adult'), name: 'Dev V3' },
  'v3-baby': { ...FIXTURE_BLOBBI, id: 'dev-theater-v3-baby', ...devV3Visual('baby'), name: 'Dev V3 Baby' },
};

function fixtureFromQuery(): Blobbi {
  try {
    const key = new URLSearchParams(window.location.search).get('blobbi') ?? '';
    return FIXTURES[key] ?? FIXTURE_BLOBBI;
  } catch {
    return FIXTURE_BLOBBI;
  }
}

/** The room to open in: the stage, or `?room=<location id>` (town, home, arcade, …) for a check elsewhere. */
function roomFromQuery(): LocationId {
  try {
    const room = new URLSearchParams(window.location.search).get('room');
    return (room && (ROOMS as readonly string[]).includes(room) ? room : 'stage') as LocationId;
  } catch {
    return 'stage';
  }
}
const ROOMS: readonly LocationId[] = ['stage', 'town', 'home', 'beach', 'plaza', 'arcade', 'nostr-station', 'shop', 'back-yard'];

function ForceStage({ room }: { room: LocationId }) {
  const { currentLocation, setCurrentLocation } = useLocation();
  useEffect(() => {
    if (currentLocation !== room) setCurrentLocation(room);
  }, [currentLocation, setCurrentLocation, room]);
  return null;
}

/**
 * The display draws the local companion from the owned collection, which a
 * harness with no account never fetches: seed the collection with the
 * fixture (under the signed-out key), so the real display draws the real
 * body through the real pipeline, exactly as it does for a player.
 */
function SeedCollection({ blobbi }: { blobbi: Blobbi }) {
  const queryClient = useQueryClient();
  useEffect(() => {
    queryClient.setQueryData(['blobbis', undefined], [blobbi]);
  }, [queryClient, blobbi]);
  return null;
}

export function DevTheater() {
  const [blobbi] = useState(fixtureFromQuery);
  const [room] = useState(roomFromQuery);
  return (
    <LocationProvider>
      <SeedCollection blobbi={blobbi} />
      {/* The REAL shell, not a bare div.
          The harness used to mount `PlayingView` directly, which quietly made it
          a worse reproduction than the product: the shell owns fullscreen, and a
          fullscreen bug that reset the whole world was therefore invisible here.
          `BlobbiStage` inside the shell provides the movement-blocker context
          the world needs, exactly as it does on the real route. */}
      <BlobbiAppShell screen="playing" showGameChrome inWorld>
        <ForceStage room={room} />
        <PlayingView selectedBlobbi={blobbi} />
      </BlobbiAppShell>
    </LocationProvider>
  );
}

export default DevTheater;
