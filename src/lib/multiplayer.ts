/**
 * Nostr-Only Multiplayer System for Blobbi Island
 * Using Kind 31950 (Addressable Events) with NIP-40 Expiration
 */

import type { LocationId } from '@/lib/location-types';
import { constrainPosition } from '@/lib/boundaries';
import { locationBoundaries } from '@/lib/location-boundaries';
import type { Position } from '@/lib/types';
import type { NostrEvent } from '@nostrify/nostrify';
import { KIND_BLOBBI_STATE } from '@/lib/blobbi-kinds';
import { buildBlobbiAddress } from '@blobbi-kit/core/blobbi';

// ============================================================================
// Constants and Configuration
// ============================================================================

/** Expiration time in seconds (35 seconds) */
export const EXP_SECONDS = 35;

/** Default movement speed in pixels per second */
export const DEFAULT_SPEED_PX = 120;

/** Heartbeat interval in milliseconds (25 seconds) */
export const HEARTBEAT_INTERVAL_MS = 25000;

/** Animation and garbage collection interval in milliseconds (100ms) */
export const ANIMATION_INTERVAL_MS = 100;

// ============================================================================
// Type Definitions
// ============================================================================

/** Player state enum */
export type PlayerState = 'idle' | 'moving' | 'emote';

/** Position with timestamp */
export interface PositionWithTimestamp {
  x: number;
  y: number;
  ts: number;
}

/** Movement goal */
export interface MovementGoal {
  from: { x: number; y: number };
  to: { x: number; y: number };
  v: number; // velocity in pixels per second
  ts: number; // timestamp when movement started
}

/**
 * A reference to a shared activity, carried by presence.
 *
 * `type` exists so a future shared activity (a game, a jukebox) is additive
 * rather than a second field, and so a reader can tell what kind of address
 * `session` is without parsing it.
 */
export interface PresenceActivity {
  type: 'shared-playback';
  /** An opaque address string to this layer — deliberately not parsed here. */
  session: string;
}

