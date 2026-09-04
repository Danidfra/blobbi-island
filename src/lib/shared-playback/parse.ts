/**
 * Parsing and validation for both shared-playback kinds.
 *
 * **The kind number is a routing hint, never proof of provenance.** Nostr has no
 * kind registry with allocation authority, so anything at all may arrive under
 * `31951` / `21951`: from another application that picked the same numbers, or
 * from someone deliberately publishing junk. Every rule below exists so that a
 * hostile or merely foreign event is a no-op rather than a bug:
 *
 *  - structural validation (§4.4, §5.4) before anything is believed;
 *  - `version` gating, so a future schema is ignored rather than guessed at;
 *  - signature-derived authority, a command is accepted only from the pubkey
 *    embedded in the session address it targets (§5.4 (4)), which is the entire
 *    "guests cannot control playback" guarantee;
 *  - numeric bounds, so a 10^9-second position can never reach a player.
 *
 * Rejections are returned as reasons, not thrown: on an open relay a rejected
 * event is the normal case, not an exceptional one.
 */

import type { NostrEvent } from '@nostrify/nostrify';
import { z } from 'zod';
import {
  CONTENT_VERSION,
  KIND_SHARED_PLAYBACK_COMMAND,
  KIND_SHARED_PLAYBACK_SESSION,
  MAX_POSITION_S,
  MAX_RATE,
  MIN_RATE,
  PROTOCOL_TAG,
  UPDATED_AT_SANITY_MS,
} from './constants';
import { parseSessionAddress, sameAddress, sessionAddress } from './address';
import {
  fail,
  ok,
  type ParseResult,
  type RejectionReason,
  type SharedPlaybackCommand,
  type SharedPlaybackSession,
  type SharedPlaybackSessionContent,
} from './types';

/** YouTube ids are exactly 11 URL-safe characters. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Media validation.
 *
 * The theater ships an OPEN catalog (see `docs/theater-local-implementation.md`
 * §3), so the protocol document's optional application-layer rule §4.4 (13),
 * "media.id ∈ curated catalog": has no catalog to check against and is
 * deliberately not implemented. Shape validation still applies: an id that
 * cannot be a YouTube id is refused before it can reach a player.
 */
const mediaSchema = z.object({
  provider: z.literal('youtube'),
  id: z.string().regex(YOUTUBE_ID),
});

const positionSchema = z.number().finite().min(0).max(MAX_POSITION_S);
const rateSchema = z.number().finite().min(MIN_RATE).max(MAX_RATE);
const revSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const updatedAtSchema = z.number().int().min(0);

const sessionContentSchema = z.object({
  version: z.literal(CONTENT_VERSION),
  rev: revSchema,
  media: mediaSchema,
  playback: z.object({
    state: z.enum(['playing', 'paused']),
    position: positionSchema,
    updatedAt: updatedAtSchema,
    rate: rateSchema,
  }),
  permissions: z.object({
    mode: z.literal('host-only'),
  }),
});

const commandBase = {
  version: z.literal(CONTENT_VERSION),
  rev: revSchema,
  position: positionSchema,
  updatedAt: updatedAtSchema,
};

const commandSchema = z.discriminatedUnion('command', [
  z.object({ ...commandBase, command: z.literal('play'), rate: rateSchema }),
  z.object({ ...commandBase, command: z.literal('pause'), rate: rateSchema }),
  z.object({
    ...commandBase,
    command: z.literal('seek'),
    rate: rateSchema,
    reason: z.enum(['direct', 'skip-forward', 'skip-backward', 'restart']).optional(),
  }),
  z.object({
    ...commandBase,
    command: z.literal('set-media'),
    media: mediaSchema,
    state: z.enum(['playing', 'paused']),
    rate: rateSchema,
  }),
  z.object({ ...commandBase, command: z.literal('set-rate'), rate: rateSchema }),
  z.object({ ...commandBase, command: z.literal('end-session') }),
]);

// ── Tag helpers ────────────────────────────────────────────────────────────

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([tagName]) => tagName === name)?.[1];
}

function tagValues(event: NostrEvent, name: string): string[] {
  return event.tags.filter(([tagName]) => tagName === name).map(([, value]) => value ?? '');
}

function hasProtocolTag(event: NostrEvent): boolean {
  return tagValues(event, 't').includes(PROTOCOL_TAG);
}

