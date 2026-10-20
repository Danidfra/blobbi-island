/**
 * Where the Island's Blobbi is, behind one interface (`travel-mode.ts`), the
 * Island's wiring of the kit's World Travel protocol, after Blobbi Home's
 * `useHomeTravel`:
 *
 *   off    the default: the Blobbi is here. No session, no location read or
 *          written, nothing signed, no listener. Navigating to another world
 *          still works (`useWorldDeparture`): the page simply goes.
 *   nostr  World Travel on Nostr (M16): the Blobbi's World Location (kind
 *          31126) is the only authority for where it is, read from the relays
 *          every Blobbi world uses (`BLOBBI_WORLD_TRAVEL_RELAYS`), on any
 *          device. The protocol is the kit's (`@blobbi-kit/core` world-travel,
 *          `useWorldTravel`); this hook only wires the Island to it:
 *            - only a signed-in account has a session (the Island has no
 *              guests);
 *            - OPENING THE ISLAND IS THE PLAYER'S INTENTION TO BRING THE
 *              BLOBBI HERE (revised 2026-10-19, `world-travel-departure.ts`):
 *              once the account is signed in and the place is confirmed with
 *              the relays, an away Blobbi is moved here at once with the
 *              kit's own explicit move (`session.travel({ explicit: true })`:
 *              one signature, one event), and the sync plays its arrival.
 *              ONCE PER PAGE LOAD per Blobbi (`ArrivalIntent`, per document):
 *              never again on a re-render, a remount, a reconnect, a relay
 *              update or a focus or visibility change; a reload is a new page
 *              and may move again; a tab that already decided never reclaims
 *              the Blobbi by itself. And only while the page is FRESH: within
 *              `ARRIVAL_INTENT_TTL_MS` of its navigation start and visible
 *              (`pageIsFresh`); an old background tab shown later, or a page
 *              left signing in longer, moves nothing by itself. Already here:
 *              nothing is published. A signer that is missing, refuses or
 *              does not answer within `SIGN_PROMPT_TIMEOUT_MS`
 *              (`boundedSigner`: a late approval is dropped, never published)
 *              moves nothing; the away card's "Bring here" (an explicit
 *              `travel()`) is the retry;
 *            - LEAVING for another world through the Worlds sheet moves the
 *              Blobbi from here (`departTo`): one World Location naming the
 *              destination, signed and published by this page before it goes.
 *              The destination finds itself named and plays its arrival. This
 *              World also departs when its stream brings a move made elsewhere;
 *            - no input moves the Blobbi: a trusted press or key is activity
 *              only (`session.noteActivity`, for the optional Active Presence);
 *            - while its place is not known yet (`resolution: 'pending'`: a
 *              fresh device, the first look under way) it is neither here nor
 *              away: the actor starts absent and the Island shows "looking
 *              for it" (`view: 'looking'`); the first answer is settled,
 *              never played as a journey;
 *            - signed by the account's own signer: an nsec login signs
 *              silently, an extension or a remote signer may ask;
 *            - Active Presence (kind 21124) stays OFF: the Island's own room
 *              presence (kind 31950) is a different fact (a position inside a
 *              room, for this World's players) and the two never stand in for
 *              each other. Turning Active Presence on is a later, opt-in
 *              choice, as in the other worlds.
 *
 * Nothing else says where a Blobbi is: no cookie, no page storage of its own
 * (the kit keeps the last SIGNED location on this device, a cache of the
 * relays' answer, never a source of moves), nothing in a URL. The companion
 * choice (11125 `current_companion`) is untouched: which Blobbi it is stays
 * that tag's business; this hook follows whatever Blobbi the Island has
 * selected.
 */
