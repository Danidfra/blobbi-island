export interface LocationScalingConfig {
  initialScale: number;
  finalScale: number;
}

export const locationScalingConfig: Record<string, LocationScalingConfig> = {
  'nostr-station-open.webp': {
    initialScale: 1.2,
    finalScale: 0.6,
  },
  'nostr-station-inside.png': {
    initialScale: 1.4,
    finalScale: 1.3,
  },
  'town-open.webp': {
    initialScale: 1.2,
    finalScale: 0.8,
  },
  'plaza-open.webp': {
    initialScale: 1.2,
    finalScale: 0.8,
  },
  'mine-open.webp': {
    initialScale: 1.6,
    finalScale: 1.2,
  },
  'arcade-minus1.png': {
    initialScale: 1.2,
    finalScale: 0.8,
  },
  'arcade-1.png': {
    initialScale: 1.2,
    finalScale: 1.2,
  },
  'shopping-mall-inside.png': {
    initialScale: 1,
    finalScale: 0.8,
  },
  // Clothing Store. `initialScale` is the FRONT of the room (y = 99.5) and
  // `finalScale` the BACK (y = 64.5) — see `resolveBlobbiScale`. The furnished
  // artwork opened the floor up from a 22 %-deep strip to a 35 %-deep room, so
  // the ramp widened with it: the old 1.2 → 1.0 was calibrated for the shell and
  // would have left a Blobbi at the clothing rack the same size as one on the
  // rug. The slope now matches the Badges Store's, the other room of this depth.
  'clothing-store.webp': {
    initialScale: 1.25,
    finalScale: 0.9,
  },
  // Badges Store. `initialScale` is the FRONT of the room (y = 99) and
  // `finalScale` the BACK (y = 59.5) — see `resolveBlobbiScale`. At ~40 % of the
  // world deep it is the deepest shop interior, so the ramp is the widest.
  'badges-store-inside.webp': {
    initialScale: 1.3,
    finalScale: 0.9,
  },
  // Furniture Store. `initialScale` is the FRONT of the room (y = 99) and
  // `finalScale` the BACK (y = 56) — see `resolveBlobbiScale`. At 43 % of the
  // world deep it is the deepest interior in the game, because the showroom's
  // aisle runs all the way from the frame's bottom edge to the checkout desk
  // against the back wall. The ramp is set to the same slope per unit of depth
  // the Badges Store uses, so a Blobbi at the till reads as being as far away
  // as one at the Badges counter.
  'furniture-store-inside.webp': {
    initialScale: 1.3,
    finalScale: 0.85,
  },
  // Care Store. `initialScale` is the FRONT of the room (y = 99) and
  // `finalScale` the BACK (y = 68.5) — see `resolveBlobbiScale`. The room is
  // ~30 % of the world deep, a little more than the clothing store, so the ramp
  // is slightly wider.
  'care-store-inside.webp': {
    initialScale: 1.2,
    finalScale: 0.95,
  },
  'photo-booth-inside.png': {
    initialScale: 1.5,
    finalScale: 1.5,
  },
  // Plaza interior. `initialScale` is the FRONT of the room (y = 99.5) and
  // `finalScale` the BACK (y ≈ 39.4, the far ends of the balcony's wings) —
  // see `resolveBlobbiScale`. Two floors share one linear ramp, so the scale
  // runs continuously: ~1.05 at the frame's bottom edge, ~0.85 at the bottom
  // step (y = 73.6), ~0.73 halfway up the flight, ~0.63 on the landing and the
  // corridor's centre run (y = 46), easing to 0.58 as the wings climb the
  // parapet toward the frame edges.
  //
  // The back was 0.75, at which a Blobbi on the landing stood 87 % as tall as
  // the painted door beside it and looked no further away than one at the foot
  // of the stairs. The ramp now puts it at ~70 % of the door. Its floor is the
  // balcony parapet: the Blobbi walks the corridor BEHIND it, and the corridor
  // line keeps the same immersion behind the parapet's plate all the way out
  // (`PLAZA_CORRIDOR`), so what has to hold is that an `lg` rig (96 px, 8 % of
  // the world tall at 0.58) keeps its head and eyes above the plate — which it
  // does with ~1.5 % to spare above the top rail at the wings' ends and ~3.5 %
  // along the centre run. Lower than this and the corridor becomes a walk
  // behind a fence.
  'plaza-inside.webp': {
    initialScale: 1.05,
    finalScale: 0.58,
  },
};
