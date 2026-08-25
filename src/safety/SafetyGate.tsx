/**
 * The world does not mount until a profile has been chosen.
 *
 * ## Why a gate rather than a check inside the island
 *
 * Every capability in this game is enforced at a data boundary — chat
 * admission, egress, uploads, theater media, naming, presence projection — and
 * every one of those boundaries reads a policy. Mounting the island first and
 * "tightening" it once a profile arrives would mean each of those boundaries
 * had already answered a question once, under whichever policy happened to be
 * in scope, and some of those answers are events on a relay.
 *
 * So the ordering is inverted: resolve, then mount. The island renders for the
 * first time already knowing what it may do.
 *
 * ## Three states, three behaviours
 *
 * ```
 *   resolved     mount the world under exactly that policy
 *   resolving    hold — a neutral surface, no world, no publish, no subscription
 *   unprovided   REFUSE. A missing provider is a wiring bug that will not
 *                resolve itself, and waiting forever would hide it.
 * ```
 *
 * `unprovided` is why the permissive context fallback is survivable: a
 * component that loses its provider gets Standard and says so, but the ISLAND
 * cannot mount that way at all.
 *
 * ## The holding surface says nothing
 *
 * No age language, no mention of profiles, no explanation of what is being
 * decided — a child should never be shown the machinery of their own
 * supervision, and there is nothing here a player can act on. It is a moment of
 * the island's own background, which today never renders because resolution is
 * synchronous.
 */

import type { ReactNode } from 'react';

import { useSafetyResolution } from './island-safety-context';

interface SafetyGateProps {
  children: ReactNode;
  /** Shown while a profile is being resolved. Neutral and brief by contract. */
  fallback?: ReactNode;
}

export function SafetyGate({ children, fallback = null }: SafetyGateProps) {
  const resolution = useSafetyResolution();

  if (resolution.status === 'resolved') return <>{children}</>;

  // `unprovided` renders the same nothing as `resolving`, deliberately: the
  // difference is reported at the policy hook, and neither state may mount a
  // world. What must not happen is either one rendering the island.
  return <>{fallback}</>;
}
