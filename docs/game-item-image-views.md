# Game Item Image Views

How Blobbi Island consumes the repeatable `image` tag of a kind:31632 Game Item
Definition, and how it decides which of an item's pictures to show where.

One sentence: **the library parses the tags, the Island picks among them, and the
renderer only ever receives plain URLs.**

---

## 1. The external model (`@nostr-games/inventory@0.2.0`)

The wire format is a repeatable tag:

```text
["image", "<url>"]              # primary / default image (no marker)
["image", "<url>", "<marker>"]  # an additional view
```

Six markers are defined by this version of the spec:

| marker | camera angle |
| --- | --- |
| `front` | facing the camera |
| `back` | seen from behind |
| `side-right` | profile, right |
| `side-left` | profile, left |
| `diagonal-front-right` | three-quarter, right |
| `diagonal-front-left` | three-quarter, left |

The library exposes:

| symbol | what it gives us |
| --- | --- |
| `GameItemDefinition.images` | every valid `image` tag, in tag order, with markers |
| `GameItemDefinition.image` | the primary URL (same rule as `getPrimaryItemImage`) |
| `GameItemImage` | `{ url: string; marker?: string }` |
| `GameItemImageMarker` / `GAME_ITEM_IMAGE_MARKERS` | the six known markers |
| `GameItemImageMarkerValue` | a known marker **or** any other string |
| `GameItemImageSource` | `{ images: readonly GameItemImage[] }`: the helper input |
| `selectPrimaryGameItemImage(images)` | the primary entry, or `undefined` |
| `getPrimaryItemImage(item)` | the primary URL, or `undefined` |
| `getItemImageByMarker(item, marker)` | the first image with that marker |
| `getItemImagesByMarker(item, marker)` | every image with that marker, in order |
| `isGameItemImageMarker(value)` | narrows a string to the known union |

Rules that matter downstream, all verified against the installed package in
`src/inventory/item-image-resolution.test.ts`:

- an **unmarked** image is the primary/default;
- when *every* image is marked, the **first** entry becomes the primary, so an
  only-marked definition still renders;
- `marker` is the raw index-2 value, so **unknown markers survive verbatim**,
  `isGameItemImageMarker` narrows, it does not filter;
- image tags with a missing or blank URL are **ignored**;
- there is **no** `thumb` tag, **no** spritesheet and **no** turnaround format.

## 2. Primary image policy (compact UI)

Inventory tiles, shop cards, item-detail headers, list rows and HUD chips call
`primaryItemImageUrl()` and show exactly one picture:

```text
first unmarked image
  → first valid image (only when the item ships nothing but marked views)
  → the legacy flattened `image` field (models with no collection)
  → nothing (the caller renders its emoji/placeholder)
```

The first two steps are `getPrimaryItemImage` verbatim; the Island does not
restate them.

A compact cell **never** prefers a marked view when a primary exists. A hat's
`side-left` artwork in an inventory grid would misrepresent the item, so pose
assets stay out of unposed contexts.

## 3. Pose-specific policy (a Blobbi wearing the item)

`itemImageSourcesForView(definition, view)` returns an **ordered, de-duplicated**
list rather than one URL, because the renderer paints `sources[0]` and walks the
rest on `<img onError>`.

```text
front:  front-marked → primary → first valid image
back:   back-marked  → primary → front-marked → first valid image
```

`back` falls through to the front view before the generic last resort because a
back-mounted item that only published a front asset is far likelier to be
drawable from behind than an arbitrary first entry is. `front` does not
reciprocate: an item shipping a `back` view and no `front` view is telling us its
front *is* the primary.

**Side and diagonal views are never chosen as a front or back view.** They are
different camera angles, not different qualities of the same angle, dropping a
side-view hat onto a front-facing Blobbi is a worse answer than dropping its
primary image on it. They remain reachable only through the generic "first valid
image" last resort, which exists so an item shipping nothing but a diagonal view
still renders.

## 4. Exact accessory fallback order

`createIslandAccessorySourceResolver({ definitionsByCode, facing })` in
`src/components/blobbi/lib/island-accessory-sources.ts` produces, highest first:

