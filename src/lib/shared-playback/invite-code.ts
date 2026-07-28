/**
 * Invitation codes (protocol §3.3, §13).
 *
 * Six characters from a 31-glyph alphabet, published as the indexed `c` tag.
 *
 * **A code is not a secret and not access control.** It is an indexed tag on a
 * public relay, enumerable by anyone. It buys exactly one thing: not having to
 * read a 64-character pubkey and a UUID out loud. Knowing a code grants no write
 * capability — authority is signature-based (§6.1) — which is why the resolution
 * algorithm below is allowed to be a plain public query.
 */

import {
  INVITE_ALPHABET,
  INVITE_LENGTH,
  INVITE_REJECT_BYTE_AT,
} from './constants';
import type { SharedPlaybackSession } from './types';

/** Two candidate sessions closer together than this are never auto-resolved. */
export const INVITE_AMBIGUITY_WINDOW_S = 60;

/** Fill a byte array with random values. Injected so tests are deterministic. */
export type RandomBytes = (length: number) => Uint8Array;

const defaultRandomBytes: RandomBytes = (length) => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

/**
 * Generate a code with rejection sampling.
 *
 * `byte % 31` over the full 0..255 range would make the first `256 % 31 = 8`
 * glyphs measurably more likely than the rest. Discarding bytes ≥ 248 removes
 * that bias entirely, at the cost of ~3 % more randomness consumed.
 */
export function generateInviteCode(randomBytes: RandomBytes = defaultRandomBytes): string {
  let code = '';
  // A generous cap: the expected number of draws is ~6.2, and a pathological
  // (or hostile test) generator must not be able to spin here forever.
  for (let attempts = 0; code.length < INVITE_LENGTH && attempts < 64; attempts += 1) {
    const bytes = randomBytes(INVITE_LENGTH * 2);
    for (const byte of bytes) {
      if (byte >= INVITE_REJECT_BYTE_AT) continue;
      code += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
      if (code.length === INVITE_LENGTH) break;
    }
  }
  if (code.length !== INVITE_LENGTH) {
    throw new Error('invite-code: random source did not yield enough usable bytes');
  }
  return code;
}

/**
 * Normalize typed input into a canonical code, or `null` if it cannot be one.
 *
 * Accepts the shapes people actually type — lowercase, with spaces or dashes —
 * and rejects everything else BEFORE a relay is queried (§13.2 (1)). A code that
 * cannot exist should cost zero network round trips and produce an immediate,
 * specific message.
 */
export function normalizeInviteCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const stripped = input.trim().toUpperCase().replace(/[\s_-]/g, '');
  if (stripped.length !== INVITE_LENGTH) return null;
  for (const char of stripped) {
    if (!INVITE_ALPHABET.includes(char)) return null;
  }
  return stripped;
}

export type InviteResolution =
  /** Exactly one live session answers to this code. */
  | { type: 'ok'; session: SharedPlaybackSession }
  /** Nothing valid, live and active carries this code. */
  | { type: 'none' }
  /**
   * More than one plausible session. Deliberately NOT resolved silently:
   * joining the wrong host's session is worse than an error message (§13.2 (8)).
   */
  | { type: 'ambiguous'; candidates: SharedPlaybackSession[] };

/**
 * Resolve validated candidates to at most one session (§13.2, steps 4–9).
 *
 * Callers pass sessions that already survived structural validation; this stage
 * applies the *product* rules: exact code match (a relay may over-match its own
 * filter), not ended, not expired, and an explicit refusal to guess between two
 * near-simultaneous or differently-hosted candidates.
 */
export function resolveInviteCode(
  candidates: readonly SharedPlaybackSession[],
  code: string,
  nowMs: number,
): InviteResolution {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return { type: 'none' };

  const nowSec = Math.floor(nowMs / 1000);
  const live = candidates
    .filter((session) => session.code === normalized)
    .filter((session) => session.status === 'active')
    .filter((session) => session.expiration > nowSec);

  if (live.length === 0) return { type: 'none' };
  if (live.length === 1) return { type: 'ok', session: live[0] };

  // Deterministic order: newest first, event id as the final tie-break so two
  // clients looking at the same pair always agree.
  const sorted = [...live].sort((a, b) =>
    b.createdAt - a.createdAt || (a.eventId < b.eventId ? 1 : a.eventId > b.eventId ? -1 : 0),
  );

  const [first, second] = sorted;
  const differentHosts = first.hostPubkey !== second.hostPubkey;
  const tooClose = first.createdAt - second.createdAt <= INVITE_AMBIGUITY_WINDOW_S;
  if (differentHosts || tooClose) return { type: 'ambiguous', candidates: sorted };

  return { type: 'ok', session: first };
}
