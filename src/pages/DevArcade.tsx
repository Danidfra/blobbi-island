import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { PlayingView } from '@/components/blobbi/PlayingView';
import { BlobbiAppShell } from '@/components/shell/BlobbiAppShell';
import { LocationProvider } from '@/contexts/LocationContext';
import { useLocation } from '@/hooks/useLocation';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import type { Blobbi } from '@/hooks/useBlobbis';
import { Button } from '@/components/ui/button';

import { ArcadeGameShell } from '@/components/blobbi/arcade/ArcadeGameShell';
import { ArcadeMachinePanel } from '@/components/blobbi/arcade/ArcadeMachinePanel';
import { ArcadeCatalogueShell } from '@/components/blobbi/arcade/ArcadeCatalogue';
import { ArcadeDedicatedPreview } from '@/components/blobbi/arcade/ArcadeDedicatedPreview';
import { ElevatorModal } from '@/components/blobbi/ElevatorModal';
import { resolveNativeArcadeGame } from '@/components/blobbi/arcade/native-games';
import {
  ARCADE_AIR_HOCKEY_MACHINE_ID,
  ARCADE_CATALOGUE,
  ARCADE_POOL_MACHINE_ID,
  BLOBBI_AIR_HOCKEY_GAME_ID,
  BLOBBI_DANCE_GAME_ID,
  BLOBBI_DANCE_MACHINE_ID,
  BLOBBI_POOL_GAME_ID,
  canLaunchArcadeGame,
  getCatalogueEntry,
  sharedCabinetCatalogue,
  type ArcadeCatalogueEntry,
} from '@/arcade/catalogue';
import {
  INITIAL_ARCADE_MACHINE_STATE,
  arcadeMachineReducer,
  type ArcadeStatus,
} from '@/arcade/arcade-machine-state';
import type { ArcadeGameResult } from '@/arcade/types';
import { calculateTicketAward, getRewardPolicy } from '@/arcade/reward-policy';
import {
  ARCADE_FLOORS,
  arcadeMachines,
  machineAnchorPosition,
  type ArcadeFloorId,
} from '@/lib/arcade-machines-config';
import { clearArcadePasses, grantArcadePass } from '@/arcade/pass/arcade-pass-entitlement';
import { useArcadePass } from '@/hooks/useArcadePass';

import { DanceMachine } from '@/components/blobbi/arcade/dance/DanceMachine';
import { PoolMachine } from '@/components/blobbi/arcade/pool/PoolMachine';
import { AirHockeyMachine } from '@/components/blobbi/arcade/hockey/AirHockeyMachine';
import { PrizeCounter } from '@/components/blobbi/arcade/prizes/PrizeCounter';
import { ArcadeCosmeticRedeemAction } from '@/components/blobbi/arcade/prizes/ArcadeCosmeticRedeemAction';
import { clearRedemptions } from '@/lib/arcade-redemption-ledger';
import { ARCADE_PRIZE_COUNTER } from '@/lib/arcade-room-config';
import { HOCKEY_STAT_KEYS } from '@/arcade/hockey/hockey-result';
import { POOL_STAT_KEYS } from '@/arcade/pool/pool-result';
import { POOL_SCENARIOS, poolScenario } from '@/arcade/pool/pool-scenarios';
import { createPoolMatch, type PoolMatchState } from '@/arcade/pool/match';
import { DEFAULT_DANCE_CHART, type DanceChart } from '@/arcade/dance/chart';
import { NEON_HOP_TRACK } from '@/arcade/dance/track';
import { DANCE_REWARD_TUNING } from '@/arcade/dance/dance-reward';
import { DANCE_STAT_KEYS } from '@/arcade/dance/dance-result';
import { DANCE_JUDGMENTS } from '@/arcade/dance/judgment';
import {
  COMBO_SCALE_CLASS,
  DANCE_COMBO_TIERS,
  DANCE_LANE_VISUALS,
  comboTier,
  judgmentReadoutClass,
} from '@/components/blobbi/arcade/dance/dance-visuals';
import { DanceMascot } from '@/components/blobbi/arcade/dance/DanceMascot';
import type { ArcadeRewardWriter } from '@/arcade/arcade-reward-boundary';
import { ArcadeRewardWriterError } from '@/inventory/arcade-reward-writer';
import { claimLockKind, clearClaims, persistClaim, readClaims } from '@/lib/arcade-claim-ledger';
import { cn } from '@/lib/utils';

import { ITEM_CATALOG_QUERY_KEY, type ItemCatalog } from '@/inventory/useItemCatalog';
import {
  buildEmptyInventory,
  inventoryQueryKey,
} from '@/inventory/useIslandInventory';
import { bundledFallbackDefinition } from '@/inventory/catalog-fallback';
import { addInventoryItemQuantity } from '@/inventory/package';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';

/**
 * Development-only arcade harness — `/dev/arcade`.
 *
 * **Not a production route.** `AppRouter` registers it behind
 * `import.meta.env.DEV`, which Vite replaces with a literal `false` in a build,
 * so the whole module is dead code the bundler drops. It grants no session,
 * signs nothing, publishes nothing and reads no private data.
 *
 * It exists because the arcade's real entry path needs a Nostr key, a published
 * kind:31124 Blobbi on a live relay, a walk across Town, and — for two of the
 * three floors — twenty coins spent on a pass. Verifying that a pool table no
 * longer opens a dance game should not require any of that. The audit built a
 * throwaway version of this and deleted it; this is the real one.
 *
 * ## It mounts the REAL thing
 *
 * The real `BlobbiAppShell`, the real `PlayingView`, the real `InteractiveElements`
 * → `ArcadeRoom`, the real machines, the real movement and arrival system, the
 * real shell and the real lifecycle reducer. There is deliberately no second,
 * fake arcade here: a harness that reimplements what it tests proves nothing.
 * Only the Blobbi identity is fixture data, and only the starting location is
 * forced.
 *
 * ## What it can fake, and how
 *
 * Everything below writes to the TanStack cache or to `sessionStorage`. Nothing
 * publishes:
 *
 *  - **ticket balance** — seeds `['blobbi-inventory-31633', undefined]` directly;
 *  - **fetched vs fallback definitions** — seeds the catalog query with
 *    `source: 'definition'` or the bundled fallback, so the two render paths can
 *    be compared side by side;
 *  - **image failure** — seeds a definition whose `image` points nowhere, to
 *    exercise the emoji degradation path;
 *  - **lifecycle fixtures** — drives the real reducer through countdown, pause,
 *    abort and results without a game existing;
 *  - **the catalogue** — the REAL shared catalogue in the REAL shell, for any
 *    of the six GENERIC cabinets, with four entry sets: the shipped registry
 *    (which offers no cabinet game, and says so), one with a hypothetical
 *    future cabinet game so the card layout can be reviewed, one with a Guest
 *    Game (which must get no Play button), and one listing a game with no
 *    implementation (which must fail safely and say so). Only the first exists
 *    in the shipped registry;
 *  - **dedicated machines** — Blobbi Dance, Pool and Air Hockey opening
 *    DIRECTLY, in their real controllers on their real machine ids. None ever
 *    shows the shared catalogue, which is the thing to check here;
 *  - **overlay containment** — every surface above is portaled into the frame's
 *    stage overlay host, so what a reviewer sees is a panel inside the game
 *    window rather than one covering the browser page;
 *  - **anchors** — draws each machine's configured walk-to point on the floor;
 *  - **claims** — every dedicated machine (dance, hockey, pool) runs the REAL
 *    claim boundary with a FAKE `ArcadeRewardWriter` whose balance is ADDITIVE,
 *    like the real kind:31633 grant. Every claim outcome is
 *    reachable — confirmed, signer-refused, timed out, verified against the
 *    wrong quantity, unverifiable, and **`lagging-relay`, which reproduces the
 *    duplicate-grant defect exactly**: the publish lands and the verification
 *    read is a beat behind. The writer log shows every publish and every read,
 *    so "how many publications did that take?" is answerable at a glance. A
 *    deliberately broken chart is one chip away, and so is a forced
 *    `prefers-reduced-motion`.
 *
 * Walking the Blobbi to the dance machine in the world below opens the REAL
 * machine with the REAL writer. It still publishes nothing, because the harness
 * has no signed-in user and the claim path refuses before it sends anything.
 */

const FIXTURE_BLOBBI: Blobbi = {
  id: 'dev-arcade-blobbi',
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

const TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);

/**
 * A fixture owner for the seeded inventory. The package refuses to build an
 * inventory address for an empty pubkey, and the harness has no signed-in user —
 * so it supplies an obviously-fake one. It is never signed with, never
 * published, and never used as a query key (the key still keys off the real,
 * absent user).
 */
