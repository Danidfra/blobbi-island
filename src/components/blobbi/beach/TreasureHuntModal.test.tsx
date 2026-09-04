/**
 * Treasure Hunt controller, screen flow, pause and interruption, the
 * exit-confirmation rule, and the audio engine's lifecycle (built on Start,
 * silenced by close: no beep may outlive the shell).
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { TreasureHuntModalView } from './TreasureHuntModalView';
import type { TreasureHuntRewardsService } from '@/hooks/useTreasureHuntRewards';
import { BEACH_REWARD_POLICY } from '@/beach/rewards/policy';
import { calculateTreasureHuntReward, rewardEligibility } from '@/beach/rewards/coin-reward';
import { TREASURE_HUNT_UI_POLICY, SAND_RECT, PLAYFIELD_IMAGE_ASPECT } from './treasure-hunt-config';
import { fieldPointToImagePercent, fitFieldLayout, type FieldMapping } from './field-transform';
import type { DetectorAudioEngine } from './detector-audio';
import {
  createTreasureHuntRound,
  treasureHuntReducer,
  type Point,
  type TreasureHuntPolicy,
  type TreasureHuntRound,
} from '@/beach/treasure-hunt';

const WIDTH = 800;
const HEIGHT = 500;
const RECT = {
  width: WIDTH,
  height: HEIGHT,
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: WIDTH,
  bottom: HEIGHT,
  toJSON: () => ({}),
} as DOMRect;

/** jsdom-safe PointerEvent that keeps coordinates and pointer fields. */
class TestPointerEvent extends MouseEvent {
  public pointerId: number | undefined;
  public pointerType: string;
  constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
    super(type, init);
    this.pointerId = init.pointerId;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

beforeAll(() => {
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  Object.assign(HTMLElement.prototype, {
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => true,
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(RECT);
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeEngine(): DetectorAudioEngine & {
  update: ReturnType<typeof vi.fn>;
  dig: ReturnType<typeof vi.fn>;
  finish: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  return {
    update: vi.fn(),
    dig: vi.fn(),
    finish: vi.fn(),
    setMuted: vi.fn(),
    muted: false,
    dispose: vi.fn(),
  };
}

type MockGrant = 'applied' | 'ambiguous' | 'failed';

/** A deterministic in-memory reward service for the view layer. */
function makeRewardsService(options?: {
  remaining?: number;
  windowStatus?: null;
  grant?: MockGrant;
}): TreasureHuntRewardsService & {
  reserved: string[];
  abandoned: { opId: string; digs: number; activeSeconds: number }[];
  authorized: string[];
} {
  const reserved: string[] = [];
  const abandoned: { opId: string; digs: number; activeSeconds: number }[] = [];
  const authorized: string[] = [];
  const remaining = options?.remaining ?? 10;
  const grant = options?.grant ?? 'applied';
  return {
    reserved,
    abandoned,
    authorized,
    windowStatus:
      options?.windowStatus === null
        ? null
        : { limit: 10, remaining, windowKey: 'w', resetsAt: 0 },
    policy: BEACH_REWARD_POLICY,
    async reserveRewardedHunt() {
      if (remaining <= 0) return { ok: false, reason: 'limit-reached' as const };
      const opId = `mock-op-${reserved.length}`;
      reserved.push(opId);
      return { ok: true, opId };
    },
    reportParticipation() {},
    async authorizeReward(result, opId) {
      authorized.push(opId);
      // Flow tests cannot wait 20 real seconds under a rAF clock; the
      // participation rule itself is pinned by the pure coin-reward tests.
      const flowPolicy = { ...BEACH_REWARD_POLICY, minActiveSeconds: 0 };
      const eligibility = rewardEligibility(result, flowPolicy);
      if (!eligibility.eligible) return { status: 'ineligible', reason: eligibility.reason };
      const reward = calculateTreasureHuntReward(result, flowPolicy)!;
      if (grant === 'ambiguous') return { status: 'ambiguous', reward };
      if (grant === 'failed') return { status: 'failed', reward, message: 'simulated' };
      return { status: 'applied', reward, alreadyApplied: false };
    },
    abandonHunt(opId, participation) {
      abandoned.push({ opId, ...participation });
    },
    pendingOps: [],
    refreshPending() {},
    async recoverPendingReward() {
      return 'applied' as const;
    },
  };
}

function renderModal(options?: {
  policy?: TreasureHuntPolicy;
  onClose?: () => void;
  onActorSuppressionChange?: (suppressed: boolean) => void;
  rewards?: TreasureHuntRewardsService;
}) {
  const engines: ReturnType<typeof makeEngine>[] = [];
  const audioFactory = vi.fn(() => {
    const engine = makeEngine();
    engines.push(engine);
    return engine;
  });
  const onClose = options?.onClose ?? vi.fn();
  const rewards =
    options?.rewards ?? makeRewardsService({ windowStatus: null });
  const view = render(
    <TreasureHuntModalView
      open
      onClose={onClose}
      onActorSuppressionChange={options?.onActorSuppressionChange}
      rewards={rewards}
      dev={{
        seed: 'modal-test',
        policy: options?.policy ?? TREASURE_HUNT_UI_POLICY,
        audioFactory,
        forceReducedMotion: true,
      }}
    />
  );
  return { view, audioFactory, engines, onClose, rewards };
}

async function startHunt(label: string | RegExp = 'Start Practice Hunt') {
  fireEvent.click(screen.getByRole('button', { name: label }));
  // Reservation (if any) resolves on a microtask; the game mounts after it.
  await waitFor(() =>
    expect(document.querySelector('[data-treasure-game]')).not.toBeNull(),
  );
}

/** The same round the modal builds, for computing dig coordinates. */
function referenceRound(policy: TreasureHuntPolicy): TreasureHuntRound {
  const created = createTreasureHuntRound({ seed: 'modal-test', policy });
  if (!created.ok) throw new Error('reference round failed');
  return treasureHuntReducer(created.round, { type: 'start' });
}

function pxFor(point: Point, policy: TreasureHuntPolicy): { clientX: number; clientY: number } {
  const mapping: FieldMapping = {
    layout: fitFieldLayout(WIDTH, HEIGHT, PLAYFIELD_IMAGE_ASPECT),
    sandRect: SAND_RECT,
    fieldWidth: policy.fieldWidth,
    fieldHeight: policy.fieldHeight,
  };
  const percent = fieldPointToImagePercent(point, mapping);
  return {
    clientX: mapping.layout.imageLeft + (percent.leftPercent / 100) * mapping.layout.imageWidth,
    clientY: mapping.layout.imageTop + (percent.topPercent / 100) * mapping.layout.imageHeight,
  };
}

function fieldEl(): HTMLElement {
  const element = document.querySelector('[data-treasure-field]');
  if (!(element instanceof HTMLElement)) throw new Error('field not mounted');
  return element;
}

describe('screen flow', async () => {
  it('opens on the intro without touching audio', async () => {
    const { audioFactory } = renderModal();
    expect(screen.getByText('Beach Treasure Hunt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Practice Hunt' })).toBeInTheDocument();
    expect(audioFactory).not.toHaveBeenCalled();
  });

  it('Start Hunt builds the audio engine inside the click and mounts the game', async () => {
    const { audioFactory } = renderModal();
    await startHunt();
    expect(audioFactory).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-treasure-game]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /metal detector/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('closing from the intro needs no confirmation', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByRole('button', { name: /Close Beach Treasure Hunt/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Leave the hunt?')).not.toBeInTheDocument();
  });
});

describe('pause and interruption', async () => {
  it('pauses and resumes through the shell controls', async () => {
    renderModal();
    await startHunt();
    fireEvent.click(screen.getByRole('button', { name: /Pause Beach Treasure Hunt/ }));
    expect(document.querySelector('[data-treasure-paused]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Resume Beach Treasure Hunt/ }));
    expect(document.querySelector('[data-treasure-paused]')).toBeNull();
  });

  it('window blur pauses a live round and never auto-resumes', async () => {
    renderModal();
    await startHunt();
    fireEvent.blur(window);
    expect(document.querySelector('[data-treasure-paused]')).not.toBeNull();
    fireEvent.focus(window);
    expect(document.querySelector('[data-treasure-paused]')).not.toBeNull();
  });
});

describe('exit rule', async () => {
  it('mid-round close asks first; Keep Digging resumes', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await startHunt();

    fireEvent.click(screen.getByRole('button', { name: /Leave Beach Treasure Hunt/ }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Leave the hunt?')).toBeInTheDocument();
    expect(screen.getByText('The current hunt will be abandoned.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep Digging' }));
    expect(screen.queryByText('Leave the hunt?')).not.toBeInTheDocument();
    expect(document.querySelector('[data-treasure-paused]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('confirming the exit closes, discards the round and silences the engine', async () => {
    const onClose = vi.fn();
    const { engines } = renderModal({ onClose });
    await startHunt();

    fireEvent.click(screen.getByRole('button', { name: /Leave Beach Treasure Hunt/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave Hunt' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(engines[0].dispose).toHaveBeenCalled();
  });

  it('Escape follows the same confirmation path', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await startHunt();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.getByText('Leave the hunt?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('unmounting disposes the engine; no beep outlives the shell', async () => {
    const { view, engines } = renderModal();
    await startHunt();
    view.unmount();
    expect(engines[0].dispose).toHaveBeenCalled();
  });
});

describe('finish and results', async () => {
  const onePolicy: TreasureHuntPolicy = { ...TREASURE_HUNT_UI_POLICY, shovelUses: 1 };

  it('a shovel-depleting miss ends the round and shows the findings summary', async () => {
    const { engines } = renderModal({ policy: onePolicy });
    await startHunt();

    const reference = referenceRound(onePolicy);
    const miss = findMissPoint(reference);

    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    fireEvent.pointerDown(fieldEl(), { pointerId: 4, ...pxFor(miss, onePolicy) });

    expect(engines[0].dig).toHaveBeenCalledWith(false);
    expect(engines[0].finish).toHaveBeenCalledWith(0);
    expect(screen.getByText('Findings Summary')).toBeInTheDocument();
    expect(screen.getByText(/No treasures this time/)).toBeInTheDocument();
    // Practice framing: says plainly that nothing durable was granted, and
    // never claims an inventory grant.
    expect(
      screen.getByText('Practice round: no Coins were awarded.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/inventory/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/added to/i)).not.toBeInTheDocument();
  });

  it('a dig on a target reveals it, updates the finds count and records a hit', async () => {
    const { engines } = renderModal();
    await startHunt();

    const reference = referenceRound(TREASURE_HUNT_UI_POLICY);
    const target = reference.targets[0];

    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    fireEvent.pointerDown(fieldEl(), {
      pointerId: 4,
      ...pxFor(target.position, TREASURE_HUNT_UI_POLICY),
    });

    expect(engines[0].dig).toHaveBeenCalledWith(true);
    expect(document.querySelector('[data-dig-marker="hit"]')).not.toBeNull();
    expect(document.querySelector('[data-find-marker]')).not.toBeNull();
  });

  it('Practice Again starts a completely fresh simulation with a new engine', async () => {
    const { audioFactory, engines } = renderModal({ policy: onePolicy });
    await startHunt();
    const reference = referenceRound(onePolicy);
    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    fireEvent.pointerDown(fieldEl(), { pointerId: 4, ...pxFor(findMissPoint(reference), onePolicy) });
    expect(screen.getByText('Findings Summary')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Practice Again' }));
    expect(audioFactory).toHaveBeenCalledTimes(2);
    expect(engines[0].dispose).toHaveBeenCalled();
    expect(document.querySelector('[data-treasure-game]')).not.toBeNull();
  });

  it('Return to Beach closes without confirmation after results', async () => {
    const onClose = vi.fn();
    renderModal({ policy: onePolicy, onClose });
    await startHunt();
    const reference = referenceRound(onePolicy);
    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    fireEvent.pointerDown(fieldEl(), { pointerId: 4, ...pxFor(findMissPoint(reference), onePolicy) });

    fireEvent.click(screen.getByRole('button', { name: 'Return to Beach' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Leave the hunt?')).not.toBeInTheDocument();
  });
});

describe('tool switching, audio and actor suppression', async () => {
  const frames = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });

  it('detector audio only operates while the detector is the active tool', async () => {
    const { engines } = renderModal();
    await startHunt();
    const engine = engines[0];

    await frames();
    expect(engine.update).toHaveBeenCalled(); // active detector reports

    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    engine.update.mockClear();
    await frames();
    await frames();
    expect(engine.update).not.toHaveBeenCalled(); // docked detector is silent

    fireEvent.click(screen.getByRole('button', { name: /metal detector/i }));
    await frames();
    await frames();
    expect(engine.update).toHaveBeenCalled(); // resumes from the live signal
    expect(engines).toHaveLength(1); // same engine; nothing duplicated
  });

  it('selecting the shovel docks and deactivates the detector; reselecting restores it', async () => {
    renderModal();
    await startHunt();

    const detector = document.querySelector('[data-treasure-detector]') as HTMLElement;
    const activeLeft = detector.style.left;
    expect(detector.dataset.docked).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    expect(detector.dataset.docked).toBe('true');
    expect(detector.dataset.signalLevel).toBe('none'); // display deactivated
    expect(detector.style.left).not.toBe(activeLeft);

    fireEvent.click(screen.getByRole('button', { name: /metal detector/i }));
    expect(detector.dataset.docked).toBeUndefined();
    // The logical coil position was never overwritten by dock coordinates.
    expect(detector.style.left).toBe(activeLeft);
  });

  it('suppresses the actor for playing and results, restoring it on close and unmount', async () => {
    const onSuppress = vi.fn();
    const onClose = vi.fn();
    const onePolicy: TreasureHuntPolicy = { ...TREASURE_HUNT_UI_POLICY, shovelUses: 1 };
    const { view } = renderModal({
      policy: onePolicy,
      onClose,
      onActorSuppressionChange: onSuppress,
    });

    expect(onSuppress).not.toHaveBeenCalledWith(true); // intro keeps the actor

    await startHunt();
    expect(onSuppress).toHaveBeenLastCalledWith(true);

    // Finish the round: still covered by the shell → still suppressed.
    const reference = referenceRound(onePolicy);
    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    fireEvent.pointerDown(fieldEl(), { pointerId: 4, ...pxFor(findMissPoint(reference), onePolicy) });
    expect(screen.getByText('Findings Summary')).toBeInTheDocument();
    expect(onSuppress).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: 'Return to Beach' }));
    expect(onSuppress).toHaveBeenLastCalledWith(false);

    onSuppress.mockClear();
    view.unmount();
    expect(onSuppress).toHaveBeenCalledWith(false);
  });
});

describe('rewarded hunts', () => {
  const onePolicy: TreasureHuntPolicy = { ...TREASURE_HUNT_UI_POLICY, shovelUses: 1 };

  it('rewarded intro shows the remaining count and Start Hunt reserves a slot', async () => {
    const rewards = makeRewardsService({ remaining: 7 });
    renderModal({ rewards });

    expect(document.querySelector('[data-treasure-intro-mode="rewarded"]')).not.toBeNull();
    expect(screen.getByText(/Rewarded hunts remaining today/)).toHaveTextContent('7');

    await startHunt('Start Hunt');
    expect(rewards.reserved).toHaveLength(1);
    expect(document.querySelector('[data-treasure-rewarded-chip]')).not.toBeNull();
  });

  it('at the limit the intro switches to practice and reserves nothing', async () => {
    const rewards = makeRewardsService({ remaining: 0 });
    renderModal({ rewards });

    expect(document.querySelector('[data-treasure-intro-mode="practice-limit"]')).not.toBeNull();
    expect(screen.getByText(/completed today’s rewarded hunts/)).toBeInTheDocument();

    await startHunt('Start Practice Hunt');
    expect(rewards.reserved).toHaveLength(0);
    expect(document.querySelector('[data-treasure-rewarded-chip]')).toBeNull();
  });

  it('a finished rewarded hunt authorizes once and shows the applied breakdown', async () => {
    const rewards = makeRewardsService({ remaining: 5, grant: 'applied' });
    renderModal({ rewards, policy: onePolicy });
    await startHunt('Start Hunt');

    // Play out: pass the 20 s participation floor, then burn the only dig.
    const reference = referenceRound(onePolicy);
    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    fireEvent.pointerDown(fieldEl(), {
      pointerId: 4,
      ...pxFor(reference.targets[0].position, onePolicy),
    });

    await waitFor(() =>
      expect(
        document.querySelector('[data-treasure-reward-status="applied"]'),
      ).not.toBeNull(),
    );
    expect(rewards.authorized).toHaveLength(1);
    expect(rewards.authorized[0]).toBe(rewards.reserved[0]);
    expect(screen.getByText(/Blobbi Coins added/)).toBeInTheDocument();
    expect(screen.getByText('Base reward')).toBeInTheDocument();
  });

  it('an ambiguous grant never claims Coins were added and blocks replay', async () => {
    const rewards = makeRewardsService({ remaining: 5, grant: 'ambiguous' });
    renderModal({ rewards, policy: onePolicy });
    await startHunt('Start Hunt');

    const reference = referenceRound(onePolicy);
    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    fireEvent.pointerDown(fieldEl(), {
      pointerId: 4,
      ...pxFor(reference.targets[0].position, onePolicy),
    });

    await waitFor(() =>
      expect(
        document.querySelector('[data-treasure-reward-status="ambiguous"]'),
      ).not.toBeNull(),
    );
    expect(screen.queryByText(/Blobbi Coins added/)).not.toBeInTheDocument();
    expect(screen.getByText(/will not be lost or doubled/)).toBeInTheDocument();
    // Replay is withheld while the outcome is unsettled.
    expect(screen.queryByRole('button', { name: /Hunt Again|Practice Again/ })).toBeNull();
  });

  it('a provably-failed grant offers a retry', async () => {
    const rewards = makeRewardsService({ remaining: 5, grant: 'failed' });
    renderModal({ rewards, policy: onePolicy });
    await startHunt('Start Hunt');

    const reference = referenceRound(onePolicy);
    fireEvent.click(screen.getByRole('button', { name: /shovel/i }));
    fireEvent.pointerDown(fieldEl(), {
      pointerId: 4,
      ...pxFor(reference.targets[0].position, onePolicy),
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));
    await waitFor(() => expect(rewards.authorized).toHaveLength(2));
  });

  it('leaving mid-hunt reports the abandonment with its participation', async () => {
    const rewards = makeRewardsService({ remaining: 5 });
    renderModal({ rewards });
    await startHunt('Start Hunt');

    fireEvent.click(screen.getByRole('button', { name: /Leave Beach Treasure Hunt/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave Hunt' }));

    expect(rewards.abandoned).toHaveLength(1);
    expect(rewards.abandoned[0].opId).toBe(rewards.reserved[0]);
    // No result was finalized, so nothing was authorized.
    expect(rewards.authorized).toHaveLength(0);
  });

  it('a pending operation from an earlier session surfaces on the intro', async () => {
    const rewards = makeRewardsService({ remaining: 5 });
    const pending = {
      opId: 'old-op',
      roundKey: 'r',
      windowKey: 'w',
      status: 'finalized' as const,
      amount: 9,
      digs: 3,
      activeSeconds: 40,
      createdAt: 0,
      updatedAt: 0,
    };
    renderModal({
      rewards: { ...rewards, pendingOps: [pending] },
    });
    expect(document.querySelector('[data-treasure-pending-recovery]')).not.toBeNull();
    expect(screen.getByText(/9 Coins ready to finish/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish reward' })).toBeInTheDocument();
  });
});

/** A dig point clear of every unresolved target's dig radius. */
function findMissPoint(round: TreasureHuntRound): Point {
  for (let x = 0.05; x < round.policy.fieldWidth; x += 0.02) {
    for (let y = 0.05; y < round.policy.fieldHeight; y += 0.02) {
      const candidate = { x, y };
      const clear = round.targets.every((target) => {
        const dx = candidate.x - target.position.x;
        const dy = candidate.y - target.position.y;
        return target.found || Math.hypot(dx, dy) > target.digRadius;
      });
      if (clear) return candidate;
    }
  }
  throw new Error('no miss point on this field');
}
