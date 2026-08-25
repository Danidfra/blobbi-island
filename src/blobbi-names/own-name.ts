/**
 * What this player may call their own Blobbi — checked at the writer, not the
 * input.
 *
 * ## The composer is not the boundary
 *
 * A curated experience shows a two-dropdown composer instead of a text field,
 * and that is presentation. A caller holding `finalizeAdoption` directly — a
 * modified build, a console, a future second naming surface — must not be able
 * to publish `message me on telegram` as a Blobbi name. So the decision lives
 * here, the adoption writer consults it before it signs anything, and the
 * composer is simply the pleasant way to produce something that passes.
 *
 * ## Capability, not profile
 *
 * `ownFreeTextNaming` decides which rule applies. Nothing here compares a
 * profile name.
 */

import type { IslandSafetyPolicy } from '@/safety';

import { validateCuratedBlobbiName, type CuratedNameRejection } from './curated-names';

/** The existing free-text limit, unchanged. */
export const MAX_BLOBBI_NAME_LENGTH = 32;

export type OwnNameRejection = 'empty' | 'too-long' | `curated:${CuratedNameRejection}`;

export type OwnNameAdmission =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: OwnNameRejection };

/**
 * Whether this experience may publish this name, and what to publish.
 *
 * Returns the normalized name so the writer stores what was validated rather
 * than re-deriving it — a trim in one place and not the other is how a value
 * passes a check and then changes on its way to the wire.
 */
export function admitOwnBlobbiName(
  policy: IslandSafetyPolicy,
  value: unknown,
): OwnNameAdmission {
  if (policy.ownFreeTextNaming) {
    // Standard: the rules the hatching flow has always applied — non-empty once
    // trimmed, within the length the input enforces. Deliberately NOT screened
    // against the prohibited-text classifier: that would be a new restriction on
    // an existing experience, and this phase does not quietly add one.
    if (typeof value !== 'string') return { ok: false, reason: 'empty' };
    const trimmed = value.trim();
    if (!trimmed) return { ok: false, reason: 'empty' };
    if (trimmed.length > MAX_BLOBBI_NAME_LENGTH) return { ok: false, reason: 'too-long' };
    return { ok: true, name: trimmed };
  }

  // Curated: the name must structurally belong to the approved vocabulary. A
  // clean sentence is still refused — that is the whole point.
  const curated = validateCuratedBlobbiName(value);
  if (!curated.ok) return { ok: false, reason: `curated:${curated.reason}` };
  return { ok: true, name: curated.name };
}
