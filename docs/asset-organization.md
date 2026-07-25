# Asset Organization

How every non-code asset in Blobbi Island is stored, named, and found.

Read this before adding art, audio, video, or effects.

---

## 1. Where assets live

All runtime game assets are **static files under `public/assets/`**, served from the site
root. Nothing is imported through the bundler, so a path in the source is a literal URL:

```
public/assets/world/map/blobbi-island.png   ->   /assets/world/map/blobbi-island.png
```

Two things deliberately live *outside* `public/assets/`:

| Path | Why |
| --- | --- |
| `public/icons/` | PWA / browser integration icons referenced by `manifest.webmanifest` and `index.html`. These are platform metadata, not game content, and their URLs must stay stable because installed PWAs cache them. |
| `src/blobbi/**/lib/*-svg-data.ts` | Blobbi character art is *generated, inlined SVG* in TypeScript, not files. It is versioned with the code that draws it. Do not add PNGs for Blobbi bodies here. |

---

## 2. The structure

```
public/assets/
├── world/                  Shared, location-agnostic world content
│   ├── backgrounds/          One full-screen background per LocationId
│   ├── buildings/            Exterior building shells + their entrance overlays
│   ├── map/                  Island map and travel miniatures
│   └── props/                Reusable scenery (bushes, streetlights, ...)
│
├── locations/              Assets unique to ONE place
│   ├── arcade/
│   │   ├── ground/           LocationId "arcade"
│   │   ├── level-1/          LocationId "arcade-1"
│   │   └── level-b1/         LocationId "arcade-minus1"
│   ├── back-yard/
│   ├── beach/
│   ├── cave/
│   ├── home/
│   ├── mine/
│   ├── nostr-station/
│   ├── photo-booth/
│   │   └── props/            Overlay props composited onto the photo
│   ├── plaza/
│   ├── shop/
│   │   └── doors/            Storefront doors inside the mall
│   └── stage/
│
├── characters/             Everything that is a character, not scenery
│   ├── blobbi/
│   │   ├── accessories/      <slot>/<code>.png — filenames are Nostr data ids
│   │   ├── animations/       (reserved)
│   │   └── backgrounds/      Portrait backdrops, keyed by background id
│   └── npc/                  (reserved)
│
├── items/                  Inventory-facing item icons
│   ├── food/
│   ├── toys/
│   ├── tickets/
│   ├── furniture/            (reserved)
│   ├── decorations/          (reserved)
│   └── collectibles/         (reserved)
│
├── minigames/              Sprites that only exist inside a minigame
│   └── mining/
│
├── ui/                     Interface layer, never part of the world
│   ├── branding/             Login / title artwork
│   ├── cursors/              Custom CSS cursors
│   ├── icons/
│   │   └── nostr-hub/
│   ├── achievements/         (reserved)
│   └── hud/                  (reserved)
│
├── audio/                  (reserved) ambient/ music/ sfx/ voice/
├── effects/                (reserved) particles/ shaders/ vfx/
├── video/                  (reserved) cutscenes/
│
└── archive/                Unreferenced assets, kept for reference (see its README)
```

Folders marked *(reserved)* are empty and contain a `.gitkeep`. They exist so the first
person to add a sound or a particle effect does not have to invent a location.

---

## 3. Why it is organized this way

**Group by responsibility, not by history.** The previous layout grew by accident, which
produced folders that described *when* an asset was made rather than *what it does*:

| Old folder | Problem |
| --- | --- |
| `interactive/` | Meant "has a click handler". That is a *code* concern, not an asset concern, so it collected doors, food, toys, furniture, arcade cabinets and gems side by side. |
| `scenario/` | Overlapped `interactive/` with no rule for which one a decoration belonged in. |
| `places/` | Held only backgrounds, but the name suggested it held everything about a place. |
| `map/` | Mixed the actual island map with login/title branding — two unrelated domains. |
| `baby-stage/`, `adult-stage/` | Life-stage folders left over from an earlier design. One held a single cursor; the other was empty. |
| `interactive/builds/shop-old.png` | Version history encoded in a filename. |

**One question, one answer.** The new rule for placing an asset is a short decision:

1. Is it interface chrome the player sees *on top of* the world? → `ui/`
2. Is it a character or worn by one? → `characters/`
3. Is it an inventory item? → `items/`
4. Does it only exist inside a minigame? → `minigames/<game>/`
5. Does it appear in exactly one place? → `locations/<place>/`
6. Otherwise it is shared world content → `world/`

**`locations/` instead of `rooms/`.** Blobbi Island has interiors *and* outdoor areas
(`beach`, `mine`, `town`). "Room" would have excluded half of them. The folder names mirror
the `LocationId` union in `src/lib/location-types.ts`, so finding a place's art is
mechanical: the location id *is* the folder name.

**Backgrounds stay flat.** `world/backgrounds/` holds one image per `LocationId` rather
than one per `locations/<place>/`. They are an enumerable set consumed by a single lookup
table (`LOCATION_BACKGROUNDS`), and keeping them together makes it obvious at a glance
which locations exist and which are missing art. Everything *else* about a place is
location-scoped.