/** Presence content structure */
export interface PresenceContent {
  state: PlayerState;
  location: LocationId;
  anchor: PositionWithTimestamp;
  goal?: MovementGoal;
  blobbiD?: string; // Optional blobbiD for better tracking
  /**
   * OPTIONAL semantic hiding state: the id of the hiding spot the player is
   * currently hidden inside (e.g. a Town bush's id like "town-bush-1"), or
   * absent/undefined when the player is not hidden.
   *
   * This is an explicit, position-independent representation of "hidden in this
   * spot" so remote clients suppress the player's Blobbi visual reliably rather
   * than inferring it from approximate coordinates. It is set when the player
   * arrives and hides, and cleared as soon as they start moving away.
   *
   * Backward compatible: older clients that don't understand this field simply
   * ignore it and keep rendering the Blobbi normally.
   */
  hiddenIn?: string;
  /**
   * OPTIONAL semantic seating state: the canonical id of the theater seat the
   * player is currently sitting in (e.g. `"theater-seat-a4"`), or absent when
   * the player is not seated.
   *
   * This is the multiplayer counterpart of the local `sittingIn` state owned by
   * `PlayingView`, and it exists for the same reason as {@link hiddenIn}: remote
   * clients must learn "this Blobbi is IN that seat" as an explicit fact, not
   * guess it from coordinates. Coordinates cannot answer it — three seat rows
   * overlap, chairs are 96 px apart, and the published anchor is the walk-to
   * cushion point rather than the render anchor. A remote client that trusted
   * position would put Blobbis near seats instead of in them.
   *
   * The value is ALWAYS a canonical occupiable seat id from
   * `theater-seats-config.ts`. Decorative chairs (the two off-world row-B ones)
   * are never published: they cannot be clicked, cannot be walked to and cannot
   * become `sittingIn`, and the render path rejects them a second time via
   * `resolveSeatedRender`.
   *
   * Lifecycle: set on CONFIRMED ARRIVAL (never on click), preserved across
   * heartbeats, and absent from every `moving` presence — so the movement that
   * leaves a seat is itself what clears it, with no separate "stand up" event to
   * lose or reorder. Cleared on location change and on disconnect (the whole
   * presence event expires via NIP-40).
   *
   * Backward compatible: older clients that don't understand this field simply
   * ignore it and keep rendering the Blobbi with the normal floating renderer.
   *
   * NOT authoritative. Presence is advisory, self-expiring occupancy for
   * RENDERING only — it reserves nothing and grants nothing. See
   * `docs/protocol/shared-playback-session.md` §14.
   */
  seatId?: string;
  /**
   * OPTIONAL reference to the shared activity this player is participating in.
   *
   * It answers exactly one question — *which shared activity is this visible
   * player in?* — and carries **only the address string** of that activity, no
   * duplicate of its state (`docs/protocol/shared-playback-session.md` §14.2,
   * §14.3). No revision, no playhead, no media, no host. Presence is advisory
   * and self-expiring; the session event (kind `31951`) is the canonical store,
   * and neither is authoritative for the other.
   *
   * Why it exists at all: without it, a client can see who is sitting in the
   * theater but not who is watching *together*, so a participant count and a
   * "these two are in the same session" answer would have to come from
   * enumerating relay state instead of from the room.
   *
   * Lifecycle: set once a session has actually been created or joined (never
   * while a code is merely being typed), preserved across heartbeats, cleared
   * immediately on leaving the session, on standing up, and on a location
   * change. It must never be left pointing at a session the player has left.
   *
   * Backward compatible: older clients ignore it.
   */
  activity?: PresenceActivity;
  /**
   * OPTIONAL monotonic publish counter for this session, incremented once per
   * presence publish (login / move / hide / heartbeat).
   *
   * Why it exists: `created_at` has one-second resolution, so a hide and the
   * movement that leaves it are routinely stamped with the SAME second. Relay
   * delivery order is not guaranteed either, so a late hide could otherwise
   * overwrite a newer movement and re-hide a Blobbi that already walked away.
   * Because presence is keyed by a per-session id, this counter is strictly
   * increasing for a given player key and gives every update from that session a
   * deterministic order — independent of clock resolution and delivery order.
   *
   * Backward compatible: older clients omit it, and consumers then fall back to
   * comparing `created_at` exactly as before (see {@link isSupersededPresence}).
   */
  seq?: number;
}

/** Ordering key for one presence update from a single session. */
export interface PresenceOrder {
  /** Event `created_at` (seconds). */
  createdAt: number;
  /** {@link PresenceContent.seq}, when the publishing client supports it. */
  seq?: number;
}

/**
 * Decide whether an incoming presence update is older than (or a duplicate of)
 * the newest one already applied for the same player key.
 *
 * Ordering rules:
 *  1. When BOTH sides carry `seq`, order by `seq` alone. It is monotonic per
 *     session, so it resolves same-second races exactly — a delayed hide with a
 *     lower `seq` can never override a newer movement.
 *  2. Otherwise (a legacy publisher on either side) fall back to `created_at`:
 *     strictly older is dropped, same-second is applied — precisely the previous
 *     behavior, so nothing regresses for clients that don't send `seq`.
 */
export function isSupersededPresence(
  known: PresenceOrder | undefined,
  incoming: PresenceOrder,
): boolean {
  if (!known) return false;

  if (typeof known.seq === 'number' && typeof incoming.seq === 'number') {
    return incoming.seq <= known.seq;
  }

  return incoming.createdAt < known.createdAt;
}

/** Read the ordering key of a presence event (tolerates legacy payloads). */
export function presenceOrderOf(
  content: PresenceContent,
  createdAt: number,
): PresenceOrder {
  const seq = content.seq;
  return {
    createdAt,
    seq: typeof seq === 'number' && Number.isFinite(seq) ? seq : undefined,
  };
}

