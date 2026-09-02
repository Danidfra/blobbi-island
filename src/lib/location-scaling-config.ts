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
  'plaza-inside.png': {
    initialScale: 1,
    finalScale: 0.6,
  },
};
