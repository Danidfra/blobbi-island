# Adult V2 in the real actor: the DEV-only visual generation override

Blobbi Island renders bodies through `@blobbi-kit/renderer`, which since kit
`7697266` draws two artwork generations: V1 (the sixteen forms every existing
Blobbi has) and Adult V2 (one canonical anatomy with front, side and back
views and derived closed eyes). Which one a Blobbi gets is a property of its
identity, carried in its kind 31124 event as `["visual_generation","v2"]`.
No Blobbi carries that tag yet, and Island's own parser does not read it yet.

To judge V2 inside the real runtime (movement, depth scaling, z-bands, the
ground anchor, seats, sleeping, remote players) before any event carries the
tag, a development build can force the generation at the renderer boundary.

## What it is

`src/lib/blobbi-visual-dev.ts`. In a dev server (`npm run dev`):

| URL / storage | effect |
| --- | --- |
| `?blobbiVisualGeneration=v2` | draw every body as Adult V2, and remember it in `localStorage['blobbi-dev-visual-generation']` so in-app navigation (which drops the query) keeps it |
| `?blobbiVisualGeneration=v1` | back to production behaviour, and forget |
| nothing | whatever is remembered; nothing remembered means production behaviour |

The override is applied by `CurrentBlobbiDisplay` (local actor, cards, modals)
and `RemoteBlobbiSprite` (other players) to the **already resolved**
`BlobbiVisual`, after the companion has been parsed and mapped exactly as in
production: `applyDevVisualGeneration(visual, override)` returns the same
object when the override is off and a copy with `visualGeneration: 'v2'` when
it is on.

## What it can never do

- **Reach production.** Everything is gated on `import.meta.env.DEV`, a
  literal `false` in a build; the reader returns `null` before looking at the
  query or storage. The same convention gates `/dev/*` and the debug overlays.
- **Touch an event or domain state.** The module imports React and renderer
  types only (`blobbi-visual-dev.test.ts` pins the import graph); it never
  sees a `NostrEvent`, a signer, a publisher, a query cache or the parser. It
  cannot write `["visual_generation","v2"]` anywhere because it never handles
  tags at all. The remembered flag is the override itself, not Blobbi data.
- **Change a V1 body.** With the override off, `resolveBodyFacing` returns the
  pose facing for V1 regardless of movement, accessories and effects resolve as
  before, and the renderer's 142 V1 fingerprints are unchanged in the kit.

## Movement → facing

`src/lib/blobbi-facing.ts`. The movement controller's normalized heading
(`direction`, +y is down/toward the viewer) maps by dominant axis:

    down → front    up → back    right → right    left → left
    diagonals → the larger axis; an exact tie is vertical

`MovableBlobbi` passes `movementFacing` only while the pose is `standing`, so
seats, the bed and hiding never turn the body. The controller keeps its last
heading after a walk ends, so a Blobbi that walked left stays turned left
while idle (gaze then moves the single profile eye). A pose facing of `back`
(a rear-facing seat) always wins. V1 ignores `movementFacing` entirely.
Remote players use the same rule from their presence heading.

Movement, collision, boundaries and the rAF loop are untouched.

## Accessories and effects under the override

Accessory placements are authored against V1 anchors (head top 18 %, eye line
48 % of the box); V2's anchors differ (head top 15.8 %, eye line 47.3 %,
ground 92.9 %) and there is no V2 accessory anchoring or side-view accessory
artwork. Under the override accessories are therefore **not drawn**
(`accessoriesAllowed` in `CurrentBlobbiDisplay`), so nothing floats beside a
turned body. This is scoped to the override: a real V2 Blobbi is unaffected,
and V2 accessory anchoring is a separate, open item. Effects are box-relative
decoration and stay on.

## Visual bounds vs. collision bounds

`BlobbiActor` anchors the renderer box's bottom centre on the stored ground
point and draws its own ground shadow there. V1 places its body's ground line
at 82 % of the box; V2 at 92.9 %, so V2 feet sit closer to the actor's ground
point (about 7 % of the box above it instead of 18 %). The V2 viewBox is
211.67 × 238.13 (taller than wide) inside a square box, so the drawing is
letterboxed to about 89 % of the box width. Measured in `/dev/rooms` (town,
size `lg`, depth scale 1.20, 129 px box): the V2 feet end 14 px above the
stored ground point and the body is centred on it horizontally; the V1
`leafy` form's lowest pixel ends 16 px above the same point. The two
generations therefore stand on the same ground within 2 px. Nothing about the
collision boundary or approach distances reads the artwork, so no collision
behaviour changed, and no visual anchoring adjustment was made.

## What was verified in the real actor pipeline

`/dev/rooms?blobbiVisualGeneration=v2` mounts the production `MovableBlobbi` →
`BlobbiActor` → `CurrentBlobbiDisplay` → `BlobbiRenderer` chain with a dev
visual and no Nostr. Observed with the `leafy` (adult) visual:

- idle: V2 front, two gaze groups, depth scale and z-band applied by the actor;
- walking left / right: mirrored / authored profile, one gaze group;
- walking up: back view, no face, no gaze markup; walking down: front;
- diagonals: dominant axis (left-up → left, up-right → back);
- stopping keeps the last facing; `snapTo` keeps it too;
- theater seat `theater-seat-a1`: pose facing `back` wins, seated scale 0.85,
  seated z, shadow hidden, no face parts;
- `?blobbiVisualGeneration=v1` on the same room: V1 body, walking left stays
  front, no `data-part` in the DOM.

Sleeping and one visual effect (`golden-sparkles`) on V2 are covered by
`CurrentBlobbiDisplay.v2-dev-override.test.tsx`; the harness has no sleeping
pose and the effects page renders `BlobbiRenderer` directly. The live island
was not entered: it requires a Nostr sign-in and publishes presence.

## Manual verification

    # in blobbi-island (the renderer is the published @blobbi-kit/renderer package)
    npm run dev
    # open, then walk around, sit, sleep, switch rooms:
    http://localhost:5173/?blobbiVisualGeneration=v2
    # back to V1:
    http://localhost:5173/?blobbiVisualGeneration=v1

Tests: `src/lib/blobbi-visual-dev.test.ts`, `src/lib/blobbi-facing.test.ts`,
`src/components/blobbi/CurrentBlobbiDisplay.v2-dev-override.test.tsx`.
