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
      { type: 'rectangle', x: [42, 58], y: [68, 75] },
      { type: 'rectangle', x: [10, 90], y: [75, 98] },
    ]
  },
  'nostr-station-open.png': {
    shape: 'composite',
    areas: [
      { type: 'rectangle', x: [5, 70], y: [70, 95] }, // Main area
      { type: 'rectangle', x: [51, 61], y: [64, 70] }, //
      { type: 'rectangle', x: [56, 61], y: [60, 64] }, //
      { type: 'rectangle', x: [61, 70], y: [54, 70] }, //
      { type: 'rectangle', x: [64, 70], y: [50, 54] }, //
      { type: 'rectangle', x: [70, 96], y: [40, 95] }, //
      { type: 'rectangle', x: [75, 90], y: [28, 45] }, //
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
      { type: 'rectangle', x: [0, 100], y: [48, 100] },
      { type: 'rectangle', x: [45, 55], y: [36, 48] },
    ],
  },
  'arcade-1.png': {
    shape: 'composite',
    areas: [
      { type: 'rectangle', x: [48, 52], y: [55, 63] },
      { type: 'rectangle', x: [23.5, 76.5], y: [63, 84] },
      { type: 'rectangle', x: [0, 100], y: [84, 100] },
      { type: 'triangle', points: [{ x: 100, y: 84 }, { x: 76.5, y: 63 }, { x: 76.5, y: 84 }] },
      { type: 'triangle', points: [{ x: 0, y:84 }, { x: 23.5, y: 63 }, { x: 23.5, y: 84 }] }
    ],
  },
  'arcade-minus1.png': {
    shape: 'composite',
    areas: [
      { type: 'rectangle', x: [48, 52], y: [49, 55] },

      { type: 'triangle', points: [{ x: 0, y: 74 }, { x: 26.5, y: 55 }, { x: 26.5, y: 74 }] },
      { type: 'rectangle', x: [26.5, 73.5], y: [55, 74] },
      { type: 'triangle', points: [{ x: 100, y: 74 }, { x: 73.5, y: 55 }, { x: 73.5, y: 74 }] },
      { type: 'rectangle', x: [0, 100], y: [74, 88] },

      { type: 'rectangle', x: [0, 22], y: [88, 94] },
      { type: 'triangle', points: [{ x: 22, y: 88 }, { x: 22, y: 94 }, { x: 28, y: 88 }] },

      { type: 'rectangle', x: [78, 100], y: [88, 94] },
      { type: 'triangle', points: [{ x: 78, y: 88 }, { x: 78, y: 94 }, { x: 72, y: 88 }] },
      
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
