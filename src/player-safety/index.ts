/**
 * Player safety: Mute, Block and Report.
 *
 * "I do not want to interact with THIS player", as opposed to `src/safety/`,
 * which answers "what may this EXPERIENCE do". Both gate the same ingest paths
 * and neither depends on the other.
 *
 * Everything here is local-first: pressing Block is enforced by a local write,
 * never by a relay round trip. See `docs/player-safety-controls.md` for the
 * Nostr standards evaluated and the privacy reasoning behind that choice.
 */

export {
  isSelf,
  resetSafetyAccount,
  safetyAccount,
  scopedSafetyKey,
  setSafetyAccount,
  subscribeSafetyAccount,
} from './account-scope';

export type { PlayerRelationship, PlayerSafetyEntry } from './relationships';
export {
  MAX_TRACKED_PLAYERS,
  NO_RELATIONSHIP,
  PLAYER_SAFETY_STORAGE_KEY,
  clearAllRelationships,
  isBlocked,
  isCommunicationSilenced,
  isMuted,
  listRelationships,
  relationshipFor,
  relationshipsSnapshot,
  setPlayerBlocked,
  setPlayerMuted,
  subscribeRelationships,
} from './relationships';

export {
  usePlayerRelationship,
  usePlayerSafetyEntries,
  useOnPlayerSafetyChange,
} from './usePlayerSafety';

export type {
  BuildPlayerReportInput,
  PlayerReport,
  ReportBuildFailure,
  ReportBuildResult,
  ReportCategory,
  ReportCategorySpec,
  ReportedMessageEvidence,
  ReportEvidenceCandidate,
} from './report';
export {
  MAX_STORED_REPORTS,
  PLAYER_REPORT_STORAGE_KEY,
  REPORT_CATEGORIES,
  buildPlayerReport,
  clearStoredReports,
  listReports,
  reportCategoryById,
  storeReport,
} from './report';

export type { RecentMessage } from './recent-messages';
export {
  MAX_REMEMBERED_SENDERS,
  clearRecentMessages,
  forgetMessagesFrom,
  recentMessageFrom,
  rememberMessage,
} from './recent-messages';