import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNostr } from '@nostrify/react';
import { useNostrLogin } from '@nostrify/react/login';
import { verifyEvent } from 'nostr-tools/pure';
import {
  BLOBBI_WORLD_TRAVEL_RELAYS,
  currentWorld,
  isMeaningfulInput,
  isPlayedNow,
  knownWorld,
  registerWorld,
  storedWorldLocation,
  travelView,
  type NostrEvent,
  type ShownBlobbi,
  type TravelResolution,
  type TravelViewKind,
  type WorldTravelOptions,
  type WorldTravelSession,
  type WorldTravelSnapshot,
  type WorldTravelStore,
} from '@blobbi-kit/core';
import { poolWorldTravelRelays, useWorldTravel, useWorldTravelSync, type TravelPoolLike } from '@blobbi-kit/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';

import { isTrustedInput, travelMode, type TravelMode } from './travel-mode';
import { PRESENCE, type BlobbiPresenceController } from './useBlobbiPresence';
import { ArrivalIntent, autoArrivalDecision, boundedSigner, departTo as departFromHere, pageAgeMs, pageIsFresh, type DepartureOutcome } from './world-travel-departure';
import { WORLD_FARM, WORLD_ISLAND, WORLD_RUMBLE } from './worlds';

// This World, and the ones the kit does not know by name, for the words around a journey
registerWorld({ id: WORLD_ISLAND, name: 'Blobbi Island' });
registerWorld({ id: WORLD_FARM, name: 'Nostr Farm' });
registerWorld({ id: WORLD_RUMBLE, name: 'Blobbi Rumble' });

/**
 * This page's one decision per Blobbi: opening the Island brings it here once. Per document, not per mount, so a
 * remount of the provider (another route, a re-created tree) never asks again; a reload is a new page.
 */
let pageIntent = new ArrivalIntent();

/** Test seam: as if a new page had loaded (its one decision per Blobbi not made yet). Never called by the app. */
export function resetPageIntent(): void {
  pageIntent = new ArrivalIntent();
}

/** The page's storage for the kit's session, every access guarded (a refusing browser keeps nothing). */
const pageStore: WorldTravelStore = {
  get(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* not kept */
    }
  },
  remove(key) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* nothing kept */
    }
  },
};

/** One move per Blobbi across this browser's tabs, when the browser has Web Locks. */
function webLock(): WorldTravelOptions['lock'] {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks?.request) return undefined;
  return (name, fn) => locks.request(name, () => fn()) as ReturnType<typeof fn>;
}

const safeVerify = (e: NostrEvent) => {
  try {
    return verifyEvent(e as Parameters<typeof verifyEvent>[0]);
  } catch {
    return false;
  }
};

/** A pool the kit's relay adapter can use: one that opens a relay by url. */
function canAskRelays(nostr: unknown): nostr is TravelPoolLike {
  return !!nostr && typeof (nostr as { relay?: unknown }).relay === 'function';
}

const pageVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

export interface IslandWorldTravelOptions {
  /** The Blobbi on screen: its owner and its `d`. Null: none (signed out, none selected). */
  blobbi: { pubkey: string; d: string } | null;
  /** The Island's own presence controller for that Blobbi. */
  presence: BlobbiPresenceController | null;
  /** The Island's own moment, which a departure waits for. */
  busy: boolean;
  /** The Island drives its Blobbi itself (a trip to another world under way): the sync stands aside. */
  paused: boolean;
  onJourney?: (kind: 'enter' | 'leave', place: string) => void;
}

