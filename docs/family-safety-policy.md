# The Island Safety Policy

**Status: Phase B.** The capability layer exists, is tested, and now governs
four classes of in-world communication at both the send and receive boundaries.
Family mode is still **not** a user-facing feature: no setting, no onboarding
step, no storage key and no URL parameter can select it. Every shipped build
resolves to `standard`, which is the island exactly as it is today.

Communication V2 is specified in [`communication-v2.md`](./communication-v2.md);
this document remains the capability contract.

Rationale and evidence: [`family-safety-audit.md`](./family-safety-audit.md).
This document is the implementation contract — what the pieces are, and the rules
for using them.

---

## 1. What an `ExperienceProfile` is

```ts
type ExperienceProfile = 'standard' | 'family';
```

A profile names a **set of product capabilities**. That is all it names.

### It is not an age field

It does not record, imply or stand in for a player's age, birth date,
minor/adult status, or a guardian relationship. Nothing reads such a value,
nothing stores one, and nothing downstream may reconstruct one. A household may
run `family` on a shared tablet with nobody under thirty in the room, and an
adult who simply wants a quieter island is a first-class user of it.

This is deliberate, and it is a safety decision as much as a privacy one. The
audit (§13) sets out why asking "are you a child?" fails twice over: the honest
answer costs the player features, so it is answered dishonestly; and recording
the answer creates exactly the data-protection exposure the question was meant to
reduce. The way not to have that problem is to never have the field.

So: **no `isChild`, no date of birth, no age band, no "adult" claim** — not in
this module, and not derived from it elsewhere.

### Why the union is tiny

Every profile is a complete capability matrix that someone has to write, reason
about and maintain. `resolveSafetyPolicy` switches exhaustively over the union,
so adding a third member is a compile error until its policy exists. That is the
intended friction.

---

## 2. Architecture

```
ExperienceProfile              which experience (no personal data)
      ↓ resolveSafetyPolicy()
IslandSafetyPolicy             ~19 capabilities, frozen
      ↓ IslandSafetyProvider / useIslandSafetyPolicy()
resolved policy in scope
      ↓
features ask: "is this capability allowed?"
```

| File | Role |
|---|---|
| `src/safety/experience-profile.ts` | the profile union, the enumeration, `isExperienceProfile` |
| `src/safety/island-safety-policy.ts` | the `IslandSafetyPolicy` type and `assertPolicyInvariants` |
| `src/safety/policies.ts` | `STANDARD_POLICY` and `FAMILY_POLICY` — the only two capability literals |
| `src/safety/resolve.ts` | `resolveSafetyPolicy` and `ACTIVE_EXPERIENCE_PROFILE` |
| `src/safety/island-safety-context.ts` | the context and `useIslandSafetyPolicy` |
| `src/safety/IslandSafetyProvider.tsx` | mounts the resolved policy, once, in `App.tsx` |
| `src/safety/chat-admission.ts` | the first enforcement helper: `admitChatMessage` |
| `src/safety/index.ts` | the barrel; the public surface |

The policy core is pure — no React, no relay, no storage, no clock — and
`src/safety/boundaries.test.ts` proves it against the real import graph, in the
same style as `src/arcade/boundaries.test.ts`. Only the context and the provider
may import React.

### Why there is a context when the answer is currently a constant

A module singleton would be smaller today and wrong tomorrow, for two reasons
that are already visible:

1. **The value stops being constant.** The profile will come from stored,
   guardian-owned state and must change without a reload.
2. **The Phase A proof needs a seam.** Showing that a hostile kind 21201 is
   refused *before* it becomes a speech bubble means rendering the real
   `MultiplayerLayer` under Family. A context gives that test a legitimate
   injection point, so it exercises the same lookup the running game uses instead
   of a module mock.

A missing provider yields `STANDARD_POLICY`, which is today's behaviour — so
adding the context could not change any existing screen or test. **That default
is a Phase A convenience with a real trade-off: failing *open* to the permissive
profile is the wrong long-term default.** It is acceptable only while Standard IS
the shipped product and Family is unreachable. See §8.

---

## 3. Capability naming rules

**Semantic, never presentational.**

| Good | Bad |
|---|---|
| `freeTextChat` | `hideChatTextarea` |
| `externalLinks` | `disableWindowOpenButton` |
| `openMediaEntry` | `hideYouTubeInput` |

A semantic name survives a rewrite of the feature that implements it. A
presentational name does not — and, worse, it invites an implementation that
hides a textarea while the subscription underneath keeps delivering the very
content the name claims to have removed.

Three further rules:

- **One capability, both directions.** `freeTextChat` governs composing *and*
  displaying. A build that disabled composing while still rendering inbound text
  would remove the player's voice and keep every stranger's.
