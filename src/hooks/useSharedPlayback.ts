/**
 * Shared playback: the React layer.
 *
 * This is the ONLY file where the protocol meets a relay and a player. Above it,
 * the theater UI calls methods and renders a {@link SharedWatchState}; below it,
 * `src/lib/shared-playback/**` is pure, framework-free decision logic.
 *
 * ```
 *   TheaterControlCard / TheaterControls / TheaterSessionPanel
 *              │  create · join · leave · end        ▲ SharedWatchState
 *              ▼                                     │
 *   useSharedPlayback ─────────────────────────────────┐   ← this file
 *              │  subscribe · publish · reconcile      │
 *              ▼                                       ▼
 *   src/lib/shared-playback/**              TheaterPlaybackController
 *   (pure protocol)                                    │
 *                                                      ▼
 *                                             MediaPlayerAdapter → YouTube
 * ```
 *
 * The UI never builds an event, parses one, compares a revision, computes drift,
 * suppresses an echo or authorizes a signer. It picks a role and presses
 * buttons.
 *
 * ## Echo suppression
 *
 * Every player action is classified, and only one of the three classes is ever
 * published:
 *
 * | origin | published? | how it is recognized |
 * | --- | --- | --- |
 * | the local user pressed a control | **yes**, when hosting | default path |
 * | a remote command is being applied | no | `suppress` counter held across the call |
 * | a drift correction is being applied | no | same counter |
 *
 * Without that, applying a remote `play` would emit a local `play`, which would
 * publish, which would arrive back, a loop that gets louder.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNostr } from '@nostrify/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import type {
  MediaRef,
  PlaybackCommand,
  TheaterPlaybackController,
  TheaterPlaybackSnapshot,
} from '@/lib/theater-playback';
import { useIslandSafetyPolicy } from '@/safety';
import { admitTheaterMedia, type ApprovedMedia } from '@/theater-media';
import {
  createSessionClient,
  errorForRejection,
  evaluateDrift,
  expectedNow,
  generateInviteCode,
  hasReachedEnd,
  HOST_AWAY_AFTER_MS,
  ingestCanonical,
  ingestCommand,
  INVITE_COLLISION_RETRIES,
  KEEPALIVE_INTERVAL_MS,
  KIND_SHARED_PLAYBACK_COMMAND,
  KIND_SHARED_PLAYBACK_SESSION,
  createEventDedupe,
  DRIFT_CHECK_INTERVAL_MS,
  normalizeInviteCode,
  parseCommandEvent,
  parseSessionEvent,
  resolveInviteCode,
  ROOM_THEATER_MAIN,
  SEEK_SETTLE_MS,
  SessionPublisher,
  sessionAddress,
  sharedWatchError,
  type SessionAction,
  type SessionClientState,
  type SharedMediaRef,
  type SharedPlaybackSession,
  type SharedWatchError,
  type UnsignedSharedEvent,
} from '@/lib/shared-playback';

const DEBUG =
  import.meta.env.MODE === 'development' &&
  typeof localStorage !== 'undefined' &&
  localStorage.getItem('blobbi-debug-watch') === '1';

function debug(message: string, detail?: unknown): void {
  if (DEBUG) console.debug(`[blobbi][watch] ${message}`, detail ?? '');
}

export type SharedWatchMode = 'local' | 'hosting' | 'joined';
export type SharedWatchConnection =
  | 'idle'
  | 'creating'
  | 'joining'
  | 'connected'
  | 'reconnecting'
  | 'error'
  | 'ended';

export interface SharedWatchState {
  mode: SharedWatchMode;
  role: 'host' | 'guest' | null;
  /** `31951:<host>:<d>`: the one identifier presence and the UI may hold. */
  sessionAddress: string | null;
  invitationCode: string | null;
  connectionState: SharedWatchConnection;
  hostPubkey: string | null;
  /** What the session says should be on screen. */
  media: SharedMediaRef | null;
  /** No canonical update for over 90 s. A hint; playback continues. */
  hostAway: boolean;
  error: SharedWatchError | null;
}

const LOCAL_STATE: SharedWatchState = {
  mode: 'local',
  role: null,
  sessionAddress: null,
  invitationCode: null,
  connectionState: 'idle',
  hostPubkey: null,
  media: null,
  hostAway: false,
  error: null,
};

