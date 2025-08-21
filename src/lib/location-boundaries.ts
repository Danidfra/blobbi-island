import { Boundary } from '@/lib/boundaries';

export const locationBoundaries: Record<string, Boundary> = {
  'home-inside.png': {
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
      { type: 'rectangle', x: [5, 70], y: [65, 95] }, // Main area
      { type: 'triangle', points: [{ x: 44, y:70 }, { x: 51, y:70  }, { x: 51, y: 64 }] }, //

      { type: 'rectangle', x: [51, 61], y: [64, 70] }, //
      { type: 'triangle', points: [{ x: 51, y:64 }, { x: 56, y:64  }, { x: 56, y: 60 }] }, //

      { type: 'rectangle', x: [56, 61], y: [60, 64] }, //
      { type: 'triangle', points: [{ x: 56, y:60 }, { x: 61, y:54  }, { x: 61, y: 60 }] }, //

      { type: 'rectangle', x: [61, 70], y: [54, 70] }, //
      { type: 'triangle', points: [{ x: 61, y:54 }, { x: 64, y:54  }, { x: 64, y: 50 }] }, //

      { type: 'rectangle', x: [64, 70], y: [50, 54] }, //
      { type: 'triangle', points: [{ x: 70, y:40 }, { x: 70, y:50  }, { x: 64, y: 50 }] }, //

      { type: 'rectangle', x: [70, 96], y: [40, 95] }, //
      { type: 'triangle', points: [{ x: 70, y:40 }, { x: 75, y: 32 }, { x: 75, y: 40 }] }, //

      { type: 'rectangle', x: [75, 90], y: [30, 45] }, //
    ],
  },
  'plaza-open.png': {
    shape: 'rectangle',
    x: [5, 95],
    y: [56, 98],
  },
  'plaza-inside.png': {
    shape: 'composite',
    areas: [

      // Main area
      { type: 'rectangle', x: [0, 41], y: [72, 100] },

      { type: 'rectangle', x: [59, 100], y: [72, 100] },
      { type: 'triangle', points: [{ x: 59, y: 75 }, { x: 55, y: 75 }, { x: 59, y: 80 }] },
      
      { type: 'rectangle', x: [41, 59], y: [85, 100] },
      { type: 'triangle', points: [{ x: 41, y: 75 }, { x: 45, y: 75 }, { x: 41, y: 80 }] },

      { type: 'rectangle', x: [25, 75], y: [69, 75] },
      { type: 'triangle', points: [{ x: 0, y:72 }, { x: 25, y: 62 }, { x: 25, y: 72 }] },
      { type: 'rectangle', x: [25, 35], y: [62, 69] },
      { type: 'triangle', points: [{ x: 100, y: 72 }, { x: 75, y: 62 }, { x: 75, y: 72 }] },
      { type: 'rectangle', x: [65, 75], y: [62, 69] },

      // Stairs
      { type: 'triangle', points: [{ x: 42, y:69 }, { x: 46, y: 69 }, { x: 46, y: 43 }] },
      { type: 'triangle', points: [{ x: 58, y: 69 }, { x: 53, y: 69 }, { x: 53, y: 43 }] },
      { type: 'rectangle', x: [44, 55], y: [55, 69] },
      { type: 'rectangle', x: [46, 53], y: [43, 55] },

      // First floor
      { type: 'rectangle', x: [44.5, 54.5], y: [43, 45] },

      { type: 'rectangle', x: [53, 76], y: [43, 43] },
      { type: 'rectangle', x: [25, 46], y: [43, 43] },

      { type: 'triangle', points: [{ x: 25, y:43 }, { x: 0, y: 33 }, { x: 25, y: 43 }] },
      { type: 'triangle', points: [{ x: 75, y: 43 }, { x: 100, y: 33 }, { x: 75, y: 43 }] },
    ],
  },
  'arcade-inside.png': {
    shape: 'composite',
    areas: [
      { type: 'rectangle', x: [0, 100], y: [48, 100] },
      { type: 'rectangle', x: [45, 55], y: [36, 48] },
    ],
  },
  'arcade-1.png': {
    shape: 'composite',
    areas: [
      { type: 'rectangle', x: [48, 52], y: [51, 59] },

      { type: 'rectangle', x: [23.5, 76.5], y: [59, 84] },
      { type: 'triangle', points: [{ x: 100, y: 84 }, { x: 76.5, y: 59 }, { x: 76.5, y: 84 }] },
      { type: 'triangle', points: [{ x: 0, y:84 }, { x: 23.5, y: 59 }, { x: 23.5, y: 84 }] },

      { type: 'rectangle', x: [0, 100], y: [84, 100] },
    ],
  },
  'arcade-minus1.png': {
    shape: 'composite',
    areas: [
      { type: 'rectangle', x: [48, 52], y: [49, 55] },

      { type: 'triangle', points: [{ x: 0, y: 74 }, { x: 26.5, y: 55 }, { x: 26.5, y: 74 }] },
      { type: 'rectangle', x: [26.5, 73.5], y: [55, 69] },
      { type: 'triangle', points: [{ x: 100, y: 74 }, { x: 73.5, y: 55 }, { x: 73.5, y: 74 }] },
      { type: 'rectangle', x: [0, 26.5], y: [74, 88] },
      { type: 'rectangle', x: [26.5, 42], y: [69, 82] },
      { type: 'rectangle', x: [58, 73.5], y: [69, 82] },
      { type: 'rectangle', x: [73.5, 100], y: [74, 88] },

      { type: 'rectangle', x: [48, 52], y: [72, 88] },
      { type: 'rectangle', x: [26.5, 73.5], y: [84, 88] },

      // { type: 'rectangle', x: [26.5, 73.5], y: [84, 88] },
      // { type: 'rectangle', x: [26.5, 73.5], y: [84, 88] },

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
  'stage-inside.png': {
    shape: 'rectangle',
    x: [0, 100],
    y: [75, 98],
  },
  'cave-inside.png': {
    shape: 'rectangle',
    x: [16, 84],
    y: [71, 75.5],
  },
  'shopping-mall-inside.png': {
    shape: 'composite',
    areas: [
      { type: 'rectangle', x: [0, 100], y: [84, 100] },

      { type: 'rectangle', x: [0, 7], y: [56, 84] },
      { type: 'triangle', points: [{ x: 7, y: 64 }, { x: 7, y: 84 }, { x: 10, y: 84 }] },

      { type: 'rectangle', x: [7, 100], y: [56, 57] },

      { type: 'rectangle', x: [93, 100], y: [27, 56] },
      { type: 'triangle', points: [{ x: 93, y: 27 }, { x: 93, y: 56 }, { x: 90, y: 56 }] },

      { type: 'rectangle', x: [0, 93], y: [27, 28] },
    ],
  },
  'photo-booth-inside.png': {
    shape: 'rectangle',
    x: [20, 68], // Center area of booth
    y: [59, 63], // Bottom area of booth (floor)
  },
};