/**
 * Read the seating claim out of presence content, tolerating anything.
 *
 * Presence content is attacker-controlled JSON from an open relay, so this
 * accepts ONLY a non-empty string and answers `undefined` for everything else —
 * missing (legacy clients), null, numbers, objects, arrays, empty strings.
 *
 * It deliberately does NOT check the id against the seat registry: that is a
 * *rendering* decision, made by `resolveSeatedRender` / the occupancy resolver,
 * which know about theater geometry. This layer stays a transport parser, so
 * presence has no dependency on any one room's furniture.
 */
export function parseSeatId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Blank INCLUDES whitespace-only: `"   "` is not an id, it is a missing value
  // wearing a costume. Rejecting it here means "seated" and "not seated" stay
  // the only two states a reader can end up in.
  if (value.trim().length === 0) return undefined;
  // Deliberately NOT trim-normalized. Returning `" theater-seat-a4 "` unchanged
  // lets the exact-match seat registry reject it downstream, which is the
  // predictable outcome; trimming would instead *accept* a padded spelling and
  // give one seat two wire representations — and occupancy is keyed by this
  // string. Canonical ids contain no whitespace, so nothing legitimate is lost.
  return value;
}

/**
 * Read the shared-activity reference out of presence content, tolerating
 * anything.
 *
 * Like {@link parseSeatId}, this is a TRANSPORT parser: it accepts only the
 * documented shape and answers `undefined` for everything else. It deliberately
 * does NOT check that `session` is a well-formed session address — that is a
 * protocol question, answered by the shared-playback library, and presence must
 * not grow a dependency on any one activity's addressing rules.
 */
export function parseActivity(value: unknown): PresenceActivity | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { type?: unknown; session?: unknown };
  if (candidate.type !== 'shared-playback') return undefined;
  if (typeof candidate.session !== 'string' || candidate.session.trim().length === 0) return undefined;
  return { type: 'shared-playback', session: candidate.session };
}

/** Walkable API interface for boundary checking */
export interface WalkableApi {
  isWalkable(x: number, y: number): boolean;
  clampToBounds(x: number, y: number): { x: number; y: number };
}

/** Animation state for remote players */
export interface PlayerAnimState {
  pos: Position;           // current animated position
  target: Position;        // destination from event.goal or event.anchor
  speedPx: number;         // same as DEFAULT_SPEED_PX
  lastUpdate: number;      // last frame timestamp
  moving: boolean;
}

/** Player state for rendering */
export interface PlayerRenderState {
  pubkey: string;
  sessionId: string;
  blobbiAddr: string;
  position: Position;
  isMoving: boolean;
  lastSeen: number;
  visual?: BlobbiVisual;
  lastContent: PresenceContent & { blobbiD?: string }; // Allow blobbiD in lastContent
  animState: PlayerAnimState; // animation state for smooth movement
  blobbiD?: string; // Direct blobbiD for quick access
  /**
   * The hiding-spot id this remote player is currently hidden inside, or
   * undefined when not hidden. Mirrors {@link PresenceContent.hiddenIn} from the
   * latest presence so renderers can suppress this Blobbi's visual without
   * re-parsing content.
   */
  hiddenIn?: string;
  /**
   * The canonical theater seat id this remote player claims to be sitting in, or
   * undefined when they are not seated. Mirrors {@link PresenceContent.seatId}
   * from the latest presence, already sanitized by {@link parseSeatId}.
   *
   * A CLAIM, not a fact: the renderer still resolves it through the canonical
   * seat registry (`resolveSeatedRender`) and the occupancy resolver still
   * arbitrates duplicate claims, so an unknown, decorative or contested id can
   * never pin a Blobbi to a chair.
   */
  seatId?: string;
  /**
   * The shared activity this remote player claims to be in, or undefined.
   * Mirrors {@link PresenceContent.activity}, already sanitized by
   * {@link parseActivity}.
   *
   * A CLAIM about participation, never a source of playback state: what is
   * playing and where the playhead is comes from the session event alone.
   */
  activity?: PresenceActivity;
}

