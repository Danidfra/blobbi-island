/**
 * Where an existing player appears after a reload.
 *
 * ## The question this answers
 *
 * `LocationProvider` used to open every session with `useState('town')`, so a
 * reload: including a reload after an error recovery, always dropped the
 * player in Town, however far from Town they actually were. There was no second
 * authority to consult: no stored location, no route segment, nothing. Town was
 * simply the initial value.
 *
 * Meanwhile the app already publishes exactly the fact that was missing.
 * Kind:31950 presence carries the player's current island location, and the
 * multiplayer layer already has a rule for when such an event stops meaning
 * "this Blobbi is here": the NIP-40 expiration written by
 * `buildPresence31950`, checked by `isPresenceAlive`.
 *
 * So this module asks the presence the player themselves published, and applies
 * the SAME lifetime rule multiplayer applies to everyone else:
 *
 * > you resume where you were if, and only if, another player would still be
 * > able to see you standing there.
 *
 * ## Why stale presence goes to Town
 *
 * Not a fallback, a decision. Presence expiring is what removes a Blobbi from
 * every other client's world. A player whose presence lapsed has *left*, as far
 * as the island is concerned. Restoring them into that location days later
 * would resurrect a position the world already forgot, and would do it
 * asymmetrically: they would be standing on the beach in their own client
 * having never re-entered it in anyone else's.
 *
 * ## What is restored
 *
 * The coarse `location` and nothing else. Presence also carries `anchor`,
 * `goal`, `hiddenIn`, `seatId` and `activity`; every one of those is
 * deliberately dropped here. See `docs/location-resume.md` §"Location only".
 */

import type { NostrEvent } from '@nostrify/nostrify';
import type { LocationId } from '@/lib/location-types';
import type { Position } from '@/lib/types';
import type { RelayReadOutcome, RelayReadUnknownReason } from '@/lib/relay-read';
import { LOCATION_BACKGROUNDS, getBackgroundForLocation } from '@/lib/location-backgrounds';
import { locationBoundaries } from '@/lib/location-boundaries';
import { constrainPosition, type Boundary } from '@/lib/boundaries';
import { wireCenterToGround } from '@/lib/presence-ground';
import { isPresenceAlive, presenceExpirationOf } from '@/lib/multiplayer';

/** Where a player starts when nothing usable can be resumed. */
export const DEFAULT_ISLAND_LOCATION: LocationId = 'town';

/**
 * The walkable area PlayingView falls back to when a background has no entry in
 * `locationBoundaries`. Mirrored here so a resumed position is validated against
 * exactly the region the scene will actually constrain the actor to.
 */
const FALLBACK_BOUNDARY: Boundary = { shape: 'rectangle', x: [0, 100], y: [60, 100] };

/** Is this one of the arcade locations the pass governs? */
export function isArcadeLocation(location: string): boolean {
  return location.startsWith('arcade');
}

/**
 * Every location the island can actually draw.
 *
 * Derived from `LOCATION_BACKGROUNDS` rather than written out again: that
 * record is typed `Record<LocationId, string>`, so the compiler already forces
 * it to stay exhaustive, and membership in it is precisely the property we need,
 * a key present here has a scene to render. A second hand-maintained list
 * would be free to drift into claiming a location that renders nothing.
 */
const RENDERABLE_LOCATIONS: ReadonlySet<string> = new Set(Object.keys(LOCATION_BACKGROUNDS));

/** Is this arbitrary string from the relay a location this build can render? */
export function isRenderableLocation(value: unknown): value is LocationId {
  return typeof value === 'string' && RENDERABLE_LOCATIONS.has(value);
}

/** A finite world-percent coordinate pair, as the wire format defines them. */
function readWirePoint(value: unknown): Position | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  // World-percent space is 0–100 by definition. A value outside it is not an
  // out-of-bounds position to be clamped, it is a malformed one, clamping
  // `x: -9999` to an edge would silently invent a location the player was never
  // at. Those fall through to the scene's canonical spawn instead.
  if (x < 0 || x > 100 || y < 0 || y > 100) return null;
  return { x, y };
}