1. the requested pose's marked image from the definition;
2. the definition's primary image;
3. the definition's `front` view; only when resolving `back`;
4. the definition's first valid image;
5. the URL stored on the equip tag, or, **only when there is none**, the
   generated remote URL for the code;
6. the local `.webp` asset;
7. the local `.png` asset.

Then: blank URLs are dropped and repeats are collapsed, keeping the first
occurrence. An empty `src` is a request for the current page, and retrying a URL
that just failed only delays reaching one that works.

Steps 1–4 are published facts; steps 5–7 are inferred paths, so **published
artwork outranks a filename guess**. Step 5 deliberately keeps the historical
`url || generated` pairing instead of listing both, appending the generated URL
after a stored one would add a network retry that never used to happen.

## 5. Item identity and issuer trust

A kind:31632 item is identified by `31632:<issuer-pubkey>:<d-tag>`, never by `d`
alone. Kind:31632 is addressable, so anybody can publish a definition with any
`d` value; matching on `d` across arbitrary issuers would let a stranger's event
decide what a player's hat looks like.

`src/inventory/accessory-item-identity.ts` therefore maps a legacy accessory code
onto a `d` tag, and resolves that `d` through the existing official registry,
which always stamps `OFFICIAL_ITEM_ISSUER_PUBKEY`. No trust is widened:
`parseOfficialItemDefinition` already rejects every other issuer before a
definition can enter the catalog.

**The mapping is empty today.** The official issuer has published 20 item
definitions (19 consumables + the Arcade Ticket) and no accessory, so every
accessory currently resolves through the legacy chain alone and the
definition-aware branch is dormant but fully tested against fixtures. The mapping
is explicit rather than derived (e.g. `blobbi:accessory:<code>`) so that
resolution can never start silently because somebody published an event at a
guessable address.

## 6. Legacy accessory compatibility

Accessories predate the item protocol here. An accessory with no definition
behaves exactly as it did before this phase, same sources, same order:

```text
stored equip URL (or the generated remote URL when absent) → local .webp → local .png
```

That is asserted directly in
`src/components/blobbi/lib/island-accessory-sources.test.ts`, including that a
stored URL never gains an extra generated-URL retry and that identical URLs are
never tried twice.

## 7. What the actor supports today

`CurrentBlobbiDisplay` renders `facing="front"` or `facing="back"`, and asks for
the matching image view. That is the whole set: there are no side-facing or
diagonal Blobbi poses, movement direction is not mapped to a side image, and
nothing animates between view assets.

**A published `back` image changes the picture, never the policy.** Which
accessories are drawn from behind is still decided by the package's
`REAR_VIEW_HIDDEN_SLOTS`: a face-only item stays hidden in rear view no matter
what it publishes.

## 8. Preserved but inactive views

`side-right`, `side-left`, `diagonal-front-right`, `diagonal-front-left` and any
unknown marker are parsed, stored in `ResolvedBlobbiItemDefinition.images`, and
reachable through `itemImageByMarker` / `itemImagesByMarker`. Nothing in the
current render path consumes them.

This is why the Island model keeps the package's **ordered collection** rather
than a `marker → url` map. A map would lose source order, duplicate markers, a
second unmarked primary, and future markers; all things an issuer can
legitimately publish.

## 9. Package boundary

```text
kind:31632 event
  → @nostr-games/inventory 0.2.0        (parses tags → GameItemImage[])
  → Island catalog / protocol-adapter   (keeps the whole collection)
  → Island image-view resolver          (picks per context)
  → Island accessory source resolver    (adds legacy fallbacks)
  → @blobbi/react                       (paints plain URLs)
```

`@blobbi/react` knows nothing about kinds, tags, issuers, relays, inventory
ownership, item definitions or view markers. Its `AccessorySourceResolver`
contract is unchanged: a resolver still receives `{ code, slot, url }` and still
returns `readonly string[]`: so the definition lookup and the requested pose are
**closed over at construction time** on the Island side.

Enforced by `src/components/blobbi/renderer-boundary.test.ts` (the package
imports no inventory code, mentions no kind number or marker vocabulary, and the
accessory adapter is the only Island module turning definitions into renderer
sources) and by `packages/blobbi-react/src/package-purity.test.ts`.

