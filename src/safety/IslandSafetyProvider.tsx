/**
 * Puts the resolved policy in scope for the application.
 *
 * Mounted once, near the top of `App.tsx`, above everything that can render
 * content another player authored.
 *
 * ## It has no way to become Family in production
 *
 * The `profile` prop defaults to {@link ACTIVE_EXPERIENCE_PROFILE}, which is the
 * literal `'standard'`. `App.tsx` passes nothing. There is no setting, no
 * storage read, no URL parameter and no environment variable behind it, so a
 * deployed build resolves to Standard deterministically — this phase defines the
 * Family policy and deliberately leaves it unreachable.
 *
 * The prop exists so tests can mount the real component tree under a real
 * profile, which is what makes the Family enforcement proof a proof about the
 * shipping code path rather than about a mock. `boundaries.test.ts` checks that
 * no non-test module outside `src/safety/` names the Family policy or passes a
 * profile, so the prop cannot quietly acquire a caller.
 */

import type { ReactNode } from 'react';

import type { ExperienceProfile } from './experience-profile';
import { IslandSafetyPolicyContext } from './island-safety-context';
import { ACTIVE_EXPERIENCE_PROFILE, resolveSafetyPolicy } from './resolve';

interface IslandSafetyProviderProps {
  children: ReactNode;
  /**
   * Which experience to present. Defaults to the build's active profile;
   * supplying it is a testing affordance, not a product feature.
   */
  profile?: ExperienceProfile;
}

export function IslandSafetyProvider({
  children,
  profile = ACTIVE_EXPERIENCE_PROFILE,
}: IslandSafetyProviderProps) {
  // Resolution is a pure lookup returning one of two frozen singletons, so the
  // value is referentially stable for a given profile and needs no memo.
  const policy = resolveSafetyPolicy(profile);

  return (
    <IslandSafetyPolicyContext.Provider value={policy}>
      {children}
    </IslandSafetyPolicyContext.Provider>
  );
}
