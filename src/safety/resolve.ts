/**
 * Turning a profile into a policy, and deciding which profile this build runs.
 *
 * This is the ONE place where a profile is compared against anything. Every
 * other module in the application receives a resolved {@link IslandSafetyPolicy}
 * and asks it about capabilities — see `island-safety-policy.ts` for why, and
 * `eslint.config.js` for the rule that keeps it that way.
 */

import type { ExperienceProfile } from './experience-profile';
import type { IslandSafetyPolicy } from './island-safety-policy';
import { FAMILY_POLICY, STANDARD_POLICY } from './policies';

/**
 * The policy for a profile.
 *
 * The switch is exhaustive over {@link ExperienceProfile}, so adding a third
 * profile is a compile error here until its policy is written — which is the
 * cheapest possible reminder that a profile IS a complete capability matrix.
 *
 * **Anything that is not a known profile throws.** It does not fall back to
 * Standard, and it does not merge. A silent fallback is how an unreadable stored
 * profile turns into a permissive one, and a merge is how a policy ends up
 * half-restricted — neither failure would be visible at the call site, and both
 * would be visible to a child. Callers holding untrusted input validate it with
 * `isExperienceProfile` first and choose their fallback deliberately.
 */
export function resolveSafetyPolicy(profile: ExperienceProfile): IslandSafetyPolicy {
  switch (profile) {
    case 'standard':
      return STANDARD_POLICY;
    case 'family':
      return FAMILY_POLICY;
    default:
      throw new Error(
        `Unknown ExperienceProfile ${JSON.stringify(profile)}: refusing to guess a safety policy.`,
      );
  }
}

/**
 * The profile every build of Blobbi Island currently runs.
 *
 * A literal, on purpose. There is no environment variable, no build flag, no
 * storage key, no query parameter and no developer console hook that changes it,
 * because a safety profile that can be flipped by something a player can reach
 * is not a safety profile. Production therefore resolves to `'standard'`
 * deterministically, and this phase is, by construction, incapable of altering
 * what any existing player sees.
 *
 * When profile SELECTION ships, this constant becomes the default rather than
 * the answer: the provider will read a stored, guardian-owned value, validate it
 * with `isExperienceProfile`, and fall back here only when there is genuinely
 * nothing stored. Two things must be true of that change and are worth writing
 * down before anyone makes it:
 *
 *  1. the fallback must never *downgrade* — a device whose guardian chose
 *     `'family'` and whose storage read fails must not silently become Standard;
 *  2. the resolved policy must be available on the very first render, because a
 *     single frame of Standard is a frame in which a stranger's text can be
 *     admitted.
 */
export const ACTIVE_EXPERIENCE_PROFILE: ExperienceProfile = 'standard';
