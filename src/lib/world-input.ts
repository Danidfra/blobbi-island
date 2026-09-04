/**
 * Shared pointer-input policy for the world surface (Phase 3).
 *
 * "Does this pointer event mean *walk there*?" used to be answered by two
 * byte-identical copies of the same selector list + predicate (MovableBlobbi
 * and MultiplayerLayer), plus a narrower third check in
 * `useCancelInteractionOnWorldClick`. A UI element added to one list and
 * forgotten in the other shows up as the local Blobbi walking under a modal
 * while presence stays put; this module is the single answer.
 *
 * Three distinct questions, three exports:
 *
 *  - {@link shouldTriggerWorldMove}, may this event start a world walk?
 *    Used by the local input adapter (MovableBlobbi) and the presence click
 *    publisher (MultiplayerLayer), which must always agree.
 *  - {@link isWithinMoveBlockingUi}, did this event originate on an element
 *    that manages its own interaction lifecycle (`data-block-move`)? Used to
 *    decide whether a world tap cancels a pending walk-to-interact.
 *  - {@link BLOCK_UI_SELECTOR}, the one selector list behind both.
 *
 * Interactive world objects (doors, seats, bushes, machines) carry
 * `data-block-move` and stop propagation themselves; they are never made
 * `pointer-events: none`.
 */

/**
 * Everything a world tap must NOT walk through: app UI, dialogs/menus, form
 * controls, and any element explicitly marked `data-block-move`.
 */
export const BLOCK_UI_SELECTOR = [
  '[data-block-move]',
  '[data-overlay]',
  '[role="dialog"]',
  '[aria-modal="true"]',
  '[role="menu"]',
  '[role="button"]',
  'button',
  'a[href]',
  'input, textarea, select',
  '.modal',
  '.drawer',
  '.popover',
  '.tooltip',
  '.map-ui',
].join(',');

const isPrimaryPointer = (ev: MouseEvent | PointerEvent) =>
  (!('button' in ev) || ev.button === 0) &&
  !ev.altKey &&
  !ev.ctrlKey &&
  !ev.metaKey &&
  !ev.shiftKey;

/**
 * Whether a pointer/touch event on the world should start a world walk.
 *
 * `container` is the world surface the caller listens on (the element carrying
 * `data-world-surface`). The event walks its composed path so nested icons and
 * content inside buttons/interactive elements are attributed to their
 * interactive ancestor, and:
 *
 *  - any UI element in the chain ({@link BLOCK_UI_SELECTOR}) blocks the move;
 *  - a DIFFERENT world surface in the chain blocks it (nested surfaces,
 *    e.g. a preview world inside a modal, own their events);
 *  - a remote player sprite (`[data-player-key]`) blocks it: clicking another
 *    Blobbi is a social action, never local movement;
 *  - the event must originate inside `container`;
 *  - mouse/pointer input must be an unmodified primary-button press.
 *
 * Caller-specific guards (photo-booth mode, "was this my own Blobbi?") stay at
 * the call sites; they are policy about the caller's state, not about the
 * event.
 */
export function shouldTriggerWorldMove(
  ev: MouseEvent | TouchEvent | PointerEvent,
  container: HTMLElement,
): boolean {
  const path = (ev as MouseEvent & { composedPath?: () => EventTarget[] }).composedPath?.();
  const chain: Element[] =
    (path?.filter((n) => n instanceof Element) as Element[] | undefined) ??
    (ev.target instanceof Element ? [ev.target] : []);

  for (const el of chain) {
    if (el.matches?.(BLOCK_UI_SELECTOR)) return false;
    if (el !== container && el.hasAttribute?.('data-world-surface')) return false;
    if (el.closest?.('[data-player-key]')) return false;
  }

  if (!(ev.target instanceof Node) || !container.contains(ev.target)) return false;

  if (ev instanceof MouseEvent && !isPrimaryPointer(ev)) return false;

  return true;
}

/**
 * Whether an event target sits inside an element that manages its own
 * interaction lifecycle (`data-block-move`): interactive world objects, UI
 * chrome, remote Blobbi sprites.
 *
 * Used by the pending-interaction world-click canceller: a pointerdown that
 * reaches the world surface WITHOUT passing this test means the player tapped
 * empty ground or chose another destination, so a pending walk-to-interact is
 * abandoned. Deliberately narrower than {@link BLOCK_UI_SELECTOR}: cancelling
 * is cheap and must stay predictable, so only explicit `data-block-move`
 * carriers are exempt.
 */
export function isWithinMoveBlockingUi(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-block-move]') !== null;
}
