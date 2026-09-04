/**
 * The communication data boundary, the first capability with a real
 * enforcement point, now aware of message classes.
 *
 * ## Why admission, and not a hidden input
 *
 * A Family build that hid the composer and left the subscription running would
 * remove the child's voice and keep every stranger's. The composer lives in the
 * communication panel; inbound events arrive in `MultiplayerLayer`'s
 * `processChatEvent`, in a different file, from a different direction, and
 * neither knows about the other. So the decision cannot live in a component: it
 * has to live where a message is ADMITTED, and both directions consult the same
 * function.
 *
 * This module is pure, no React, no relay, no clock, no storage, so "does
 * Family refuse this message?" is answerable by a unit test with no world to
 * mount, and the same answer is what the running game uses.
 *
 * ## The boundary is inbound, not outbound
 *
 * Refusing to *send* is a courtesy: it stops the app offering an input whose
 * output it would discard. Refusing to *render* is the actual protection,
 * because the sender is not necessarily this build. A Standard player in the
 * same room, or any third-party client, will keep emitting whatever it likes
 * regardless of what this client's UI looks like
 * (`docs/family-safety-audit.md` §3.1 A4). The inbound call site is the one that
 * matters, and it belongs before anything can present the message.
 *
 * ## What this function does NOT do
 *
 * It does not inspect content. It never reads a phrase's words, never measures a
 * length, never filters a term. Two separate concerns, deliberately kept apart:
 *
 *  - **Structure and bounds** are the parser's job (`src/communication/parse.ts`).
 *    By the time a message reaches here it is already known to reference only
 *    catalog entries this build holds, and a structured message is already
 *    stripped of anything that was not an id.
 *  - **Capability** is this function's job, and it answers from the policy
 *    alone.
 *
 * That split is what makes the security claim checkable. A spoofed
 * `{"type":"quick","phrase":"want-to-play","text":"<abuse>"}` is not defeated
 * here: it is defeated in the parser, which never copies `text`, and this
 * function then sees an ordinary quick phrase, because that is all that is left
 * of it.
 */

import type { IslandSafetyPolicy } from './island-safety-policy';

/**
 * The classes of communication the island can carry.
 *
 * Structurally identical to `IslandMessageClass` in `src/communication/`, and
 * deliberately not imported from it: the safety layer must stay free of
 * application dependencies (`boundaries.test.ts` enforces that), and structural
 * typing means a real `IslandMessage` satisfies {@link ChatMessageCandidate}
 * with no coupling in either direction.
 *
 * The union is exhaustively switched below, so adding a way to communicate is a
 * compile error until someone decides which capability governs it. That friction
 * is intentional: a new message class is a new thing a stranger can put on a
 * child's screen.
 */
export type ChatMessageClass = 'text' | 'quick' | 'template' | 'emote';

/** Why a message was refused. */
export type ChatRejectionReason =
  | 'free-text-not-permitted'
  | 'phrases-not-permitted'
  | 'emotes-not-permitted';

/**
 * The outcome of an admission check.
 *
 * A discriminated union rather than a boolean, so a caller cannot turn "refused"
 * into "allowed" by dropping a `!`, and so the reason travels with the decision
 * for diagnostics and for a future "your friend said something we don't show
 * here" affordance.
 */
export type ChatAdmission =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: ChatRejectionReason };

/**
 * A message reduced to what the policy needs to judge it: its class.
 *
 * Deliberately not the message itself and never a `NostrEvent`. Admission is a
 * decision about the KIND of thing being said, not about its words or its wire
 * format, and a type that cannot express the words is a type that cannot be
 * tempted to read them.
 */
export interface ChatMessageCandidate {
  readonly type: ChatMessageClass;
}

const ADMITTED: ChatAdmission = Object.freeze({ admitted: true });

const REFUSALS: Readonly<Record<ChatRejectionReason, ChatAdmission>> = Object.freeze({
  'free-text-not-permitted': Object.freeze({
    admitted: false,
    reason: 'free-text-not-permitted',
  }),
  'phrases-not-permitted': Object.freeze({
    admitted: false,
    reason: 'phrases-not-permitted',
  }),
  'emotes-not-permitted': Object.freeze({ admitted: false, reason: 'emotes-not-permitted' }),
});

/**
 * Whether this message may cross the boundary, in either direction.
 *
 * One function for send and receive on purpose: two would be two chances to
 * update only one of them, and the invariant that makes restricting free text
 * coherent is precisely that composing and displaying can never diverge.
 *
 * @param policy - the resolved policy for the current experience
 * @param message - a message whose structure has already been validated
 */
export function admitChatMessage(
  policy: IslandSafetyPolicy,
  message: ChatMessageCandidate,
): ChatAdmission {
  switch (message.type) {
    case 'text':
      return policy.freeTextChat ? ADMITTED : REFUSALS['free-text-not-permitted'];

    // A quick phrase and a filled-in template are the same product promise, a
    // sentence assembled from a catalog this build ships, so one capability
    // governs both. Splitting them would let a profile allow "Hi!" and refuse
    // "Meet me at the Beach in 10 minutes", which is not a distinction anyone
    // has a reason to draw.
    case 'quick':
    case 'template':
      return policy.predefinedPhrases ? ADMITTED : REFUSALS['phrases-not-permitted'];

    case 'emote':
      return policy.emotes ? ADMITTED : REFUSALS['emotes-not-permitted'];

    default:
      // Unreachable while the union is exhaustive. If a class is ever added
      // without a decision here, refusing is the only safe default: an
      // unrecognised way of speaking must not be admitted because nobody
      // remembered to classify it.
      return REFUSALS['free-text-not-permitted'];
  }
}