/**
 * The position to resume at, in INTERNAL ground coordinates, or `null` to use
 * the scene's canonical spawn.
 *
 * ## Which field, and why
 *
 * Presence carries two points and neither is simply "where the player is":
 *
 * | | `anchor` | `goal` |
 * | --- | --- | --- |
 * | stationary (`idle`, heartbeat) | the live position | absent |
 * | walking (`moving`) | where the walk STARTED | `{from, to, v, ts}` |
 *
 * So mid-walk, `anchor` is already behind the player and `goal.to` is where the
 * walk ends. `goal?.to ?? anchor` is the settled position, and it is not a
 * guess: it is precisely what `processPresenceEvent` uses as the target for
 * every REMOTE copy of that player (`groundGoal ? groundGoal.to : groundAnchor`).
 * Restoring anywhere else would put the local player somewhere no other client
 * ever drew them.
 *
 * `goal.to` is taken as a STATIC point. The goal itself is never carried into
 * the decision: there is no field on the result to put it in, so a reload can
 * never resume walking toward a target chosen 30 seconds ago.
 *
 * ## Coordinates
 *
 * The wire carries legacy CENTER points in world-percent (0–100); internal
 * island code uses GROUND points (feet). The conversion is the same one presence
 * ingest performs, at the same boundary (`src/lib/presence-ground.ts`).
 */
function resolveResumePosition(content: unknown, location: LocationId): Position | null {
  if (!content || typeof content !== 'object') return null;
  const { anchor, goal } = content as { anchor?: unknown; goal?: unknown };

  const goalTo = goal && typeof goal === 'object' ? (goal as { to?: unknown }).to : undefined;
  const wire = readWirePoint(goalTo) ?? readWirePoint(anchor);
  if (!wire) return null;

  // WIRE→GROUND, exactly as `processPresenceEvent` does on ingest.
  const ground = wireCenterToGround(wire, location);
  if (!Number.isFinite(ground.x) || !Number.isFinite(ground.y)) return null;

  // The destination scene's OWN policy decides what is in bounds. A position
  // that was walkable when published (both `goal.to` and every published anchor
  // already are) survives this untouched; one that is not, a room whose floor
  // moved between builds, is clamped onto the floor rather than dropping the
  // player through it.
  const boundary = locationBoundaries[getBackgroundForLocation(location)] ?? FALLBACK_BOUNDARY;
  const constrained = constrainPosition(ground, boundary);
  if (!Number.isFinite(constrained.x) || !Number.isFinite(constrained.y)) return null;

  return constrained;
}

/*
 * NOTE the deliberate absence of a pass-gated floor table.
 *
 * The arcade floors used to need an Arcade Pass to be in, so a player restored
 * upstairs without one was stranded, the only exit refused them, and this
 * policy had to land them at the entrance instead. The elevator is open to
 * everyone now: the arcade charges for PLAYS (one Arcade Token each), not for
 * standing in the building. With no gated floor there is nothing to check, and
 * a resumed player simply resumes where they were.
 */

/**
 * What the resume decision was. Distinct cases stay distinct even where several
 * end at Town, because "we confirmed you have no presence" and "we could not
 * reach a relay" are different facts and only one of them is knowledge.
 */
export type LocationResumeOutcome =
  /** Presence is alive and its location is renderable. */
  | { readonly kind: 'fresh-presence'; readonly location: LocationId }
  /** Presence exists but its NIP-40 lifetime has run out. */
  | {
      readonly kind: 'stale-presence';
      readonly presenceLocation: string | null;
      readonly expiration: number;
    }
  /** Alive, but the location string is not one this build can render. */
  | { readonly kind: 'invalid-location'; readonly value: string | null }
  /** The relay answered, and it holds no usable presence for this player. */
  | { readonly kind: 'no-presence' }
  /**
   * The read never completed. NOT an empty result and never recorded as one,
   * see `src/lib/relay-read.ts`.
   */
  | { readonly kind: 'unknown-read'; readonly reason: RelayReadUnknownReason };

export interface LocationResumeDecision {
  /** The location to start the session in. Always renderable. */
  readonly location: LocationId;
  /**
   * Where in that location to place the actor, in INTERNAL ground coordinates,
   * already validated against the destination scene's walkable area.
   *
   * `null` means "use the scene's canonical spawn": no presence position, a
   * malformed one, or a location the player is not being restored into anyway.
   * There is deliberately no goal, seat, pose or activity beside it: this is a
   * standing position and nothing else.
   */
  readonly position: Position | null;
  /** Why, in full. */
  readonly outcome: LocationResumeOutcome;
}

/** The parts of a presence event this policy reads. */
interface ResumeCandidate {
  readonly event: NostrEvent;
  readonly expiration: number;
  /** `null` when the `loc:` tag and `content.location` are absent or disagree. */
  readonly location: string | null;
  /** The parsed JSON content, for the position fields. Never trusted by shape. */
  readonly content: unknown;
}

