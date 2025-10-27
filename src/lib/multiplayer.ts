/**
 * Nostr-Only Multiplayer System for Blobbi Island
 * Using Kind 31950 (Addressable Events) with NIP-40 Expiration
 */

import type { LocationId } from '@/lib/location-types';
import { constrainPosition } from '@/lib/boundaries';
import { locationBoundaries } from '@/lib/location-boundaries';
import type { Position } from '@/lib/types';
import type { NostrEvent } from '@nostrify/nostrify';

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

/** Presence content structure */
export interface PresenceContent {
  state: PlayerState;
  location: LocationId;
  anchor: PositionWithTimestamp;
  goal?: MovementGoal;
  blobbiD?: string; // Optional blobbiD for better tracking
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
  return `31124:${pubkey}:${d}`;
}

/** Parse an 'a' tag into its components */
export function parseA(a: string): { kind: number; pubkey: string; blobbi_d: string } {
  const [k, pk, d] = a.split(':');
  if (k !== '31124' || !pk || !d) {
    throw new Error('Invalid "a" tag format');
  }
  return { kind: 31124, pubkey: pk, blobbi_d: d };
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
    'town': 'town-open.png',
    'home': 'home-inside.png',
    'beach': 'beach-open.png',
    'mine': 'mine-open.png',
    'nostr-station': 'nostr-station-open.png',
    'nostr-station-inside': 'nostr-station-inside.png',
    'plaza': 'plaza-open.png',
    'plaza-inside': 'plaza-inside.png',
    'arcade': 'arcade-inside.png',
    'arcade-1': 'arcade-1.png',
    'arcade-minus1': 'arcade-minus1.png',
    'stage': 'stage-inside.png',
    'shop': 'shopping-mall-inside.png',
    'back-yard': 'back-yard-open.png',
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
  }
): Promise<void> {
  const { sessionId, islandId, location, blobbiAddr, startPos } = params;

  const content: PresenceContent = {
    state: 'idle',
    location,
    anchor: {
      x: startPos.x,
      y: startPos.y,
      ts: nowSec(),
    },
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
  },
  from: Position,
  rawClick: Position,
  speedPx: number,
  nav: WalkableApi
): Promise<Position> {
  const { sessionId, islandId, location, blobbiAddr } = params;

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
 * Publish heartbeat to renew expiration
 */
export async function publishHeartbeat(
  publish: (event: Record<string, unknown>) => Promise<void>,
  params: {
    sessionId: string;
    islandId: string;
    location: LocationId;
    blobbiAddr: string;
  },
  currentPos: Position
): Promise<void> {
  const { sessionId, islandId, location, blobbiAddr } = params;

  const content: PresenceContent = {
    state: 'idle',
    location,
    anchor: {
      x: currentPos.x,
      y: currentPos.y,
      ts: nowSec(),
    },
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