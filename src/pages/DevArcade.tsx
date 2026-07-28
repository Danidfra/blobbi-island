import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { PlayingView } from '@/components/blobbi/PlayingView';
import { BlobbiAppShell } from '@/components/shell/BlobbiAppShell';
import { LocationProvider } from '@/contexts/LocationContext';
import { useLocation } from '@/hooks/useLocation';
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
 *  - **anchors** — draws each machine's configured walk-to point on the floor.
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
  const [note, setNote] = useState<string | null>(null);

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
      <aside className="fixed bottom-0 left-0 right-0 z-[1000] max-h-[45vh] overflow-y-auto border-t-2 border-fuchsia-500 bg-white/95 p-3 text-xs text-black">
        <p className="mb-2 font-bold">
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
