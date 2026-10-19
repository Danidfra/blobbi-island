/**
 * World Travel, wired once around the playing view: the Island's own Blobbi
 * presence (`useBlobbiPresence`), the arrival on entry (`entry-arrival.ts`),
 * the goodbye scene that leads to another world (`useWorldDeparture`), the
 * Nostr session that says where the Blobbi is (`useIslandWorldTravel`), and
 * the surfaces for all of them: the Worlds sheet (opened from the dock), the
 * departure card, the away card.
 *
 * The world below reads one small view (`WorldTravelContext`): how to draw
 * its Blobbi, and whether the room may publish its presence for it.
 *
 * ENTERING. The Blobbi is not standing in the room when the world opens: it
 * starts absent and arrives through the teleport, once per mount, after the
 * entry gate has decided (`entryDecision`): at once (after a beat) with World
 * Travel off or no session; on Nostr, only once the first look at the relays
 * has answered (or failed within the kit's timeout), never on a location this
 * device merely kept, and never later than `ENTRY_HOLD_MAX_MS`. A Blobbi that
 * turns out to be in another world stays absent, with the away card. While
 * the entry waits, the kit's sync stands aside (`paused`), so nothing settles
 * the Blobbi here before the gate, and the room's presence (31950) waits
 * until it has formed (`blobbiHere`).
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
import { ENTRY_BEAT_MS, ENTRY_HOLD_MAX_MS, entryArrivalEnabled, entryDecision } from './entry-arrival';
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

/** The entry: waiting for the gate, played (or skipped) once, or none (no Blobbi when the world opened). */
type Entry = 'waiting' | 'done' | 'none';

export function WorldTravelProvider({ blobbi, pubkey, busy = false, children }: WorldTravelProviderProps) {
  const reducedMotion = useReducedMotion();
  const policy = useIslandSafetyPolicy();
  const { requestEgress } = useExternalEgress();
  const canLeave = isEgressAllowed(policy, 'world-travel');
  const name = blobbi?.name || 'Your Blobbi';

  // Decided once, when the world opens (never by a re-render): with a Blobbi, it arrives; it starts absent meanwhile
  const [entry, setEntry] = useState<Entry>(() => (blobbi && entryArrivalEnabled() ? 'waiting' : 'none'));
  const heldSince = useRef(Date.now());
  const presence = useBlobbiPresence({ initial: entry === 'waiting' ? 'absent' : 'present', reducedMotion });
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
    // The entry and a trip of the Island's own drive the teleport alone while they last
    paused: entry === 'waiting' || departure.phase !== 'idle',
    onJourney: (kind, place) => {
      showGameNotice(
        kind === 'leave'
          ? { title: `${name} hopped over to ${travel.nameOf(place)}!`, description: 'It comes back when you play here.', emoji: '🌍' }
          : { title: `${name} is back!`, description: 'Welcome back to the Island.', emoji: '🏝️' },
      );
    },
  });

  // The entry gate: asked again whenever what is known changes, and at the latest when the hold runs out. The
  // decision is carried out after a beat (so the arrival lands in a drawn room), and only once: `entry` is then done
  const [, retime] = useState(0);
  const controller = presence.controller;
  const { resolution, here } = travel;
  useEffect(() => {
    if (entry !== 'waiting') return;
    const heldFor = Date.now() - heldSince.current;
    const decision = entryDecision({ resolution, here, heldFor });
    if (decision === 'wait') {
      const timer = setTimeout(() => retime((n) => n + 1), Math.max(ENTRY_HOLD_MAX_MS - heldFor, 0) + 1);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      if (decision === 'enter' && controller.getState() === 'absent') controller.enter();
      setEntry('done');
    }, ENTRY_BEAT_MS);
    return () => clearTimeout(timer);
  }, [entry, resolution, here, controller]);

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

  // The room publishes its presence for a Blobbi that is here and standing; never for one away, leaving, coming, or
  // still to arrive (an arriving Blobbi is `arriving`, not `present`, until it has formed)
  const blobbiHere = presence.state === 'present' && travel.here && departure.phase === 'idle' && entry !== 'waiting';
  const view = useMemo<WorldTravelView>(
    () => ({ presence: presence.state, journey: presence.journey, departure: departure.phase, blobbiHere, openWorlds }),
    [presence.state, presence.journey, departure.phase, blobbiHere, openWorlds],
  );

  // The away card speaks only for a Blobbi the session follows, and never over the goodbye scene or the entry's wait
  const awayCard = travel.mode === 'nostr' && blobbi && departure.phase === 'idle' && entry !== 'waiting' && (travel.view !== 'here' || travel.unreachable);
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
              needed={travel.follow?.needed}
              suspended={travel.follow?.suspended}
              unreachable={travel.unreachable}
              onRefresh={travel.refresh}
            />
          )}
        </div>
      ) : null}
    </WorldTravelContext.Provider>
  );
}
