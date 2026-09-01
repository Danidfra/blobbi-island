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
  'clothing-store-inside.png': {
    initialScale: 1.2,
    finalScale: 1,
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
