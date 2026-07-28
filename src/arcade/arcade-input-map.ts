/**
 * Arcade input — the pure half.
 *
 * Event → action mapping lives here, with no React and no DOM, so it can be
 * tested exhaustively without simulating a keyboard. `useArcadeInput.ts` is a
 * thin listener wrapper around these functions; every decision worth testing is
 * in this file.
 *
 * ## Scope
 *
 * Four lanes plus a pause control. That is what the first game (the basement
 * rhythm machine) needs and nothing more. There is no gamepad support: the repo
 * has no precedent for it, no product requirement asks for it, and it would
 * double the mapping surface for a device nobody has said they use. Revisit
 * after two games ship.
 *
 * There is also no score logic here, and there must never be. This module turns
 * a key into `{ lane: 'left', phase: 'press' }`; what a lane press is WORTH is
 * the game's business.
 */

/** The four lanes of a rhythm-style game, named by direction, not by key. */
export const ARCADE_LANES = ['left', 'down', 'up', 'right'] as const;
export type ArcadeLane = (typeof ARCADE_LANES)[number];

export type ArcadeInputAction =
  | { readonly type: 'lane'; readonly lane: ArcadeLane; readonly phase: 'press' | 'release' }
  | { readonly type: 'pause' };

/** `KeyboardEvent.key` → lane. Both arrows and WASD, because both are expected. */
export type ArcadeKeymap = Readonly<Record<string, ArcadeLane>>;

export const DEFAULT_ARCADE_KEYMAP: ArcadeKeymap = {
  ArrowLeft: 'left',
  ArrowDown: 'down',
  ArrowUp: 'up',
  ArrowRight: 'right',
  a: 'left',
  s: 'down',
  w: 'up',
  d: 'right',
  A: 'left',
  S: 'down',
  W: 'up',
  D: 'right',
};

/**
 * Keys whose default browser behaviour must be suppressed while a game is
 * active. Arrows and space scroll the page; a rhythm game that scrolls the
 * world out from under itself is unplayable.
 *
 * Nothing here suppresses `Escape` or `Tab`: closing and focus traversal must
 * keep working, which is the difference between "captures input" and "traps the
 * player".
 */
export const ARCADE_PREVENT_DEFAULT_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowDown',
  'ArrowUp',
  'ArrowRight',
  ' ',
  'Spacebar',
]);

/** Keys that request a pause. Escape is NOT one — Escape closes the shell. */
export const ARCADE_PAUSE_KEYS: ReadonlySet<string> = new Set(['p', 'P']);

export interface KeyEventLike {
  readonly key: string;
  /** True for the auto-repeat events a held key emits. */
  readonly repeat?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}

/**
 * Resolve a key event to an arcade action, or `null` when the key means nothing
 * here.
 *
 * Auto-repeat is dropped: holding an arrow must not machine-gun presses at the
 * OS repeat rate. A modifier combination is dropped too — `Cmd+R` is a reload,
 * not a left-lane hit.
 */
export function resolveKeyAction(
  event: KeyEventLike,
  phase: 'down' | 'up',
  keymap: ArcadeKeymap = DEFAULT_ARCADE_KEYMAP,
): ArcadeInputAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (phase === 'down' && event.repeat) return null;

  if (phase === 'down' && ARCADE_PAUSE_KEYS.has(event.key)) return { type: 'pause' };

  const lane = keymap[event.key];
  if (!lane) return null;
  return { type: 'lane', lane, phase: phase === 'down' ? 'press' : 'release' };
}

/** Whether this key's default action must be suppressed while playing. */
export function shouldPreventDefault(key: string): boolean {
  return ARCADE_PREVENT_DEFAULT_KEYS.has(key);
}

/**
 * Human-readable control mapping, rendered by the shell's preview so a player
 * knows what a game will ask of them before it starts.
 *
 * Lives with the keymap rather than in a component so the copy cannot drift away
 * from the bindings it describes.
 */
export interface ArcadeControlHint {
  readonly lane: ArcadeLane;
  readonly desktop: string;
  readonly mobile: string;
}

export const ARCADE_CONTROL_HINTS: readonly ArcadeControlHint[] = [
  { lane: 'left', desktop: '←  or  A', mobile: 'Tap the far-left zone' },
  { lane: 'down', desktop: '↓  or  S', mobile: 'Tap the centre-left zone' },
  { lane: 'up', desktop: '↑  or  W', mobile: 'Tap the centre-right zone' },
  { lane: 'right', desktop: '→  or  D', mobile: 'Tap the far-right zone' },
];

/** Minimum touch-zone edge, in CSS pixels. Below this, taps start missing. */
export const ARCADE_TOUCH_ZONE_MIN_PX = 44;
