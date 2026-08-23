/**
 * Which EXPERIENCE this client is presenting — and, deliberately, nothing else.
 *
 * ## This is not an age field
 *
 * An `ExperienceProfile` says which set of product capabilities is in effect. It
 * does **not** record, imply or stand in for the player's age, birth date,
 * minor/adult status, or a guardian relationship. Nothing in this module reads
 * or stores any such value, and nothing downstream may reconstruct one from it:
 * a household may run `'family'` on a shared tablet with nobody under thirty in
 * the room, and an adult who simply prefers a quieter island is a first-class
 * user of it.
 *
 * That is a safety decision as much as a privacy one. `docs/family-safety-audit.md`
 * §13 sets out why asking "are you a child?" is both ineffective (the honest
 * answer costs the player features, so it is answered dishonestly) and actively
 * counterproductive (recording the answer creates the data-protection exposure
 * the question was meant to reduce). The way not to have that problem is to
 * never have the field, so this type is the *only* notion of profile in the
 * codebase and it carries no personal data.
 *
 * ## Why the union stays tiny
 *
 * Two members, and adding a third must be a deliberate act: every profile is a
 * complete capability matrix somebody has to maintain, reason about and test.
 * The union is exhaustive-switched in `resolve.ts`, so a third member fails to
 * compile until its policy exists — which is the point.
 *
 * ## Why this type barely leaves this directory
 *
 * Feature code asks the resolved policy what it may do; it does not ask who the
 * player is. See `island-safety-policy.ts` for the reasoning and
 * `eslint.config.js` for the rule that keeps it true.
 */

/**
 * The experiences Blobbi Island can present.
 *
 * - `'standard'` — the island as it ships today: free-text chat, an open
 *   theater catalog, working external links and shares.
 * - `'family'` — the reduced-risk experience defined by
 *   {@link ../../docs/family-safety-policy.md}. Defined and tested, **not yet
 *   selectable by anyone**; see `resolve.ts`.
 */
export type ExperienceProfile = 'standard' | 'family';

/**
 * Every profile, in one place, so a test can enumerate them without restating
 * the union. Order is stability-only and carries no meaning.
 */
export const EXPERIENCE_PROFILES: readonly ExperienceProfile[] = Object.freeze([
  'standard',
  'family',
]);

/**
 * Whether an unknown value is a profile this build understands.
 *
 * The guard exists for the boundary that does not exist yet: when a profile
 * becomes selectable it will be read back from storage, and storage returns
 * `unknown`. Validating there — rather than casting — is what stops a corrupted
 * or hand-edited value from reaching {@link resolveSafetyPolicy}.
 *
 * Note what it deliberately does NOT do: it does not pick a fallback. Choosing
 * what an unreadable stored profile means is a product decision with a real
 * wrong answer (a device whose guardian selected `'family'` must not silently
 * fall back to `'standard'`), so it belongs to the phase that introduces
 * storage, not to this guard.
 */
export function isExperienceProfile(value: unknown): value is ExperienceProfile {
  return (EXPERIENCE_PROFILES as readonly unknown[]).includes(value);
}