/** Blobbi visual data */
export interface BlobbiVisual {
  name: string;
  baseColor?: string;
  secondaryColor?: string;
  pattern?: string;
  eyeColor?: string;
  specialMark?: string;
  stage?: 'egg' | 'baby' | 'adult';
  adultType?: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

/** Get current timestamp in seconds */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Generate a unique session ID */
export function makeSessionId(): string {
  return crypto.randomUUID();
}

/** Create a Blobbi address string */
export function makeBlobbiAddr(pubkey: string, d: string): string {
  return buildBlobbiAddress(pubkey, d);
}

/** Parse an 'a' tag into its components */
export function parseA(a: string): { kind: number; pubkey: string; blobbi_d: string } {
  const [k, pk, d] = a.split(':');
  if (k !== String(KIND_BLOBBI_STATE) || !pk || !d) {
    throw new Error('Invalid "a" tag format');
  }
  return { kind: KIND_BLOBBI_STATE, pubkey: pk, blobbi_d: d };
}

// ============================================================================
// Position and Movement Functions
// ============================================================================

/**
 * Interpolate position along a goal path at a given time
 */
export function posAt(goal: MovementGoal, tSec: number): Position {
  const elapsed = tSec - goal.ts;
  if (elapsed <= 0) {
    return { x: goal.from.x, y: goal.from.y };
  }

  const distance = Math.sqrt(
    Math.pow(goal.to.x - goal.from.x, 2) +
    Math.pow(goal.to.y - goal.from.y, 2)
  );

  const duration = distance / goal.v;

  if (elapsed >= duration) {
    return { x: goal.to.x, y: goal.to.y };
  }

  const progress = elapsed / duration;
  return {
    x: goal.from.x + (goal.to.x - goal.from.x) * progress,
    y: goal.from.y + (goal.to.y - goal.from.y) * progress,
  };
}

/**
 * Clamp a target position to walkable area using existing boundary system
 */
export function clampToWalkable(
  target: Position,
  origin: Position,
  nav: WalkableApi
): Position {
  // First check if target is already walkable
  if (nav.isWalkable(target.x, target.y)) {
    return target;
  }

  // Use the existing boundary system to constrain the position
  const clamped = nav.clampToBounds(target.x, target.y);

  // If still not walkable, find the nearest walkable point along the direction
  if (!nav.isWalkable(clamped.x, clamped.y)) {
    // Calculate direction from origin to target
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance === 0) {
      return origin; // No movement needed
    }

    const stepX = dx / distance;
    const stepY = dy / distance;

    // Step along the direction until we find a walkable point
    let currentX = origin.x;
    let currentY = origin.y;
    let lastWalkable = { x: origin.x, y: origin.y };

    const maxSteps = Math.ceil(distance);
    for (let i = 1; i <= maxSteps; i++) {
      currentX = origin.x + stepX * i;
      currentY = origin.y + stepY * i;

      if (nav.isWalkable(currentX, currentY)) {
        lastWalkable = { x: currentX, y: currentY };
      } else {
        break;
      }
    }

    return lastWalkable;
  }

  return clamped;
}

/**
 * Create a WalkableApi implementation for a given location
 */
export function createWalkableApi(location: LocationId): WalkableApi {
  const backgroundFile = getBackgroundFileForLocation(location);
  const boundary = backgroundFile ? locationBoundaries[backgroundFile] : undefined;

  return {
    isWalkable(x: number, y: number): boolean {
      if (!boundary) return true;

      // Use the existing constrainPosition function to check if position is valid
      const constrained = constrainPosition({ x, y }, boundary);
      return Math.abs(constrained.x - x) < 0.1 && Math.abs(constrained.y - y) < 0.1;
    },

    clampToBounds(x: number, y: number): { x: number; y: number } {
      if (!boundary) return { x, y };
      return constrainPosition({ x, y }, boundary);
    }
  };
}

/**
 * Get background file name for a location (simplified mapping)
 */