/**
 * Pull the resume-relevant fields out of a presence event, or `null` if the
 * event is not a structurally usable presence for this island.
 *
 * Deliberately NOT `validatePresenceEvent`: that helper folds the lifetime
 * check in, so a stale presence would come back indistinguishable from no
 * presence at all, and the "stale ⇒ Town" decision could never be reported
 * honestly. Structure is checked here; lifetime is checked by the shared
 * `isPresenceAlive` in {@link resolveInitialIslandLocation}.
 */
function toCandidate(event: NostrEvent, islandId: string): ResumeCandidate | null {
  if (event.kind !== 31950) return null;

  const tags = event.tags;
  const dTag = tags.find(([n]: string[]) => n === 'd')?.[1];
  if (!dTag?.startsWith('session:')) return null;
  if (!tags.find(([n, v]: string[]) => n === 't' && v === 'blobbi:presence')) return null;

  // Presence from another island is not presence *here*. Filtered out as a
  // candidate rather than reported as invalid: the player genuinely has no
  // resumable position on this island.
  if (!tags.find(([n, v]: string[]) => n === 't' && v === `island:${islandId}`)) return null;

  const expiration = presenceExpirationOf(event);
  if (expiration === null) return null;

  const tagLocation = tags
    .find(([n, v]: string[]) => n === 't' && v?.startsWith('loc:'))?.[1]
    ?.slice('loc:'.length) ?? null;

  let content: unknown = null;
  let contentLocation: string | null = null;
  try {
    content = JSON.parse(event.content);
    const value = (content as { location?: unknown } | null)?.location;
    contentLocation = typeof value === 'string' ? value : null;
  } catch {
    content = null;
    contentLocation = null;
  }

  // The tag and the content must agree. `processPresenceEvent` requires the
  // same agreement before it will render a player, so an event whose two
  // location fields disagree is one no client would draw anywhere.
  const location =
    tagLocation !== null && tagLocation === contentLocation ? tagLocation : null;

  return { event, expiration, location, content };
}

/**
 * The newest candidate, by ordinary newest-event semantics.
 *
 * `created_at` decides, so a second tab that published more recently wins,
 * which is the answer multi-tab should give. The `id` tie-break only makes the
 * same-second case deterministic; it carries no meaning. Note this picks the
 * newest event and then judges it, rather than searching for the newest event
 * that happens to be resumable: an unrenderable newest location is a fact about
 * where the player last was, not a reason to reach further back.
 */
function newestCandidate(candidates: readonly ResumeCandidate[]): ResumeCandidate | null {
  let best: ResumeCandidate | null = null;
  for (const candidate of candidates) {
    if (
      best === null ||
      candidate.event.created_at > best.event.created_at ||
      (candidate.event.created_at === best.event.created_at && candidate.event.id > best.event.id)
    ) {
      best = candidate;
    }
  }
  return best;
}

export interface ResolveInitialIslandLocationInput {
  /** The raw outcome of one bounded read for this player's presence. */
  readonly read: RelayReadOutcome;
  /** Current time in SECONDS, matching `created_at`/`expiration`. */
  readonly now: number;
  /** The island being entered; presence for any other island is ignored. */
  readonly islandId: string;
}

/** Everything falls back to Town at the canonical spawn. */
function fallback(outcome: LocationResumeOutcome): LocationResumeDecision {
  return { location: DEFAULT_ISLAND_LOCATION, position: null, outcome };
}

/**
 * Decide where this session starts. Pure: no clock, no relay, no React, no
 * storage.
 */
export function resolveInitialIslandLocation(
  input: ResolveInitialIslandLocationInput,
): LocationResumeDecision {
  const { read, now, islandId } = input;

  if (read.status === 'unknown') {
    // Non-destructive: navigate to the default, record that we do not know. No
    // "the player was in Town" fact is written anywhere as a result of this.
    return fallback({ kind: 'unknown-read', reason: read.reason });
  }

  const candidates = read.events
    .map((event) => toCandidate(event, islandId))
    .filter((candidate): candidate is ResumeCandidate => candidate !== null);

  const newest = newestCandidate(candidates);
  if (newest === null) return fallback({ kind: 'no-presence' });

  // The shared rule. Same predicate, same direction, same constant that decides
  // whether a remote player is still drawn.
  if (!isPresenceAlive(newest.expiration, now)) {
    return fallback({
      kind: 'stale-presence',
      presenceLocation: newest.location,
      expiration: newest.expiration,
    });
  }

  if (!isRenderableLocation(newest.location)) {
    return fallback({ kind: 'invalid-location', value: newest.location });
  }

  return {
    location: newest.location,
    position: resolveResumePosition(newest.content, newest.location),
    outcome: { kind: 'fresh-presence', location: newest.location },
  };
}
