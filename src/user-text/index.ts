/**
 * User-authored text guardrails.
 *
 * A reusable primitive that safety surfaces invoke deliberately; never applied
 * automatically to every string in the app, and never the security boundary.
 * See `docs/safe-user-authored-names.md`.
 */

export type { UserTextClassification, UserTextVerdict } from './prohibited-text';
export {
  PROHIBITED_TERMS,
  classifyUserAuthoredText,
  containsProhibitedText,
  normalizeForMatching,
} from './prohibited-text';