const FIXTURE_PUBKEY = '0'.repeat(64);

/** Monotonic, so every fixture run gets a distinct id (no clock, no randomness). */
let fixtureRunCounter = 0;

/**
 * A chart that fails validation, so the preview's error state can be seen
 * without hand-editing the shipped one.
 */
const BROKEN_CHART: DanceChart = { ...DEFAULT_DANCE_CHART, version: 99 };

/**
 * Catalogue fixtures, for the states the shipped registry cannot be in.
 *
 * The registry has no Guest Game and no broken entry, and it must not gain one
 * to make them reviewable. These are passed as the catalogue's `entries` prop —
 * the same prop, the same component, the same cards — so what is reviewed here
 * is the real presentation of a hypothetical row.
 */
type CatalogueFixture = 'real' | 'future-game' | 'with-guest' | 'unresolvable';

const CATALOGUE_FIXTURES: readonly CatalogueFixture[] = [
  'real',
  'future-game',
  'with-guest',
  'unresolvable',
];

/**
 * A hypothetical future game that a GENERIC cabinet could offer.
 *
 * The shipped registry has none — every game belongs to a dedicated machine —
 * so the card layout the catalogue is built to grow into has nothing to render
 * it with. This is that card, and it must never be added to the real registry:
 * the empty state is the honest one until a shared-cabinet game actually
 * exists.
 */
const DEV_FUTURE_CABINET_GAME: ArcadeCatalogueEntry = {
  id: 'dev-future-cabinet-game',
  title: 'Blobbi Blocks',
  shortDescription: 'Stack the falling blocks and clear a line before they reach the top.',
  category: 'island',
  availability: 'playable',
  launchMode: 'native',
  grantsTickets: false,
  controls: [{ scheme: 'keyboard', label: 'Arrow keys' }],
  estimatedDurationMs: 120_000,
  source: 'blobbi-internal',
  host: 'shared-cabinet',
};

/**
 * A Guest Game that claims to be playable.
 *
 * The important thing about this fixture is what it does NOT get: no Play
 * button, because `canLaunchArcadeGame` refuses it on CATEGORY before it ever
 * looks at `launchMode` or `availability`. It is here so that refusal can be
 * seen rather than trusted.
 */
const DEV_GUEST_ENTRY: ArcadeCatalogueEntry = {
  id: 'dev-guest-example',
  title: 'A Guest Game',
  shortDescription: 'A little game made by somebody else. Just for fun.',
  category: 'guest',
  availability: 'playable',
  launchMode: 'guest-runtime',
  grantsTickets: false,
  controls: [{ scheme: 'pointer', label: 'Tap or click' }],
  source: 'external-publisher',
  host: 'shared-cabinet',
};

/** An island game the catalogue offers and the resolver has never heard of. */
const DEV_UNRESOLVABLE_ENTRY: ArcadeCatalogueEntry = {
  id: 'dev-missing-implementation',
  title: 'A Game With No Code',
  shortDescription: 'Listed as playable, with nothing behind it. Launching must fail safely.',
  category: 'island',
  availability: 'playable',
  launchMode: 'native',
  grantsTickets: false,
  controls: [],
  source: 'blobbi-internal',
  host: 'shared-cabinet',
};

/** Every way the reward writer can behave, without a relay or a signer. */
type WriterOutcome =
  | 'confirm'
  | 'sign-refused'
  | 'timeout'
  | 'verify-mismatch'
  | 'verify-unreadable'
  | 'lagging-relay';

const WRITER_OUTCOMES: readonly WriterOutcome[] = [
  'confirm',
  'sign-refused',
  'timeout',
  'verify-mismatch',
  'verify-unreadable',
  'lagging-relay',
];

/**
 * A fake `ArcadeRewardWriter`.
 *
 * The whole point of the writer being an INTERFACE rather than a hook: every
 * branch of the claim boundary — including the two that must never be reported
 * as success — is reachable here with no key, no relay and no published event.
 */
function createDevWriter(
  outcome: WriterOutcome,
  startingBalance: number,
  log: (line: string) => void,
): ArcadeRewardWriter {
  // The balance is ADDITIVE, exactly like the real kind:31633 grant. That is
  // what makes `lagging-relay` a faithful reproduction of the manual defect:
  // the first publish really does land, and only the read is behind.
  let quantity = startingBalance;
  let reads = 0;
  let publishes = 0;
  return {
    async publishTicketGrant(claim) {
      publishes += 1;
      log(`publish #${publishes} (+${claim.tickets}) → ${outcome}`);
      if (outcome === 'sign-refused') {
        throw new ArcadeRewardWriterError('DEV: the signer refused', 'sign-failed');
      }
      if (outcome === 'timeout') {
        quantity += claim.tickets; // it landed; we just never heard back
        throw Object.assign(new Error('DEV: publish timed out'), { name: 'TimeoutError' });
      }
      quantity += claim.tickets;
      if (outcome === 'verify-mismatch') quantity -= claim.tickets - 1;
    },
    async readTicketQuantity() {
      reads += 1;
      if (outcome === 'verify-unreadable' && reads > 1) {
        log(`read #${reads} → null (read failed)`);
        return null;
      }
      // The verification read (the second one) lags a beat behind. This is the
      // ordinary relay behaviour that produced the real duplicate grant.
      const value = outcome === 'lagging-relay' && reads === 2 ? startingBalance : quantity;
      log(`read #${reads} → ${value}${value === quantity ? '' : ' (stale)'}`);
      return value;
    },
  };
}

/**
 * Dance result fixtures.
 *
 * A run is sixty-eight seconds long, and there is no way to shorten one without
 * changing the chart. Reviewing the results screen — every metric, every grade
 * band, and the zero-ticket outcome — by playing the song through each time is
 * how a results screen ends up reviewed once and never again.
 *
 * These dispatch a REAL `finish` into the REAL lifecycle reducer with a
 * hand-built result, so the screen that renders is the production one, driven by
 * the production reward policy. Nothing about the policy is faked: `dud` earns
 * nothing because `completedNaturally` is 0, which is exactly the rule the
 * policy applies to a run that was cut short.
 */
type DanceResultFixture = 'flawless' | 'decent' | 'scrappy' | 'dud';

const DANCE_RESULT_FIXTURES: readonly DanceResultFixture[] = [
  'flawless',
  'decent',
  'scrappy',
  'dud',
];

function danceFixtureResult(
  runId: string,
  machineId: string,
  gameId: string,
  fixture: DanceResultFixture,
): ArcadeGameResult {
  const shape = {
    flawless: { accuracy: 100, perfect: 110, good: 0, okay: 0, miss: 0, maxCombo: 110, score: 148_500 },
    decent: { accuracy: 79, perfect: 62, good: 31, okay: 11, miss: 6, maxCombo: 38, score: 96_400 },
    scrappy: { accuracy: 52, perfect: 21, good: 30, okay: 29, miss: 30, maxCombo: 9, score: 41_200 },
    dud: { accuracy: 33, perfect: 9, good: 14, okay: 18, miss: 69, maxCombo: 4, score: 18_050 },
  }[fixture];

  const total = shape.perfect + shape.good + shape.okay + shape.miss;
  return {
    runId,
    gameId,
    machineId,
    difficulty: 'normal',
    cleared: shape.accuracy >= 70,
    score: shape.score,
    // Fixed timestamps: a harness must be reproducible.
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_068_000,
    stats: {
      [DANCE_STAT_KEYS.accuracy]: shape.accuracy,
      [DANCE_STAT_KEYS.maxCombo]: shape.maxCombo,
      [DANCE_STAT_KEYS.perfect]: shape.perfect,
      [DANCE_STAT_KEYS.good]: shape.good,
      [DANCE_STAT_KEYS.okay]: shape.okay,
      [DANCE_STAT_KEYS.miss]: shape.miss,
      [DANCE_STAT_KEYS.totalNotes]: total,
      [DANCE_STAT_KEYS.fullCombo]: shape.miss === 0 ? 1 : 0,
      // The one field that decides eligibility. `dud` is the zero-ticket case:
      // a run that never reached the end of the song.
      [DANCE_STAT_KEYS.completedNaturally]: fixture === 'dud' ? 0 : 1,
      [DANCE_STAT_KEYS.durationMs]: 68_000,
      [DANCE_STAT_KEYS.chartVersion]: DEFAULT_DANCE_CHART.version,
    },
  };
}

/**
 * Air Hockey result fixtures — representative awards, no match needed.
 *
 * Same idea as the dance fixtures: a REAL `finish` through the REAL reducer
 * with a hand-built result, so the reward panel that renders is the production
 * one, priced by the production `HOCKEY_REWARD_POLICY`.
 */
