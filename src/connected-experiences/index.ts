/**
 * Connected Experiences: what the Nostr Station knows about the independent
 * Nostr apps it hands players to. Presentation and destinations only; the
 * inventory side of interoperability lives in `src/inventory`.
 */

export type {
  ConnectedExperience,
  ConnectedExperienceLaunchMode,
  ConnectedExperienceUrlOverrides,
} from './connected-experiences-config';
export {
  CONNECTED_EXPERIENCES,
  NOSTR_FARM_EXPERIENCE,
  NOSTR_FARM_URL,
  connectedExperienceUrlOverrides,
  getConnectedExperience,
  overrideEnvName,
  resolveConnectedExperienceUrl,
} from './connected-experiences-config';
export { clearLaunchHint, hasSeenLaunchHint, markLaunchHintSeen } from './launch-hint';
