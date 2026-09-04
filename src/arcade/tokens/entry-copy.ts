/**
 * What the player is told when a run is refused.
 *
 * One place, so three machines cannot describe the same refusal three ways,
 * and so no arcade surface can accidentally call a Token a Ticket while
 * explaining why a play did not start.
 */

import type { ArcadeEntryRefusal } from './game-entry';

/** Player-facing copy for a refused start. Never protocol language. */
export function arcadeEntryRefusalMessage(refusal: ArcadeEntryRefusal): string {
  switch (refusal.reason) {
    case 'insufficient-tokens':
      return refusal.needed === 1
        ? 'You need 1 Arcade Token to play. Get more at the token counter.'
        : `You need ${refusal.needed} Arcade Tokens to play. Get more at the token counter.`;
    case 'unconfirmed':
      // The spend may have landed, so we neither start the run nor claim the
      // token is safe. Trying again is the honest instruction.
      return "We couldn't confirm your token just now, so the game didn't start. Check your tokens and try again.";
    case 'busy':
      return 'Just a moment, your game is already starting.';
    case 'unavailable':
      return "We couldn't read your tokens just now. Try again in a moment.";
  }
}