function getBackgroundFileForLocation(location: LocationId): string | undefined {
  const locationToFile: Record<LocationId, string> = {
    'town': 'town-open.webp',
    'home': 'home-inside.png',
    'beach': 'beach-open.webp',
    'mine': 'mine-open.webp',
    'nostr-station': 'nostr-station-open.webp',
    'nostr-station-inside': 'nostr-station-inside.png',
    'plaza': 'plaza-open.webp',
    'plaza-inside': 'plaza-inside.png',
    'arcade': 'arcade-inside.png',
    'arcade-1': 'arcade-1.png',
    'arcade-minus1': 'arcade-minus1.png',
    'stage': 'stage-inside.png',
    'shop': 'shopping-mall-inside.png',
    'back-yard': 'back-yard-open.webp',
    'cave-open': 'cave-inside.png',
    'clothing-store-inside': 'clothing-store-inside.png',
  };

  return locationToFile[location];
}

// ============================================================================
// Event Building Functions
// ============================================================================

/**
 * Build a kind 31950 presence event
 */
export function buildPresence31950(params: {
  sessionId: string;
  islandId: string;
  location: LocationId;
  blobbiAddr: string;
  content: PresenceContent;
}): {
  kind: number;
  content: string;
  tags: string[][];
} {
  const { sessionId, islandId, location, blobbiAddr, content } = params;
  const expiration = (nowSec() + EXP_SECONDS).toString();

  return {
    kind: 31950,
    content: JSON.stringify(content),
    tags: [
      ['d', `session:${sessionId}`],
      ['a', blobbiAddr],
      ['t', 'blobbi:presence'],
      ['t', `island:${islandId}`],
      ['t', `loc:${location}`],
      ['expiration', expiration],
    ],
  };
}

// ============================================================================
// Publishing Functions
// ============================================================================

/**
 * Publish presence on login/entering island
 */
export async function publishPresenceLogin(
  publish: (event: Record<string, unknown>) => Promise<void>,
  params: {
    sessionId: string;
    islandId: string;
    location: LocationId;
    blobbiAddr: string;
    startPos: Position;
    /** Monotonic publish counter for this session (see {@link PresenceContent.seq}). */
    seq?: number;
  }
): Promise<void> {
  const { sessionId, islandId, location, blobbiAddr, startPos, seq } = params;

  const content: PresenceContent = {
    state: 'idle',
    location,
    anchor: {
      x: startPos.x,
      y: startPos.y,
      ts: nowSec(),
    },
    ...(seq !== undefined ? { seq } : {}),
  };

  const event = buildPresence31950({
    sessionId,
    islandId,
    location,
    blobbiAddr,
    content,
  });

  await publish(event);
}

/**
 * Publish movement goal
 */
export async function publishMove(
  publish: (event: Record<string, unknown>) => Promise<void>,
  params: {
    sessionId: string;
    islandId: string;
    location: LocationId;
    blobbiAddr: string;
    /** Monotonic publish counter for this session (see {@link PresenceContent.seq}). */
    seq?: number;
  },
  from: Position,
  rawClick: Position,
  speedPx: number,
  nav: WalkableApi,
  /**
   * The shared activity, preserved across movement.
   *
   * Unlike `seatId` and `hiddenIn` — which movement is *defined* to clear,
   * because they are claims about being stationary somewhere — participation in
   * a session says nothing about where a Blobbi is standing. Dropping it here
   * would make every walk look like leaving the session and rejoining it 25 s
   * later. Leaving is published explicitly instead ({@link publishActivity}).
   */
  activity?: PresenceActivity
): Promise<Position> {
  const { sessionId, islandId, location, blobbiAddr, seq } = params;

  // Clamp destination to walkable area
  const clampedTo = clampToWalkable(rawClick, from, nav);

  const content: PresenceContent = {
    state: 'moving',
    location,
    anchor: {
      x: from.x,
      y: from.y,
      ts: nowSec(),
    },
    goal: {
      from: { x: from.x, y: from.y },
      to: { x: clampedTo.x, y: clampedTo.y },
      v: speedPx,
      ts: nowSec(),
    },
    ...(activity ? { activity } : {}),
    ...(seq !== undefined ? { seq } : {}),
  };

  const event = buildPresence31950({
    sessionId,
    islandId,
    location,
    blobbiAddr,
    content,
  });

  await publish(event);
  return clampedTo;
}

