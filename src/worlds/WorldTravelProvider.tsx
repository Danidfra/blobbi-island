/**
 * World Travel, wired once around the playing view: the Island's own Blobbi
 * presence (`useBlobbiPresence`), the goodbye scene that leads to another
 * world (`useWorldDeparture`), the Nostr session that says where the Blobbi
 * is (`useIslandWorldTravel`), and the surfaces for all three: the Worlds
 * sheet (opened from the dock), the departure card, the away card.
 *
 * The world below reads one small view (`WorldTravelContext`): how to draw
 * its Blobbi, and whether the room may publish its presence for it.
 *
 * The page's one way out of the Island runs through the egress boundary
 * (`requestEgress({ class: 'world-travel' })`), called only when the Blobbi
 * has finished leaving; the answer `false` (the policy refused, a bad
 * address) brings it back at once.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { DOCK_EVENTS } from '@/components/shell/dock-events';
import { useExternalEgress } from '@/external-egress';
import { useIslandSafetyPolicy } from '@/safety';
import { isEgressAllowed } from '@/external-egress';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { showGameNotice } from '@/lib/game-notices';
import type { Blobbi } from '@/hooks/useBlobbis';

import { DepartureNotice } from './DepartureNotice';
import { WorldAwayNotice } from './WorldAwayNotice';
import { WorldsModal } from './WorldsModal';
import { useBlobbiPresence } from './useBlobbiPresence';
import { useIslandWorldTravel } from './useIslandWorldTravel';
import { useWorldDeparture } from './useWorldDeparture';
import { WorldTravelContext, type WorldTravelView } from './world-travel-context';
import { worlds, type OpenWorld, type World } from './worlds';

export interface WorldTravelProviderProps {
  /** The Blobbi in the world, or null (none selected). */
  blobbi: Blobbi | null;
  /** The account the Blobbi belongs to. */
  pubkey: string | undefined;
  /** The Island's own moment, which a remote departure waits for (a minigame, a ceremony). */
  busy?: boolean;
  children: ReactNode;
}

export function WorldTravelProvider({ blobbi, pubkey, busy = false, children }: WorldTravelProviderProps) {
  const reducedMotion = useReducedMotion();
  const policy = useIslandSafetyPolicy();
  const { requestEgress } = useExternalEgress();
  const canLeave = isEgressAllowed(policy, 'world-travel');
  const name = blobbi?.name || 'Your Blobbi';

  const presence = useBlobbiPresence({ reducedMotion });
  const navigate = useCallback(
    (world: World & { url: string }) => requestEgress({ class: 'world-travel', url: world.url, label: world.name }),
    [requestEgress],
  );
  const departure = useWorldDeparture({ presence, canAct: !!blobbi, reducedMotion, navigate });
  const departing = departure.phase !== 'idle' && departure.phase !== 'failed';

  const travel = useIslandWorldTravel({
    blobbi: blobbi && pubkey ? { pubkey, d: blobbi.id } : null,
    presence: presence.controller,
    busy,
    paused: departure.phase !== 'idle',
    onJourney: (kind, place) => {
      showGameNotice(
        kind === 'leave'
          ? { title: `${name} hopped over to ${travel.nameOf(place)}!`, description: 'It comes back when you play here.', emoji: '🌍' }
          : { title: `${name} is back!`, description: 'Welcome back to the Island.', emoji: '🏝️' },
      );
    },
  });

  const [worldsOpen, setWorldsOpen] = useState(false);
  const openWorlds = useCallback(() => setWorldsOpen(true), []);
  useEffect(() => {
    const open = () => setWorldsOpen(true);
    document.addEventListener(DOCK_EVENTS.openWorlds, open);
    return () => document.removeEventListener(DOCK_EVENTS.openWorlds, open);
  }, []);

  const list = useMemo(() => worlds(), []);
  const onTravel = useCallback(
    (world: OpenWorld) => {
      if (departure.go(world)) setWorldsOpen(false);
    },
    [departure],
  );

  // The room publishes its presence for a Blobbi that is here and standing; never for one away, leaving or coming
  const blobbiHere = presence.state === 'present' && travel.here && departure.phase === 'idle';
  const view = useMemo<WorldTravelView>(
    () => ({ presence: presence.state, journey: presence.journey, departure: departure.phase, blobbiHere, openWorlds }),
    [presence.state, presence.journey, departure.phase, blobbiHere, openWorlds],
  );

  // The away card speaks only for a Blobbi the session follows, and never over the goodbye scene
  const awayCard = travel.mode === 'nostr' && blobbi && departure.phase === 'idle' && (travel.view !== 'here' || travel.unreachable);
  const departureRef = useRef(departure);
  departureRef.current = departure;

  return (
    <WorldTravelContext.Provider value={view}>
      {children}
      {travel.status}
      {blobbi && (
        <WorldsModal open={worldsOpen} onClose={() => setWorldsOpen(false)} name={name} worlds={list} canLeave={canLeave} departing={departing} onTravel={onTravel} />
      )}
      {(departure.phase !== 'idle' && departure.world) || awayCard ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 z-30 flex justify-center px-3 sm:bottom-24" data-testid="world-travel-notices">
          {departure.phase !== 'idle' && departure.world ? (
            <DepartureNotice phase={departure.phase} world={departure.world} name={name} onStay={departure.cancel} onRetry={() => void departureRef.current.retry()} />
          ) : (
            <WorldAwayNotice
              name={name}
              place={travel.place}
              view={travel.view}
              nameOf={travel.nameOf}
              onCallHere={travel.callHere}
              travel={travel.snapshot?.travel}
              playedThere={travel.snapshot?.presence.there ? true : undefined}
              onRetry={travel.retry}
              noticed={travel.follow?.count ?? 0}
              unreachable={travel.unreachable}
              onRefresh={travel.refresh}
            />
          )}
        </div>
      ) : null}
    </WorldTravelContext.Provider>
  );
}
