export interface LocationScalingConfig {
  initialScale: number;
  finalScale: number;
}

export const locationScalingConfig: Record<string, LocationScalingConfig> = {
  'nostr-station-open.png': {
    initialScale: 1.2,
    finalScale: 0.6,
  },
  'town-open.png': {
    initialScale: 1.2,
    finalScale: 0.8,
  },
  'plaza-open.png': {
    initialScale: 1.2,
    finalScale: 0.8,
  },
  'mine-open.png': {
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
  'shop-open.png': {
    initialScale: 1,
    finalScale: 0.8,
  },
  'photo-booth-inside.png': {
    initialScale: 1.5,
    finalScale: 1.5,
  },
  'plaza-inside.png': {
    initialScale: 1,
    finalScale: 0.8,
  },
};
