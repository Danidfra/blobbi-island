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
 *     matters for this phase — a hostile kind 21201 refused *before* it becomes
 *     a speech bubble — requires rendering the real `MultiplayerLayer` with a
 *     Family policy in scope. A context gives that test a legitimate seam
 *     instead of a module mock, so the test exercises the same lookup the
 *     running game uses.
 *
 * It is otherwise as small as a context can be: one value, no state, no effects,
 * no storage, no subscription.
 *
 * ## Why the default is Standard rather than a throw
 *
 * A missing provider yields {@link STANDARD_POLICY}, which is exactly today's
 * behaviour — so adding this module cannot change what any existing screen or
 * any existing test does, which is the invariant this phase is built around.
 *
 * The trade-off is real and worth naming: failing *open* to the permissive
 * profile is the wrong long-term default. It is acceptable only while Standard
 * IS the shipped product and Family is unreachable. The moment a profile can be
 * selected, this default has to become a deliberate resolution — the provider
 * mounted above everything that could render foreign content, and the absence of
 * one treated as a bug rather than an answer. `docs/family-safety-policy.md`
 * records that as a Phase G precondition.
 */

import { createContext, useContext } from 'react';

import type { IslandSafetyPolicy } from './island-safety-policy';
import { STANDARD_POLICY } from './policies';

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
  return useContext(IslandSafetyPolicyContext);
}
