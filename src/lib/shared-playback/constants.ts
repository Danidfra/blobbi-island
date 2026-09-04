/**
 * Shared Playback Session, protocol constants.
 *
 * Every number here comes from `docs/protocol/shared-playback-session.md`
 * (Appendix: constants). They are gathered in one file so a value can never be
 * spelled differently in two places, and so a reviewer can diff the whole
 * protocol's tuning against the specification in one screen.
 */

/** Addressable canonical session state (30000..39999). */
export const KIND_SHARED_PLAYBACK_SESSION = 31951;

/** Ephemeral playback command (20000..29999). */
export const KIND_SHARED_PLAYBACK_COMMAND = 21951;

/** The only schema version this client implements. */
export const CONTENT_VERSION = 1;

/** The reusable room identity for the Blobbi Island theater. */
export const ROOM_THEATER_MAIN = 'blobbi-island:theater:main';

/** Protocol discriminator carried by both kinds. */
export const PROTOCOL_TAG = 'shared-playback';

/** `client` tag value, per project convention. */
export const CLIENT_TAG = 'blobbi-island';

// ── Invitation codes (§3.3) ────────────────────────────────────────────────

/** 31 glyphs: `0 O 1 I L` removed as visually ambiguous. `U` is included. */
export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const INVITE_LENGTH = 6;
/** 256 − (256 % 31): bytes at or above this are rejected to avoid modulo bias. */
export const INVITE_REJECT_BYTE_AT = 248;
export const INVITE_COLLISION_RETRIES = 5;

// ── Lifetimes (§12.3) ──────────────────────────────────────────────────────

/** Rolling session TTL, refreshed on every canonical publish. */
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
/** Ephemeral commands are worthless a moment after they arrive. */
export const COMMAND_TTL_MS = 30 * 1000;
/** Canonical republish cadence: keeps TTL, clock samples and liveness fresh. */
export const KEEPALIVE_INTERVAL_MS = 20 * 1000;
/** No canonical update for this long ⇒ "host may have disconnected" (a hint). */
export const HOST_AWAY_AFTER_MS = 90 * 1000;
/** A cleanly ended session lingers this long so reconnecting guests learn why. */
export const ENDED_TTL_MS = 10 * 60 * 1000;

// ── Synchronization (§8) ───────────────────────────────────────────────────

/** Passive local check cadence. Reads the player; publishes nothing, ever. */
export const DRIFT_CHECK_INTERVAL_MS = 5000;
/** Below this, drift is not worth a seek. */
export const DRIFT_IGNORE_S = 0.75;
/** Above this, seek to the canonical position. */
export const DRIFT_HARD_SEEK_S = 2.0;
/** Checks are skipped for this long after any corrective seek. */
export const SEEK_SETTLE_MS = 2000;
/** Buffering longer than this is worth telling the user about. */
export const BUFFER_WARN_MS = 15000;
/** Rolling window for the passive clock-offset estimate. */
export const CLOCK_SAMPLE_WINDOW = 8;
/** The offset estimate is never trusted beyond this. */
export const CLOCK_OFFSET_CLAMP_MS = 5 * 60 * 1000;
/** `|updatedAt − created_at × 1000|` bound on a well-formed event. */
export const UPDATED_AT_SANITY_MS = 300000;

// ── Control publication (§10) ──────────────────────────────────────────────

/** At most one control publish per this interval. */
export const CONTROL_RATE_LIMIT_MS = 3000;
export const SKIP_STEP_S = 10;

// ── Value bounds (§4.4) ────────────────────────────────────────────────────

/** 24 h ceiling on a position, rejects absurd values outright. */
export const MAX_POSITION_S = 86400;
export const MIN_RATE = 0.25;
export const MAX_RATE = 4;