/** NIP-40, applied client-side because relays may serve expired events anyway. */
function readExpiration(event: NostrEvent): number | null {
  const raw = tagValue(event, 'expiration');
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

// ── Kind 31951 ─────────────────────────────────────────────────────────────

export interface ParseSessionOptions {
  /** Current time, unix SECONDS. */
  nowSec: number;
  /**
   * The host of the session this client is already tracking, when there is one.
   *
   * The host of an address can never change, the pubkey is *inside* the
   * address: so this is a consistency check against a spoofed address arriving
   * through UI input or presence content, not a trust decision.
   */
  knownHostPubkey?: string;
}

export function parseSessionEvent(
  event: NostrEvent,
  { nowSec, knownHostPubkey }: ParseSessionOptions,
): ParseResult<SharedPlaybackSession> {
  if (event.kind !== KIND_SHARED_PLAYBACK_SESSION) return fail('wrong-kind');

  const d = tagValue(event, 'd');
  const room = tagValue(event, 'r');
  const status = tagValue(event, 'status');
  const code = tagValue(event, 'c') ?? null;

  if (!d || !room || !hasProtocolTag(event)) return fail('missing-tag');
  if (status !== 'active' && status !== 'ended') return fail('missing-tag');
  // The code is what makes an active session findable; without it the session
  // is unreachable by every path the product offers.
  if (status === 'active' && !code) return fail('missing-tag');

  const expiration = readExpiration(event);
  if (expiration === null) return fail('missing-tag');
  if (expiration <= nowSec) return fail('expired');

  let raw: unknown;
  try {
    raw = JSON.parse(event.content);
  } catch {
    return fail('malformed-content');
  }

  // `version` is read before the full parse so an unimplemented schema version
  // is reported as exactly that, rather than as a pile of shape errors.
  const version = (raw as { version?: unknown } | null)?.version;
  if (version !== CONTENT_VERSION) return fail('unsupported-version');

  const parsed = sessionContentSchema.safeParse(raw);
  if (!parsed.success) return fail(classifySessionIssue(raw));

  const content = parsed.data as SharedPlaybackSessionContent;

  // Both timestamps come from the host, so a large gap means the event was not
  // produced by a well-behaved client. Playback math never uses `created_at`,
  // but this bound stops a hand-crafted event from claiming an absurd anchor.
  if (Math.abs(content.playback.updatedAt - event.created_at * 1000) > UPDATED_AT_SANITY_MS) {
    return fail('clock-inconsistent');
  }

  if (knownHostPubkey && event.pubkey !== knownHostPubkey) return fail('unauthorized-signer');

  return ok({
    address: sessionAddress(event.pubkey, d),
    hostPubkey: event.pubkey,
    sessionId: d,
    room,
    code,
    status,
    expiration,
    createdAt: event.created_at,
    eventId: event.id,
    content,
  });
}

/**
 * Turn a zod failure into one of the protocol's own reasons.
 *
 * The point is the error MODEL, not diagnostics: "that video id is not one we
 * can play" and "that position is nonsense" lead to different UI, so they must
 * not collapse into a single "malformed" bucket.
 */
function classifySessionIssue(raw: unknown): RejectionReason {
  const value = raw as {
    permissions?: { mode?: unknown };
    playback?: { position?: unknown; rate?: unknown };
    media?: unknown;
    rev?: unknown;
  } | null;

  if (!value || typeof value !== 'object') return 'malformed-content';
  if (value.permissions && value.permissions.mode !== 'host-only') return 'unsupported-permissions';
  if (!mediaSchema.safeParse(value.media).success) return 'unsupported-media';
  if (!revSchema.safeParse(value.rev).success) return 'bad-revision';
  if (value.playback && !positionSchema.safeParse(value.playback.position).success) return 'bad-position';
  if (value.playback && !rateSchema.safeParse(value.playback.rate).success) return 'bad-rate';
  return 'malformed-content';
}

// ── Kind 21951 ─────────────────────────────────────────────────────────────

export interface ParseCommandOptions {
  /** Current time, unix SECONDS. */
  nowSec: number;
  /** The address of the session this client is currently in. */
  expectedAddress: string;
}

export function parseCommandEvent(
  event: NostrEvent,
  { nowSec, expectedAddress }: ParseCommandOptions,
): ParseResult<SharedPlaybackCommand> {
  if (event.kind !== KIND_SHARED_PLAYBACK_COMMAND) return fail('wrong-kind');

  const expiration = readExpiration(event);
  if (expiration === null) return fail('missing-tag');
  if (expiration <= nowSec) return fail('expired');

  // Exactly one `a` tag. Two would make "which session is this for?" a guess,
  // and a command must never be applied to a session it did not name.
  const addresses = tagValues(event, 'a');
  if (addresses.length !== 1) return fail('missing-tag');
  if (!sameAddress(addresses[0], expectedAddress)) return fail('wrong-session');

  const target = parseSessionAddress(addresses[0]);
  if (!target) return fail('wrong-session');

  // THE authority check. Not a UI rule, not a convention: the relay's signature
  // verification plus this comparison is what stops a guest, or a stranger,
  // from steering someone else's session.
  if (event.pubkey !== target.hostPubkey) return fail('unauthorized-signer');

  let raw: unknown;
  try {
    raw = JSON.parse(event.content);
  } catch {
    return fail('malformed-content');
  }

  const version = (raw as { version?: unknown } | null)?.version;
  if (version !== CONTENT_VERSION) return fail('unsupported-version');

  const parsed = commandSchema.safeParse(raw);
  if (!parsed.success) return fail(classifyCommandIssue(raw));

  return ok(parsed.data as SharedPlaybackCommand);
}

const KNOWN_COMMANDS = new Set([
  'play',
  'pause',
  'seek',
  'set-media',
  'set-rate',
  'end-session',
]);

function classifyCommandIssue(raw: unknown): RejectionReason {
  const value = raw as {
    command?: unknown;
    position?: unknown;
    rate?: unknown;
    rev?: unknown;
    media?: unknown;
  } | null;

  if (!value || typeof value !== 'object') return 'malformed-content';
  if (typeof value.command !== 'string' || !KNOWN_COMMANDS.has(value.command)) return 'unknown-command';
  if (!revSchema.safeParse(value.rev).success) return 'bad-revision';
  if (!positionSchema.safeParse(value.position).success) return 'bad-position';
  if (value.command === 'set-media' && !mediaSchema.safeParse(value.media).success) return 'unsupported-media';
  if (value.command !== 'end-session' && !rateSchema.safeParse(value.rate).success) return 'bad-rate';
  return 'malformed-content';
}

/** Whether a media reference is one this client can actually load. */
export function isSupportedMedia(media: unknown): boolean {
  return mediaSchema.safeParse(media).success;
}
