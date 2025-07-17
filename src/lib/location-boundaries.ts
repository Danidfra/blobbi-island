import { Boundary } from '@/lib/boundaries';

export const locationBoundaries: Record<string, Boundary> = {
  'home-open.png': {
    shape: 'arch',
    top: 70,
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
    shape: 'rectangle',
    x: [10, 90],
    y: [75, 98],
  },
  'nostr-station-open.png': {
    shape: 'rectangle',
    x: [5, 95],
    y: [70, 95],
  },
  'plaza-open.png': {
    shape: 'rectangle',
    x: [5, 95],
    y: [70, 98],
  },
};
