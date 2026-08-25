/**
 * Three states, because "no answer" and "Standard" are not the same thing.
 *
 * Today the profile is a literal and resolution is instant, so this distinction
 * buys nothing at runtime. It is here because of what happens the day a
 * guardian can CHOOSE: a stored value has to be read, a read takes time, and
 * the shape that has no word for "still asking" answers "Standard" in the
 * meantime. One frame of Standard is one frame in which a stranger's text can
 * be admitted, an upload can start, or a presence event can be published at
 * full detail — and none of those can be taken back.
 *
 * So the states are named now, while the only profile is Standard and getting
 * it wrong costs nothing:
 *
 * ```
 *   unprovided   no IslandSafetyProvider is mounted above this subtree.
 *                A BUG, not a profile. The world must never mount here.
 *   resolving    a provider is mounted and has not decided yet.
 *   resolved     a profile was chosen deliberately, and its policy is here.
 * ```
 *
 * `unprovided` is deliberately distinct from `resolving`. A missing provider is
 * a wiring mistake that will not fix itself, and treating it as "not yet" would
 * hang the island rather than say so.
 */

import type { ExperienceProfile } from './experience-profile';
import type { IslandSafetyPolicy } from './island-safety-policy';

export type SafetyResolution =
  | { status: 'unprovided' }
  | { status: 'resolving' }
  | { status: 'resolved'; profile: ExperienceProfile; policy: IslandSafetyPolicy };

/**
 * The value a subtree with no provider sees.
 *
 * A frozen singleton so it is referentially stable and safe as a hook
 * dependency, and so an identity check is a legitimate way to spot it.
 */
export const UNPROVIDED_SAFETY: SafetyResolution = Object.freeze({ status: 'unprovided' });