/**
 * Sessions this browser tab is currently taking part in, keyed by pubkey.
 *
 * **Why a module-level map and not component state:** the session outlives the
 * component that displays it. A theater UI can be remounted for reasons that
 * have nothing to do with the session, a shell layout change, Strict Mode, a
 * re-keyed parent: and a host that lost its publisher on such a remount would
 * be permanently locked out of the session it created, while that session went
 * on existing on the relay until its 4 h expiration. Nobody could take it over
 * either: authority is the author's pubkey, so an orphaned session is simply
 * dead furniture.
 *
 * It is deliberately **in memory only**. There is no `localStorage`, so a page
 * reload is still a clean slate; this recovers from an accidental remount, not
 * from a navigation. Every intentional exit (leave, end, standing up, leaving
 * the room) deletes the entry, so nothing here can resurrect a session the user
 * chose to leave.
 */
interface ResumableSession {
  address: string;
  hostPubkey: string;
  sessionId: string;
  code: string | null;
  role: 'host' | 'guest';
}

const resumableSessions = new Map<string, ResumableSession>();

/**
 * Forget this user's session without publishing anything.
 *
 * Called when the player LEAVES THE THEATER, which is one of the two ways out of
 * a session (the other being the explicit Leave/End buttons). It is deliberately
 * a plain function rather than a hook method: by the time the location has
 * changed, the theater, and the hook with it, is already gone, so the caller
 * that knows about locations has to be able to say so from outside.
 */
export function forgetWatchSession(pubkey: string | undefined): void {
  if (pubkey) resumableSessions.delete(pubkey);
}

/** Test seam: forget every in-flight session (never used by the app). */
export function clearResumableSessionsForTests(): void {
  resumableSessions.clear();
}

export interface UseSharedPlaybackOptions {
  /** The local player's controller, or null while no player is mounted. */
  controller: TheaterPlaybackController | null;
  snapshot: TheaterPlaybackSnapshot;
  /**
   * Ask the theater to put this media on screen. Called when the SESSION says
   * the media changed, the hook cannot mount a player itself, because which
   * player exists is the theater state machine's decision.
   */
  onRequestMedia: (media: SharedMediaRef) => void;
  /**
   * The approved-media list, for the publication seam's own admission check.
   *
   * Must be the same list `TheaterStage` admits against; see `catalogRef`.
   */
  catalog?: readonly ApprovedMedia[];
}

export interface UseSharedPlaybackResult {
  shared: SharedWatchState;
  /** Start hosting, around media that is already on this screen. */
  createSession: (media: MediaRef) => Promise<void>;
  /** Join by invitation code. */
  joinSession: (code: string) => Promise<void>;
  /** Leave without ending: the local player keeps playing. */
  leaveSession: () => void;
  /** Host only: publish the terminal state, then leave. */
  endSession: () => Promise<void>;
  dismissError: () => void;
  /** Wire into `useTheaterPlayback` so local actions can be published. */
  onLocalCommand: (command: PlaybackCommand) => void;
}

/** Local player command → protocol action. Local-only controls have no mapping. */
function toSessionAction(command: PlaybackCommand): SessionAction | null {
  switch (command.type) {
    case 'play':
      return { type: 'play', position: command.position };
    case 'pause':
      return { type: 'pause', position: command.position };
    case 'seek':
      return { type: 'seek', position: command.position, reason: command.reason };
    case 'set-media':
      return { type: 'set-media', media: { provider: 'youtube', id: command.media.id } };
    case 'set-rate':
      return { type: 'set-rate', rate: command.rate, position: command.position };
    default:
      return null;
  }
}

