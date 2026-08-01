# Game Item Tools

Internal tooling for authoring kind:31632 Game Item Definitions and inspecting
kind:31633 Game Inventories.

One sentence: **it builds events with the library, signs them only when you say
so, and shows you exactly what it is about to publish.**

---

## 1. Route and access policy

```text
/tools/game-items
```

The page **ships in production builds** and is reachable by direct URL. It is
linked from nowhere in the game.

That is deliberate, and the reasoning matters:

- hiding a link is not a boundary. Anybody can publish a kind:31632 event with
  any `d` from any Nostr client;
- the real boundaries are the two that already exist — publishing requires a
  **signature from an account the user controls**, and Blobbi Island's catalog
  **rejects every definition not signed by `OFFICIAL_ITEM_ISSUER_PUBKEY`**
  (`parseOfficialItemDefinition`, unchanged by this phase);
- gating the route on `import.meta.env.DEV` — the convention used by
  `/dev/theater`, `/dev/arcade`, `/dev/rooms`, `/dev/equipment` and
  `/dev/blobbi-effects` ([visual-effect preview](./blobbi-visual-effects.md#12-development-preview))
  — would only prevent the official issuer from publishing from the deployed
  site.

`src/dev-routes.test.ts` asserts the distinction stays intentional: the dev
harnesses must be absent from `dist/`, and `GameItemTools` must be present as
its own lazy chunk (≈30 kB gzipped, loaded only on navigation).

### Signer states

| State | Editor | Preview | Inspectors | Blossom upload | Publish |
| --- | --- | --- | --- | --- | --- |
| Not signed in | ✅ | ✅ | inventory needs an account | ❌ | ❌ |
| Third-party signer | ✅ | ✅ | ✅ | ✅ | ✅ **with a warning** |
| Official issuer | ✅ | ✅ | ✅ | ✅ | ✅ |

A third-party signer **may publish**. Refusing would be theatre — the event can
be published from any other client anyway — so the honest behavior is to allow
it under the user's own key and say plainly, in the header, in the review
dialog and on every browser row, that the game will not resolve it. What the
tool never does is let a third-party definition **look** official.

The header always shows the signer's `npub`, its abbreviated hex, and whether
it matches the official issuer. No private key is ever requested, derived,
stored, or displayed; signing goes through `useCurrentUser().user.signer`, the
same account object the rest of the app uses.

---

## 2. Item Studio

The authoring surface: editor on the left, live preview on the right, publish
bar pinned at the bottom. On narrow screens the columns stack and the preview
stays reachable.

### Supported kind:31632 fields

| Field | Tag | Notes |
| --- | --- | --- |
| `d` | `["d", …]` | **Required.** The item's identity. Locked after loading a published event. |
| `name` | `["name", …]` | **Required.** |
| `type` | `["type", …]` | **Required.** Select of the recommended values, plus free text. |
| `category` | `["category", …]` | Free text with suggestions — deliberately not an enum. |
| `symbol` | `["symbol", …]` | |
| `rarity` | `["rarity", …]` | Display metadata only. |
| `max_stack` | `["max_stack", …]` | Numeric input, published as a **string**. |
| `version` | `["version", …]` | |
| `alt` | `["alt", …]` | NIP-31 fallback text. |
| images | `["image", …]` ×N | See §3. |
| contexts | `["context", …]` ×N | |
| topics | `["t", …]` ×N | |
| `model_3d` | `["model_3d", …]` | URL only. |
| `audio` | `["audio", …]` | URL only, with an inline player. |
| derivations | `["a", addr, relay, "based_on"]` ×N | See §7. |
| content | JSON body | See §5. |

Everything else on a loaded event is **preserved** — see §8.

### The `d` tag

`d` plus the signer's pubkey plus the kind **is** the event's address. Changing
it does not edit the item; it points at a different item and leaves the original
exactly where it was.

- the full address is always on screen;
- after loading a published event, `d` locks. Editing it requires the explicit
  **Create as a new item** action;
- a **Normalize** button lowercases and hyphenates on demand. It never rewrites
  what you typed on its own.

Recommended shape: `<namespace>:<category>:<slug>`, e.g.
`blobbi:accessory:party-hat`.

---

## 3. Images and view markers

The wire format is a repeatable tag:

```text
["image", "<url>"]              # primary / default (NO marker)
["image", "<url>", "<marker>"]  # a named view
```

**The primary image is the image with no marker.** The marker select's first
option is labelled `primary (unmarked)` and its value is the empty string;
choosing it removes the marker. The literal string `"primary"` can never reach a
tag — `form-event-conversion.ts` re-checks that on the way out, and
`form-event-conversion.test.ts` asserts it.

Markers this spec version defines: `front`, `back`, `side-right`, `side-left`,
`diagonal-front-right`, `diagonal-front-left`. A **custom marker** may be
entered for forward compatibility; it publishes verbatim and warns.

Each row offers: URL entry, marker select, preview on a transparency
checkerboard, load state, measured dimensions, make-primary, reorder,
duplicate, copy URL, open in a new tab, and remove.

### Recommended artwork

`1024 × 1024` PNG or WebP, transparent background. **A different size warns and
publishes.** The protocol places no constraint on image dimensions, so this is a
house convention, not a rule.

### One thing the round trip normalizes

`buildGameItemDefinitionEvent` emits the unmarked primary **first**, then the
marked views. A definition that published its primary in the middle comes back
with it hoisted. The form itself keeps the original order (the image manager
shows what was published), and the relative order of the marked views survives
untouched. Reproducing the original interleaving would mean bypassing the
builder, which this integration does not do.

---

## 4. Blossom upload

**Included**, reusing the app's existing uploader.

`src/hooks/useUploadFile.ts` is the app's one Blossom client — a
`BlossomUploader` against `blossom.primal.net`, authorized by the current
account, already used by the Photo Booth's share flow and the profile editor.
`src/tools/game-items/image-upload.ts` calls that hook and adds only a queue:

- drag-and-drop or file picker, one or many files;
- per-file status (`queued` / `uploading` / `done` / `failed with reason`);
- **marker suggestions from filenames**, shown for review before anything is
  applied — `hat-back.png` proposes `back`, `hat-diagonal-front-right.png`
  proposes `diagonal-front-right` (longest patterns match first). Suggestions are
  always editable and never silently assigned;
- files upload **sequentially**, because a signer prompting for five Blossom
  authorizations at once is a worse experience and fails on some signers.

Finishing an upload does exactly one thing: it puts a URL in an image row. It
never signs and never publishes.

No second Blossom client, server list, or credential store was added.

---

## 5. Content editor

The recommended shape:

```json
{ "description": "", "effects": {}, "metadata": {}, "visual": {} }
```

**Structured mode** edits `description`, context-keyed `effects`
(`effects["game:blobbi"].hunger`), typed `metadata` (string / number / boolean /
JSON), and `visual` — which has **two shapes**, see §5.1.

**JSON mode** edits the raw content, with inline parse errors, a Format action
and a reset-to-recommended-shape action.

Switching modes:

- structured → JSON always works;
- JSON → structured works only when the text is a valid JSON **object**. A bare
  array or string is valid content the structured fields cannot represent, so
  the switch is **refused with a reason** rather than discarding it. Content that
  was never an object stays in raw mode permanently and republishes byte for
  byte.

Keys the structured editor does not model are kept in `content.extra` (and
`visual.extra`) and re-emitted on publish, and the UI lists them by name.

`visual.slot` describes where a wearable **would** sit. It never asserts that
anyone has equipped it — that is inventory data, and no Placement model exists.

### 5.1 Two visual shapes: wearable and effect

A `visual` answers one of two questions, and the editor shows only the fields
for the one being asked. `visual.kind` is the discriminator, exactly as it is
for a reader.

| | Wearable accessory | Visual effect |
| --- | --- | --- |
| `kind` | absent | `"blobbi-effect"` |
| `slot` | `headwear`, `eyewear`, … | — |
| `effect` | — | an effect id, e.g. `golden-sparkles` |
| `effectSlot` | — | `aura` · `ground-local` · `ambient-particles` · `body-overlay` |
| `forms` | shared | shared |

```json
{
  "description": "A cheerful constellation of golden stars…",
  "visual": {
    "kind": "blobbi-effect",
    "effect": "golden-sparkles",
    "effectSlot": "ambient-particles",
    "forms": ["baby", "adult"]
  }
}
```

Choosing the `effect` **category** seeds `visual.kind` so the structured editor
produces this shape instead of a `visual` containing only `forms`. It only ever
SEEDS: once the author has typed a slot, a kind or any effect field, changing
the category rewrites nothing. A Wearable/Visual-effect toggle in the `visual`
block switches shapes explicitly; leaving effect mode clears the effect fields
so a definition can never claim to be both.

**`visual.slot` is not asked for on an effect item.** An effect surrounds the
character rather than sitting on it, so the `cosmetic-no-slot` suggestion is
suppressed and a leftover `slot` is flagged instead.

**An `effect` is a NAME, never an implementation.** No animation, CSS or markup
is carried in an event or read out of one. The effect code is local
(`@blobbi/react`), and the game runs one only when a **trusted item address**
resolves to it — a third party publishing `effect: "celestial-aura"` grants
nothing. See [`blobbi-visual-effects.md`](./blobbi-visual-effects.md) §§1–3.

Where the vocabulary lives is a boundary decision: the four effect SLOT names
are item-format vocabulary and sit in the tools' pure domain layer
(`item-form-model.ts`), while the twelve effect IDS come from the renderer and
therefore sit in the UI layer (`components/tools/game-items/effect-vocabulary.ts`)
— the domain layer must not import `@blobbi/react`, or React ends up in the
middle of event building. A test asserts the four slot names have not drifted
from the renderer's own list, and `boundaries.test.ts` asserts the arrow.

---

## 6. Validation

Four layers, visually distinct, and **only the first can stop a publication**:

| Layer | Blocks? | Source |
| --- | --- | --- |
| Blocking errors | ✅ | `validateGameItemDefinition`, the builder throwing, invalid JSON content |
| Protocol warnings | ❌ | `parseGameItemDefinitionResult` warnings |
| Image warnings | ❌ | This tool's artwork checks |
| Suggestions | ❌ | Blobbi house style |

Publishable despite warnings: no primary image, multiple primaries, duplicate
markers, unknown markers, duplicate URLs, failed browser loads, unexpected
dimensions, inconsistent canvases, missing `alt`, missing `context`, a cosmetic
without `equipable`, a stacked cosmetic.

### The one judgement call

Two **different** unmarked image URLs appear **twice**: as an image warning
(what the protocol thinks — the spec calls it a SHOULD-level authoring mistake)
and as a blocking build error (what our builder can actually emit —
`buildGameItemDefinitionEvent` refuses an ambiguous primary). Reimplementing the
builder to get around that would violate the rule this integration is built on.

Two **identical** unmarked URLs are not ambiguous: the builder de-duplicates
them, so those warn and publish.

---

## 7. Derivation (`based_on`)

`["a", "31632:<pubkey>:<d>", "<relay>", "based_on"]`. The marker is fixed and
not editable.

It records **lineage only**. It does not mean the other issuer approved
anything, does not transfer ownership, and grants no trust — nothing in Blobbi
Island resolves trust across a `based_on` edge.

---

## 8. Unknown-tag preservation

The merge policy, stated once:

```text
a tag whose name is managed by the form   → regenerated from form state
an `a` tag carrying the `based_on` marker → regenerated from form state
everything else                           → preserved verbatim
```

Managed names: `d`, `name`, `type`, `category`, `image`, `model_3d`, `audio`,
`symbol`, `rarity`, `max_stack`, `version`, `context`, `t`, `alt`.

The rule is name-based on purpose: a future `["durability", "40"]` has no field
here, so it lands in the preserved bucket, survives the edit, and republishes
untouched. The **Preserved tags** section makes this visible rather than merely
promised, and offers per-tag removal as a deliberate act.

The same applies inside `content` (§5) and to unknown image markers (§3).

`form-event-conversion.test.ts` round-trips events carrying unknown tags,
unknown markers and unknown content keys, and `import-event-json.test.ts`
asserts the same guarantees for a pasted event (§10.1).

---

## 9. Drafts

Autosaved to `localStorage` under `blobbi-game-item-drafts`, debounced at
700 ms — a pause is the unit of work, not a keystroke.

- restored on reload, with the last-saved time shown;
- duplicate and clear actions;
- loading a published item over unsaved work asks first;
- the store is **schema-versioned**. A draft from another version, corrupt JSON,
  or a wrong shape is discarded with a visible reason rather than
  half-restored, and never throws during a render;
- **a draft is never a publication** — it carries no signature and no event id;
- nothing secret is written. The form model has no key material in it, asserted
  structurally in `drafts.test.ts`.

Cross-tab draft edits deliberately do **not** stomp an open editor. Published
events do update live (§11) — those are facts about the network, not local
scratch state.

---

## 10. Loading and updating an existing definition

Load by full address, by `d` under the active signer (which can only ever
resolve your own items), or from the Published Items browser and the Inventory
Inspector.

On load: every supported field is populated, unknown tags/markers/content keys
are preserved, event id, `created_at`, author, source relays and parser
warnings are shown.

**An addressable update publishes a NEW event that supersedes the old one at the
same `kind + pubkey + d`.** Nothing is mutated and nothing is deleted; clients
simply prefer the newest event for an address. The review dialog says which of
"creates" or "replaces" is about to happen.

Another issuer's definition is **read-only**: you cannot replace somebody else's
addressable event. The tool offers **Use as template**, which clears provenance
and optionally records a `based_on` reference to the original.

### 10.1 Import event JSON

**Import event JSON** (next to *Load published*) is loading with the network
taken out: paste a whole kind:31632 event and the form populates from it. It is
for the case where the event already exists as text — authoring a batch of
official items, where every tag is decided and only the artwork is still in
flux.

It **reuses `eventToForm`**, the same function *Load published* uses, rather
than adding a second parser. Everything that path guarantees holds identically:
the package decides what a tag means, unknown tags land in **Preserved tags**,
unknown content keys land in `content.extra` / `visual.extra`, image rows keep
the unmarked primary and every marked view, and both `visual` shapes (§5.1)
survive. What the importer adds is only what a pasted blob needs:

- **Envelope validation.** Non-JSON, a non-object, a missing or non-31632
  `kind`, a missing/malformed `tags` array, or a `content` that is neither a
  string nor an object are all **rejected with a specific reason** — "this is a
  kind:1 event" rather than "invalid". A malformed tag is an error, never a
  silently dropped field. A `content` given as an object (an easy slip in a
  hand-written draft) is serialized and reported rather than refused.
- **Tolerance of an unsigned draft.** `id`, `pubkey`, `created_at` and `sig`
  are all optional — pasting something not yet signed is the normal case.

**Provenance is reported, never attached.** A paste may carry an `id`, a
`pubkey` and a `sig`; those say where the JSON came from, not that this editor
is now editing that published event. Attaching them would lock `d` and make the
studio announce that publishing "replaces" an address belonging to whoever
signed the paste — wrong whenever that is not the current signer. So an import
produces a **fresh local draft** (`loaded: null`), the pasted identity is shown
in the import summary, and publishing goes through the normal flow under the
current signer.

Importing **replaces the editor**, which autosaves into the same draft slot — so
an editor holding real work gets a confirmation first, showing what was
understood (identity, image count, preserved tags, provenance) *before* anything
is replaced. With an empty or untouched editor it applies immediately.

Import **publishes nothing and signs nothing**; artwork stays fully editable in
the Images section afterwards, and an event with no `image` tag imports fine and
raises the normal no-image warning.

---

## 11. Publishing, relays and live updates

Flow: **Review publication** → summary (signer, address, creates-or-replaces,
warnings, relays) → **Sign and publish**.

Publishing never happens on a form change, a blur, a keyboard shortcut, or the
completion of an upload. `boundaries.test.ts` asserts there is exactly one
module that can publish and exactly one call site that reaches it.

### Why not `useNostrPublish`

Two specific reasons:

- it treats a timeout as success ("may have succeeded on some relays"). Sensible
  for a movement event; a lie for a tool whose job is to report what is on the
  network;
- it publishes through the shared pool, which routes to the single configured
  relay. Official definitions must land on `OFFICIAL_ITEM_RELAYS` or the game
  will not resolve them.

So this feature fans out with `publishToRelays` (`src/inventory/relay-fan-out.ts`,
shared with `useItemCatalog`) and reports **each relay's verdict individually**.
It is not a second signer: the signature comes from the app's existing account.

Partial success is a real state and is reported as one. The form is **never
cleared** on a partial or total failure.

### No reload, ever

After a successful publish:

- the record is written straight into the definition query cache
  (`upsertDefinitionRecord`), so it appears in Published Items immediately;
- de-duplication is **by address, newest wins**, so an update replaces its row
  rather than adding a second one — exactly what a replaceable event does;
- the editor rebinds to the event that now exists, so a follow-up publish is
  understood as replacing;
- an **official** definition additionally invalidates the shared item catalog,
  because it changes what the game itself resolves. A third-party definition
  changes nothing in-game and leaves the catalog alone.

`window.location.reload()` appears nowhere; `boundaries.test.ts` asserts it.

---

## 12. Published Items browser

Every kind:31632 definition from the official issuer and the active signer.

Search by name / `d` / address; filter by issuer bucket, type, category, marker
availability, and missing-primary; sort by updated / name / `d`. Each card shows
the primary image, name, `d`, address, type, category, rarity, image count,
available markers, updated time, author and warning count, plus open-in-editor,
use-as-template, copy-address and raw-event inspection.

**Identity is the address, never the `d`.** Two issuers publishing the same `d`
are two items and always render as two rows. Only the official pubkey earns the
`Official` badge — `published-items-view.test.ts` includes an impostor case.

These queries parse **without** an issuer filter, which is what lets the tool
show third-party definitions. That widens nothing: none of it feeds the catalog,
the shop or accessory resolution.

---

## 13. Inventory Inspector

A **read-only** view of the current user's kind:31633 inventory, joined to the
definitions its addresses point at.

Read-only is a hard property, not a current limitation: there is no quantity
control, no grant button, and no path from this component to
`useInventoryMutation` — asserted in `boundaries.test.ts`.

Each entry reports one of three sources, and the difference matters:

| Source | Meaning |
| --- | --- |
| `published definition` | A real kind:31632 event was found for this address |
| `bundled fallback` | No event; Island ships fallback metadata for this official item |
| `unresolved` | No event and no fallback — nothing describes this item |

`bundled` is not a failure — Island ships metadata so the game works when relays
are down — but a tool for verifying what is *actually published* must never let
it masquerade as a publication.

### Two queries, regardless of item count

```text
useIslandInventory()              → one kind:31633 event
useItemDefinitionsByAddress(...)  → one batched kind:31632 request
buildInspectorRows(...)           → pure, synchronous join
```

Filters are grouped by author so each request is precise
(`authors: [issuer], '#d': [...]`) rather than a cross product. A 50-item
inventory costs the same two subscriptions as a 2-item one. `buildInspectorRows`
is a pure function over data already in hand — there is nowhere in it to put a
query, which makes the N+1 shape structurally impossible rather than merely
absent.

Both queries live in TanStack Query, so a newer inventory event, a newly
published definition, an account change or a relay change all refresh the view
in place.

---

## 14. Item preview

Four modes, because "does this look right?" is four questions:

| Mode | What it answers | Helper used |
| --- | --- | --- |
| Card | What an inventory row / shop tile shows | `primaryItemImageUrl` |
| Views | Every published `image` tag with its marker | — |
| Compare | primary / front / back side by side, published vs resolved | `itemImageByMarker`, `itemImageSourcesForView` |
| On a Blobbi | The real renderer — the accessory worn, or the **effect drawn** | `itemImageSourcesForView` + `normalizeAccessoryPlacements`, or `BlobbiRendererView effects` |

These are the **production** helpers, not lookalikes — a preview with different
fallback rules would show a hat the game will not show. Nothing is invented: a
view the item does not publish is reported as absent or as a fallback, and side
/ diagonal views are never substituted for a front or back pose.

### Blobbi accessory preview

Uses `@blobbi/react` with a **fixture** Blobbi (baby or adult) built from
constants — never the player's companion. Front/back toggle, and preview-only
x / y / scale / rotation / flip controls that are **local component state**: not
Placement protocol data, never serialized, gone on unmount.

It does not equip, grant, publish, or touch any inventory.

One step of Island's full resolver is deliberately omitted: the legacy tail
(`generateAccessoryUrl(code)` → `public/assets/.../<code>.webp` → `.png`) exists
for accessories identified by legacy codes like `headwear-8`. An item being
authored has a `d`, not a legacy code, so every one of those steps is guaranteed
to miss — including them only emitted a warning and two doomed requests per
render.

**A face-only accessory legitimately vanishes from behind.** `eyewear`,
`face-mark` and `handheld` are in `REAR_VIEW_HIDDEN_SLOTS`; publishing a `back`
view does not change that. The panel says so in words rather than letting it
read as broken.

### Blobbi effect preview

For an **effect** item the same tab draws the EFFECT instead. An effect item's
artwork is a token — a star charm, a mist bottle, a prism — that represents the
effect in an inventory row; pasting it onto a Blobbi's head would preview
something the game never renders.

It draws the effect id the author typed, on the same fixture Blobbi, with
front/back, baby/adult and size toggles, and a declared `effectSlot` that
disagrees with the effect's actual slot is called out. This is also where "can
this client draw it?" is answered, rather than in the validation panel: that
question is about the renderer, which the studio's domain layer cannot see
(§5.1).

**One resolver, every source.** `resolveEffectPreview(effect, effectSlot)` is
the only thing that decides what gets drawn, and it takes two strings. An
imported event, a *Load published* result, a restored autosave and live typing
are therefore indistinguishable by the time anything renders — they are the same
two strings. `EffectPreviewParity.test.tsx` builds the same item all four ways
and asserts the rendered effect markup is **byte-identical**. Preview never
requires a publish, a signer or a relay.

`content.visual.effect` is the **canonical** id. Tags (`d`, `t`, `rarity`,
`category`) are never consulted to identify the effect; `category: "effect"` is
only a fallback signal for *routing* to this tab when `visual.kind` is absent.

**An id this client cannot draw gets a labelled stand-in, not a blank box.** An
unknown effect borrows a real one from its declared `effectSlot`
(`ambient-particles` → sparkles, `ground-local` → fog, `body-overlay` → glitch,
`aura` → halo), badged **Approximate preview** and captioned with the fact that
Blobbi Island would draw nothing for that id. It shows *where* the effect would
sit — which is what the slot is for — without pretending the stand-in is the
item's artwork. A slot that is not one of the four falls back to
`ambient-particles` and says so. An item naming neither an effect nor a slot
draws nothing, because it is not an effect yet.

Nothing is equipped, granted or published, and the item's address is never
consulted — the author is asking what an id looks like, which needs no trust.

---

## 15. Raw event inspector

Shared by all three tabs. Shows id, kind, pubkey, `created_at`, signature,
content, every tag with its index, full JSON, the parsed model, parser warnings
and source relays. Copy event JSON / id / address.

Tags are labelled **`form field`** (regenerated) or **`preserved`** (untouched),
which is the whole reason to look at raw tags here: it is how you verify the
preservation promise in §8.

Renders **collapsed by default** and only serializes while open — a form that
re-renders per keystroke must not stringify a 4 kB event nobody is reading.

---

## 16. Explicit non-goals

This phase added **none** of the following, and `boundaries.test.ts` asserts it:

- Grant (no `GRANT_MARKER`, no grant tags, no receipts);
- Placement or any equip protocol;
- inventory mutation from the inspector — quantities are read-only;
- granting or equipping the authored item;
- legacy equip-tag migration;
- side or diagonal Blobbi actor poses;
- changes to movement, ground anchors, presence, or theater;
- a redesign of the player inventory or the shop;
- a backend, a second Nostr provider, a second signer, a second Blossom client,
  a second item parser, or a second inventory query;
- publishing `@blobbi/react`.

Automated tests publish **no** real Nostr events: the signer and the relay
writer are mocked wherever publishing is exercised.

---

## 17. Publishing a new official accessory, step by step

1. Sign in with the official issuer key. The header must read **Official
   issuer**.
2. Open `/tools/game-items` → **Item Studio**.
3. Set `d` (e.g. `blobbi:accessory:party-hat`), `name`, and `type: cosmetic`.
4. Set `category` (e.g. `headwear`) and, if you want it, `rarity`.
5. Add topics: at minimum `equipable`, plus the slot topic. Add
   `context: game:blobbi`.
6. Write an `alt` line for generic clients.
7. Drop the artwork into the image manager. Name the files
   `<item>-front.png` / `<item>-back.png` so the markers are suggested, then
   **check the suggested markers** and upload.
8. Make sure exactly one row is **primary (unmarked)** — usually the front-facing
   hero image.
9. In **Content → structured**, set `visual.slot` (e.g. `headwear`) and
   `visual.forms` (e.g. `baby`, `adult`), and write a `description`.
10. Check the preview: **Compare** for primary/front/back, then **On a Blobbi**
    for both facings and both stages.
11. Clear the validation panel's blocking layer, and read the warnings — they are
    advisory, but "no primary image" usually is not what you meant.
12. **Review publication** → confirm the address and that it says *creates* (or
    *replaces*, if you are updating) → **Sign and publish**.
13. Confirm the per-relay result. Copy the address.
14. To make the accessory resolve in-game, map its legacy accessory code to the
    new `d` in `src/inventory/accessory-item-identity.ts` — that mapping is
    explicit on purpose (see that file's module note).

---

## See also

- [`INVENTORY_ARCHITECTURE.md`](./INVENTORY_ARCHITECTURE.md) — the kind:31632 /
  kind:31633 architecture these tools author against.
- [`game-item-image-views.md`](./game-item-image-views.md) — how Island selects
  among an item's `image` tags.
- [`blobbi-renderer-contract.md`](./blobbi-renderer-contract.md) — the
  `@blobbi/react` boundary the accessory preview respects.
- [`accessory-definition-migration.md`](./accessory-definition-migration.md) —
  the transitional accessory architecture, the mapping format, and the
  publish → activate checklist the activation panel below drives.

## Accessory activation status

A published **cosmetic** definition is not yet wearable. Publishing puts the item
on relays; *activating* it means mapping a legacy `equip` code onto its address,
and that is a reviewed source-code change. Between the two, the item is real and
invisible — a gap that is silent if the tool does not say so.

Each card in **Published Items** therefore carries an **Accessory activation**
panel (`src/tools/game-items/activation-status.ts` for the logic,
`ActivationStatusPanel.tsx` for the view). It reports:

- Published; official issuer (or **not** the official issuer);
- mapped to a legacy accessory code, and which one — or *not mapped*;
- **Active in renderer** — mapped *and* resolving to **this** address;
- slot mismatch between `content.visual.slot` and the mapped code's prefix;
- missing primary / front / back artwork.

It offers **Copy full address**, **Copy mapping code** and **Copy registry
snippet**. The snippet is an `OFFICIAL_COSMETIC_DEFINITIONS` entry for a human to
paste, review and commit.

The panel is **diagnostic only**. Nothing on it publishes an event, mutates an
inventory, or edits the mapping — a browser that could write the trust mapping
would defeat the point of having one. It renders for cosmetics only; a consumable
is used, never worn, so it has no activation story.

A third party's definition carrying the *same* `d` reports **Not active**, because
the mapping resolves the official address and that event is not at it.

---

**Phase 9.5 (hardened in 9.5a):** the tools gained a fourth tab, the
**Equipment Lab** — the one sanctioned mutation surface inside the tools,
over the two canonical kind:31633/31634 writers. Unlike the read-only tabs it
is **build-flag gated and off by default**
(`VITE_ENABLE_LIVE_INVENTORY_LAB=true`); default builds neither show the tab
nor include its chunk, every Lab write requires an explicit confirmation, and
normal controls respect published `max_stack`. See
[`inventory-equipment-lab.md`](./inventory-equipment-lab.md); the boundary
amendments live in `src/tools/game-items/boundaries.test.ts`.

**Phase 9.5b:** the tools page accepts a validated `?tab=` deep link
(`/tools/game-items?tab=lab` from the `/dev/equipment` harness); values go
through `coerceToolTab`, so disabled builds fall back to the Item Studio.
The publish-free visual harness for all sixteen official items is
[`dev-equipment-harness.md`](./dev-equipment-harness.md).
