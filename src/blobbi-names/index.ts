/**
 * Blobbi names — whose words reach a screen, and what a player may publish.
 *
 * Two independent protections, both structural rather than filter-based:
 * a curated experience never displays a stranger's authored name, and it can
 * only publish a name the approved vocabulary can express.
 *
 * See `docs/safe-user-authored-names.md`.
 */

export type { CuratedNameRejection, CuratedNameResult } from './curated-names';
export {
  CURATED_ADJECTIVES,
  CURATED_NAME_COMBINATIONS,
  CURATED_NOUNS,
  composeCuratedName,
  isCuratedBlobbiName,
  validateCuratedBlobbiName,
} from './curated-names';

export type {
  RemoteNameResolution,
  RemoteNameSource,
  ResolveRemoteNameOptions,
} from './display-names';
export { resolveRemoteBlobbiDisplayName, safeBlobbiAlias } from './display-names';

export type { OwnNameAdmission, OwnNameRejection } from './own-name';
export { MAX_BLOBBI_NAME_LENGTH, admitOwnBlobbiName } from './own-name';