export function useSharedPlayback({
  controller,
  snapshot,
  onRequestMedia,
  catalog,
}: UseSharedPlaybackOptions): UseSharedPlaybackResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  // Read at call time: the publication seam is a stable callback, so capturing
  // the policy would freeze it at mount.
  const policy = useIslandSafetyPolicy();
  const policyRef = useRef(policy);
  policyRef.current = policy;
  // The SAME list the theater admits against. Passing it through matters: a
  // defence-in-depth check judging by a different catalog than the primary gate
  // would refuse media the theater had already accepted.
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;

  const [shared, setShared] = useState<SharedWatchState>(LOCAL_STATE);

  // ── Refs: everything the timers and subscriptions read ───────────────────
  const clientRef = useRef<SessionClientState | null>(null);
  const publisherRef = useRef<SessionPublisher | null>(null);
  const modeRef = useRef<SharedWatchMode>('local');
  const controllerRef = useRef<TheaterPlaybackController | null>(controller);
  const snapshotRef = useRef<TheaterPlaybackSnapshot>(snapshot);
  const requestMediaRef = useRef(onRequestMedia);
  const suppressRef = useRef(0);
  const lastSeekAtRef = useRef(0);
  const dedupeRef = useRef(createEventDedupe());
  const subscriptionRef = useRef<{ close: () => void } | null>(null);
  /** Canonical state that arrived before a player existed (§9.1, §11.3). */
  const pendingApplyRef = useRef(false);

  controllerRef.current = controller;
  snapshotRef.current = snapshot;
  requestMediaRef.current = onRequestMedia;

  /**
   * The player's state as the PLAYER sees it, not as React last rendered it.
   *
   * The rendered snapshot can be a render behind, more under load, in a
   * background tab, or between two timer callbacks in the same task. Measuring
   * "drift" against a stale position turns render lag into a seek, and a seek
   * into more lag. The controller is polled every 250 ms and is the honest
   * source; the rendered snapshot is only a fallback for the moment before a
   * player exists.
   */
  const livePlayback = useCallback((): TheaterPlaybackSnapshot => {
    const ctrl = controllerRef.current;
    if (!ctrl) return snapshotRef.current;
    // Force a fresh read from the player rather than trusting the 250 ms poll:
    // a backgrounded or throttled tab can stretch that poll to seconds, and both
    // callers here: the drift check and the keepalive, would then measure, or
    // publish, a position the player left behind long ago. `tick()` only reads.
    ctrl.tick();
    return ctrl.getSnapshot();
  }, []);

  /**
   * Is there a player whose readings mean anything right now?
   *
   * Between standing up and sitting down again there is no player at all, and
   * the last rendered snapshot still *looks* usable, same phase, a frozen
   * position. Believing it freezes the session's anchor for as long as the host
   * is on their feet, and every guest gets dragged back to that moment when the
   * host sits down again. "No player" has to mean "no readings".
   */
  const hasLivePlayer = useCallback(
    () => controllerRef.current !== null && !pendingApplyRef.current,
    [],
  );

  const patch = useCallback((changes: Partial<SharedWatchState>) => {
    setShared((current) => ({ ...current, ...changes }));
  }, []);

  /**
   * Sign and publish, propagating failure.
   *
   * Deliberately NOT `useNostrPublish`: that hook swallows publish errors for
   * presence (kind 31950), which is right for a heartbeat and wrong here, a
   * canonical state whose publish failed must be retried and surfaced, not
   * reported as success.
   */
  const publish = useCallback(
    async (event: UnsignedSharedEvent): Promise<void> => {
      if (!user) throw new Error('not signed in');
      const signed = await user.signer.signEvent({
        kind: event.kind,
        content: event.content,
        tags: event.tags,
        created_at: event.created_at,
      });
      await nostr.event(signed, { signal: AbortSignal.timeout(5000) });
    },
    [nostr, user],
  );

  // ── Applying remote state to the local player ────────────────────────────

  /** Run `fn` with publication suppressed. Synchronous by contract. */
  const withoutPublishing = useCallback((fn: () => void) => {
    suppressRef.current += 1;
    try {
      fn();
    } finally {
      suppressRef.current -= 1;
    }
  }, []);

  /**
   * Bring the local player in line with the canonical state.
   *
   * `force` seeks regardless of drift, used on join, on a media change, and
   * when a command was just applied. The passive tick uses the drift bands
   * instead, so ordinary jitter never causes a seek.
   */
  const reconcile = useCallback(
    (options: { force?: boolean } = {}) => {
      const client = clientRef.current;
      const ctrl = controllerRef.current;
      const snap = livePlayback();
      if (!client?.content) return;

      // No player yet: remember that there is something to apply and do it when
      // one appears. Losing this is how a guest ends up staring at a still frame.
      if (!ctrl) {
        pendingApplyRef.current = true;
        return;
      }

      const { media, playback } = client.content;

      if (snap.media?.id !== media.id) {
        // The theater owns which player exists; ask it for the right one.
        pendingApplyRef.current = true;
        requestMediaRef.current(media);
        return;
      }

      const ready = snap.phase === 'ready' || snap.phase === 'ended';
      if (!ready) {
        pendingApplyRef.current = true;
        return;
      }
      pendingApplyRef.current = false;

      const nowMs = Date.now();
      const target = expectedNow(client, nowMs, snap.duration) ?? 0;

      if (playback.rate !== snap.rate) {
        withoutPublishing(() => ctrl.setRate(playback.rate));
      }

      const drift = Math.abs(snap.currentTime - target);
      if (options.force || drift > 2) {
        lastSeekAtRef.current = nowMs;
        withoutPublishing(() => ctrl.seek(target, 'direct'));
      }

      // A `playing` session whose playhead has run past the end is finished, not
      // a seek target: chasing it loops at the final frame.
      const finished = playback.state === 'playing' && hasReachedEnd(target, snap.duration);

      debug('reconcile', {
        rev: client.content.rev,
        state: playback.state,
        media: media.id,
        target: Number(target.toFixed(2)),
        playerAt: Number(snap.currentTime.toFixed(2)),
        playerPlaying: snap.playerPlaying,
        forced: Boolean(options.force),
        finished,
      });
      if (playback.state === 'playing' && !finished) {
        if (!snap.playerPlaying) withoutPublishing(() => ctrl.play());
      } else if (snap.playerPlaying) {
        withoutPublishing(() => ctrl.pause());
      }
    },
    [livePlayback, withoutPublishing],
  );

  // ── Event ingestion ──────────────────────────────────────────────────────

  const handleEvent = useCallback(
    (event: NostrEvent) => {
      const client = clientRef.current;
      if (!client) return;
      if (dedupeRef.current.check(event.id)) return;

      const nowSec = Math.floor(Date.now() / 1000);

      if (event.kind === KIND_SHARED_PLAYBACK_SESSION) {
        const parsed = parseSessionEvent(event, { nowSec, knownHostPubkey: client.hostPubkey });
        if (!parsed.ok) {
          debug('canonical rejected', parsed.reason);
          const error = errorForRejection(parsed.reason);
          if (error) patch({ error });
          return;
        }
        const result = ingestCanonical(client, parsed.value, Date.now());
        clientRef.current = result.state;
        if (result.ignored) return debug('canonical ignored', result.ignored);
        debug('canonical applied', {
          rev: parsed.value.content.rev,
          state: parsed.value.content.playback.state,
          position: parsed.value.content.playback.position,
          changed: result.changed,
          mediaChanged: result.mediaChanged,
          offsetMs: result.state.clockOffsetMs,
        });

        patch({
          media: result.state.content?.media ?? null,
          invitationCode: parsed.value.code,
          connectionState: result.state.ended ? 'ended' : 'connected',
          hostAway: false,
          ...(result.ended ? { error: sharedWatchError('session-closed') } : {}),
        });
        if (result.changed && modeRef.current === 'joined') {
          reconcile({ force: result.mediaChanged || result.ended });
        }
        return;
      }

      if (event.kind === KIND_SHARED_PLAYBACK_COMMAND) {
        const parsed = parseCommandEvent(event, { nowSec, expectedAddress: client.address });
        if (!parsed.ok) {
          debug('command rejected', parsed.reason);
          const error = errorForRejection(parsed.reason);
          if (error) patch({ error });
          return;
        }
        const result = ingestCommand(client, parsed.value, Date.now());
        clientRef.current = result.state;
        if (result.ignored) return debug('command ignored', `${parsed.value.command} rev ${parsed.value.rev}: ${result.ignored}`);
        debug('command applied', { command: parsed.value.command, rev: parsed.value.rev, position: parsed.value.position });

        patch({
          media: result.state.content?.media ?? null,
          hostAway: false,
          ...(result.ended
            ? { connectionState: 'ended', error: sharedWatchError('session-closed') }
            : {}),
        });
        if (modeRef.current === 'joined') reconcile({ force: true });
      }
    },
    [patch, reconcile],
  );

  // ── Relay I/O ────────────────────────────────────────────────────────────

  /** Read the newest canonical state directly, the reconnect/heal path (§8.7). */
  const requeryCanonical = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      const events = await nostr.query(
        [
          {
            kinds: [KIND_SHARED_PLAYBACK_SESSION],
            authors: [client.hostPubkey],
            '#d': [client.address.split(':')[2]],
            limit: 4,
          },
        ],
        { signal: AbortSignal.timeout(4000) },
      );
      for (const event of events) handleEvent(event);
    } catch (error) {
      debug('re-query failed', error);
    }
  }, [handleEvent, nostr]);

  const subscribe = useCallback(
    (address: string, hostPubkey: string) => {
      subscriptionRef.current?.close();
      let closed = false;

      const filters: NostrFilter[] = [
        {
          kinds: [KIND_SHARED_PLAYBACK_SESSION],
          authors: [hostPubkey],
          '#d': [address.split(':')[2]],
        },
        {
          kinds: [KIND_SHARED_PLAYBACK_COMMAND],
          '#a': [address],
          since: Math.floor(Date.now() / 1000) - 1,
        },
      ];

      const run = async () => {
        // Reconnect for as long as the session is open. Each attempt re-queries
        // the canonical state first, because anything missed while the socket
        // was down is recoverable from that one event and from nothing else.
        while (!closed) {
          try {
            const req = nostr.req(filters) as AsyncIterableIterator<unknown>;
            for await (const message of req) {
              if (closed) break;
              if (!Array.isArray(message)) continue;
              const [type, , event] = message;
              if (type === 'EVENT' && event && typeof event === 'object') {
                handleEvent(event as NostrEvent);
              } else if (type === 'CLOSED') {
                break;
              }
            }
          } catch (error) {
            if (closed) return;
            debug('subscription dropped', error);
            patch({ connectionState: 'reconnecting', error: sharedWatchError('subscribe-failed') });
          }
          if (closed) return;
          await new Promise((resolve) => setTimeout(resolve, 2000));
          if (closed) return;
          await requeryCanonical();
          patch({ connectionState: 'connected' });
        }
      };

      void run();
      subscriptionRef.current = {
        close: () => {
          closed = true;
        },
      };
    },
    [handleEvent, nostr, patch, requeryCanonical],
  );

  // ── Teardown ─────────────────────────────────────────────────────────────

  const teardown = useCallback(() => {
    subscriptionRef.current?.close();
    subscriptionRef.current = null;
    publisherRef.current?.dispose();
    publisherRef.current = null;
    clientRef.current = null;
    dedupeRef.current.reset();
    pendingApplyRef.current = false;
    modeRef.current = 'local';
  }, []);

  useEffect(() => teardown, [teardown]);

  // ── Actions ──────────────────────────────────────────────────────────────

  /** Is this code already live somewhere? Best effort, by construction. */
  const isCodeTaken = useCallback(
    async (code: string): Promise<boolean> => {
      try {
        const events = await nostr.query(
          [{ kinds: [KIND_SHARED_PLAYBACK_SESSION], '#c': [code], limit: 20 }],
          { signal: AbortSignal.timeout(3000) },
        );
        const nowSec = Math.floor(Date.now() / 1000);
        return events.some((event) => {
          const parsed = parseSessionEvent(event, { nowSec });
          return parsed.ok && parsed.value.status === 'active' && parsed.value.code === code;
        });
      } catch {
        // A relay that will not answer is not evidence of a collision.
        return false;
      }
    },
    [nostr],
  );

  /** Build the host's publisher. Shared by creating a session and resuming one. */
  const makePublisher = useCallback(
    (hostPubkey: string, sessionId: string, code: string) =>
      new SessionPublisher({
        publish,
        hostPubkey,
        sessionId,
        room: ROOM_THEATER_MAIN,
        code,
        onError: (error) => patch({ error }),
        onCommit: (content) => {
          const client = clientRef.current;
          if (!client) return;
          // Keep the host's own client state in step so the passive drift check
          // and any late joiner read the same anchor the relay holds.
          clientRef.current = {
            ...client,
            content,
            lastAppliedRev: content.rev,
            lastCanonicalAtMs: Date.now(),
          };
          patch({ media: content.media });
        },
        onRollback: () => reconcile({ force: true }),
      }),
    [patch, publish, reconcile],
  );

  const createSession = useCallback(
    async (media: MediaRef) => {
      // Creating a session publishes the media as its opening state, so it is a
      // media broadcast like any other and is admitted like one.
      if (!admitTheaterMedia(policyRef.current, media, catalogRef.current).admitted) return;
      if (!user) return patch({ error: sharedWatchError('not-signed-in') });
      if (modeRef.current !== 'local') return;

      patch({ connectionState: 'creating', error: null });

      // A code that is already live somewhere would make "join by code"
      // ambiguous for everyone, so it is checked before it is published. Two
      // hosts can still race, which is why resolution refuses to guess
      // (§13.2 (8)) rather than trusting this check.
      let code = generateInviteCode();
      for (let attempt = 0; attempt < INVITE_COLLISION_RETRIES; attempt += 1) {
        const taken = await isCodeTaken(code);
        if (!taken) break;
        code = generateInviteCode();
      }

      const sessionId = crypto.randomUUID();
      const address = sessionAddress(user.pubkey, sessionId);
      const publisher = makePublisher(user.pubkey, sessionId, code);

      const created = await publisher.create({ provider: 'youtube', id: media.id });
      if (!created) {
        publisher.dispose();
        return patch({ connectionState: 'error' });
      }

      publisherRef.current = publisher;
      clientRef.current = {
        ...createSessionClient({ address, hostPubkey: user.pubkey, role: 'host' }),
        content: created,
        lastAppliedRev: created.rev,
        lastCanonicalAtMs: Date.now(),
      };
      modeRef.current = 'hosting';
      subscribe(address, user.pubkey);

      // Remembered so an accidental remount cannot orphan a session this user
      // is the only possible author for.
      resumableSessions.set(user.pubkey, {
        address,
        hostPubkey: user.pubkey,
        sessionId,
        code,
        role: 'host',
      });

      patch({
        mode: 'hosting',
        role: 'host',
        sessionAddress: address,
        invitationCode: code,
        hostPubkey: user.pubkey,
        connectionState: 'connected',
        media: created.media,
        error: null,
      });
    },
    [isCodeTaken, makePublisher, patch, subscribe, user],
  );

  const joinSession = useCallback(
    async (rawCode: string) => {
      if (!user) return patch({ error: sharedWatchError('not-signed-in') });
      if (modeRef.current !== 'local') return;

      const code = normalizeInviteCode(rawCode);
      if (!code) return patch({ error: sharedWatchError('invalid-invitation'), connectionState: 'idle' });

      patch({ connectionState: 'joining', error: null });

      let candidates: SharedPlaybackSession[] = [];
      try {
        const events = await nostr.query(
          [
            {
              kinds: [KIND_SHARED_PLAYBACK_SESSION],
              '#c': [code],
              '#r': [ROOM_THEATER_MAIN],
              limit: 20,
            },
          ],
          { signal: AbortSignal.timeout(5000) },
        );
        const nowSec = Math.floor(Date.now() / 1000);
        candidates = events
          .map((event) => parseSessionEvent(event, { nowSec }))
          .flatMap((result) => (result.ok ? [result.value] : []));
      } catch (error) {
        debug('join query failed', error);
        return patch({ connectionState: 'error', error: sharedWatchError('subscribe-failed') });
      }

      const resolution = resolveInviteCode(candidates, code, Date.now());
      if (resolution.type === 'none') {
        return patch({ connectionState: 'idle', error: sharedWatchError('session-not-found') });
      }
      if (resolution.type === 'ambiguous') {
        return patch({ connectionState: 'idle', error: sharedWatchError('session-ambiguous') });
      }

      const session = resolution.session;
      clientRef.current = createSessionClient({
        address: session.address,
        hostPubkey: session.hostPubkey,
        role: 'guest',
      });
      const ingested = ingestCanonical(clientRef.current, session, Date.now());
      clientRef.current = ingested.state;
      modeRef.current = 'joined';
      dedupeRef.current.check(session.eventId);

      patch({
        mode: 'joined',
        role: 'guest',
        sessionAddress: session.address,
        invitationCode: session.code,
        hostPubkey: session.hostPubkey,
        connectionState: 'connected',
        media: session.content.media,
        hostAway: false,
        error: null,
      });

      resumableSessions.set(user.pubkey, {
        address: session.address,
        hostPubkey: session.hostPubkey,
        sessionId: session.sessionId,
        code: session.code,
        role: 'guest',
      });

      subscribe(session.address, session.hostPubkey);
      // Cue the media first; the position is applied as soon as a player exists.
      requestMediaRef.current(session.content.media);
      reconcile({ force: true });
    },
    [nostr, patch, reconcile, subscribe, user],
  );

  /**
   * Re-attach to a session this tab is already in, after the UI was remounted.
   *
   * Everything is rebuilt from the relay's own latest canonical event; never
   * from remembered playback state, so a resumed host continues the revision
   * count the relay actually holds, and a resumed guest reconstructs exactly as
   * a fresh joiner would.
   */
  const resumeSession = useCallback(
    async (record: ResumableSession) => {
      if (modeRef.current !== 'local') return;
      try {
        const events = await nostr.query(
          [
            {
              kinds: [KIND_SHARED_PLAYBACK_SESSION],
              authors: [record.hostPubkey],
              '#d': [record.sessionId],
              limit: 4,
            },
          ],
          { signal: AbortSignal.timeout(5000) },
        );
        const nowSec = Math.floor(Date.now() / 1000);
        const sessions = events
          .map((event) => parseSessionEvent(event, { nowSec, knownHostPubkey: record.hostPubkey }))
          .flatMap((result) => (result.ok ? [result.value] : []))
          .filter((session) => session.address === record.address)
          .sort((a, b) => b.content.rev - a.content.rev || b.createdAt - a.createdAt);

        const session = sessions[0];
        // Gone, expired or ended while we were away: there is nothing to return
        // to, and the entry must not linger and retry forever.
        if (!session || session.status !== 'active') {
          if (user) resumableSessions.delete(user.pubkey);
          return;
        }

        clientRef.current = {
          ...createSessionClient({
            address: session.address,
            hostPubkey: session.hostPubkey,
            role: record.role,
          }),
        };
        const ingested = ingestCanonical(clientRef.current, session, Date.now());
        clientRef.current = ingested.state;
        dedupeRef.current.check(session.eventId);

        if (record.role === 'host') {
          const publisher = makePublisher(session.hostPubkey, session.sessionId, session.code ?? '');
          publisher.adopt(session.content, session.status);
          publisherRef.current = publisher;
          modeRef.current = 'hosting';
        } else {
          modeRef.current = 'joined';
        }

        patch({
          mode: record.role === 'host' ? 'hosting' : 'joined',
          role: record.role,
          sessionAddress: session.address,
          invitationCode: session.code,
          hostPubkey: session.hostPubkey,
          connectionState: 'connected',
          media: session.content.media,
          hostAway: false,
          error: null,
        });

        subscribe(session.address, session.hostPubkey);
        requestMediaRef.current(session.content.media);
        reconcile({ force: true });
        debug('resumed session', { address: session.address, role: record.role, rev: session.content.rev });
      } catch (error) {
        debug('resume failed', error);
      }
    },
    [makePublisher, nostr, patch, reconcile, subscribe, user],
  );

  const leaveSession = useCallback(() => {
    if (user) resumableSessions.delete(user.pubkey);
    teardown();
    setShared(LOCAL_STATE);
  }, [teardown, user]);

  const endSession = useCallback(async () => {
    const publisher = publisherRef.current;
    if (publisher) {
      const position = snapshotRef.current.currentTime;
      const ended = await publisher.end(position);
      if (!ended) patch({ error: sharedWatchError('publish-failed', 'end-session') });
    }
    if (user) resumableSessions.delete(user.pubkey);
    teardown();
    setShared(LOCAL_STATE);
  }, [patch, teardown, user]);

  const dismissError = useCallback(() => patch({ error: null }), [patch]);

  // ── The publication seam ─────────────────────────────────────────────────

  const onLocalCommand = useCallback((command: PlaybackCommand) => {
    // Remote-originated and correction-originated actions are suppressed here,
    // which is the whole of the echo-loop defence.
    if (suppressRef.current > 0) return;
    if (modeRef.current !== 'hosting') return;
    const publisher = publisherRef.current;
    if (!publisher) return;
    const action = toSessionAction(command);
    if (!action) return;
    // The PUBLICATION seam, and the host's half of the gate.
    //
    // A host's media has already passed admission on the way to its own player,
    // so this is defence in depth rather than the primary check, but it is the
    // one place a `set-media` becomes an event other people receive, and a
    // caller holding this callback should not be able to broadcast media this
    // experience would refuse to play.
    if (
      action.type === 'set-media' &&
      !admitTheaterMedia(policyRef.current, action.media, catalogRef.current).admitted
    ) {
      return;
    }
    // Rebuilding a player for the SAME video (a retry, a remount) re-announces
    // its media. Publishing that would burn a revision and rewind every guest to
    // zero for a video they are already watching.
    if (action.type === 'set-media' && publisher.intended?.media.id === action.media.id) return;
    publisher.commit(action);
  }, []);

  // ── Timers ───────────────────────────────────────────────────────────────

  // Re-attach after a remount. Runs once per mount, and only when this tab was
  // already in a session that no intentional exit removed, so it cannot revive
  // a session the user left, and it cannot create one.
  const resumeAttemptedRef = useRef(false);
  useEffect(() => {
    if (resumeAttemptedRef.current) return;
    if (!user) return;
    const record = resumableSessions.get(user.pubkey);
    if (!record) return;
    resumeAttemptedRef.current = true;
    void resumeSession(record);
  }, [resumeSession, user]);

  // Keepalive: rolls the expiration, refreshes every guest's clock estimate, and
  // doubles as the host-liveness signal. Host only.
  useEffect(() => {
    if (shared.mode !== 'hosting') return;
    const id = window.setInterval(() => {
      // Re-anchor from where the host's player ACTUALLY is. Extrapolating the
      // previous anchor instead would keep publishing a timeline the host is no
      // longer on the moment anything stalls it, and every guest would follow
      // the fiction rather than the host.
      const snap = livePlayback();
      const usable =
        hasLivePlayer() &&
        (snap.phase === 'ready' || snap.phase === 'ended') &&
        Number.isFinite(snap.currentTime);
      // With no usable reading the anchor is extrapolated instead, so a session
      // whose host is briefly out of their chair keeps running for everyone else.
      void publisherRef.current?.keepalive(usable ? { position: snap.currentTime } : undefined);
    }, KEEPALIVE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [hasLivePlayer, livePlayback, shared.mode]);

  // The passive check. It reads the player and publishes NOTHING; no network
  // event is ever produced by a drift check, on host or guest.
  useEffect(() => {
    if (shared.mode === 'local') return;
    const id = window.setInterval(() => {
      const client = clientRef.current;
      const ctrl = controllerRef.current;
      const snap = livePlayback();
      if (!client?.content) return;

      // A player that appeared, or became ready, with state waiting for it.
      // This is a one-shot catch-up (it clears the flag), not a correction, and
      // it is what puts a rebuilt player, after a seat change, say, back at
      // the canonical position instead of at zero.
      if (pendingApplyRef.current && ctrl) {
        reconcile({ force: true });
        return;
      }
      if (!ctrl) return;

      // ⚠️ THE HOST IS NEVER CORRECTED AGAINST ITS OWN STATE.
      //
      // Canonical position is DERIVED from the host's player (§8.1), so
      // correcting the host toward it is a feedback loop with nothing outside it:
      // the moment the two disagree, a play started from YouTube's own controls
      // publishes nothing, so canonical stays "paused at 0": the check drags the
      // host's player back, every tick, forever. That is the reported
      // "jumps back to the beginning every few seconds".
      //
      // The host stays honest a different way: the 20 s keepalive re-anchors
      // canonical FROM the live player, so guests follow where the host actually
      // is instead of where it once said it would be.
      if (modeRef.current === 'hosting') return;

      if (Date.now() - client.lastCanonicalAtMs > HOST_AWAY_AFTER_MS) {
        setShared((current) => (current.hostAway ? current : { ...current, hostAway: true }));
        void requeryCanonical();
      }

      const decision = evaluateDrift(client, {
        playerPosition: snap.currentTime,
        nowMs: Date.now(),
        duration: snap.duration,
        playerReady: snap.phase === 'ready',
        buffering: snap.phase === 'buffering',
        rateMatched: snap.rate === client.content.playback.rate,
        msSinceLastSeek: Date.now() - lastSeekAtRef.current,
        settleMs: SEEK_SETTLE_MS,
      });

      if (decision.action === 'seek' && decision.target !== null) {
        debug('drift correction', decision);
        lastSeekAtRef.current = Date.now();
        withoutPublishing(() => ctrl.seek(decision.target as number, 'direct'));
      }
    }, DRIFT_CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [livePlayback, reconcile, requeryCanonical, shared.mode, withoutPublishing]);

  // A NEW player, in either role, starts at zero and knows nothing about the
  // session. Standing up destroys the player and sitting down builds another, so
  // this is the ordinary path after a seat change, and without it a host's
  // rebuilt player would sit at 0 while the session played on, then drag the
  // canonical anchor back to 0 on its next keepalive.
  const lastControllerRef = useRef<TheaterPlaybackController | null>(null);
  useEffect(() => {
    if (controller === lastControllerRef.current) return;
    lastControllerRef.current = controller;
    if (!controller || modeRef.current === 'local') return;
    pendingApplyRef.current = true;
  }, [controller]);

  // A player appeared (or became ready) while state was waiting to be applied.
  useEffect(() => {
    if (shared.mode === 'local') return;
    if (!controller || !pendingApplyRef.current) return;
    reconcile({ force: true });
  }, [controller, reconcile, shared.mode, snapshot.phase, snapshot.media?.id]);

  // A tab that was backgrounded had its timers throttled; anything could have
  // happened. Re-read the canonical state rather than trusting the tick.
  useEffect(() => {
    if (shared.mode === 'local') return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void requeryCanonical().then(() => {
        if (modeRef.current === 'joined') reconcile({ force: false });
      });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reconcile, requeryCanonical, shared.mode]);

  return useMemo(
    () => ({
      shared,
      createSession,
      joinSession,
      leaveSession,
      endSession,
      dismissError,
      onLocalCommand,
    }),
    [createSession, dismissError, endSession, joinSession, leaveSession, onLocalCommand, shared],
  );
}
