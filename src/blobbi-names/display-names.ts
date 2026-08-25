/**
 * Whose words appear on a player's screen — the one place that decides.
 *
 * ## The threat
 *
 * A Blobbi name is up to thirty-two characters of free text, published in kind
 * 31124 by its owner, and rendered above their Blobbi to everyone in the room.
 * It is the last surface where a stranger can put words of their own choosing
 * in front of a curated player: chat is structured, item names are
 * issuer-locked, theater media is catalogued. This closes it.
 *
 * ## Two rules, and the stronger one is not a filter
 *
 * `strangerAuthoredNames: false` means **never show an authored name**, not
 * "show it if it passes a profanity check". Weakening it to the latter would
 * make a denylist the boundary, and a denylist loses to `come find me on
 * discord` — which is clean, and is the message that actually matters.
 *
 * So a curated experience substitutes a deterministic alias unconditionally. The
 * prohibited-text classifier is available here for a *different* case (§
 * {@link ResolveRemoteNameOptions.screenAuthoredText}) and is defence in depth,
 * never the thing being relied on.
 *
 * ## Resolve once, at the model boundary
 *
 * Every display of a remote name — the hover label, its `title` and
 * `aria-label`, the info modal's heading, the actor's tooltip — reads
 * `BlobbiVisual.name`. So the substitution happens where a stranger's kind 31124
 * BECOMES that field, and every consumer downstream is safe without knowing this
 * module exists. Patching each component would have been six chances to miss
 * one, and the seventh would be added next month.
 *
 * The authored text is not destroyed: the stranger's own event is untouched, and
 * nothing here rewrites anything on a relay. It simply never becomes display
 * text.
 */

import { genUserName } from '@/lib/genUserName';
import type { IslandSafetyPolicy } from '@/safety';
import { containsProhibitedText } from '@/user-text';

/**
 * A stable, safe stand-in for a player whose name may not be shown.
 *
 * ## Reusing `genUserName`
 *
 * Deliberately the existing generator rather than a second identity-naming
 * system. It already satisfies everything an alias needs — deterministic from a
 * pubkey, no relay lookup, no authored input, stable across renders and
 * reloads, ASCII letters and one space, bounded length — and its vocabulary
 * (twenty-four adjectives × twenty-four animals) is clean. This module's test
 * asserts every one of the 576 outputs against the prohibited-text classifier,
 * so "clean" is checked rather than assumed.
 *
 * Wrapped under this name so the intent is legible at the call site, and so the
 * vocabulary can diverge later without touching consumers.
 *
 * **Not a security identifier.** The generator's hash is small and collisions
 * are common — two strangers can share an alias. That is fine for a label whose
 * job is "something to call them"; anywhere identity matters, the pubkey is
 * used instead (see `player-safety`'s settings list, which shows an npub).
 */
export function safeBlobbiAlias(pubkey: string): string {
  if (!pubkey) return 'Someone';
  return genUserName(pubkey);
}

export interface ResolveRemoteNameOptions {
  readonly policy: IslandSafetyPolicy;
  /** The author. Seeds the alias; never displayed directly. */
  readonly pubkey: string;
  /** The name the stranger chose, already resolved from their event. */
  readonly authoredName: string | null | undefined;
  /**
   * Screen an authored name against the prohibited-text classifier.
   *
   * For a surface that permits authored names but wants obvious abuse filtered:
   * clean text is shown, prohibited text becomes the alias.
   *
   * Off by default, because Standard's current behaviour is to show the name and
   * this phase does not quietly change it. It exists so that a future profile
   * which permits authored names cannot accidentally become a place prohibited
   * text is rendered — the distinction is in the API rather than in somebody
   * remembering.
   */
  readonly screenAuthoredText?: boolean;
}

/** Why the displayed name is what it is. Useful in tests and diagnostics. */
export type RemoteNameSource = 'authored' | 'alias';

export interface RemoteNameResolution {
  readonly name: string;
  readonly source: RemoteNameSource;
}

/**
 * The name to show for a remote player's Blobbi.
 *
 * Never throws and never returns an empty string: a missing or unusable authored
 * name falls back to the alias, so no surface has to invent its own placeholder.
 */
export function resolveRemoteBlobbiDisplayName({
  policy,
  pubkey,
  authoredName,
  screenAuthoredText = false,
}: ResolveRemoteNameOptions): RemoteNameResolution {
  const alias = (): RemoteNameResolution => ({ name: safeBlobbiAlias(pubkey), source: 'alias' });

  // The strong rule: an experience that does not permit authored names never
  // shows one, however innocent it is.
  if (!policy.strangerAuthoredNames) return alias();

  const authored = typeof authoredName === 'string' ? authoredName.trim() : '';
  if (!authored) return alias();

  if (screenAuthoredText && containsProhibitedText(authored)) return alias();

  return { name: authored, source: 'authored' };
}
