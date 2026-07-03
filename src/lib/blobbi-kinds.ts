/**
 * Blobbi Nostr Event Kind Constants
 *
 * These values are now sourced from the shared `@blobbi-kit/core` package (the
 * single source of truth) and re-exported here so existing Island imports of
 * `@/lib/blobbi-kinds` keep working unchanged.
 *
 * Kind 1124:  Blobbi Social Interaction (regular event, append-only log)
 * Kind 11125: Blobbonaut Owner Profile (replaceable event)
 * Kind 31124: Blobbi Pet State (addressable event)
 *
 * Legacy kinds (do NOT use for new events):
 * Kind 14919: Old interaction kind from NIP-BB spec (superseded by 1124)
 * Kind 31125: Old owner profile kind (superseded by 11125)
 */

import { KIND_BLOBBI_INTERACTION } from '@blobbi-kit/core/blobbi-interaction';
import {
  KIND_BLOBBONAUT_PROFILE,
  KIND_BLOBBONAUT_PROFILE_LEGACY,
  BLOBBONAUT_PROFILE_KINDS,
  KIND_BLOBBI_STATE,
} from '@blobbi-kit/core/blobbi';

export {
  /** Blobbi social interaction event (regular). */
  KIND_BLOBBI_INTERACTION,
  /** Blobbonaut owner profile (replaceable). */
  KIND_BLOBBONAUT_PROFILE,
  /** Legacy owner profile kind — query alongside 11125 for backward compat. */
  KIND_BLOBBONAUT_PROFILE_LEGACY,
  /** Both profile kinds, for use in query filters. */
  BLOBBONAUT_PROFILE_KINDS,
  /** Blobbi pet state (addressable). */
  KIND_BLOBBI_STATE,
};