## 10. Warning handling

The parser reports non-fatal `ParseWarning`s: `missing-primary-image`,
`multiple-primary-images`, `invalid-image-tag`. **None of them rejects an item.**
The Island keeps the definition and resolves deterministically:

- missing primary → the first valid image becomes the primary;
- multiple primaries → the first unmarked one wins;
- invalid image tag → that tag is dropped, the rest of the item is unaffected;
- duplicate markers and unknown markers produce no warning at all and are
  preserved.

Warnings are authoring feedback for issuers, not player-facing problems, so
nothing raises a toast. They are inspectable in tests and dev tooling via
`parseGameItemDefinitionResult(...).warnings`.

## 11. Fixtures and testing

`src/inventory/item-image-fixtures.ts` holds **raw kind:31632 events**: not
hand-built definition objects: so every test exercises the real parser. They
cover: primary only; primary + front + back; a full turnaround; only-marked;
duplicate `front`; multiple primaries; an unknown marker; invalid/blank image
tags; no images at all; back-only; front-only.

They require no authentication, no relay, no inventory ownership and no
equipment state; they create no persistent event; they are authored by a
**fixture pubkey**, not the official issuer, so a stray import cannot make one
resolve as an official item. URLs point at `fixtures.invalid`, which can never
resolve.

Suites:

| file | covers |
| --- | --- |
| `src/inventory/item-image-resolution.test.ts` | library contract, primary policy, pose policy, marker preservation, warnings |
| `src/inventory/accessory-item-identity.test.ts` | identity mapping and issuer trust |
| `src/components/blobbi/lib/island-accessory-sources.test.ts` | full fallback order, legacy compatibility, de-duplication |
| `src/components/blobbi/CurrentBlobbiDisplay.accessory-views.test.tsx` | front/back wiring through the real renderer, rear-view slot policy unchanged |
| `src/components/blobbi/ItemBagModal.image-views.test.tsx` | inventory tiles use the primary image |
| `src/components/blobbi/FoodShopModal.image-views.test.tsx` | shop cards use the primary image; published artwork outranks bundled paths |
| `src/components/blobbi/renderer-boundary.test.ts` | the renderer package stays protocol-agnostic |

## 12. Non-goals

Explicitly **not** part of this work:

- publishing item definitions or inventory events;
- Grant; Placement; equip-ownership migration;
- remote accessory lookup or any runtime fetch to build a source list;
- side-facing or diagonal Blobbi poses; animation; spritesheets; turnaround
  schema; 3D;
- changes to `@blobbi/react`'s boundaries, movement, ground anchors, presence or
  theater;
- redesigning the inventory or shop UI;
- migrating legacy accessories.

## 13. Authoring these images

The `image` tags described here are authored and published through the internal
Game Item Tools at `/tools/game-items`: see
[`game-item-tools.md`](./game-item-tools.md) for the image manager, the
primary/unmarked rule, marker suggestions from filenames, and the front/back
preview that uses the same resolution helpers documented above.

The non-goals in §12 that concern *publishing* are addressed by that tool; the
rendering non-goals (side/diagonal poses, animation, spritesheets, 3D) still
stand.

## 14. First activated accessory

The non-goal "migrating legacy accessories" in §12 is now partially addressed:
one accessory: the **Block Builder Cap**
(`31632:9efb8d30…63a9:blobbi:cosmetic:block-builder-cap`): resolves its artwork
through the `image` views documented above. Its `front` and `back` markers drive
`itemImageSourcesForView`, and its `side-right` / `side-left` markers are parsed
and reachable but never posed, exactly as §"why side/diagonal are not
substituted" describes.

Everything else in §12 still stands: no Grant, no Placement, no runtime fetch to
build a source list, no side-facing Blobbi poses. The remaining 24 legacy
accessories are unpublished and resolve through the legacy chain unchanged.

See [`accessory-definition-migration.md`](./accessory-definition-migration.md).
Visual-EFFECT items carry a single primary image (card artwork only, an
effect's look is local code, not an image): see
[`blobbi-effect-activation.md`](./blobbi-effect-activation.md).
