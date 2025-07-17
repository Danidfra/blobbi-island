import { describe, it, expect } from 'vitest';
import { calculateBlobbiZIndex, getInteractiveElementsForBackground } from './interactive-elements-config';

describe('Interactive Elements Configuration', () => {
  describe('calculateBlobbiZIndex', () => {
    it('should return base z-index for unknown background', () => {
      const zIndex = calculateBlobbiZIndex(50, 'unknown-background.png');
      expect(zIndex).toBe(20);
    });

    it('should calculate correct z-index for town-open.png background', () => {
      // Test Blobbi above all elements (should be behind everything)
      const aboveAll = calculateBlobbiZIndex(10, 'town-open.png');
      expect(aboveAll).toBe(14); // One less than the lowest element z-index (15)

      // Test Blobbi between bush-3 (68%) and bush-1 (100%)
      // Elements above: arcade(35%,z15), stage(30%,z15), shop(35%,z15), bush-3(68%,z25), bush-4(74%,z25)
      // Elements below: bush-1(100%,z25), bush-2(100%,z25), streetlight-left(90%,z25), streetlight-right(90%,z25)
      // Should be behind elements below (min z-index 25 -> 24)
      const betweenElements = calculateBlobbiZIndex(85, 'town-open.png');
      expect(betweenElements).toBe(24);

      // Test Blobbi below all elements (should be in front of everything)
      const belowAll = calculateBlobbiZIndex(101, 'town-open.png');
      expect(belowAll).toBe(26); // Higher than the highest element z-index (25) + 1
    });

    it('should calculate correct z-index for mine-open.png background', () => {
      // Test Blobbi above cave (40%) - should be behind cave
      const aboveCave = calculateBlobbiZIndex(30, 'mine-open.png');
      expect(aboveCave).toBe(14); // One less than cave z-index (15)

      // Test Blobbi below cave (40%) - should be in front of cave
      const belowCave = calculateBlobbiZIndex(50, 'mine-open.png');
      expect(belowCave).toBe(16); // One more than cave z-index (15)
    });

    it('should calculate correct z-index for beach backgrounds', () => {
      // Test for beach-open.png
      const aboveBoat = calculateBlobbiZIndex(30, 'beach-open.png');
      expect(aboveBoat).toBe(14); // One less than boat z-index (15)

      const belowBoat = calculateBlobbiZIndex(40, 'beach-open.png');
      expect(belowBoat).toBe(16); // One more than boat z-index (15)

      // Test for beach.png (same boat element)
      const aboveBoatBeach = calculateBlobbiZIndex(30, 'beach.png');
      expect(aboveBoatBeach).toBe(14);
    });

    it('should not go below minimum z-index of 1', () => {
      // This test ensures we never get a z-index below 1
      const minZIndex = calculateBlobbiZIndex(0, 'town-open.png');
      expect(minZIndex).toBeGreaterThanOrEqual(1);
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

      const beachElements = getInteractiveElementsForBackground('beach.png');
      expect(beachElements).toHaveLength(1);
      expect(beachElements[0].id).toBe('boat-beach');
    });

    it('should return empty array for unknown background', () => {
      const elements = getInteractiveElementsForBackground('unknown.png');
      expect(elements).toHaveLength(0);
    });
  });
});