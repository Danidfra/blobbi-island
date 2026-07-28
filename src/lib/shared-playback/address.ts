/**
 * Session addresses — `31951:<host-pubkey-hex>:<session-d>`.
 *
 * This string is the ONLY identifier other systems (presence, UI, deep links)
 * are allowed to hold (protocol §3.1, §14.3). It is self-describing: the host
 * pubkey is inside it, which is why "who is allowed to command this session" is
 * answerable without any extra lookup, and why a session's host can never change.
 */

import { KIND_SHARED_PLAYBACK_SESSION } from './constants';

const HEX64 = /^[0-9a-f]{64}$/;

/** Build the addressable coordinate for a session. */
export function sessionAddress(hostPubkey: string, sessionId: string): string {
  return `${KIND_SHARED_PLAYBACK_SESSION}:${hostPubkey.toLowerCase()}:${sessionId}`;
}

export interface ParsedSessionAddress {
  kind: number;
  hostPubkey: string;
  sessionId: string;
}

/**
 * Parse an address, or `null` if it is not one.
 *
 * Strict on purpose: the pubkey must be 64 lowercase hex characters and the kind
 * must be exactly ours. Addresses arrive from relay tags and from presence
 * content, both of which are attacker-controlled, and every authority decision
 * downstream reads the pubkey out of this string.
 */
export function parseSessionAddress(address: unknown): ParsedSessionAddress | null {
  if (typeof address !== 'string') return null;
  const parts = address.split(':');
  if (parts.length !== 3) return null;
  const [kindPart, pubkey, sessionId] = parts;
  if (kindPart !== String(KIND_SHARED_PLAYBACK_SESSION)) return null;
  if (!HEX64.test(pubkey)) return null;
  if (!sessionId) return null;
  return { kind: KIND_SHARED_PLAYBACK_SESSION, hostPubkey: pubkey, sessionId };
}

/** Whether a value is a syntactically valid session address. */
export function isSessionAddress(address: unknown): address is string {
  return parseSessionAddress(address) !== null;
}

/**
 * Compare two addresses the way §5.4 (3) requires: string-exact after
 * normalizing the pubkey to lowercase. A relay's `#a` filter is a hint, never a
 * guarantee, so every command is re-checked against this.
 */
export function sameAddress(a: unknown, b: unknown): boolean {
  const left = parseSessionAddress(a);
  const right = parseSessionAddress(b);
  if (!left || !right) return false;
  return left.hostPubkey === right.hostPubkey && left.sessionId === right.sessionId;
}
