/**
 * ARRIVING ON ENTRY: whenever the world opens with a Blobbi (the app opened,
 * a reload, back from another Blobbi world), the Blobbi is not standing
 * there already: it arrives through the teleport's own arrival (motes come
 * down, the body forms), exactly once per mount of the world. The same
 * convention as Blobbi Home's "coming home" (`room-arrival.ts`) and Pixel's
 * held entry (`entryDecision` in its travel host), with the same gate:
 *
 *   - World Travel off (or no session: signed out, another account's
 *     Blobbi): the arrival plays after a short beat, once the world is drawn;
 *   - World Travel on Nostr: the arrival WAITS for the first look at the
 *     relays. A location this device kept (`cached`) is never enough to draw
 *     the Blobbi: it may be stale (the origin of a trip never learns the move
 *     the destination made). Once a relay answered (`confirmed`), or none
 *     did within the kit's timeout (`unreachable`: the kept place, or the
 *     default World, stands), the Blobbi arrives if it is here and stays
 *     absent if it is elsewhere (the away card says where). The wait is
 *     bounded by `ENTRY_HOLD_MAX_MS` so a page never waits on the network
 *     for ever: a place still unknown then is shown as not here;
 *   - nothing here reads or writes a location: the kit's session does the
 *     looking, and the room's own presence (kind 31950) waits until the
 *     Blobbi has formed.
 *
 * Pure decisions, so the provider's timing is testable without a relay.
 */
import type { TravelResolution } from '@blobbi-kit/core';

/** The longest the entry waits for the first look (the kit's relay timeout is 4 s). */
export const ENTRY_HOLD_MAX_MS = 6_000;
/** A beat after the world is drawn, so the arrival is seen landing in it rather than with it. */
export const ENTRY_BEAT_MS = 280;

export type EntryDecision = 'wait' | 'enter' | 'skip';

export interface EntryFacts {
  /**
   * How sure the place is: the kit's resolution while a session runs, `none` when no session will (World Travel
   * off, no signed-in owner for this Blobbi, no relays): the Blobbi is simply here then.
   */
  resolution: TravelResolution | 'none';
  /** It is here (`travel.here`: the session's word, or true with no session). */
  here: boolean;
  /** How long the entry has waited (ms). */
  heldFor: number;
}

/** What the entry does now. `wait` asks again when the facts change, and at the latest when the hold runs out. */
export function entryDecision({ resolution, here, heldFor }: EntryFacts): EntryDecision {
  if (resolution === 'pending' || resolution === 'cached') {
    if (heldFor < ENTRY_HOLD_MAX_MS) return 'wait';
    // The hold ran out with no answer: a place not known at all is not here; a kept place stands, as the kit says
    return resolution === 'cached' && here ? 'enter' : 'skip';
  }
  return here ? 'enter' : 'skip';
}

let enabled = true;

/**
 * Test seam: suites about something else may start with the Blobbi present, as before the arrival on entry existed.
 * Never called by the app.
 */
export function setEntryArrivalEnabled(on: boolean): void {
  enabled = on;
}

export function entryArrivalEnabled(): boolean {
  return enabled;
}