---

## 4. Naming conventions

1. **`kebab-case` only.** Lowercase, hyphen-separated, no spaces, no underscores, no
   capitals: `self-service-kiosk-on.png`.
2. **The folder is context — do not repeat it.** `locations/plaza/chill-lounge.png`, not
   `locations/plaza/plaza-chill-lounge.png`. Duplicate basenames across folders are fine
   and expected (`locations/stage/chair.png` and `locations/nostr-station/chair.png`).
3. **State goes in a suffix, not a new folder.** Use the base name plus a state suffix so
   the variants sort together:
   `refrigerator.png` / `refrigerator-open.png` / `refrigerator-door.png`,
   `self-service-kiosk.png` / `self-service-kiosk-on.png`,
   `information.png` / `information-interactive.png`.
4. **Never encode versions in filenames.** No `-old`, `-new`, `-v2`, `-final`. Replace the
   file; git holds the history. If the old art must be kept, move it to `archive/`.
5. **Numbered variants are `-1`, `-2`, ... with no padding**: `bush-1.png` … `bush-4.png`.
6. **Some filenames are data identifiers and must never be renamed.** If the name appears
   in Nostr event data or in a lookup table keyed by name, it is a contract:
   - `characters/blobbi/accessories/<slot>/<code>.png` — `<code>` is the accessory code
     published in `inv` / `equip` tags.
   - `characters/blobbi/backgrounds/blobbi-bg-default.png` — the background id stored on
     the pet.
   - `minigames/mining/{stone,gem-1,gem-2,gem-3}.png` — keys of `GEM_VALUES`.
   - `world/backgrounds/*.png` — values of `LOCATION_BACKGROUNDS`.

   Renaming any of these silently breaks existing player data. Add a mapping layer instead.

---

## 5. Referencing assets from code

### Literal paths for one-off sprites

A sprite placed once in one scene can be an inline literal. This is the common case:

```tsx
<img src="/assets/locations/plaza/fountain-top.png" alt="Fountain" />
```

### `src/lib/asset-paths.ts` for computed paths

**Any path built at runtime from data must go through `@/lib/asset-paths`.** This is the
rule that makes future reorganizations cheap — before it existed, the accessory directory
was interpolated in four separate places with two different spellings.

```ts
import { accessoryImagePath, miningItemPath, locationBackgroundPath, ASSET_DIRS } from '@/lib/asset-paths';

accessoryImagePath('headwear', 'headwear-8');   // -> /assets/characters/blobbi/accessories/headwear/headwear-8.png
miningItemPath('gem-2.png');                    // -> /assets/minigames/mining/gem-2.png
locationBackgroundPath('town-open.png');        // -> /assets/world/backgrounds/town-open.png
ASSET_DIRS.worldProps;                          // -> /assets/world/props
```

If you add a new domain folder, add it to `ASSET_DIRS` in the same commit.

### Non-obvious reference sites

When moving assets, these are easy to miss — check all of them:

| Location | What it references |
| --- | --- |
| `tailwind.config.ts` → `theme.extend.cursor` | `ui/cursors/*` via CSS `url()` |
| `public/sw.js` → `urlsToCache` | service-worker precache list |
| `index.html` | favicon, apple-touch-icon, `<link rel="preload">` |
| `public/manifest.webmanifest` | PWA icons |
| `src/lib/location-backgrounds.ts` | background *filenames* (not full paths) |
| `src/lib/blobbi-backgrounds.ts` | portrait backdrops |
| `*.test.tsx` | tests assert on exact `src` attributes |

---

## 6. Where future asset types go

| Asset type | Put it in | Notes |
| --- | --- | --- |
| Sound effects | `audio/sfx/` | Name by event: `door-open.mp3`, `coin-pickup.mp3`. |
| Ambient loops | `audio/ambient/` | Name by location: `beach-waves.mp3`. |
| Music | `audio/music/` | Name by track/theme: `arcade-theme.mp3`. |
| Voice | `audio/voice/<speaker>/` | One folder per character so lines stay together. |
| Videos / cutscenes | `video/cutscenes/` | Name by story beat: `intro.mp4`. |
| VFX sprites / sheets | `effects/vfx/` | Sheets: `<name>-sheet.png` plus a sibling `<name>.json` for frame data. |
| Particle textures | `effects/particles/` | Small, reusable, greyscale where possible. |
| Shaders | `effects/shaders/` | `.glsl` / `.frag` / `.vert`. |
| Character animations | `characters/blobbi/animations/` or `characters/npc/<name>/animations/` | Keep the sheet and its frame JSON adjacent. |
| NPC art | `characters/npc/<npc-name>/` | Self-contained: portrait, sprites, animations. |
| UI icons | `ui/icons/<feature>/` | Group by feature (`ui/icons/nostr-hub/`), not by shape. Prefer `lucide-react` for generic glyphs — only add files for custom art. |
| Cursors | `ui/cursors/` | Remember to register the hotspot in `tailwind.config.ts`. |
| Achievements / badges | `ui/achievements/` | Filename should equal the achievement id. |
| Accessories | `characters/blobbi/accessories/<slot>/` | Filename **must** equal the accessory code. |
| Items (food, furniture, decorations) | `items/<category>/` | Filename should equal the item id where one exists. |
| Buildings | `world/buildings/` | Ship the shell and its `-door` overlay together. |
| Decorations / scenery | `world/props/` if reusable, else `locations/<place>/` | See the promotion rule below. |
| Maps / tilemaps | `world/map/` | Industry-standard formats (e.g. Tiled JSON) may keep their own schema. |
| New minigame art | `minigames/<game>/` | One folder per game. |
| New location art | `locations/<location-id>/` + one background in `world/backgrounds/` | Add the `LocationId` to `src/lib/location-types.ts` and the background to `LOCATION_BACKGROUNDS`. |