export interface IslandWorldTravel {
  mode: TravelMode;
  /** Where the Blobbi is: a World id such as `blobbi-pixel` (`blobbi-island` when off). */
  place: string;
  /** It belongs here now (and is not still on its way). Always true when off. */
  here: boolean;
  /** The place known (off: always; nostr: kept on this device, the relays answered, or there is no session). */
  known: boolean;
  /** What the Island shows of its place: `looking`, `here`, `away`, `coming`. */
  view: TravelViewKind;
  /** Nostr: no relay answered the first look (the kept place, or here by default, is shown); off: false. */
  unreachable: boolean;
  /**
   * How sure the place is (the kit's resolution), or `none` when no session runs for this Blobbi (off, signed out,
   * another account's Blobbi, no relays): the entry's arrival waits on it (`entry-arrival.ts`).
   */
  resolution: TravelResolution | 'none';
  /** Nostr: read the relays again now. */
  refresh(): void;
  /** A place, for the words around a journey ("Blobbi Pixel", "another Blobbi world"). */
  nameOf(place: string): string;
  /** The away card's button: the player's explicit act. */
  callHere(): void;
  /** Nostr only: try again after a failure (the same signed move when it is recent, else a new explicit request). */
  retry(): void;
  /** Nostr only: the session's snapshot (null when off or without a session). */
  snapshot: WorldTravelSnapshot | null;
  /**
   * Leaving for `destination` (a World id): move the Blobbi there from here, now (`world-travel-departure.ts`): a
   * fresh read, one World Location signed by the account (an extension may ask) and published to the travel relays.
   * Resolves with what came of it, never throws; `read-only` when nothing can move (off, no session, signed out).
   */
  departTo(destination: string): Promise<DepartureOutcome>;
  /** The account's signer may ask the player (an extension, a remote signer), so a wait for it is worth a word. */
  signerPrompts: boolean;
  /** Nostr only: a hidden element stating place, phase and presence for tests and diagnostics. */
  status: ReactNode;
}

const nameOfWorld = (place: string) => (place === WORLD_ISLAND ? 'the Island' : (knownWorld(place)?.name ?? 'another Blobbi world'));

const OFF: Omit<IslandWorldTravel, 'status' | 'refresh' | 'callHere' | 'retry' | 'departTo'> = {
  mode: 'off',
  place: WORLD_ISLAND,
  here: true,
  known: true,
  view: 'here',
  unreachable: false,
  resolution: 'none',
  nameOf: nameOfWorld,
  snapshot: null,
  signerPrompts: false,
};

export function useIslandWorldTravel(o: IslandWorldTravelOptions): IslandWorldTravel {
  const [mode] = useState(travelMode);
  // Off: the same hook with no options, so no session, no sync, no listener and nothing signed; the Blobbi is here
  const travel = useNostrTravel(mode === 'nostr' ? o : null);
  return mode === 'nostr' ? travel : { ...OFF, refresh: travel.refresh, callHere: travel.callHere, retry: travel.retry, departTo: travel.departTo, status: null };
}