/**
 * Publish that the player has arrived at and is now hidden inside a hiding spot
 * (e.g. a Town bush). Emits an idle presence at the current position carrying
 * the optional {@link PresenceContent.hiddenIn} semantic state so remote
 * clients suppress this Blobbi's visual. Cleared by the next movement (which
 * publishes a normal `moving` presence WITHOUT `hiddenIn`) or heartbeat.
 */
export async function publishHide(
  publish: (event: Record<string, unknown>) => Promise<void>,
  params: {
    sessionId: string;
    islandId: string;
    location: LocationId;
    blobbiAddr: string;
    /** Monotonic publish counter for this session (see {@link PresenceContent.seq}). */
    seq?: number;
  },
  currentPos: Position,
  hidingSpotId: string
): Promise<void> {
  const { sessionId, islandId, location, blobbiAddr, seq } = params;

  const content: PresenceContent = {
    state: 'idle',
    location,
    anchor: {
      x: currentPos.x,
      y: currentPos.y,
      ts: nowSec(),
    },
    hiddenIn: hidingSpotId,
    ...(seq !== undefined ? { seq } : {}),
  };

  const event = buildPresence31950({
    sessionId,
    islandId,
    location,
    blobbiAddr,
    content,
  });

  await publish(event);
}

/**
 * Publish that the player has ARRIVED at and is now sitting in a theater seat.
 *
 * Emits an idle presence at the current position carrying the optional
 * {@link PresenceContent.seatId} semantic state, so remote clients snap this
 * Blobbi to the seat's canonical anchor and draw it rear-facing.
 *
 * Called on CONFIRMED ARRIVAL only. Cleared by the next movement (which
 * publishes a normal `moving` presence WITHOUT `seatId`), by a location change,
 * and by presence expiry.
 */
export async function publishSit(
  publish: (event: Record<string, unknown>) => Promise<void>,
  params: {
    sessionId: string;
    islandId: string;
    location: LocationId;
    blobbiAddr: string;
    /** Monotonic publish counter for this session (see {@link PresenceContent.seq}). */
    seq?: number;
  },
  currentPos: Position,
  seatId: string,
  activity?: PresenceActivity
): Promise<void> {
  const { sessionId, islandId, location, blobbiAddr, seq } = params;

  const content: PresenceContent = {
    state: 'idle',
    location,
    anchor: {
      x: currentPos.x,
      y: currentPos.y,
      ts: nowSec(),
    },
    seatId,
    // A player who sits down while already in a watch session must not appear
    // to have left it for the 25 s until the next heartbeat.
    ...(activity ? { activity } : {}),
    ...(seq !== undefined ? { seq } : {}),
  };

  const event = buildPresence31950({
    sessionId,
    islandId,
    location,
    blobbiAddr,
    content,
  });

  await publish(event);
}

/**
 * Publish that the player joined or left a shared activity.
 *
 * One idle presence, published at the moment participation actually changes,
 * because waiting up to 25 s for the next heartbeat would show everyone else a
 * stale answer to "who is watching this together?" — and, on leaving, would keep
 * pointing at a session the player is no longer in.
 *
 * Passing `activity: null` is the clear: the event carries no `activity` field
 * at all, which is exactly how `hiddenIn` and `seatId` are cleared.
 */
export async function publishActivity(
  publish: (event: Record<string, unknown>) => Promise<void>,
  params: {
    sessionId: string;
    islandId: string;
    location: LocationId;
    blobbiAddr: string;
    /** Monotonic publish counter for this session (see {@link PresenceContent.seq}). */
    seq?: number;
  },
  currentPos: Position,
  activity: PresenceActivity | null,
  seatId?: string
): Promise<void> {
  const { sessionId, islandId, location, blobbiAddr, seq } = params;

  const content: PresenceContent = {
    state: 'idle',
    location,
    anchor: {
      x: currentPos.x,
      y: currentPos.y,
      ts: nowSec(),
    },
    // The seat is preserved: joining a session does not stand you up.
    ...(seatId ? { seatId } : {}),
    ...(activity ? { activity } : {}),
    ...(seq !== undefined ? { seq } : {}),
  };

  const event = buildPresence31950({
    sessionId,
    islandId,
    location,
    blobbiAddr,
    content,
  });

  await publish(event);
}

