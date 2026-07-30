import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  posAt,
  type PresenceContent,
  type MovementGoal,
  type PlayerRenderState,
} from '@/lib/multiplayer';

// Mock nowSec to control time during tests
const mockNowSec = vi.fn();
let mockTime = 1000000; // Fixed timestamp

vi.mock('@/lib/multiplayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/multiplayer')>();

  return {
    ...actual,
    nowSec: () => mockNowSec() || mockTime,
  };
});

describe('Multiplayer Smooth Movement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTime = 1000000;
    mockNowSec.mockImplementation(() => mockTime);
  });

  describe('posAt function', () => {
    it('should return starting position when elapsed time is 0', () => {
      const goal: MovementGoal = {
        from: { x: 10, y: 20 },
        to: { x: 50, y: 60 },
        v: 100, // 100 pixels per second
        ts: 1000000,
      };

      const position = posAt(goal, 1000000); // Same as start time
      expect(position).toEqual({ x: 10, y: 20 });
    });

    it('should return destination position when movement is complete', () => {
      const goal: MovementGoal = {
        from: { x: 10, y: 20 },
        to: { x: 50, y: 60 },
        v: 100, // 100 WORLD-DESIGN pixels per second
        ts: 1000000,
      };

      // Phase 2: distance is measured in world-design px (1046×697), matching
      // the px/s velocity unit (the legacy version divided percent by px/s).
      // dx = 40% of 1046 = 418.4px, dy = 40% of 697 = 278.8px → dist ≈ 502.7px
      // Duration ≈ 5.03s.
      const position = posAt(goal, 1000000 + 6); // past the duration
      expect(position).toEqual({ x: 50, y: 60 });
    });

    it('should interpolate position correctly during movement', () => {
      const goal: MovementGoal = {
        from: { x: 0, y: 0 },
        to: { x: 100, y: 100 },
        v: 100, // 100 world px per second
        ts: 1000000,
      };

      // Distance = hypot(1046, 697) ≈ 1256.9 world px → duration ≈ 12.569s.
      // At 6.2845s, progress = 0.5.
      const position = posAt(goal, 1000000 + 6.2845);
      expect(position.x).toBeCloseTo(50, 1);
      expect(position.y).toBeCloseTo(50, 1);
    });
  });

  describe('PlayerRenderState with smooth movement', () => {
    it('should store lastContent for interpolation', () => {
      const content: PresenceContent = {
        state: 'moving',
        location: 'town',
        anchor: { x: 10, y: 20, ts: 1000000 },
        goal: {
          from: { x: 10, y: 20 },
          to: { x: 50, y: 60 },
          v: 100,
          ts: 1000000,
        },
      };

      const playerState: PlayerRenderState = {
        pubkey: 'testpubkey',
        sessionId: 'testsession',
        blobbiAddr: '31124:testpubkey:testd',
        position: { x: 10, y: 20 },
        isMoving: true,
        lastSeen: 1000000,
        lastContent: content,
        animState: {
          pos: { x: 10, y: 20 },
          target: { x: 50, y: 60 },
          speedPx: 220,
          lastUpdate: performance.now(),
          moving: true,
        },
      };

      expect(playerState.lastContent).toEqual(content);
      expect(playerState.isMoving).toBe(true);
    });

    it('should handle idle state without goal', () => {
      const content: PresenceContent = {
        state: 'idle',
        location: 'town',
        anchor: { x: 30, y: 40, ts: 1000000 },
      };

      const playerState: PlayerRenderState = {
        pubkey: 'testpubkey',
        sessionId: 'testsession',
        blobbiAddr: '31124:testpubkey:testd',
        position: { x: 30, y: 40 },
        isMoving: false,
        lastSeen: 1000000,
        lastContent: content,
        animState: {
          pos: { x: 30, y: 40 },
          target: { x: 30, y: 40 },
          speedPx: 220,
          lastUpdate: performance.now(),
          moving: false,
        },
      };

      expect(playerState.lastContent).toEqual(content);
      expect(playerState.isMoving).toBe(false);
      expect(playerState.position).toEqual({ x: 30, y: 40 });
    });
  });
});