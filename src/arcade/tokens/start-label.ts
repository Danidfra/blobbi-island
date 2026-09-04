/**
 * What the start control of a paid machine must SAY — decided from the entry
 * model alone, so every machine's label agrees with what `admit` will charge.
 * Kept out of the button component so React fast-refresh sees a pure
 * component file there.
 */

import type { ArcadeGameEntry } from './game-entry';

export interface ArcadeStartLabelInput {
  entry: ArcadeGameEntry;
  gameId: string;
  /** A replay after a finished run (same price, different verb). */
  replay?: boolean;
}

/** The label a start/replay control must carry for this game and this player. */
export function arcadeStartLabel({ entry, gameId, replay = false }: ArcadeStartLabelInput): string {
  const cost = entry.costFor(gameId);
  const waived = cost === 0 || entry.hasPass;
  if (waived) return replay ? 'Play again' : 'Start';
  const unit = cost === 1 ? 'Token' : 'Tokens';
  return `${replay ? 'Play again' : 'Play'} · ${cost} ${unit}`;
}

/** Is the player's known balance short of the price (and no Pass covers it)? */
export function arcadeEntryLooksShort({ entry, gameId }: ArcadeStartLabelInput): boolean {
  const cost = entry.costFor(gameId);
  if (cost === 0 || entry.hasPass) return false;
  return entry.tokenBalance !== null && entry.tokenBalance < cost;
}