function useNostrTravel(o: IslandWorldTravelOptions | null): IslandWorldTravel {
  const { nostr } = useNostr();
  const { logins } = useNostrLogin();
  const { user } = useCurrentUser();
  const login = logins[0];
  // Only the signed-in account's own Blobbi has a session
  const owner = o?.blobbi && user && login && user.pubkey === o.blobbi.pubkey ? o.blobbi.pubkey : null;
  const d = o?.blobbi?.d ?? null;

  const sessionRef = useRef<WorldTravelSession | null>(null);
  const lastInputAt = useRef<number | null>(null);
  const latest = useRef({ user, login, owner, d });
  latest.current = { user, login, owner, d };

  const relays = useMemo(() => (canAskRelays(nostr) ? poolWorldTravelRelays(nostr, BLOBBI_WORLD_TRAVEL_RELAYS, { onReconnect: () => void sessionRef.current?.refresh() }) : null), [nostr]);
  const relaysRef = useRef(relays);
  relaysRef.current = relays;
  const options = useMemo<WorldTravelOptions | null>(() => {
    if (!owner || !d || !relays) return null;
    return {
      owner,
      d,
      world: WORLD_ISLAND,
      relays,
      verify: safeVerify,
      store: pageStore,
      lock: webLock(),
      // The kit's own move (the opening's, Bring here) waits for the signer with a limit (`SIGN_PROMPT_TIMEOUT_MS`):
      // a prompt left open longer ends it as declined (the away card offers its retry), and a late approval is
      // dropped by the wrapper, so it never reaches the kit and is never published
      signer: () => {
        const { user: u, login: l, owner: own } = latest.current;
        if (!u || !l || u.pubkey !== own) return null;
        return boundedSigner({ mode: l.type === 'nsec' ? 'silent' : 'prompt', sign: (t) => u.signer.signEvent(t) as Promise<NostrEvent> });
      },
      stillAccount: () => latest.current.user?.pubkey === owner && latest.current.owner === owner,
      isActive: () => isPlayedNow({ visible: pageVisible(), lastInputAt: lastInputAt.current, now: Date.now() }),
      // The arrival's motes gather before the body forms: started that much earlier, the body forms at the
      // session's `formAt` (the departure window's end, and no sooner than MIN_TRAVEL_MS after the act)
      arrivalLeadMs: PRESENCE.arriveLeadMs,
      // The Island's room presence (31950) is its own fact; Active Presence stays off here
      presenceEnabled: false,
    };
  }, [owner, d, relays]);
  const travel = useWorldTravel(options);
  const { session } = travel;
  // The kit makes its session in an effect: until its first snapshot, a session that is coming says what it will
  // start with (the location kept on this device, or `pending`), so no render shows the Blobbi here meanwhile
  const kept = useMemo(() => (options ? storedWorldLocation(pageStore, { owner: options.owner, d: options.d, verify: safeVerify }) : null), [options]);
  const snapshot = travel.snapshot && options && travel.snapshot.owner === options.owner && travel.snapshot.d === options.d ? travel.snapshot : null;
  const coming = !!options && !snapshot;
  const view: TravelViewKind = snapshot ? travelView(snapshot).kind : coming ? (kept ? (currentWorld(kept) === WORLD_ISLAND ? 'here' : 'away') : 'looking') : 'here';
  const resolution = snapshot ? snapshot.resolution : coming ? (kept ? 'cached' : 'pending') : 'none';
  sessionRef.current = session;

  const controller = o?.presence ?? null;
  const travels = !!o?.blobbi && !!controller;
  // Not known where it is (a fresh device, a new account or Blobbi): not standing here meanwhile. Before the paint, so
  // no frame shows it here; settled with no journey (the first answer is settled too, by the sync)
  useLayoutEffect(() => {
    if (view !== 'looking' || !travels || !controller || o?.paused) return;
    if (controller.getState() !== 'absent') controller.settle('absent');
  }, [view, travels, controller, o?.paused]);
  useWorldTravelSync({
    session,
    blobbi: (): ShownBlobbi | null =>
      controller && travels
        ? { state: () => controller.getState(), enter: () => void controller.enter(), leave: () => void controller.leave(), settle: (s) => controller.settle(s) }
        : null,
    busy: o?.busy ?? false,
    paused: o ? o.paused || !travels : true,
    onJourney: o?.onJourney,
  });

  // A trusted press or key in a visible, focused page is activity (for the optional Active Presence); it never moves
  // the Blobbi
  useEffect(() => {
    if (!session) return;
    const onInput = (e: Event) => {
      const visible = pageVisible();
      let focused = visible;
      try {
        focused = document.hasFocus() || visible;
      } catch {
        /* visible is enough */
      }
      if (!isMeaningfulInput({ trusted: isTrustedInput(e), visible, focused })) return;
      lastInputAt.current = Date.now();
      session.noteActivity();
    };
    window.addEventListener('pointerdown', onInput, { capture: true, passive: true });
    window.addEventListener('keydown', onInput, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', onInput, { capture: true });
      window.removeEventListener('keydown', onInput, { capture: true });
    };
  }, [session]);

  // OPENING THE ISLAND brings an away Blobbi here, once per page and Blobbi: asked again whenever what is known
  // changes (the first look answered, a refresh) or the page is shown; decided once (`pageIntent`), before acting
  const [shown, reshow] = useState(0);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => reshow((n) => n + 1);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  const snapshotResolution = snapshot?.resolution ?? null;
  const snapshotHere = snapshot?.here ?? null;
  useEffect(() => {
    if (!options || !session || !travels || snapshotResolution === null || snapshotHere === null) return;
    const { owner: own, d: id } = options;
    // The decision counts as OPENING the world only within `ARRIVAL_INTENT_TTL_MS` of the page's navigation start
    // (`performance.now`) and while the page is visible: a background tab shown later than that, or a page left
    // signing in for longer, moves nothing by itself (Bring here remains). A reload is a new document, fresh again; a
    // back/forward-cache restore keeps the page's state, so its earlier decision stands
    const decision = autoArrivalDecision({
      consumed: pageIntent.consumed(own, id),
      fresh: pageIsFresh(pageAgeMs()),
      resolution: snapshotResolution,
      here: snapshotHere,
      visible: pageVisible(),
      signer: !!options.signer?.(),
    });
    if (decision === 'wait') return;
    pageIntent.consume(own, id);
    if (decision === 'arrive') void session.travel({ explicit: true });
  }, [options, session, travels, snapshotResolution, snapshotHere, shown]);

  const callHere = useCallback(() => void sessionRef.current?.travel({ explicit: true }), []);
  const retry = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const phase = s.snapshot().travel;
    if (phase.phase === 'failed' && phase.reason === 'unreachable') {
      void s.retry().then((out) => {
        if (out === 'stale') void s.travel({ explicit: true });
      });
    } else void s.travel({ explicit: true });
  }, []);
  const refresh = useCallback(() => void sessionRef.current?.refresh(), []);
  // Leaving for another world: the move from here to it, signed and published by this page (the origin)
  const departTo = useCallback(async (destination: string): Promise<DepartureOutcome> => {
    const s = sessionRef.current;
    const r = relaysRef.current;
    const { user: u, login: l, owner: own, d: id } = latest.current;
    if (!s || !r || !u || !l || !own || !id) return 'read-only';
    const result = await departFromHere({
      owner: own,
      d: id,
      destination,
      session: s,
      relays: r,
      signer: { mode: l.type === 'nsec' ? 'silent' : 'prompt', sign: (t) => u.signer.signEvent(t) as Promise<NostrEvent> },
      verify: safeVerify,
      lock: webLock(),
      stillAccount: () => latest.current.user?.pubkey === own && latest.current.owner === own,
    });
    return result.outcome;
  }, []);
  const signerPrompts = !!login && login.type !== 'nsec';

  const status = createElement('span', {
    hidden: true,
    'data-testid': 'world-travel-status',
    'data-travel-mode': 'nostr',
    'data-travel-session': snapshot ? 'on' : 'none',
    'data-travel-place': snapshot?.place ?? WORLD_ISLAND,
    'data-travel-here': String(snapshot ? snapshot.here : true),
    'data-travel-status': snapshot?.status ?? 'none',
    'data-travel-phase': snapshot?.travel.phase ?? 'idle',
    'data-travel-reason': snapshot?.travel.phase === 'failed' ? snapshot.travel.reason : undefined,
    'data-travel-change': snapshot ? `${snapshot.change.kind}:${snapshot.change.key}` : undefined,
    'data-travel-location': snapshot?.location?.id,
    'data-travel-resolution': resolution,
    'data-travel-view': view,
    'data-presence-status': snapshot?.presence.status ?? 'off',
    'data-presence-there': snapshot?.presence.there?.world,
  });

  return {
    mode: 'nostr',
    place: snapshot?.place ?? (kept && coming ? currentWorld(kept) : WORLD_ISLAND),
    // Not known yet: neither here nor away
    here: view === 'looking' ? false : snapshot ? snapshot.here : kept && coming ? currentWorld(kept) === WORLD_ISLAND : true,
    known: view !== 'looking',
    view,
    unreachable: resolution === 'unreachable',
    resolution,
    refresh,
    nameOf: nameOfWorld,
    callHere,
    retry,
    snapshot,
    departTo,
    signerPrompts,
    status,
  };
}