- **Permission, not availability.** A capability answers *may this profile?*, not
  *is it built?*. `emotes: true` in both policies does not claim an emote system
  exists; it records that neither profile forbids one.
- **Add a capability rather than branch on a profile.** If a call site wants to
  know the profile, the capability it actually needed is missing.

---

## 4. The two policies

`STANDARD_POLICY` **describes what ships today**, capability for capability. It
is what every existing player resolves to, so tightening it here would be a
silent product change disguised as a refactor. Where the audit recommends a
Standard-mode improvement — an interstitial before external links, for instance —
this file still says `externalLinks: true`, matching shipped behaviour. Those
improvements belong to the phase that implements them, where they are visible.

`FAMILY_POLICY` is defined, exhaustively tested, and **unreachable**.

The shape of Family follows one finding from the audit: *the risk is concentrated
in arbitrary text, arbitrary video and the exits — remove those three and keep the
world.*

| | Standard | Family |
|---|---|---|
| `freeTextChat` | ✅ | ❌ |
| `predefinedPhrases` | ✅ | ✅ |
| `emotes` | ✅ | ✅ |
| `directMessages` | ❌ | ❌ *(invariant)* |
| `strangerAuthoredNames` | ✅ | ❌ |
| `strangerProfileMetadata` | ❌ | ❌ *(invariant)* |
| `ownFreeTextNaming` | ✅ | ❌ |
| `externalLinks` | ✅ | ❌ |
| `socialPlatformSharing` | ✅ | ❌ |
| `nativeShareSheet` | ✅ | ❌ |
| `arbitraryRemoteMedia` | ❌ | ❌ *(invariant)* |
| `openMediaEntry` | ✅ | ❌ |
| `mediaUploads` | ✅ | ❌ |
| `publicNotePublishing` | ✅ | ❌ |
| `relaySelection` | ✅ | ❌ |
| `authoringTools` | ✅ | ❌ |
| **`multiplayerPresence`** | ✅ | **✅** |
| **`sharedActivities`** | ✅ | **✅** |
| `detailedPresence` | ✅ | ❌ |

**Family is not a single-player mode**, and `policies.test.ts` asserts it. Every
restriction above is acceptable *because* the island is still shared.

### Invariants

Three capabilities are typed as the literal `false` rather than `boolean`:
`directMessages`, `strangerProfileMetadata`, `arbitraryRemoteMedia`. They are not
restrictions Family adds — they are properties the island has today in every
profile. Turning any of them on is a new product decision, not a configuration
change, and the literal type means a profile that tries to relax one does not
compile.

`assertPolicyInvariants` re-checks these at runtime and adds three structural
rules: every profile keeps multiplayer and shared activities; a profile that
switches off free text must offer phrases or emotes (**restricting speech is a
substitution, never a removal**); and a profile that allows public note
publishing must also allow the upload that completes it.

### Capabilities whose Family semantics are still open

Recorded now rather than discovered later:

- **`openMediaEntry: false` leaves the Family theater with nothing to play.** The
  intended replacement is an issuer-signed catalog of approved videos, reusing
  the trust pattern `useItemCatalog.ts` already applies to items. Until then,
  Family may gather in the theater and not watch. A real gap, not papered over.
- **`strangerAuthoredNames: false` needs somewhere to put the substitute.**
  `genUserName` already derives a stable name per pubkey; which layer swaps it in
  (probably the kind 31124 visual parser) is undecided.
- **`detailedPresence: false` has no agreed coarse shape.** Dropping `hiddenIn`
  is clearly right; whether `goal` and sub-percent coordinates also coarsen is a
  protocol conversation. Note that coarsening what this client *publishes* does
  not change what a relay will serve to a modified one.
- **`authoringTools: false` is route-level, not an authorization boundary.**
  Publishing an event only ever required a signature the player already controls.

---

## 5. How a feature consumes the policy

```ts
import { useIslandSafetyPolicy } from '@/safety';

function ShareRow() {
  const policy = useIslandSafetyPolicy();
  if (!policy.socialPlatformSharing) return null;
  // …
}
```

For anything outside React, take the policy as a parameter — that is what keeps
the decision testable:

```ts
export function admitChatMessage(policy: IslandSafetyPolicy, message: ChatMessageCandidate): ChatAdmission
```

**Never** this:

```ts
if (profile === 'family') return null;   // ❌
if (isChild) return null;                // ❌
```

A capability check states the reason the code behaves as it does, survives the
arrival of a third profile untouched, and can be exercised by a test that never
mentions a profile. A profile check states a fact about a person, spreads a
policy decision across the tree, and has to be revisited at every call site the
day the matrix changes.

---

## 6. Where enforcement belongs

**At the data boundary, not the render boundary.**

For anything a stranger can author, the check goes where the content is
*admitted* — before it is queued, cached, or handed to a component.