type HockeyResultFixture = 'shutout' | 'close-win' | 'loss';

const HOCKEY_RESULT_FIXTURES: readonly HockeyResultFixture[] = ['shutout', 'close-win', 'loss'];

function hockeyFixtureResult(
  runId: string,
  machineId: string,
  gameId: string,
  fixture: HockeyResultFixture,
): ArcadeGameResult {
  const [player, opponent] = { shutout: [7, 0], 'close-win': [7, 5], loss: [3, 7] }[fixture];
  return {
    runId,
    gameId,
    machineId,
    difficulty: 'normal',
    cleared: player > opponent,
    score: player,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_150_000,
    stats: {
      [HOCKEY_STAT_KEYS.playerGoals]: player,
      [HOCKEY_STAT_KEYS.opponentGoals]: opponent,
      [HOCKEY_STAT_KEYS.goalDifference]: player - opponent,
      [HOCKEY_STAT_KEYS.targetGoals]: 7,
      [HOCKEY_STAT_KEYS.won]: player > opponent ? 1 : 0,
      [HOCKEY_STAT_KEYS.completedNaturally]: 1,
      [HOCKEY_STAT_KEYS.durationMs]: 150_000,
      [HOCKEY_STAT_KEYS.playerHits]: 24,
      [HOCKEY_STAT_KEYS.opponentHits]: 21,
      [HOCKEY_STAT_KEYS.wallBounces]: 40,
      [HOCKEY_STAT_KEYS.topPuckSpeed]: 640,
    },
  };
}

/**
 * Pool result fixtures — representative awards, no frame needed.
 *
 * `clean-win` is the 8-ticket maximum; `scrappy-win` shows the clean-frame and
 * legal-8 bonuses withheld; `loss` is the participation floor.
 */
type PoolResultFixture = 'clean-win' | 'scrappy-win' | 'loss';

const POOL_RESULT_FIXTURES: readonly PoolResultFixture[] = ['clean-win', 'scrappy-win', 'loss'];

function poolFixtureResult(
  runId: string,
  machineId: string,
  gameId: string,
  fixture: PoolResultFixture,
): ArcadeGameResult {
  const won = fixture !== 'loss';
  const clean = fixture === 'clean-win';
  return {
    runId,
    gameId,
    machineId,
    difficulty: 'normal',
    cleared: won,
    score: won ? 7 : 3,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_240_000,
    stats: {
      [POOL_STAT_KEYS.won]: won ? 1 : 0,
      [POOL_STAT_KEYS.completedNaturally]: 1,
      [POOL_STAT_KEYS.durationMs]: 240_000,
      [POOL_STAT_KEYS.playerBalls]: won ? 7 : 3,
      [POOL_STAT_KEYS.opponentBalls]: won ? 4 : 7,
      [POOL_STAT_KEYS.remainingOpponentBalls]: won ? 3 : 0,
      [POOL_STAT_KEYS.ballDifference]: won ? 3 : -4,
      [POOL_STAT_KEYS.playerShots]: 19,
      [POOL_STAT_KEYS.playerSuccessfulShots]: won ? 9 : 4,
      [POOL_STAT_KEYS.playerScratches]: clean ? 0 : 2,
      [POOL_STAT_KEYS.opponentScratches]: 1,
      [POOL_STAT_KEYS.playerFouls]: clean ? 0 : 1,
      [POOL_STAT_KEYS.longestPlayerRun]: won ? 4 : 2,
      [POOL_STAT_KEYS.earlyEightLoss]: 0,
      [POOL_STAT_KEYS.legalEightFinish]: clean ? 1 : 0,
      [POOL_STAT_KEYS.playerGroup]: 0,
    },
  };
}

/**
 * Shell-box presets for the viewport audit.
 *
 * These constrain the shell's BOX, not the viewport: CSS media queries still
 * evaluate at the real window width, so a `sm:` rule does not turn off just
 * because the box is 320 px wide. They catch overflow, cramped controls and
 * unreachable buttons at a glance; a genuine breakpoint check still needs device
 * emulation, and saying so beats a harness that quietly proves less than it
 * appears to.
 */
type ViewportPresetId = 'auto' | '320' | '375' | '390' | '768';

const VIEWPORT_PRESETS: readonly { id: ViewportPresetId; label: string; css: string }[] = [
  { id: 'auto', label: 'auto', css: '' },
  { id: '320', label: '320×568', css: 'width:320px!important;height:568px!important;' },
  { id: '375', label: '375×667', css: 'width:375px!important;height:667px!important;' },
  { id: '390', label: '390×844', css: 'width:390px!important;height:844px!important;' },
  { id: '768', label: '768×1024', css: 'width:768px!important;height:1024px!important;' },
];

const FLOOR_LOCATIONS: Record<ArcadeFloorId, 'arcade' | 'arcade-1' | 'arcade-minus1'> = {
  ground: 'arcade',
  'floor-1': 'arcade-1',
  basement: 'arcade-minus1',
};

/** A fixture result, so the results view can be exercised with no game. */
function fixtureResult(
  runId: string,
  gameId: string,
  machineId: string,
  cleared: boolean,
): ArcadeGameResult {
  return {
    runId,
    gameId,
    machineId,
    difficulty: 'normal',
    cleared,
    score: cleared ? 128_400 : 42_100,
    // Fixed timestamps: a harness must be reproducible, and the reward policy is
    // deterministic precisely so it never reads a clock.
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_090_000,
    // `completedNaturally` and `won` are the two generic eligibility stats the
    // policies read; the game-specific extras degrade gracefully when absent.
    stats: {
      accuracy: cleared ? 94 : 51,
      maxCombo: cleared ? 212 : 33,
      completedNaturally: 1,
      won: cleared ? 1 : 0,
    },
  };
}

function FloorSwitcher({ floor }: { floor: ArcadeFloorId }) {
  const { currentLocation, setCurrentLocation } = useLocation();
  const wanted = FLOOR_LOCATIONS[floor];
  useEffect(() => {
    if (currentLocation !== wanted) setCurrentLocation(wanted);
  }, [currentLocation, wanted, setCurrentLocation]);
  return null;
}

