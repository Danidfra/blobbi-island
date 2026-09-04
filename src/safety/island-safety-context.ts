/**
 * How a component gets the resolved policy.
 *
 * ## Why a context, when the answer is currently a constant
 *
 * A module-level singleton would be smaller today and wrong tomorrow, for two
 * reasons that are already visible:
 *
 *  1. **The value stops being constant.** The profile will come from stored,
 *     guardian-owned state, and it must be able to change without a reload. A
 *     singleton read at import time cannot do that; every consumer would have to
 *     be rewritten at the moment the feature ships.
 *  2. **A test needs to stand the world up under Family.** The proof that
 *     matters for this phase, a hostile kind 21201 refused *before* it becomes
 *     a speech bubble, requires rendering the real `MultiplayerLayer` with a
 *     Family policy in scope. A context gives that test a legitimate seam
 *     instead of a module mock, so the test exercises the same lookup the
 *     running game uses.
 *
 * It is otherwise as small as a context can be: one value, no state, no effects,
 * no storage, no subscription.
 *
 * ## Why the default is still Standard, and what now stops it mattering
 *
 * A missing provider yields {@link STANDARD_POLICY}. That is failing OPEN, it is
 * the wrong long-term default, and it is kept only because hundreds of unit
 * tests render a single component with no provider above it and would otherwise
 * be testing their harness rather than their subject.
 *
 * What changed in Phase H.0 is that the fallback can no longer be reached by
 * anything that matters:
 *
 *  - it is REPORTED, {@link noteMissingSafetyProvider} logs, loudly, outside
 *    production, so a component that lost its provider says so instead of
 *    quietly becoming permissive;
 *  - and the ISLAND cannot mount on it at all. `SafetyGate` renders the world
 *    only under a `resolved` {@link SafetyResolution}, and `unprovided` is a
 *    distinct state from `resolving` precisely so it can be refused rather than
 *    waited for.
 *
 * So the invariant is enforced where a capability can actually do damage,
 * publish, upload, admit a stranger's text, rather than by making every button
 * in the app require a provider to render.
 */

import { createContext, useContext } from 'react';

import type { IslandSafetyPolicy } from './island-safety-policy';
import { STANDARD_POLICY } from './policies';
import { UNPROVIDED_SAFETY, type SafetyResolution } from './safety-resolution';

/**
 * Whether a profile has been resolved for this subtree, and which.
 *
 * Defaults to `unprovided`: the state that means "nobody has mounted a
 * provider", which is distinct from both "still deciding" and "Standard".
 */
export const SafetyResolutionContext = createContext<SafetyResolution>(UNPROVIDED_SAFETY);

/**
 * The policy in effect for the subtree.
 *
 * Exported for the provider and for tests that need to supply a value directly;
 * feature code uses {@link useIslandSafetyPolicy} instead.
 */
export const IslandSafetyPolicyContext = createContext<IslandSafetyPolicy>(STANDARD_POLICY);

/**
 * The resolved policy for the current experience.
 *
 * The one call feature code should make. Ask it about capabilities:
 *
 * ```ts
 * const policy = useIslandSafetyPolicy();
 * if (!policy.externalLinks) return;
 * ```
 *
 * The returned object is frozen and stable across renders, so it is safe to use
 * directly as a hook dependency without memoization.
 */
export function useIslandSafetyPolicy(): IslandSafetyPolicy {
  // Both contexts read unconditionally, hooks are not allowed to be optional,
  // and the branch below is about which ANSWER wins, not which hook runs.
  const resolution = useContext(SafetyResolutionContext);
  const fallback = useContext(IslandSafetyPolicyContext);

  if (resolution.status === 'resolved') return resolution.policy;
  if (resolution.status === 'unprovided') noteMissingSafetyProvider();
  return fallback;
}

/**
 * How the island learns whether a profile has been chosen yet.
 *
 * Separate from the policy hook because they answer different questions.
 * "Which capabilities do I have?" is asked by every feature and always needs an
 * answer; "has anybody decided yet?" is asked by exactly one thing, the gate
 * that mounts the world, and its whole value is being able to say "no".
 */
export function useSafetyResolution(): SafetyResolution {
  return useContext(SafetyResolutionContext);
}

/**
 * A subtree asked for a policy with no provider above it.
 *
 * Loud outside production, silent inside it: this is a wiring bug, and a wiring
 * bug should stop a developer rather than a player. Counted as well as logged
 * so a test can assert the real application tree never reaches it, which is
 * the assertion that makes the permissive fallback tolerable.
 */
let missingProviderReports = 0;
let missingProviderLogged = false;

export function noteMissingSafetyProvider(): void {
  missingProviderReports += 1;
  /*
    Once per session, and in every build.

    Once because this runs during render, and a component that re-renders sixty
    times a second does not need to say the same thing sixty times a second.

    In every build because the alternative is reading the build mode here, and
    the safety layer is asserted to be decidable without ambient state, a rule
    worth more than suppressing one console line a player will never look at.
    Nothing about the message is sensitive: it names a wiring bug.
  */
  if (missingProviderLogged) return;
  missingProviderLogged = true;
  console.error(
    '[safety] useIslandSafetyPolicy() was called with no IslandSafetyProvider above it. ' +
      'Falling back to Standard, which is a bug and not a profile; see src/safety/island-safety-context.ts.',
  );
}

/** How many times the missing-provider fallback has been taken. For tests. */
export function missingSafetyProviderCount(): number {
  return missingProviderReports;
}

/** Reset the counter. For tests only. */
export function resetMissingSafetyProviderCount(): void {
  missingProviderReports = 0;
  missingProviderLogged = false;
}