/**
 * Publish heartbeat to renew expiration
 */
export async function publishHeartbeat(
  publish: (event: Record<string, unknown>) => Promise<void>,
  params: {
    sessionId: string;
    islandId: string;
    location: LocationId;
    blobbiAddr: string;
    /** Monotonic publish counter for this session (see {@link PresenceContent.seq}). */
    seq?: number;
  },
  currentPos: Position,
  hiddenIn?: string,
  seatId?: string,
  activity?: PresenceActivity
): Promise<void> {
  const { sessionId, islandId, location, blobbiAddr, seq } = params;

  const content: PresenceContent = {
    state: 'idle',
    location,
    anchor: {
      x: currentPos.x,
      y: currentPos.y,
      ts: nowSec(),
    },
    // Preserve the hiding state across heartbeats so a player who stays hidden
    // for longer than the expiration window remains hidden for remote clients.
    ...(hiddenIn ? { hiddenIn } : {}),
    // Same for seating: a player who watches a whole film without moving would
    // otherwise pop out of their chair every time presence was renewed.
    ...(seatId ? { seatId } : {}),
    // And the same for the watch session — a two-hour film is a lot of
    // heartbeats to drop out of the participant list on.
    ...(activity ? { activity } : {}),
    ...(seq !== undefined ? { seq } : {}),
  };

  const event = buildPresence31950({
    sessionId,
    islandId,
    location,
    blobbiAddr,
    content,
  });

  await publish(event);
}

// ============================================================================
// Event Validation
// ============================================================================

/**
 * Validate a presence event
 */
export type PresenceValidation =
  | { ok: true }
  | { ok: false; reason: string };

export function explainPresenceEvent(event: NostrEvent): PresenceValidation {
  try {
    if (event.kind !== 31950) return { ok: false, reason: 'kind != 31950' };

    const dTag = event.tags.find(([n]: string[]) => n === 'd')?.[1];
    const aTag = event.tags.find(([n]: string[]) => n === 'a')?.[1];
    const presenceTag = event.tags.find(([n, v]: string[]) => n === 't' && v === 'blobbi:presence');
    const islandTag = event.tags.find(([n, v]: string[]) => n === 't' && v?.startsWith('island:'));
    const locationTag = event.tags.find(([n, v]: string[]) => n === 't' && v?.startsWith('loc:'));
    const expirationTag = event.tags.find(([n]: string[]) => n === 'expiration')?.[1];

    if (!dTag) return { ok: false, reason: 'missing d tag' };
    if (!dTag.startsWith('session:')) return { ok: false, reason: 'd not session:*' };
    if (!aTag) return { ok: false, reason: 'missing a tag' };
    if (!presenceTag) return { ok: false, reason: 'missing t:blobbi:presence' };
    if (!islandTag) return { ok: false, reason: 'missing island tag' };
    if (!locationTag) return { ok: false, reason: 'missing loc tag' };
    if (!expirationTag) return { ok: false, reason: 'missing expiration' };

    const expiration = parseInt(expirationTag);
    if (Number.isNaN(expiration)) return { ok: false, reason: 'expiration NaN' };
    if (expiration <= nowSec()) return { ok: false, reason: 'expired' };

    // Parse content
    const content: PresenceContent = JSON.parse(event.content);
    if (!content?.state) return { ok: false, reason: 'content.state missing' };
    if (!content?.location) return { ok: false, reason: 'content.location missing' };
    if (!content?.anchor) return { ok: false, reason: 'content.anchor missing' };

    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, reason: `exception: ${String(err instanceof Error ? err.message : err)}` };
  }
}

export function validatePresenceEvent(event: NostrEvent): boolean {
  return explainPresenceEvent(event).ok;
}