---

## 7. Room- / location-specific vs. reusable assets

This is the distinction people get wrong most often, so it has one explicit rule.

**Put an asset in `locations/<place>/` if it is currently used by exactly one place.**
**Put it in a shared folder (`world/props/`, `items/`, `ui/`) only once a second place
actually uses it.**

Start location-scoped and *promote* when reuse appears — do not pre-emptively generalize.
Promotion is cheap and mechanical:

```sh
git mv public/assets/locations/plaza/bench.png public/assets/world/props/bench.png
# then update the references (they are literal strings)
```

Consequences of this rule worth knowing:

- `locations/home/bed.png`, `chest.png` and `refrigerator*.png` are location-scoped today
  even though "furniture" sounds generic, because only the home renders them. When the
  furniture store makes furniture placeable, they move to `items/furniture/`.
- `world/props/bush-*.png` and `streetlight.png` are shared even though only the town uses
  them right now, because they carry no location-specific detail and were always intended
  as generic set dressing.
- `locations/plaza/floor.png` is used by both `plaza` and `plaza-inside`. Those are two
  `LocationId`s in the same *place*, so it sits at the place root rather than being
  duplicated. **Never duplicate a file to satisfy the folder structure** — put it at the
  nearest shared ancestor.
- Multi-floor places nest by floor (`locations/arcade/{ground,level-1,level-b1}/`).
  Anything shared across floors goes at `locations/arcade/`.

---

## 8. Archived assets

`public/assets/archive/` holds assets with **zero references anywhere in the repository**.
They were moved rather than deleted so the reorganization stays reversible.

Files are stored under the path they *would* occupy in the live tree, so promoting one back
is a single `git mv` with the `archive/` segment removed.

See [`public/assets/archive/README.md`](../public/assets/archive/README.md) for the current
contents, the exact reason each file was archived, and the method used to prove it was
unused.

**Important:** "no source file mentions this filename" is *not* sufficient proof that an
asset is unused. Accessory sprites are resolved at runtime from Nostr inventory data and
backgrounds from a lookup table, so an unused-asset check must also treat every directory
used as the static prefix of a template literal as fully reachable.

---

## 9. Recommendations for contributors

**Do**

- Optimize before committing. These are static files with no build-time processing, so a
  large PNG is shipped byte-for-byte to every player.
- Prefer `.webp` for new photographic/complex art. The accessory loader already falls back
  `.webp` → `.png`.
- Add the state suffix variants (`-open`, `-on`, `-interactive`) in the same commit as the
  base sprite.
- Update `ASSET_DIRS` in `src/lib/asset-paths.ts` when you add a domain folder.
- Delete the old file in the same commit that replaces it.

**Don't**

- Don't create a folder named after a sprint, a person, a date, or a life stage.
- Don't add `-old` / `-v2` / `-final` files. Use git, or `archive/`.
- Don't interpolate an asset directory inline — add a helper to `src/lib/asset-paths.ts`.
- Don't rename a file whose name is a data identifier (see §4.6).
- Don't commit `.DS_Store`. It is gitignored; keep it that way.

**Verifying a move**

`npm test` runs `tsc`, `eslint`, `vitest` and `vite build`, but none of them can see a
broken *string* path. After moving assets, also confirm that every `/assets/...` URL in the
built output resolves to a file that exists in `dist/`, and that no legacy path segment
survives anywhere.

### Known gaps

- `/assets/locations/back-yard/door.png` is referenced by `InteractiveElements.tsx` but the
  art has never existed in the repository (it was previously referenced as
  `/assets/interactive/back-yard-door.png` and 404'd there too). The back yard renders a
  broken image today. Dropping the art at that path fixes it with no code change.
- `characters/blobbi/accessories/eyewear/` starts at `eyewear-2.png`; there is no
  `eyewear-1.png`.
- `public/sw-register.js` is never loaded by `index.html`, so the service worker in
  `public/sw.js` is currently dead code.
