import { describe, it, expect } from 'vitest';
import {
  calculateBlobbiZIndex,
  getZIndexConfigForBackground,
  getZIndexThresholdForPosition,
  setZIndexConfigForBackground,
} from './interactive-elements-config';

describe('Interactive Elements Configuration', () => {
  describe('calculateBlobbiZIndex', () => {
    it('should return base z-index for unknown background', () => {
      const zIndex = calculateBlobbiZIndex(50, 'unknown-background.png');
      expect(zIndex).toBe(20);
    });

    it('should calculate correct z-index for stage-inside.png background based on position', () => {
      // Test position at 95% from top (5% from bottom) - should be z-index 25
      const nearBottom = calculateBlobbiZIndex(95, 'stage-inside.png');
      expect(nearBottom).toBe(25);

      // Ground-anchor bands (Phase 2): the center-era 18%-from-bottom sample
      // corresponds to a GROUND point ~9.2% lower: 8.8% from bottom → z 15.
      const midBottom = calculateBlobbiZIndex(91.2, 'stage-inside.png');
      expect(midBottom).toBe(15);

      // Ground point 25% from bottom is well above the band ramp - z-index 9
      const higherUp = calculateBlobbiZIndex(75, 'stage-inside.png');
      expect(higherUp).toBe(9);

      // Test position at 50% from top (50% from bottom) - should be z-index 9
      const middle = calculateBlobbiZIndex(50, 'stage-inside.png');
      expect(middle).toBe(9);
    });

    it('should calculate correct z-index for town-open.webp background', () => {
      // Ground band 0-1.7% from bottom is the front-most row - z-index 25
      const nearBottom = calculateBlobbiZIndex(99, 'town-open.webp');
      expect(nearBottom).toBe(25);

      // Ground-anchor bands (Phase 2): the center-era 15%-from-bottom line sits
      // ~8.3% lower for a ground point: 8.3% from bottom → z 15.
      const higherUp = calculateBlobbiZIndex(91.7, 'town-open.webp');
      expect(higherUp).toBe(15);
    });

    it('should calculate correct z-index for beach-open.webp background', () => {
      // Test position at 90% from top (10% from bottom) - should be z-index 25
      const nearBottom = calculateBlobbiZIndex(90, 'beach-open.webp');
      expect(nearBottom).toBe(25);

      // Test position at 70% from top (30% from bottom) - should be z-index 15
      const higherUp = calculateBlobbiZIndex(70, 'beach-open.webp');
      expect(higherUp).toBe(15);
    });

    it('should calculate correct z-index for mine-open.webp background', () => {
      // Test position at 90% from top (10% from bottom) - should be z-index 20
      const nearBottom = calculateBlobbiZIndex(90, 'mine-open.webp');
      expect(nearBottom).toBe(20);

      // Test position at 70% from top (30% from bottom) - should be z-index 10
      const higherUp = calculateBlobbiZIndex(70, 'mine-open.webp');
      expect(higherUp).toBe(10);
    });


  });

  describe('x-limited bands', () => {
    const BACKGROUND = 'x-limited-test.png';
    const thresholds = [
      { minPosition: 0, maxPosition: 40, zIndex: 20 },
      { minPosition: 40.01, maxPosition: 60, xRange: [30, 70] as [number, number], zIndex: 20 },
      { minPosition: 40.01, maxPosition: 60, zIndex: 9 },
      { minPosition: 60.01, maxPosition: 100, zIndex: 9 },
    ];

    it('claims the position only inside its span, and yields to the general band outside it', () => {
      setZIndexConfigForBackground(BACKGROUND, thresholds);
      // y = 50 → position 50, inside the split band.
      expect(calculateBlobbiZIndex(50, BACKGROUND, 50)).toBe(20);
      expect(calculateBlobbiZIndex(50, BACKGROUND, 30)).toBe(20); // inclusive edge
      expect(calculateBlobbiZIndex(50, BACKGROUND, 70)).toBe(20);
      expect(calculateBlobbiZIndex(50, BACKGROUND, 29.9)).toBe(9);
      expect(calculateBlobbiZIndex(50, BACKGROUND, 70.1)).toBe(9);
      // Outside the split band, x makes no difference.
      expect(calculateBlobbiZIndex(70, BACKGROUND, 50)).toBe(20);
      expect(calculateBlobbiZIndex(30, BACKGROUND, 50)).toBe(9);
    });

    it('never claims a position whose x is unknown', () => {
      setZIndexConfigForBackground(BACKGROUND, thresholds);
      expect(calculateBlobbiZIndex(50, BACKGROUND)).toBe(9);
      expect(getZIndexThresholdForPosition(50, BACKGROUND)?.xRange).toBeUndefined();
      expect(getZIndexThresholdForPosition(50, BACKGROUND, 50)?.xRange).toEqual([30, 70]);
    });

    it('changes nothing for rooms whose bands have no span', () => {
      // Every pre-existing room: the answer with x is the answer without it.
      for (const y of [95, 91.2, 75, 50, 20]) {
        expect(calculateBlobbiZIndex(y, 'stage-inside.png', 50)).toBe(calculateBlobbiZIndex(y, 'stage-inside.png'));
        expect(calculateBlobbiZIndex(y, 'mine-open.webp', 10)).toBe(calculateBlobbiZIndex(y, 'mine-open.webp'));
      }
    });
  });

  describe('getZIndexConfigForBackground', () => {
    it('should return config for stage-inside.png', () => {
      const config = getZIndexConfigForBackground('stage-inside.png');
      expect(config).toBeDefined();
      expect(config?.backgroundFile).toBe('stage-inside.png');
      expect(config?.thresholds).toHaveLength(3);
    });

    it('should return undefined for unknown background', () => {
      const config = getZIndexConfigForBackground('unknown.png');
      expect(config).toBeUndefined();
    });
  });

  describe('getZIndexThresholdForPosition', () => {
    it('should return correct threshold for stage-inside.png positions', () => {
      // 3% from bottom should match first threshold (0-15%)
      const threshold1 = getZIndexThresholdForPosition(3, 'stage-inside.png');
      expect(threshold1?.zIndex).toBe(25);

      // 8% from bottom matches the second GROUND band (5.81-10.8%)
      const threshold2 = getZIndexThresholdForPosition(8, 'stage-inside.png');
      expect(threshold2?.zIndex).toBe(15);

      // 25% from bottom should match third threshold (20.01-100%)
      const threshold3 = getZIndexThresholdForPosition(25, 'stage-inside.png');
      expect(threshold3?.zIndex).toBe(9);
    });

    it('should return undefined for unknown background', () => {
      const threshold = getZIndexThresholdForPosition(50, 'unknown.png');
      expect(threshold).toBeUndefined();
    });
  });
});
