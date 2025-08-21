import { describe, it, expect } from 'vitest';
import {
  calculateBlobbiZIndex,
  getInteractiveElementsForBackground,
  getZIndexConfigForBackground,
  convertToBottomBasedPosition,
  getZIndexThresholdForPosition
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

      // Test position at 82% from top (18% from bottom) - should be z-index 15
      const midBottom = calculateBlobbiZIndex(82, 'stage-inside.png');
      expect(midBottom).toBe(15);

      // Test position at 75% from top (25% from bottom) - should be z-index 9
      const higherUp = calculateBlobbiZIndex(75, 'stage-inside.png');
      expect(higherUp).toBe(9);

      // Test position at 50% from top (50% from bottom) - should be z-index 9
      const middle = calculateBlobbiZIndex(50, 'stage-inside.png');
      expect(middle).toBe(9);
    });

    it('should calculate correct z-index for town-open.png background', () => {
      // Test position at 95% from top (5% from bottom) - should be z-index 25
      const nearBottom = calculateBlobbiZIndex(95, 'town-open.png');
      expect(nearBottom).toBe(25);

      // Test position at 85% from top (15% from bottom) - should be z-index 15
      const higherUp = calculateBlobbiZIndex(85, 'town-open.png');
      expect(higherUp).toBe(15);
    });

    it('should calculate correct z-index for beach-open.png background', () => {
      // Test position at 90% from top (10% from bottom) - should be z-index 25
      const nearBottom = calculateBlobbiZIndex(90, 'beach-open.png');
      expect(nearBottom).toBe(25);

      // Test position at 70% from top (30% from bottom) - should be z-index 15
      const higherUp = calculateBlobbiZIndex(70, 'beach-open.png');
      expect(higherUp).toBe(15);
    });

    it('should calculate correct z-index for mine-open.png background', () => {
      // Test position at 90% from top (10% from bottom) - should be z-index 20
      const nearBottom = calculateBlobbiZIndex(90, 'mine-open.png');
      expect(nearBottom).toBe(20);

      // Test position at 70% from top (30% from bottom) - should be z-index 10
      const higherUp = calculateBlobbiZIndex(70, 'mine-open.png');
      expect(higherUp).toBe(10);
    });


  });

  describe('convertToBottomBasedPosition', () => {
    it('should correctly convert top-based to bottom-based position', () => {
      expect(convertToBottomBasedPosition(0)).toBe(100); // Top -> Bottom
      expect(convertToBottomBasedPosition(100)).toBe(0); // Bottom -> Top
      expect(convertToBottomBasedPosition(50)).toBe(50); // Middle -> Middle
      expect(convertToBottomBasedPosition(25)).toBe(75); // 25% from top -> 75% from bottom
      expect(convertToBottomBasedPosition(75)).toBe(25); // 75% from top -> 25% from bottom
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

      // 17% from bottom should match second threshold (15.01-20%)
      const threshold2 = getZIndexThresholdForPosition(17, 'stage-inside.png');
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

  describe('getInteractiveElementsForBackground', () => {
    it('should return correct elements for town-open.png', () => {
      const elements = getInteractiveElementsForBackground('town-open.png');
      expect(elements).toHaveLength(9); // 9 elements in town

      const elementIds = elements.map(e => e.id);
      expect(elementIds).toContain('arcade');
      expect(elementIds).toContain('stage');
      expect(elementIds).toContain('shop');
      expect(elementIds).toContain('bush-1');
      expect(elementIds).toContain('bush-2');
      expect(elementIds).toContain('bush-3');
      expect(elementIds).toContain('bush-4');
      expect(elementIds).toContain('streetlight-left');
      expect(elementIds).toContain('streetlight-right');
    });

    it('should return correct elements for mine-open.png', () => {
      const elements = getInteractiveElementsForBackground('mine-open.png');
      expect(elements).toHaveLength(1); // 1 element in mine
      expect(elements[0].id).toBe('cave');
    });

    it('should return correct elements for beach backgrounds', () => {
      const beachOpenElements = getInteractiveElementsForBackground('beach-open.png');
      expect(beachOpenElements).toHaveLength(1);
      expect(beachOpenElements[0].id).toBe('boat');
    });

    it('should return empty array for unknown background', () => {
      const elements = getInteractiveElementsForBackground('unknown.png');
      expect(elements).toHaveLength(0);
    });
  });
});