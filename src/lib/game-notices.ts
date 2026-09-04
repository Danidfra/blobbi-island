/**
 * Blobbi Island: in-game notices, the small paper chips that appear at the
 * top-right of the game window when something happened to the player in
 * the world ("+1 Strawberry, received from Nostr Farm").
 *
 * ## Why not the app toaster
 *
 * The shadcn `Toaster` portals to `document.body` and pins itself to the
 * browser viewport. That is right for app chrome (a failed save, a relay
 * problem), and wrong for a game moment: in the framed desktop layout the
 * toast landed outside the wood frame, in fullscreen the fullscreened
 * element hid it, and on a phone it competed with the browser's own edges.
 * A game notice belongs INSIDE the game window, so this store feeds a layer
 * that `BlobbiFrame` renders inside the bezel, level with the world.
 *
 * ## Bounded, always
 *
 * At most {@link MAX_VISIBLE_GAME_NOTICES} notices exist at any time. A new
 * one beyond that evicts the OLDEST immediately: no exit animation holds
 * its place, and nothing is queued for later. Each notice also leaves on
 * its own after {@link GAME_NOTICE_TTL_MS}, the same dwell the Farm gives
 * its produce chips. Two is chosen over the Farm's three because the
 * Island's window is shared with a HUD row and, on a phone, is the whole
 * screen; the limit is the same in every layout so the behaviour is one
 * rule, not three.
 *
 * Presentation only. Evicting or expiring a notice tells nobody: the
 * arrival detector that raised it keeps its own baseline, so what was
 * shown once is never re-raised because its chip left early.
 *
 * Module-level like `useToast`, so an account-level controller can raise a
 * notice while the frame, which renders it, lives elsewhere in the tree.
 */

export interface GameNoticeInput {
  /** "+1 Strawberry" */
  title: string;
  /** "Received from Nostr Farm" */
  description?: string;
  /** The item's picture, when it has one; `emoji` is the fallback. */
  imageUrl?: string;
  emoji?: string;
}

export interface GameNotice extends GameNoticeInput {
  id: string;
  createdAt: number;
}

export const MAX_VISIBLE_GAME_NOTICES = 2;
export const GAME_NOTICE_TTL_MS = 7000;

type Listener = () => void;

let notices: readonly GameNotice[] = [];
const listeners = new Set<Listener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let counter = 0;

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function remove(id: string): void {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  if (!notices.some((notice) => notice.id === id)) return;
  notices = notices.filter((notice) => notice.id !== id);
  emit();
}

/**
 * Show a notice. Returns its id. The oldest notice leaves at once when the
 * stack is full; this one leaves after the dwell time, or on `dismiss`.
 */
export function showGameNotice(input: GameNoticeInput, ttlMs: number = GAME_NOTICE_TTL_MS): string {
  counter += 1;
  const id = `game-notice-${counter}`;
  const notice: GameNotice = { ...input, id, createdAt: Date.now() };
  const kept = notices.slice(Math.max(0, notices.length - (MAX_VISIBLE_GAME_NOTICES - 1)));
  for (const evicted of notices.slice(0, notices.length - kept.length)) {
    const timer = timers.get(evicted.id);
    if (timer) clearTimeout(timer);
    timers.delete(evicted.id);
  }
  notices = [...kept, notice];
  timers.set(
    id,
    setTimeout(() => remove(id), ttlMs),
  );
  emit();
  return id;
}

export function dismissGameNotice(id: string): void {
  remove(id);
}

/** Oldest first. Stable reference between changes. */
export function gameNoticesSnapshot(): readonly GameNotice[] {
  return notices;
}

export function subscribeGameNotices(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test hook: forget everything, cancel every dwell timer. */
export function clearGameNotices(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  if (notices.length === 0) return;
  notices = [];
  emit();
}
