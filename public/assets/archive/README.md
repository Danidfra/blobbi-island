# Archived assets

Assets in this folder are **not referenced anywhere in the codebase**. They were moved
here (instead of being deleted) so that the reorganization is fully reversible and the
art is not lost.

Each file is stored under the path it *would* occupy in the live tree, so promoting one
back is a single `git mv` with the `archive/` segment removed. Example:

```sh
git mv public/assets/archive/world/props/bench-1.png public/assets/world/props/bench-1.png
```

## How "unused" was determined

For every file under `public/assets/` the whole repository (`.ts`, `.tsx`, `.js`, `.jsx`,
`.html`, `.css`, `.json`, `.webmanifest`, `.md`) was searched for:

1. the exact public URL (`/assets/...`),
2. the bare filename (catches split/interpolated strings), and
3. any directory used as the static prefix of a template literal
   (e.g. `` `/assets/characters/blobbi/accessories/${slot}/${code}.png` ``), which means
   every file inside that directory is considered reachable.

Only files with **zero** hits from all three checks were archived. This is why none of the
accessory sprites were archived even though no source file names them literally: they are
resolved at runtime from Nostr inventory data.

## Contents

| File | Why it was archived |
| --- | --- |
| `world/buildings/shop-old.png` | Superseded by `world/buildings/shop.png`. The `-old` suffix marks it as a replaced iteration. |
| `world/props/bench-1.png`, `world/props/bench-2.png` | Town bench scenery that was never placed in any location. Likely intended for the town or plaza. |
| `locations/shop/glass-barrier.png` | Superseded by the split `glass-barrier-top.png` / `glass-barrier-bottom.png` pair actually rendered in the shopping mall. |
| `locations/plaza/chill-lounge.png`, `chill-lounge-interactive.png`, `drawing-wall.png`, `drawing-wall-interactive.png`, `information.png`, `information-interactive.png` | The Plaza interior's composed kiosks. Superseded by `world/backgrounds/plaza-inside.webp`, which paints all six storefronts into the plate; the room now overlays pressable hotspots (`plaza-inside-config.ts`) instead of sprites. |
| `locations/arcade/level-b1/elevator-minus1-door.png` | Unused floor-specific elevator door variant; the arcade basement renders the shared `elevator-door.png` for both states. |
| `locations/arcade/level-b1/dance-machine-piece.png` | Companion sprite for the dance machine minigame, which has not been implemented yet. Promote to `minigames/dance/` when that game is built. |
| `ui/icons/map.svg` | Replaced by the `lucide-react` map icon the shell's map control uses. |

## Policy

- Do **not** add new work-in-progress assets here. Use a feature branch instead.
- Re-audit this folder before each release. Anything that has been archived for more than
  two release cycles and has no owner should be deleted.
