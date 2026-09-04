/**
 * The line between what an error SAYS and what a player is SHOWN.
 *
 * Hooks throw for two audiences at once. Some messages are written for the
 * player ("Only 2 Strawberry left", "That Blobbi is too young for this") and
 * should reach them verbatim. Others are diagnostics — a relay URL, an event
 * coordinate, `kind:31633`, a pubkey, "All relays failed", "signal aborted" —
 * and mean nothing to a player except that something is broken in a way they
 * cannot act on. Toasts used to forward `error.message` unread, so both kinds
 * reached the screen.
 *
 * `playerFacingMessage` is the ONE filter every game surface calls: a message
 * that reads like it was written for a person is kept; anything that carries
 * an internal id, a protocol term or a runtime's own phrasing is replaced by
 * the surface's fallback. Throw {@link PlayerFacingError} to bypass the
 * heuristic for copy that is deliberate but would trip it.
 *
 * Nothing here changes what is thrown or logged — diagnostics still go to the
 * console and the dev tools untouched. Only the toast copy is decided here.
 */

/** An error whose message was written for the player and must be shown as is. */
export class PlayerFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlayerFacingError';
  }
}

const TECHNICAL_PATTERNS: readonly RegExp[] = [
  /[0-9a-f]{32,}/i, // pubkeys, event ids, coordinates
  /\b(?:wss?|https?):\/\//i, // relay and web URLs
  /\bkinds?[: ]\s*\d+/i, // "kind:31633", "kind 1416"
  /\b[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)*\b/, // context/item ids: farm:main, blobbi:island
  /\brelays?\b/i, // relay-protocol wording
  /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|AbortError|DOMException|NetworkError|ECONN[A-Z]*|ETIMEDOUT|undefined|null|NaN|JSON|WebSocket|XMLHttpRequest|fetch|nip\d+|NIP-\d+)\b/,
  /\b(?:is not a function|cannot read propert|failed to fetch|unexpected token|timed out|timeout|aborted|signal|stack)\b/i,
  /\[object /,
];

/** Does this message read like a diagnostic rather than a sentence for a player? */
export function looksTechnical(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length === 0) return true;
  return TECHNICAL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * The message a player may see for this error: the error's own words when
 * they were written for a person, otherwise `fallback`.
 */
export function playerFacingMessage(error: unknown, fallback: string): string {
  if (error instanceof PlayerFacingError) return error.message;
  if (error instanceof Error && !looksTechnical(error.message)) return error.message;
  return fallback;
}
