/**
 * How a blocked or muted player is named back to the person who blocked them.
 *
 * ## Why not their Blobbi's name
 *
 * Because they chose it. A name is 32 characters of free text authored by the
 * player being listed, and a management screen is exactly where that becomes a
 * problem: the whole point of blocking someone is to stop seeing what they
 * wrote, and a list that renders their chosen words to do it has reintroduced
 * the thing it was built to remove. The audit's Family findings make the same
 * point about names generally (H-1), and a safety surface is the last place to
 * make an exception.
 *
 * So the identifier is derived from the key: an abbreviated npub, which nobody
 * chose and which cannot say anything. It is stable, it matches what other Nostr
 * clients show, and it is the same string every time.
 *
 * A caller MAY pass a remembered Blobbi name as a *secondary* hint where the
 * player already saw it in context, but the npub stays the identity, because
 * that is the part that is true.
 */

import { nip19 } from 'nostr-tools';

/**
 * A short, stable, unchosen identifier for a player.
 *
 * `npub1abcd…wxyz`. Falls back to the raw hex on anything unencodable rather
 * than throwing: a safety list that fails to render is worse than one showing a
 * hex string.
 */
export function playerShortId(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
  } catch {
    return pubkey.length > 12 ? `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}` : pubkey;
  }
}