A component only controls what *this* build draws. A boundary check also governs
content arriving from a Standard client, from a third-party client, or into a
screen nobody has written yet. The audit names hiding-the-UI-while-the-
subscription-runs as the most likely way to get Family mode wrong here, precisely
because the composer (`BlobbiActionDock`) and the receive path
(`MultiplayerLayer.processChatEvent`) are different files that do not know about
each other.

### The worked example: communication

```
relay → subscription → processChatEvent
          → parse (structure + local catalogs)
          → duplicate
          → [ admitChatMessage ]     ← the capability boundary
          → inbound throttle
          → renderMessage (trusted local reconstruction)
          → queueBubble → bubble
```

`admitChatMessage` is consulted in two places in `MultiplayerLayer`:

- **inbound**, in `processChatEvent`, after the payload has been validated and
  before anything can render or queue it — this is the one that protects a
  player, because the sender is not necessarily this build;
- **outbound**, in `sendMessage`, so no holder of the send ref can route around
  the composer.

**Two separate concerns, deliberately kept apart.** Structure and bounds are the
parser's job (`src/communication/parse.ts`); capability is admission's.
Admission never inspects content — no length, no filter, no term list — and
under Standard it admits every class unconditionally. `chat-admission.test.ts`
admits a hostile payload under Standard on purpose: it is a capability check, not
a content filter, and the audit is explicit that a filter is not a substitute for
a capability decision.

That split is also what defeats spoofing. A payload claiming to be a quick phrase
while carrying abusive text loses the text in the **parser**, which copies only
ids; admission then sees an ordinary quick phrase, because that is all that is
left of it. The words come from the local catalog, never from the wire.

`src/safety/boundaries.test.ts` asserts the pipeline order structurally — parse
before admit, admit before render, admit before `queueBubble` — so it cannot
drift.

---

## 7. Keeping profile checks from spreading

Two mechanisms, deliberately overlapping:

1. **ESLint** (`eslint.config.js`). Outside `src/safety/` and outside tests,
   `no-restricted-imports` blocks `FAMILY_POLICY`, `STANDARD_POLICY`,
   `resolveSafetyPolicy`, `ACTIVE_EXPERIENCE_PROFILE`, `ExperienceProfile`,
   `EXPERIENCE_PROFILES`, `isExperienceProfile` and `IslandSafetyPolicyContext`,
   and forces imports through the `@/safety` barrel. Freely importable:
   `useIslandSafetyPolicy`, `IslandSafetyProvider`, the `IslandSafetyPolicy`
   type, and the admission helpers. No custom plugin was written — the built-in
   rule was enough.
2. **`src/safety/boundaries.test.ts`.** Scans the real import graph and the
   actual identifiers, so a relative-path import or a re-export cannot route
   around the lint rule. It also asserts the provider is mounted exactly once and
   that no non-test caller passes a `profile` prop.

---

## 8. Preconditions for the phase that makes Family selectable

Not requirements of this phase; requirements *on* the next one, written down
while the reasoning is fresh.

- **The fallback must never downgrade.** A device whose guardian chose `family`
  and whose storage read fails must not silently become Standard.
  `resolveSafetyPolicy` throws on unknown input rather than guessing, and
  `isExperienceProfile` deliberately does not pick a fallback — choosing one is
  the storage phase's decision, and it has a real wrong answer.
- **The policy must be resolved on the first render.** A single frame of Standard
  is a frame in which a stranger's text can be admitted.
- **The context default must stop being permissive.** Once a profile can be
  selected, a missing provider is a bug, not an answer.

---

## 9. What Phase A did *not* do

Defined but unenforced. After Phase B, `freeTextChat`, `predefinedPhrases` and
`emotes` all have real call sites; the rest are still declarations. In
audit-roadmap order:

| Capability | Still needs |
|---|---|
| `externalLinks`, `socialPlatformSharing`, `nativeShareSheet` | the single `openExternal()` egress helper; `window.open` is still called directly in two components |
| `relaySelection`, `authoringTools` | gating `RelaySelector` and the `/tools/game-items` route |
| ~~`predefinedPhrases`, `emotes`~~ | **done in Phase B** — catalogs, phrase builder, emote grid, and enforcement at both boundaries |
| `openMediaEntry` | the curated theater catalog, re-validated on every `set-media` |
| `mediaUploads`, `publicNotePublishing` | gating `useUploadFile` and the ShareModal Nostr section |
| `strangerAuthoredNames`, `ownFreeTextNaming` | the name substitution and the word-pick composer |
| `detailedPresence` | the coarse presence shape |

Not modelled at all, because they are **missing features rather than capability
restrictions**: blocking, muting and reporting. A child today has no recourse but
to close the tab (audit C-2). They remain the highest-severity open finding, and
they need building, not a policy field.
