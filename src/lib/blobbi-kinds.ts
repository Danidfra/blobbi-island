/**
 * Blobbi Nostr Event Kind Constants
 *
 * Centralized kind numbers aligned with Ditto (source of truth).
 *
 * Kind 1124:  Blobbi Social Interaction (regular event, append-only log)
 * Kind 11125: Blobbonaut Owner Profile (replaceable event)
 * Kind 31124: Blobbi Pet State (addressable event)
 *
 * Legacy kinds (do NOT use for new events):
 * Kind 14919: Old interaction kind from NIP-BB spec (superseded by 1124)
 * Kind 31125: Old owner profile kind (superseded by 11125)
 */

/** Blobbi social interaction event (regular). */
export const KIND_BLOBBI_INTERACTION = 1124;

/** Blobbonaut owner profile (replaceable). */
export const KIND_BLOBBONAUT_PROFILE = 11125;

/** Legacy owner profile kind — query alongside 11125 for backward compat. */
export const KIND_BLOBBONAUT_PROFILE_LEGACY = 31125;

/** Both profile kinds, for use in query filters. */
export const BLOBBONAUT_PROFILE_KINDS = [KIND_BLOBBONAUT_PROFILE, KIND_BLOBBONAUT_PROFILE_LEGACY] as const;

/** Blobbi pet state (addressable). */
export const KIND_BLOBBI_STATE = 31124;
