/**
 * Blobbi Island's safety and capability layer.
 *
 * The public surface is deliberately narrow. Feature code needs three things:
 * the {@link useIslandSafetyPolicy} hook, the {@link IslandSafetyPolicy} type,
 * and whichever pure admission helper guards the boundary it is working on. The
 * profile union, the two policy literals and the resolver are exported for the
 * provider, for tests and for future safety-layer work — an ESLint rule keeps
 * them from being imported by feature code, because a capability check is what
 * belongs at a call site, not a comparison against who the player is.
 *
 * Rationale: `docs/family-safety-audit.md`.
 * Implementation contract: `docs/family-safety-policy.md`.
 */

export type { ExperienceProfile } from './experience-profile';
export { EXPERIENCE_PROFILES, isExperienceProfile } from './experience-profile';

export type { IslandSafetyPolicy } from './island-safety-policy';
export { assertPolicyInvariants } from './island-safety-policy';

export { FAMILY_POLICY, STANDARD_POLICY } from './policies';
export { ACTIVE_EXPERIENCE_PROFILE, resolveSafetyPolicy } from './resolve';

export { IslandSafetyPolicyContext, useIslandSafetyPolicy } from './island-safety-context';
export { IslandSafetyProvider } from './IslandSafetyProvider';

export type {
  ChatAdmission,
  ChatMessageCandidate,
  ChatRejectionReason,
} from './chat-admission';
export { admitChatMessage } from './chat-admission';
