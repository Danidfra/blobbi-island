/**
 * Configuration constants for the ephemeral chat system
 */

// Chat message constraints
export const CHAT_MAX_LEN = 120;

// Bubble display duration in milliseconds
export const CHAT_BUBBLE_MS = 4000;

// Drop messages older than this (in milliseconds)
export const CHAT_EVICT_MS = 10000;

// Rate limiting moved to `@/communication/rate-limit`, which sizes a cooldown
// per message class (a one-tap emote needs a higher floor than a typed sentence)
// and adds the receiver-side gate that a send cooldown cannot provide. Leaving a
// second, flat constant here would have been a number that disagreed with the
// one actually in force.

// Ephemeral event kind for chat messages
export const CHAT_KIND = 21201;

// Grace period to wait for player to appear before showing bubble (in milliseconds)
export const CHAT_PLAYER_GRACE_MS = 1000;