/**
 * The turnstile CONTRACT — pure types and the free-play default.
 *
 * The interface lives here, on the pure side of `src/arcade`, so the three
 * machines can depend on "something that admits runs" without any of them
 * importing React, a query client or an inventory writer. The implementation
 * that actually charges Tokens is a hook (`src/hooks/useArcadeGameEntry.ts`)
 * injected from the room, exactly like the reward writer and the run-id minter
 * before it.
 *
 * That split is what keeps `src/arcade` a domain layer: the boundary test
 * enforces it, and a game that could reach an inventory writer on its own is
 * the thing it exists to prevent.
 */

export type ArcadeEntryOutcome =
  /**
   * Play. The turnstile decides WHETHER a run may start and what it costs; it
   * does not name the run — that identity is the machine's, and already
   * injectable for tests.
   */
  | {
      readonly ok: true;
      /** Tokens actually spent — `0` under an active Pass. */
      readonly charged: number;
      readonly waivedByPass: boolean;
    }
  | { readonly ok: false; readonly reason: 'insufficient-tokens'; readonly needed: number }
  /** Not signed in, or the balance is not yet known. Nothing was written. */
  | { readonly ok: false; readonly reason: 'unavailable' }
  /** A start is already being admitted. Nothing was written. */
  | { readonly ok: false; readonly reason: 'busy' }
  /** The spend may or may not have landed, so the run is NOT started. */
  | { readonly ok: false; readonly reason: 'unconfirmed' };

export type ArcadeEntryRefusal = Extract<ArcadeEntryOutcome, { ok: false }>;

export type ArcadeEntryAdmitted = Extract<ArcadeEntryOutcome, { ok: true }>;

export interface ArcadeGameEntry {
  /** Tokens held, or `null` while unknown. Never a fake zero. */
  readonly tokenBalance: number | null;
  /** True while a Pass is waiving Token costs. */
  readonly hasPass: boolean;
  /** Tokens this game costs before any waiver. */
  costFor(gameId: string): number;
  /**
   * Admit a run that costs NOTHING — a free game, or one a Pass waives.
   *
   * Synchronous on purpose. A free admission is a pure decision with no I/O,
   * and making the caller await one would put a microtask between pressing
   * Play and the game starting for every player holding a Pass. Returns
   * `null` when a charge is actually required, and the caller must then await
   * {@link admit}.
   */
  admitFree(gameId: string): ArcadeEntryAdmitted | null;
  /** Charge for and admit one run of `gameId`. */
  admit(gameId: string): Promise<ArcadeEntryOutcome>;
}

/**
 * A turnstile that charges nothing.
 *
 * The default for a machine rendered without one — the DEV harness, a test, or
 * any surface that is not the arcade proper. Free play is the safe default: a
 * machine that silently charged because somebody forgot to wire an entry would
 * be taking money by omission.
 */
export const FREE_ARCADE_GAME_ENTRY: ArcadeGameEntry = Object.freeze({
  tokenBalance: null,
  hasPass: false,
  costFor: () => 0,
  admitFree: () => ({ ok: true as const, charged: 0, waivedByPass: false }),
  admit: async () => ({ ok: true as const, charged: 0, waivedByPass: false }),
});
