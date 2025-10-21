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
        v: 100, // 100 pixels per second
        ts: 1000000,
      };

      // Distance = sqrt((50-10)^2 + (60-20)^2) = sqrt(1600 + 1600) = sqrt(3200) ≈ 56.57
      // Duration = 56.57 / 100 ≈ 0.5657 seconds
      const position = posAt(goal, 1000000 + 1); // 1 second later (more than duration)
      expect(position).toEqual({ x: 50, y: 60 });
    });

    it('should interpolate position correctly during movement', () => {
      const goal: MovementGoal = {
        from: { x: 0, y: 0 },
        to: { x: 100, y: 100 },
        v: 100, // 100 pixels per second
        ts: 1000000,
      };

      // Distance = sqrt(100^2 + 100^2) = sqrt(20000) ≈ 141.42
      // Duration = 141.42 / 100 ≈ 1.4142 seconds
      // At 0.5 seconds, progress = 0.5 / 1.4142 ≈ 0.3536
      const position = posAt(goal, 1000000 + 0.5);
      expect(position.x).toBeCloseTo(35.36, 1);
      expect(position.y).toBeCloseTo(35.36, 1);
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
      };

      expect(playerState.lastContent).toEqual(content);
      expect(playerState.isMoving).toBe(false);
      expect(playerState.position).toEqual({ x: 30, y: 40 });
    });
  });
});