import { Boundary } from '@/lib/boundaries';

export const locationBoundaries: Record<string, Boundary> = {
  'home-open.png': {
    shape: 'arch',
    top: 68,
    bottom: 80,
    curvature: 2,
  },
  'town-open.png': {
    shape: 'arch',
    top: 58,
    bottom: 70,
    curvature: 4,
  },
  'beach-open.png': {
    shape: 'arch',
    top: 68,
    bottom: 70,
    curvature: 6,
  },
  'mine-open.png': {
    shape: 'composite',
    areas: [
      { x: [42, 58], y: [68, 75] },
      { x: [10, 90], y: [75, 98] },
    ]
  },
  'nostr-station-open.png': {
    shape: 'composite',
    areas: [
      { x: [5, 70], y: [70, 95] }, // Main area
      { x: [51, 61], y: [64, 70] }, //
      { x: [56, 61], y: [60, 64] }, //
      { x: [61, 70], y: [54, 70] }, //
      { x: [64, 70], y: [50, 54] }, //
      { x: [70, 96], y: [40, 95] }, //
      { x: [75, 90], y: [28, 45] }, //
    ],
  },
  'plaza-open.png': {
    shape: 'rectangle',
    x: [5, 95],
    y: [56, 98],
  },
  'arcade-open.png': {
    shape: 'composite',
    areas: [
      { x: [0, 100], y: [48, 100] },
      { x: [45, 55], y: [36, 48] },
    ],
  },
  'back-yard-open.png': {
    shape: 'rectangle',
    x: [10, 90],
    y: [75, 98],
  },
  'stage-open.png': {
    shape: 'rectangle',
    x: [0, 100],
    y: [75, 98],
  },
  'cave-open.png': {
    shape: 'rectangle',
    x: [16, 84],
    y: [75, 79],
  },
};
