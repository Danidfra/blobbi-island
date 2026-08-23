/**
 * The chat data boundary — the first capability with a real enforcement point.
 *
 * ## Why admission, and not a hidden input
 *
 * A Family build that hid the chat composer and left the subscription running
 * would remove the child's voice and keep every stranger's. The composer lives
 * in `BlobbiActionDock`; the inbound events arrive in `MultiplayerLayer`'s
 * `processChatEvent`, in a different file, from a different direction, and
 * neither knows about the other. So the decision cannot live in a component: it
 * has to live at the point where a message is ADMITTED, and both directions have
 * to consult the same function.
 *
 * That is what this module is. It is pure — no React, no relay, no clock, no
 * storage — so the question "does Family reject this message?" is answerable by
 * a unit test with no world to mount, and the same answer is what the running
 * game uses.
 *
 * ## The boundary is inbound, not outbound
 *
 * Refusing to *send* free text is a courtesy to the player: it stops the app
 * offering an input whose output it would discard. Refusing to *render* free
 * text is the actual protection, because the sender is not necessarily this
 * build. A Standard player standing in the same room, or any third-party client
 * that can emit a kind 21201, will keep sending arbitrary text regardless of
 * what this client's UI looks like — `docs/family-safety-audit.md` §3.1 A4. The
 * inbound call site is therefore the one that matters, and it belongs before
 * `queueBubble`, not inside the bubble component.
 *
 * ## Standard is untouched, by construction
 *
 * When `freeTextChat` is allowed this function admits everything, unconditionally
 * and with no inspection of the text. It applies no length limit, no filter and
 * no heuristic, so wiring it into the chat path cannot change what a Standard
 * player sends or sees. That is deliberate and is asserted directly:
 * `chat-admission.test.ts` admits a hostile payload under Standard on purpose.
 * Content filtering is a different concern with different failure modes, and the
 * audit is explicit that a filter is not a substitute for a capability decision.
 */

import type { IslandSafetyPolicy } from './island-safety-policy';

/** Why a message was refused. One member today; a union so it can gain more. */
export type ChatRejectionReason = 'free-text-not-permitted';

/**
 * The outcome of an admission check.
 *
 * A discriminated union rather than a boolean so a caller cannot accidentally
 * treat "refused" as "allowed" by dropping a `!`, and so the reason travels with
 * the decision for logging and for the eventual "your friend said something we
 * don't show here" affordance.
 */
export type ChatAdmission =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: ChatRejectionReason };

/**
 * A chat message, reduced to what the policy needs to judge it.
 *
 * Deliberately not a `NostrEvent`: admission is a product decision about the
 * KIND of content, not about a wire format, and keeping the shape minimal is
 * what lets the same function serve the send path (which has no event yet) and
 * the receive path (which has already parsed one).
 *
 * Phase D adds an optional curated-phrase identifier here; a message carrying
 * one will be admissible under a policy that allows `predefinedPhrases`, which
 * is why this is an object rather than a bare string.
 */
export interface ChatMessageCandidate {
  /** The player-authored text, already extracted from wherever it came from. */
  readonly text: string;
}

const ADMITTED: ChatAdmission = Object.freeze({ admitted: true });

const FREE_TEXT_REFUSED: ChatAdmission = Object.freeze({
  admitted: false,
  reason: 'free-text-not-permitted',
});

/**
 * Whether this message may cross the boundary, in either direction.
 *
 * One function for send and receive on purpose: two would be two chances to
 * update only one of them, and the invariant that makes free-text restriction
 * coherent is precisely that composing and displaying can never diverge.
 *
 * @param policy - the resolved policy for the current experience
 * @param message - the candidate, already parsed and sanitized by its caller
 */
export function admitChatMessage(
  policy: IslandSafetyPolicy,
  message: ChatMessageCandidate,
): ChatAdmission {
  if (policy.freeTextChat) return ADMITTED;

  // Every message this build can currently produce or receive is free text, so
  // a profile that does not permit it admits none of them. When the phrase
  // catalog lands, a message that resolves to a known phrase id is admitted
  // here instead of being refused.
  void message;
  return FREE_TEXT_REFUSED;
}