/** Overlay marking each machine's configured walk-to anchor. */
function AnchorOverlay({ floor }: { floor: ArcadeFloorId }) {
  const machines = arcadeMachines.filter((m) => m.floor === floor);
  return (
    <div className="pointer-events-none absolute inset-0 z-[900]">
      {machines.map((machine) => {
        const anchor = machineAnchorPosition(machine);
        return (
          <div
            key={machine.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${anchor.x}%`, top: `${anchor.y}%` }}
          >
            <div className="h-3 w-3 rounded-full border-2 border-white bg-fuchsia-500" />
            <span className="absolute left-4 top-0 whitespace-nowrap rounded bg-black/70 px-1 text-[9px] text-white">
              {machine.id}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function DevArcade() {
  const queryClient = useQueryClient();
  const [floor, setFloor] = useState<ArcadeFloorId>('basement');
  const [showAnchors, setShowAnchors] = useState(false);
  const [machineId, setMachineId] = useState(arcadeMachines[0].id);
  const [lifecycle, dispatch] = useReducer(arcadeMachineReducer, INITIAL_ARCADE_MACHINE_STATE);
  const { isActive: hasPass } = useArcadePass();
  /** Read-only. The harness never signs and never publishes; it needs the pubkey
   *  only because the claim ledger is keyed by owner. */
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;
  const [note, setNote] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  // ── Dance harness state ─────────────────────────────────────────────────
  const [danceOpen, setDanceOpen] = useState(false);
  const [danceChart, setDanceChart] = useState<'valid' | 'invalid'>('valid');
  const [writerOutcome, setWriterOutcome] = useState<WriterOutcome>('confirm');
  const [viewport, setViewport] = useState<ViewportPresetId>('auto');
  const [showGallery, setShowGallery] = useState(false);
  const [forceReducedMotion, setForceReducedMotion] = useState(false);
  const [remountKey, setRemountKey] = useState(0);
  const [writerLog, setWriterLog] = useState<string[]>([]);
  const [danceLifecycle, danceDispatch] = useReducer(
    arcadeMachineReducer,
    INITIAL_ARCADE_MACHINE_STATE,
  );

  /**
   * The catalogue entry the harness drives, and the cabinet it pretends the
   * player walked to.
   *
   * A cabinet no longer owns a game, so the harness picks one of each — which is
   * also what makes "the same game, launched from a different machine id" a
   * thing this panel can demonstrate.
   */
  const danceEntry = getCatalogueEntry(BLOBBI_DANCE_GAME_ID)!;
  /**
   * Blobbi Dance's machine is not a choice. It is a DEDICATED machine's game,
   * and `canLaunchArcadeGame` refuses it anywhere else — so a harness chip that
   * let you pick a cabinet would demonstrate something the product refuses to
   * do, which is the exact false confidence a harness exists to prevent.
   */
  const danceMachineId = BLOBBI_DANCE_MACHINE_ID;

  // ── Pool harness state ──────────────────────────────────────────────────
  //
  // Pool needs its own lifecycle rather than sharing the dance one: the reducer
  // holds a single run, and two machines driving one reducer would let closing
  // either of them abort the other's run.
  //
  // Reaching Pool through the ROOM means walking a Blobbi to the table, which
  // needs a signed-in pet and several seconds of animation. That is the right
  // path for a player and the wrong one for a reviewer checking a rebound angle,
  // so — exactly as with Blobbi Dance — the harness opens the real controller,
  // with the real lifecycle, on the real machine id, directly.
  const [poolOpen, setPoolOpen] = useState(false);
  const [poolLifecycle, poolDispatch] = useReducer(
    arcadeMachineReducer,
    INITIAL_ARCADE_MACHINE_STATE,
  );
  const poolEntry = getCatalogueEntry(BLOBBI_POOL_GAME_ID)!;
  /** Like the dance machine's, not a choice: `canLaunchArcadeGame` refuses it anywhere else. */
  const poolMachineId = ARCADE_POOL_MACHINE_ID;

  /**
   * The physics review scenario to open Pool with, or `null` for a real frame.
   *
   * A scenario replaces the RACK, not the game: the same controller, the same
   * lifecycle, the same rules and the same physics world — just a table laid out
   * to put one behaviour in front of a reviewer. See `pool-scenarios.ts`.
   */
  const [poolScenarioId, setPoolScenarioId] = useState<string | null>(null);

  const openPool = useCallback(
    (scenarioId: string | null = null) => {
      setPoolScenarioId(scenarioId);
      poolDispatch({ type: 'close' });
      poolDispatch({ type: 'open', machineId: poolMachineId, gameId: poolEntry.id });
      setPoolOpen(true);
    },
    [poolEntry.id, poolMachineId],
  );

  /**
   * Build the scenario's table, or `undefined` to let the game rack up normally.
   *
   * The scenario's suggested shot is deliberately NOT played automatically: the
   * point is to take it yourself and watch, and several of the fifteen are about
   * how a rebound looks rather than where a ball ends up.
   */
  const poolMatchFactory = useMemo(() => {
    if (poolScenarioId === null) return undefined;
    const scenario = poolScenario(poolScenarioId);
    if (!scenario) return undefined;
    return (): PoolMatchState => ({
      ...createPoolMatch({ difficulty: 'normal', seed: 1 }),
      balls: scenario.balls.map((b) => ({ ...b })),
      // Straight to the player's shot: a scenario is not a frame, and the
      // break-setup beat would only be in the way.
      phase: 'aiming',
      timerMs: 0,
      broken: true,
      banner: scenario.expected,
    });
  }, [poolScenarioId]);

  // ── Air Hockey harness state ────────────────────────────────────────────
  //
  // Its own lifecycle, for the same reason Pool has one: the reducer holds a
  // single run. The room reaches this table by walking a Blobbi to it; the
  // harness opens the real controller on the real machine id directly.
  const [hockeyOpen, setHockeyOpen] = useState(false);
  const [hockeyLifecycle, hockeyDispatch] = useReducer(
    arcadeMachineReducer,
    INITIAL_ARCADE_MACHINE_STATE,
  );
  const hockeyEntry = getCatalogueEntry(BLOBBI_AIR_HOCKEY_GAME_ID)!;
  /** Like the others, not a choice: `canLaunchArcadeGame` refuses it anywhere else. */
  const hockeyMachineId = ARCADE_AIR_HOCKEY_MACHINE_ID;

  const openHockey = useCallback(() => {
    hockeyDispatch({ type: 'close' });
    hockeyDispatch({ type: 'open', machineId: hockeyMachineId, gameId: hockeyEntry.id });
    setHockeyOpen(true);
  }, [hockeyEntry.id, hockeyMachineId]);

  // ── Prize Counter harness state ─────────────────────────────────────────
  //
  // Since Phase 9.5 the counter is PREVIEW-ONLY: the official six-item catalog,
  // no spend writer, no ownership store, no redemption to fake. The harness
  // only opens/closes/remounts the real component; the "Inventory / catalog
  // (cache only)" chips below drive its ticket balance and definition states.
  //
  // (`startingBalance` remains the fake DANCE reward writer's opening balance.)
  const [startingBalance, setStartingBalance] = useState(10);
  const [prizeOpen, setPrizeOpen] = useState(false);
  /** Bumped to remount the counter with clean selection/preview state. */
  const [prizeResetKey, setPrizeResetKey] = useState(0);

  // ── Catalogue harness state ─────────────────────────────────────────────
  /** Only a GENERIC cabinet can open the shared catalogue, so only those are offered. */
  const genericCabinets = useMemo(
    () => arcadeMachines.filter((m) => m.activation.type === 'shared-catalogue'),
    [],
  );
  const [catalogueMachineId, setCatalogueMachineId] = useState(genericCabinets[0].id);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  /**
   * Which dedicated coming-soon screen is open, if any.
   *
   * The REAL component the room renders, not a copy — a harness that rebuilds
   * the panel it is meant to review proves nothing about the panel.
   */
  const [dedicatedPreview, setDedicatedPreview] = useState<string | null>(null);
  /**
   * The room's three card dialogs, openable without walking anywhere.
   *
   * All three open on ARRIVAL — at the ticket counter, at the elevator — and
   * arrival needs a walk, which needs `requestAnimationFrame`. That makes their
   * LAYOUT unreviewable in any automated browser (rAF is starved there) and
   * tedious in a real one. They are also the three that regressed when the
   * arcade moved into the stage overlay host: `inFrame` supplies no padding, so
   * they lost theirs. One chip each keeps that reviewable.
   */
  const [roomModal, setRoomModal] = useState<'pass' | 'elevator' | 'no-pass' | null>(null);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [catalogueFixture, setCatalogueFixture] = useState<CatalogueFixture>('real');

  /** Which catalogue the harness shows. See {@link CATALOGUE_FIXTURES}. */
  const catalogueEntries: readonly ArcadeCatalogueEntry[] =
    catalogueFixture === 'real'
      ? ARCADE_CATALOGUE
      : catalogueFixture === 'future-game'
        ? [...ARCADE_CATALOGUE, DEV_FUTURE_CABINET_GAME]
        : catalogueFixture === 'with-guest'
          ? [...ARCADE_CATALOGUE, DEV_GUEST_ENTRY]
          : [...ARCADE_CATALOGUE, DEV_UNRESOLVABLE_ENTRY];

  /** The catalogue entry the lifecycle-fixture panel drives. */
  const [fixtureGameId, setFixtureGameId] = useState<string>(BLOBBI_DANCE_GAME_ID);
  const fixtureEntry = getCatalogueEntry(fixtureGameId) ?? danceEntry;

  const devWriter = useMemo(
    () =>
      createDevWriter(writerOutcome, startingBalance, (line) =>
        setWriterLog((l) => [...l.slice(-8), line]),
      ),
    [writerOutcome, startingBalance],
  );

  const openDance = useCallback(() => {
    setWriterLog([]);
    danceDispatch({ type: 'close' });
    danceDispatch({
      type: 'open',
      machineId: danceMachineId,
      gameId: danceEntry.id,
    });
    setDanceOpen(true);
  }, [danceEntry.id, danceMachineId]);

  /**
   * Drop the dance machine straight onto its results screen.
   *
   * A real `finish` through the real reducer, with a hand-built result — so the
   * reward panel that renders is the production one, calculated by the
   * production policy, with the fake writer still standing between it and any
   * relay.
   */
  const showDanceResult = useCallback(
    (fixture: DanceResultFixture, alreadyClaimed = false) => {
      fixtureRunCounter += 1;
      const runId = `dev-dance-${fixture}-${fixtureRunCounter}`;
      const result = danceFixtureResult(runId, danceMachineId, danceEntry.id, fixture);

      if (alreadyClaimed) {
        // Seed the durable ledger BEFORE the machine hydrates it, which is the
        // only way to reach `already-claimed` without publishing anything.
        //
        // The ledger is keyed by OWNER, so this needs the same pubkey the reward
        // hook will read with. Read-only, and it signs nothing — but it does
        // mean the state is unreachable in a signed-out browser, which the
        // harness says out loud rather than showing a chip that quietly does
        // nothing.
        if (!pubkey) {
          setNote(
            'already-claimed needs a signed-in browser: the claim ledger is keyed by owner, ' +
              'so there is no record to seed without one. Nothing was published.',
          );
          return;
        }
        persistClaim(pubkey, {
          runId,
          gameId: danceEntry.id,
          machineId: danceMachineId,
          status: 'claimed',
          tickets: 8,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
          attempts: 1,
          failure: null,
          quantityBefore: 0,
          reconcileAttempts: 0,
        });
      }

      setWriterLog([]);
      danceDispatch({ type: 'close' });
      danceDispatch({ type: 'open', machineId: danceMachineId, gameId: danceEntry.id });
      danceDispatch({ type: 'start', runId, difficulty: 'normal' });
      danceDispatch({ type: 'countdown-complete' });
      danceDispatch({ type: 'finish', result });
      setDanceOpen(true);
    },
    [danceEntry.id, danceMachineId, pubkey],
  );

  /**
   * Drop the air-hockey machine straight onto its results screen — the same
   * pattern as {@link showDanceResult}, priced by the production hockey policy,
   * with the fake writer standing between the claim and any relay.
   */
  const showHockeyResult = useCallback(
    (fixture: HockeyResultFixture) => {
      fixtureRunCounter += 1;
      const runId = `dev-hockey-${fixture}-${fixtureRunCounter}`;
      const result = hockeyFixtureResult(runId, hockeyMachineId, hockeyEntry.id, fixture);
      setWriterLog([]);
      hockeyDispatch({ type: 'close' });
      hockeyDispatch({ type: 'open', machineId: hockeyMachineId, gameId: hockeyEntry.id });
      hockeyDispatch({ type: 'start', runId, difficulty: 'normal' });
      hockeyDispatch({ type: 'countdown-complete' });
      hockeyDispatch({ type: 'finish', result });
      setHockeyOpen(true);
    },
    [hockeyEntry.id, hockeyMachineId],
  );

  /** Pool's counterpart to {@link showHockeyResult}. */
  const showPoolResult = useCallback(
    (fixture: PoolResultFixture) => {
      fixtureRunCounter += 1;
      const runId = `dev-pool-${fixture}-${fixtureRunCounter}`;
      const result = poolFixtureResult(runId, poolMachineId, poolEntry.id, fixture);
      setWriterLog([]);
      setPoolScenarioId(null);
      poolDispatch({ type: 'close' });
      poolDispatch({ type: 'open', machineId: poolMachineId, gameId: poolEntry.id });
      poolDispatch({ type: 'start', runId, difficulty: 'normal' });
      poolDispatch({ type: 'countdown-complete' });
      poolDispatch({ type: 'finish', result });
      setPoolOpen(true);
    },
    [poolEntry.id, poolMachineId],
  );

  /**
   * Force `prefers-reduced-motion` on for this tab.
   *
   * `useReducedMotion` reads `matchMedia` through `useSyncExternalStore`, and a
   * patched `matchMedia` cannot notify existing subscribers — so the harness
   * remounts the machine rather than pretending the change propagated.
   */
  const toggleReducedMotion = useCallback(() => {
    const next = !forceReducedMotion;
    setForceReducedMotion(next);
    const original = window.matchMedia.bind(window);
    window.matchMedia = ((query: string) => {
      const mql = original(query);
      if (!next || !query.includes('prefers-reduced-motion')) return mql;
      return { ...mql, matches: true, addEventListener() {}, removeEventListener() {} } as MediaQueryList;
    }) as typeof window.matchMedia;
    setRemountKey((k) => k + 1);
  }, [forceReducedMotion]);

  const machine = useMemo(
    () => arcadeMachines.find((m) => m.id === machineId)!,
    [machineId],
  );

  // ── Cache seeding (no relay, no publish) ────────────────────────────────

  const seedTickets = useCallback(
    (quantity: number) => {
      const base = buildEmptyInventory(FIXTURE_PUBKEY);
      const seeded =
        quantity > 0 ? addInventoryItemQuantity(base, TICKET_ADDRESS, quantity) : base;
      queryClient.setQueryData(inventoryQueryKey(undefined), seeded);
      setNote(`Seeded ${quantity} Arcade Ticket(s) into the local cache. Nothing published.`);
    },
    [queryClient],
  );

  const seedCatalog = useCallback(
    (mode: 'fallback' | 'fetched' | 'broken-image') => {
      const fallback = bundledFallbackDefinition(TICKET_ADDRESS);
      if (!fallback) return;

      const definition =
        mode === 'fallback'
          ? fallback
          : mode === 'fetched'
            ? { ...fallback, source: 'definition' as const, name: `${fallback.name} (fetched)` }
            : {
                ...fallback,
                source: 'definition' as const,
                image: '/assets/__does-not-exist__.png',
              };

      const catalog: ItemCatalog = {
        byAddress: new Map([[TICKET_ADDRESS, definition]]),
        fetchedCount: mode === 'fallback' ? 0 : 1,
        totalCount: 1,
        // This harness seeds the ticket alone; no cosmetic or effect item is
        // under test here.
        cosmeticsFetched: 0,
        cosmeticsTotal: 0,
        effectItemsFetched: 0,
        effectItemsTotal: 0,
      };
      queryClient.setQueryData(ITEM_CATALOG_QUERY_KEY, catalog);
      setNote(`Catalog seeded as "${mode}". Nothing published.`);
    },
    [queryClient],
  );

  // ── Lifecycle fixtures ──────────────────────────────────────────────────

  const runFixture = useCallback(
    (to: ArcadeStatus) => {
      // A FRESH run id each time. Reusing one would hit the reducer's
      // one-reward-per-run guard on the second press, which looks like a broken
      // button but is the idempotency rule doing its job.
      fixtureRunCounter += 1;
      const runId = `dev-run-${to}-${fixtureRunCounter}`;
      dispatch({ type: 'close' });
      // A REAL catalogue id, never a forced one. A harness that fakes a
      // launchable game onto a coming-soon entry can demonstrate states the
      // product cannot reach, which is exactly the kind of false confidence it
      // exists to prevent.
      // The REAL rule, with the REAL machine: a fixture that ignored it could
      // demonstrate a run on a machine the product refuses to start one on.
      const launchable = canLaunchArcadeGame({
        game: fixtureEntry,
        machineId: machine.id,
        surface: 'dedicated-machine',
      });
      dispatch({
        type: 'open',
        machineId: machine.id,
        gameId: launchable ? fixtureEntry.id : null,
      });
      if (to === 'preview') {
        setNote(null);
        return;
      }

      if (!launchable) {
        setNote(
          `${fixtureEntry.title} cannot be launched from ${machine.displayName}, so the reducer ` +
            'refuses to start a run — select Blobbi Dance and the Blobbi Dance Machine.',
        );
        return;
      }
      setNote(null);

      dispatch({ type: 'start', runId });
      if (to === 'countdown') return;

      dispatch({ type: 'countdown-complete' });
      if (to === 'playing') return;
      if (to === 'paused') {
        dispatch({ type: 'pause' });
        return;
      }
      if (to === 'aborted') {
        dispatch({ type: 'abort', reason: 'quit' });
        return;
      }

      dispatch({
        type: 'finish',
        result: fixtureResult(runId, fixtureEntry.id, machine.id, true),
      });
      if (to === 'claiming') dispatch({ type: 'claim' });
      if (to === 'rewarded') {
        dispatch({ type: 'claim' });
        dispatch({ type: 'claim-succeeded' });
      }
    },
    [machine, fixtureEntry],
  );

  const award = useMemo(() => {
    if (!lifecycle.result) return null;
    // The fixture entry decides which game's policy prices the result — all
    // three dedicated games have one now.
    const policy = getRewardPolicy(lifecycle.result.gameId);
    if (!policy) return null;
    return calculateTicketAward(policy, lifecycle.result);
  }, [lifecycle.result]);

  return (
    <LocationProvider>
      <BlobbiAppShell screen="playing" showGameChrome inWorld>
        <FloorSwitcher floor={floor} />
        <PlayingView selectedBlobbi={FIXTURE_BLOBBI} />
        {showAnchors && <AnchorOverlay floor={floor} />}

        {/*
          The harness's arcade surfaces live INSIDE the shell, exactly as the
          real room's do.

          They used to be siblings of `BlobbiAppShell`, which put them outside
          the frame's stage-overlay host — so they portaled to `document.body`
          and covered the whole browser page. That made the harness incapable of
          showing the containment it exists to verify: a panel reviewed here
          would look nothing like the one a player gets.
        */}
      {danceOpen && danceLifecycle.status !== 'closed' && (
        <DanceMachine
          key={remountKey}
          machineId={danceMachineId}
          gameId={danceEntry.id}
          title={danceEntry.title}
          lifecycle={danceLifecycle}
          dispatch={danceDispatch}
          onExit={() => {
            danceDispatch({ type: 'close' });
            setDanceOpen(false);
          }}
          exitLabel="Back to the arcade"
          exitAriaLabel="Back to the arcade room"
          chart={danceChart === 'valid' ? DEFAULT_DANCE_CHART : BROKEN_CHART}
          rewardWriter={devWriter}
          showDebugDetails
        />
      )}

      {/*
        Pool, in the real controller with the real lifecycle and the real claim
        boundary — and the FAKE writer, because Pool pays tickets now and a
        harness claim must never publish.
      */}
      {poolOpen && poolLifecycle.status !== 'closed' && (
        <PoolMachine
          key={`pool-${remountKey}`}
          machineId={poolMachineId}
          gameId={poolEntry.id}
          title={poolEntry.title}
          lifecycle={poolLifecycle}
          dispatch={poolDispatch}
          createMatchState={poolMatchFactory}
          rewardWriter={devWriter}
          onExit={() => {
            poolDispatch({ type: 'close' });
            setPoolOpen(false);
            setPoolScenarioId(null);
          }}
          exitLabel="Back to the arcade"
          exitAriaLabel="Back to the arcade room"
          showDebugDetails
        />
      )}

      {/*
        The Prize Counter, in the REAL notice shell with the REAL counter
        surface. Preview-only since Phase 9.5: it can neither spend nor grant,
        so the harness needs no fakes — seed the caches below to drive its
        ticket balance and definition states.
      */}
      {prizeOpen && (
        <ArcadeGameShell
          key={`prize-${prizeResetKey}`}
          open
          onClose={() => setPrizeOpen(false)}
          title={ARCADE_PRIZE_COUNTER.displayName}
          description={ARCADE_PRIZE_COUNTER.blurb}
          machineId={ARCADE_PRIZE_COUNTER.id}
          surface="notice"
          closeLabel="Close"
          closeAriaLabel="Close and go back to the arcade"
          contentClassName="overflow-y-auto p-0"
        >
          {/* The real counter, with the real cosmetic redemption wired in. */}
          <PrizeCounter
            redeemSlot={(resolved) => (
              <ArcadeCosmeticRedeemAction key={resolved.prize.d} resolved={resolved} />
            )}
          />
        </ArcadeGameShell>
      )}

      {/* Air Hockey, exactly as above: real controller, fake writer. */}
      {hockeyOpen && hockeyLifecycle.status !== 'closed' && (
        <AirHockeyMachine
          key={`hockey-${remountKey}`}
          machineId={hockeyMachineId}
          gameId={hockeyEntry.id}
          title={hockeyEntry.title}
          lifecycle={hockeyLifecycle}
          dispatch={hockeyDispatch}
          rewardWriter={devWriter}
          onExit={() => {
            hockeyDispatch({ type: 'close' });
            setHockeyOpen(false);
          }}
          exitLabel="Back to the arcade"
          exitAriaLabel="Back to the arcade room"
          showDebugDetails
        />
      )}

      {/*
        The REAL shared catalogue, in the REAL shell, for whichever cabinet is
        selected. Selecting Blobbi Dance here goes through the same resolver the
        room uses, with the same machine id — which is what makes "the same game
        from a different cabinet" checkable without walking anywhere.
      */}
      {/* The REAL room dialogs, in the REAL stage overlay host. */}
      {roomModal === 'elevator' && <ElevatorModal isOpen onClose={() => setRoomModal(null)} />}

      {/* The REAL dedicated coming-soon screen, for whichever table is chosen. */}
      {dedicatedPreview && (
        <ArcadeDedicatedPreview
          open
          machineId={dedicatedPreview}
          experienceId={
            (() => {
              const activation = arcadeMachines.find((m) => m.id === dedicatedPreview)?.activation;
              return activation?.type === 'dedicated-preview' ? activation.experienceId : '';
            })()
          }
          onClose={() => setDedicatedPreview(null)}
        />
      )}

      {catalogueOpen && (
        <ArcadeCatalogueShell
          open
          machineId={catalogueMachineId}
          machineName={
            arcadeMachines.find((m) => m.id === catalogueMachineId)?.displayName ?? 'Arcade Cabinet'
          }
          machineImage={arcadeMachines.find((m) => m.id === catalogueMachineId)?.src}
          entries={catalogueEntries}
          launchError={catalogueError}
          onSelect={(gameId) => {
            // Resolved against the entries being RENDERED, not the shipped
            // registry: a fixture entry is not in the registry, and looking it up
            // there would report "not in the arcade" for the one case this
            // fixture exists to show — a listed game with no implementation.
            const entry = catalogueEntries.find((e) => e.id === gameId) ?? null;
            if (!entry) {
              setCatalogueError('That game is not in the arcade.');
              return;
            }
            const request = {
              game: entry,
              machineId: catalogueMachineId,
              surface: 'shared-catalogue' as const,
            };
            if (!canLaunchArcadeGame(request) || !resolveNativeArcadeGame(request)) {
              setCatalogueError(`${entry.title} cannot be played on this cabinet.`);
              return;
            }
            setCatalogueError(null);
            setCatalogueOpen(false);
            setNote(
              `${entry.title} would launch here. No shared-cabinet game is implemented yet, so ` +
                'the harness stops at the boundary rather than mounting something that does not exist.',
            );
          }}
          onClose={() => {
            setCatalogueOpen(false);
            setCatalogueError(null);
          }}
        />
      )}

      {/* The real shell, driven by the real reducer, with fixture content. */}
      {lifecycle.status !== 'closed' && (
        <ArcadeGameShell
          open
          onClose={() => dispatch({ type: 'close' })}
          title={machine.displayName}
          machineId={machine.id}
          gameId={lifecycle.gameId}
          status={lifecycle.status}
          surface="notice"
          onPause={() => dispatch({ type: 'pause' })}
          onResume={() => dispatch({ type: 'resume' })}
        >
          {lifecycle.status === 'results' ||
          lifecycle.status === 'claiming' ||
          lifecycle.status === 'rewarded' ? (
            <ResultsFixture award={award} />
          ) : lifecycle.status === 'aborted' ? (
            <p className="text-center">
              Run aborted ({lifecycle.abortReason}). No result, so no reward is possible.
            </p>
          ) : (
            <ArcadeMachinePanel
              displayName={machine.displayName}
              blurb={`Lifecycle fixture for ${fixtureEntry.title}. Nothing here is a real run.`}
              badge="Dev fixture"
            />
          )}
        </ArcadeGameShell>
      )}
      </BlobbiAppShell>

      {/* The control panel deliberately sits OUTSIDE the world, like the shell. */}
      <aside
        className={cn(
          'fixed bottom-0 left-0 right-0 z-[1000] overflow-y-auto border-t-2 border-fuchsia-500 bg-white/95 p-3 text-xs text-black',
          panelOpen ? 'max-h-[45vh]' : 'max-h-10',
        )}
      >
        <p className="mb-2 flex items-center gap-2 font-bold">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setPanelOpen((v) => !v)}
            className="h-6 rounded-full px-2 text-[11px]"
          >
            {panelOpen ? 'hide ▾' : 'show ▴'}
          </Button>
          {/*
            Collapsible because the panel is 45 vh tall and the arcade shell it
            drives is centred — reviewing the bottom half of a game screen from
            behind the controls that opened it is not a review.
          */}
          /dev/arcade — DEV only. Nothing here publishes to a relay.
        </p>

        <Section title="Floor">
          {(Object.keys(ARCADE_FLOORS) as ArcadeFloorId[]).map((id) => (
            <Chip key={id} active={floor === id} onClick={() => setFloor(id)}>
              {id}
            </Chip>
          ))}
          <Chip active={showAnchors} onClick={() => setShowAnchors((v) => !v)}>
            anchors
          </Chip>
          {/*
            Grants the real 24h entitlement rather than a dev-only flag, so what
            you toggle here is exactly what the arcade reads. The redemption id
            is per-click: reusing one would make the second grant a no-op.
          */}
          <Chip
            active={hasPass}
            onClick={() =>
              hasPass
                ? clearArcadePasses(user?.pubkey)
                : grantArcadePass(user?.pubkey, {
                    redemptionId: `dev-${Date.now()}`,
                    nowMs: Date.now(),
                  })
            }
          >
            {hasPass ? 'pass: 24h held' : 'pass: none'}
          </Chip>
        </Section>

        <Section title="Machine">
          {arcadeMachines.map((m) => (
            <Chip key={m.id} active={m.id === machineId} onClick={() => setMachineId(m.id)}>
              {m.displayName}
            </Chip>
          ))}
        </Section>

        <Section title="Room dialogs (contained cards)">
          {(
            [
              ['pass', 'Arcade Pass'],
              ['elevator', 'Elevator'],
              ['no-pass', 'No Pass'],
            ] as const
          ).map(([id, label]) => (
            <Chip
              key={id}
              active={roomModal === id}
              onClick={() => setRoomModal((v) => (v === id ? null : id))}
            >
              {label}
            </Chip>
          ))}
          <span className="ml-2 font-mono">
            open on ARRIVAL in the room · shown here because a walk needs rAF
          </span>
        </Section>

        <Section title="Dedicated machines">
          {/*
            These are NOT cabinets. Each opens its own experience and never the
            shared catalogue — the correction this section exists to make
            visible.

            The `dedicated-preview` loop below is now empty, because every
            dedicated machine has a built game. It stays because that state is
            the one the next machine will pass through, and a harness that
            cannot show it would have to be rebuilt to review it.
          */}
          <Chip active={danceOpen} onClick={openDance}>
            Blobbi Dance (direct)
          </Chip>
          <Chip active={poolOpen && poolScenarioId === null} onClick={() => openPool(null)}>
            Pool (direct)
          </Chip>
          <Chip active={hockeyOpen} onClick={openHockey}>
            Air Hockey (direct)
          </Chip>
          {arcadeMachines
            .filter((m) => m.activation.type === 'dedicated-preview')
            .map((m) => (
              <Chip
                key={m.id}
                active={dedicatedPreview === m.id}
                onClick={() => setDedicatedPreview((v) => (v === m.id ? null : m.id))}
              >
                {m.displayName}
              </Chip>
            ))}
          <span className="ml-2 font-mono">
            dedicated={arcadeMachines.filter((m) => m.activation.type !== 'shared-catalogue').length}{' '}
            · generic={genericCabinets.length}
          </span>
        </Section>

        <Section title="Pool physics review">
          {/*
            The fifteen manual acceptance scenarios from the Planck migration.
            Each one lays the table out for one behaviour — a jaw graze, a rail
            run past a side pocket, a full break — in the REAL game, so what a
            reviewer judges is what a player gets.
          */}
          {POOL_SCENARIOS.map((scenario) => (
            <Chip
              key={scenario.id}
              active={poolOpen && poolScenarioId === scenario.id}
              onClick={() => openPool(scenario.id)}
            >
              {scenario.label}
            </Chip>
          ))}
          <span className="ml-2 font-mono">
            {poolScenarioId
              ? (poolScenario(poolScenarioId)?.expected ?? '')
              : 'sets the table up in the real game · take the shot yourself and watch'}
          </span>
        </Section>

        <Section title="Catalogue cabinet (generic only)">
          {genericCabinets.map((m) => (
            <Chip
              key={m.id}
              active={m.id === catalogueMachineId}
              onClick={() => setCatalogueMachineId(m.id)}
            >
              {m.displayName}
            </Chip>
          ))}
        </Section>

        <Section title="Catalogue">
          <Chip
            active={catalogueOpen}
            onClick={() => {
              setCatalogueError(null);
              setCatalogueOpen((v) => !v);
            }}
          >
            {catalogueOpen ? 'close catalogue' : 'open catalogue'}
          </Chip>
          {CATALOGUE_FIXTURES.map((fixture) => (
            <Chip
              key={fixture}
              active={catalogueFixture === fixture}
              onClick={() => {
                setCatalogueFixture(fixture);
                setCatalogueError(null);
              }}
            >
              {fixture}
            </Chip>
          ))}
          <span className="ml-2 font-mono">
            cabinet={catalogueMachineId} · shared games={sharedCabinetCatalogue(catalogueEntries).length}
          </span>
        </Section>

        <Section title="Lifecycle fixture">
          {(
            [
              'preview',
              'countdown',
              'playing',
              'paused',
              'aborted',
              'results',
              'claiming',
              'rewarded',
            ] as ArcadeStatus[]
          ).map((status) => (
            <Chip key={status} onClick={() => runFixture(status)}>
              {status}
            </Chip>
          ))}
          <Chip onClick={() => dispatch({ type: 'close' })}>close</Chip>
          <span className="ml-2 font-mono">
            status={lifecycle.status} run={lifecycle.runId ?? '—'}
            {award ? ` award=${award.total}` : ''}
          </span>
        </Section>

        <Section title="Lifecycle game">
          {ARCADE_CATALOGUE.map((entry) => (
            <Chip
              key={entry.id}
              active={entry.id === fixtureGameId}
              onClick={() => setFixtureGameId(entry.id)}
            >
              {entry.title}
              {entry.availability === 'playable' ? '' : ' (not playable)'}
            </Chip>
          ))}
        </Section>

        <Section title="Blobbi Dance (real game, fake writer)">
          <Chip active={danceOpen} onClick={openDance}>
            open dance machine
          </Chip>
          <Chip
            onClick={() => {
              danceDispatch({ type: 'close' });
              setDanceOpen(false);
            }}
          >
            close
          </Chip>
          <Chip
            active={danceChart === 'invalid'}
            onClick={() => setDanceChart((c) => (c === 'valid' ? 'invalid' : 'valid'))}
          >
            chart: {danceChart}
          </Chip>
          <Chip active={forceReducedMotion} onClick={toggleReducedMotion}>
            reduced motion: {forceReducedMotion ? 'on' : 'off'}
          </Chip>
          <span className="ml-2 font-mono">
            status={danceLifecycle.status} run={danceLifecycle.runId ?? '—'} machine=
            {danceLifecycle.machineId ?? '—'}
          </span>
        </Section>

        <Section title="Dance results (no run needed)">
          {DANCE_RESULT_FIXTURES.map((fixture) => (
            <Chip key={fixture} onClick={() => showDanceResult(fixture)}>
              {fixture}
              {fixture === 'dud' ? ' (0 tickets)' : ''}
            </Chip>
          ))}
          <Chip onClick={() => showDanceResult('flawless', true)}>already-claimed</Chip>
          <span className="ml-2 font-mono">
            pair with a writer outcome below to reach confirmed / failed / unresolved
          </span>
        </Section>

        <Section title="Hockey results (no run needed)">
          {HOCKEY_RESULT_FIXTURES.map((fixture) => (
            <Chip key={fixture} onClick={() => showHockeyResult(fixture)}>
              {fixture}
              {fixture === 'loss' ? ' (floor)' : fixture === 'shutout' ? ' (max)' : ''}
            </Chip>
          ))}
          <span className="ml-2 font-mono">
            priced by the production hockey policy · claims go to the fake writer
          </span>
        </Section>

        <Section title="Pool results (no run needed)">
          {POOL_RESULT_FIXTURES.map((fixture) => (
            <Chip key={fixture} onClick={() => showPoolResult(fixture)}>
              {fixture}
              {fixture === 'loss' ? ' (floor)' : fixture === 'clean-win' ? ' (max)' : ''}
            </Chip>
          ))}
          <span className="ml-2 font-mono">
            priced by the production pool policy · claims go to the fake writer
          </span>
        </Section>

        <Section title="Shell box (not the viewport)">
          {VIEWPORT_PRESETS.map((preset) => (
            <Chip
              key={preset.id}
              active={viewport === preset.id}
              onClick={() => setViewport(preset.id)}
            >
              {preset.label}
            </Chip>
          ))}
          <Chip active={showGallery} onClick={() => setShowGallery((v) => !v)}>
            presentation gallery
          </Chip>
        </Section>

        <Section title="Fake reward writer">
          {WRITER_OUTCOMES.map((outcome) => (
            <Chip
              key={outcome}
              active={writerOutcome === outcome}
              onClick={() => setWriterOutcome(outcome)}
            >
              {outcome}
            </Chip>
          ))}
          <Chip onClick={() => clearClaims()}>clear claim ledger</Chip>
          <Chip onClick={() => setStartingBalance((b) => (b === 10 ? 0 : 10))}>
            start balance: {startingBalance}
          </Chip>
          <span className="ml-2 font-mono">
            claims={Object.keys(readClaims(pubkey)).length} · cross-tab lock:{' '}
            {claimLockKind()} · max {DANCE_REWARD_TUNING.maxPerRun}/run ·{' '}
            {NEON_HOP_TRACK.title} ({Math.round(NEON_HOP_TRACK.durationMs / 1000)}s,{' '}
            {NEON_HOP_TRACK.readiness})
          </span>
        </Section>

        {writerLog.length > 0 && (
          <pre className="mb-1.5 max-h-20 overflow-y-auto rounded bg-black/5 p-1 text-[10px]">
            {writerLog.join('\n')}
          </pre>
        )}

        <Section title="Prize Counter (preview-only, official catalog)">
          <Chip active={prizeOpen} onClick={() => setPrizeOpen((v) => !v)}>
            {prizeOpen ? 'close counter' : 'open counter'}
          </Chip>
          <Chip
            onClick={() => {
              clearRedemptions();
              setPrizeResetKey((k) => k + 1);
            }}
          >
            reset counter
          </Chip>
          <span className="ml-2 font-mono">
            six official prizes · redemption disabled by design · balance and
            definitions come from the seeded caches below
          </span>
        </Section>

        <Section title="Inventory / catalog (cache only)">
          <Chip onClick={() => seedTickets(0)}>tickets: 0</Chip>
          <Chip onClick={() => seedTickets(7)}>tickets: 7</Chip>
          <Chip onClick={() => seedTickets(1234)}>tickets: 1234</Chip>
          <Chip onClick={() => seedCatalog('fallback')}>defs: bundled fallback</Chip>
          <Chip onClick={() => seedCatalog('fetched')}>defs: fetched</Chip>
          <Chip onClick={() => seedCatalog('broken-image')}>defs: broken image</Chip>
        </Section>

        {note && <p className="mt-1 text-fuchsia-700">{note}</p>}
      </aside>

      {/*
        Shell-box overrides, for eyeballing the mobile layout without resizing
        the window. They constrain the BOX only — CSS media queries still
        evaluate at the real viewport width, so genuine narrow-viewport checks
        need device emulation. Saying so beats a harness that quietly proves less
        than it appears to.
      */}
      {viewport !== 'auto' && (
        <style>{`[data-arcade-shell]{${
          VIEWPORT_PRESETS.find((p) => p.id === viewport)?.css ?? ''
        }max-width:none!important;max-height:95vh!important;}`}</style>
      )}

      {showGallery && <DancePresentationGallery reducedMotion={forceReducedMotion} />}

      {/*
        The REAL dance machine — real chart, real judgement, real lifecycle, real
        claim boundary — with a fake writer. It publishes nothing: `rewardWriter`
        replaces the only component that could.
      */}
    </LocationProvider>
  );
}

function ResultsFixture({ award }: { award: ReturnType<typeof calculateTicketAward> | null }) {
  if (!award) return <p>No result.</p>;
  return (
    <div className="mx-auto max-w-sm space-y-2 text-sm">
      <h3 className="font-bold">Reward breakdown (calculated, NOT granted)</h3>
      <ul className="space-y-1">
        {award.breakdown.map((line) => (
          <li key={line.label} className="flex justify-between gap-4">
            <span>
              {line.label}
              {line.detail ? ` (${line.detail})` : ''}
            </span>
            <span className="font-mono">{line.tickets > 0 ? `+${line.tickets}` : line.tickets}</span>
          </li>
        ))}
      </ul>
      <p className="border-t pt-2 font-bold">
        Total: {award.total} tickets{award.capped ? ' (capped)' : ''}
      </p>
      <p className="text-xs opacity-70">
        Calculated only — granting happens on the dedicated machines&rsquo; own results screens,
        through the real claim boundary and the fake writer.
      </p>
    </div>
  );
}

/**
 * Every transient piece of dance presentation, side by side and standing still.
 *
 * The playfield paints a judgement by writing `className` onto a DOM node inside
 * the frame loop, and a combo tier the same way. Those states last 420 ms and
 * arrive only when a player earns them, which makes "does Miss read clearly?"
 * and "is the top combo tier too loud?" questions nobody can answer by playing.
 *
 * This renders them from the SAME helpers the live renderer calls —
 * `judgmentReadoutClass`, `comboTier`, `DANCE_LANE_VISUALS` — so what is
 * reviewed here is what ships. It is DEV-only twice over: the whole module is
 * behind `import.meta.env.DEV`, and nothing in the arcade imports it.
 */
function DancePresentationGallery({ reducedMotion }: { reducedMotion: boolean }) {
  /**
   * The live readout ends its pop at `opacity: 0` — it is meant to vanish. That
   * makes the animated class useless for SIDE-BY-SIDE comparison, so the gallery
   * shows the settled form by default and replays the real animation on demand.
   */
  const [pop, setPop] = useState(0);
  const animated = pop > 0 && !reducedMotion;
  useEffect(() => {
    if (pop === 0) return;
    const timer = setTimeout(() => setPop(0), 700);
    return () => clearTimeout(timer);
  }, [pop]);

  return (
    <aside className="fixed left-2 top-2 z-[1001] max-h-[80vh] w-72 overflow-y-auto rounded-xl border-2 border-fuchsia-500 bg-[#15102a] p-3 text-[11px] text-white/80">
      <p className="mb-2 font-bold uppercase tracking-widest text-fuchsia-300">
        Dance presentation gallery
      </p>

      <p className="mb-1 flex items-center justify-between font-semibold">
        Judgements
        <button
          type="button"
          onClick={() => setPop((n) => n + 1)}
          className="rounded-full border border-fuchsia-400 px-2 py-0.5 text-[10px]"
        >
          replay pop
        </button>
      </p>
      <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg bg-black/30 p-2">
        {DANCE_JUDGMENTS.map((judgment) => (
          // Keyed on the replay counter so each press re-mounts and re-runs the
          // animation rather than leaving a finished one on screen.
          // The scale lives on the WRAPPER so it cannot fight the pop's own
          // transform when the animation is replayed.
          <div key={`${judgment}-${pop}`} className="flex h-8 items-center justify-center">
            <p className={cn('scale-[0.62]', judgmentReadoutClass(judgment, !animated))}>
              {judgment === 'perfect' ? 'Perfect!' : judgment === 'miss' ? 'Miss' : judgment}
            </p>
          </div>
        ))}
      </div>

      <p className="mb-1 font-semibold">Combo tiers</p>
      <div className="mb-3 grid grid-cols-5 gap-1 rounded-lg bg-black/30 p-2">
        {DANCE_COMBO_TIERS.map((tier) => (
          <div key={tier.id} className="flex h-11 items-center justify-center overflow-hidden">
            <div className={cn(COMBO_SCALE_CLASS, comboTier(tier.min).className)}>
              <span className="font-mono text-base font-black leading-none">{tier.min}</span>
              <span className="text-[7px] font-bold uppercase tracking-[0.15em]">combo</span>
            </div>
          </div>
        ))}
      </div>

      <p className="mb-1 font-semibold">Notes · receptors · touch controls</p>
      <div className="mb-3 space-y-2 rounded-lg bg-black/30 p-2">
        <div className="grid grid-cols-4 gap-1">
          {DANCE_LANE_VISUALS.map((visual) => (
            <span
              key={visual.lane}
              className={cn(
                'flex h-9 items-center justify-center rounded-xl border-2 text-lg font-black text-white',
                visual.token,
              )}
            >
              {visual.glyph}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-1">
          {DANCE_LANE_VISUALS.map((visual) => (
            <span
              key={visual.lane}
              className={cn(
                'flex h-9 items-center justify-center rounded-xl border-2 bg-white/5 text-lg font-black',
                visual.receptor,
              )}
            >
              {visual.glyph}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-1">
          {DANCE_LANE_VISUALS.map((visual) => (
            <span
              key={visual.lane}
              className={cn(
                'flex h-12 flex-col items-center justify-center rounded-xl border-2 text-xl font-black text-white',
                visual.touch,
              )}
            >
              {visual.glyph}
              <span className="text-[9px] tracking-widest opacity-80">{visual.keyCap}</span>
            </span>
          ))}
        </div>
      </div>

      <p className="mb-1 font-semibold">Mascot moods</p>
      <div className="flex items-end justify-around rounded-lg bg-black/30 p-2">
        {(['idle', 'perfect', 'good', 'miss'] as const).map((mood) => (
          <div key={mood} className="text-center">
            <DanceMascot
              // The live game sets `data-mood` imperatively; here it is set on
              // mount so all four can be compared at once.
              ref={(node) => node?.setAttribute('data-mood', mood)}
              beatMs={500}
              dancing={mood === 'idle'}
              reducedMotion={reducedMotion}
              className="mx-auto h-10 w-10"
            />
            <span className="text-[9px]">{mood}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1">
      <span className="mr-1 w-40 shrink-0 font-semibold">{title}</span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'default' : 'outline'}
      onClick={onClick}
      className="h-6 rounded-full px-2 text-[11px]"
    >
      {children}
    </Button>
  );
}

export default DevArcade;
