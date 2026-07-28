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
import {
  INITIAL_ARCADE_MACHINE_STATE,
  arcadeMachineReducer,
  type ArcadeStatus,
} from '@/arcade/arcade-machine-state';
import type { ArcadeGameResult } from '@/arcade/types';
import { calculateTicketAward, DANCE_REWARD_POLICY } from '@/arcade/reward-policy';
import {
  ARCADE_FLOORS,
  arcadeMachines,
  machineAnchorPosition,
  type ArcadeFloorId,
} from '@/lib/arcade-machines-config';
import { clearArcadePass, grantArcadePass } from '@/lib/arcade-pass';
import { useArcadePass } from '@/hooks/useArcadePass';

import { DanceMachine } from '@/components/blobbi/arcade/dance/DanceMachine';
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
 *  - **anchors** — draws each machine's configured walk-to point on the floor;
 *  - **Blobbi Dance** — the REAL machine (real chart, real judgement, real
 *    lifecycle, real claim boundary) with a FAKE `ArcadeRewardWriter` whose
 *    balance is ADDITIVE, like the real kind:31633 grant. Every claim outcome is
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
    stats: { accuracy: cleared ? 94 : 51, maxCombo: cleared ? 212 : 33 },
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
  const hasPass = useArcadePass();
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

  const danceMachine = useMemo(
    () => arcadeMachines.find((m) => m.gameId === 'blobbi-dance')!,
    [],
  );

  const [startingBalance, setStartingBalance] = useState(10);

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
      machineId: danceMachine.id,
      gameId: danceMachine.gameId,
    });
    setDanceOpen(true);
  }, [danceMachine]);

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
      const result = danceFixtureResult(
        runId,
        danceMachine.id,
        danceMachine.gameId ?? '',
        fixture,
      );

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
          gameId: danceMachine.gameId ?? '',
          machineId: danceMachine.id,
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
      danceDispatch({ type: 'open', machineId: danceMachine.id, gameId: danceMachine.gameId });
      danceDispatch({ type: 'start', runId, difficulty: 'normal' });
      danceDispatch({ type: 'countdown-complete' });
      danceDispatch({ type: 'finish', result });
      setDanceOpen(true);
    },
    [danceMachine, pubkey],
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
      // The machine's REAL game id, never a forced one. A harness that fakes a
      // game onto a coming-soon cabinet can demonstrate states the product
      // cannot reach, which is exactly the kind of false confidence it exists to
      // prevent.
      dispatch({ type: 'open', machineId: machine.id, gameId: machine.gameId });
      if (to === 'preview') {
        setNote(null);
        return;
      }

      if (machine.gameId === null) {
        setNote(
          `${machine.displayName} has no game, so the reducer refuses to start a run — ` +
            'select Dance Dance Blobbi to exercise the run states.',
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
        result: fixtureResult(runId, machine.gameId, machine.id, true),
      });
      if (to === 'claiming') dispatch({ type: 'claim' });
      if (to === 'rewarded') {
        dispatch({ type: 'claim' });
        dispatch({ type: 'claim-succeeded' });
      }
    },
    [machine],
  );

  const award = useMemo(() => {
    if (!lifecycle.result) return null;
    return calculateTicketAward(DANCE_REWARD_POLICY, lifecycle.result);
  }, [lifecycle.result]);

  return (
    <LocationProvider>
      <BlobbiAppShell screen="playing" showGameChrome inWorld>
        <FloorSwitcher floor={floor} />
        <PlayingView selectedBlobbi={FIXTURE_BLOBBI} />
        {showAnchors && <AnchorOverlay floor={floor} />}
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
          <Chip active={hasPass} onClick={() => (hasPass ? clearArcadePass() : grantArcadePass())}>
            {hasPass ? 'pass: held' : 'pass: none'}
          </Chip>
        </Section>

        <Section title="Machine">
          {arcadeMachines.map((m) => (
            <Chip key={m.id} active={m.id === machineId} onClick={() => setMachineId(m.id)}>
              {m.displayName}
            </Chip>
          ))}
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
            status={danceLifecycle.status} run={danceLifecycle.runId ?? '—'}
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
      {danceOpen && danceLifecycle.status !== 'closed' && (
        <DanceMachine
          key={remountKey}
          machine={danceMachine}
          lifecycle={danceLifecycle}
          dispatch={danceDispatch}
          onClose={() => {
            danceDispatch({ type: 'close' });
            setDanceOpen(false);
          }}
          chart={danceChart === 'valid' ? DEFAULT_DANCE_CHART : BROKEN_CHART}
          rewardWriter={devWriter}
          showDebugDetails
        />
      )}

      {/* The real shell, driven by the real reducer, with fixture content. */}
      {lifecycle.status !== 'closed' && (
        <ArcadeGameShell
          open
          onClose={() => dispatch({ type: 'close' })}
          title={machine.displayName}
          machineId={machine.id}
          gameId={machine.gameId}
          status={lifecycle.status}
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
              availability={machine.availability}
              blurb={machine.blurb}
              showControls={machine.availability === 'preview'}
            />
          )}
        </ArcadeGameShell>
      )}
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
        Phase 2 grants nothing: no inventory mutation and no publish exists.
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
