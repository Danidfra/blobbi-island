/**
 * Nothing happens before a profile is resolved.
 *
 * The whole safety architecture is capability checks at data boundaries, and
 * every one of those boundaries reads a policy. If the island can mount before
 * a profile has been chosen, each of them answers once under whatever policy
 * happened to be in scope — and some of those answers are events on a relay,
 * an upload that has begun, or a stranger's text already on screen. None of
 * them can be taken back.
 *
 * Today resolution is synchronous and this never holds anything up. These
 * tests exist for the day a guardian's choice has to be read first.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useState, type ReactNode } from 'react';

import {
  ACTIVE_EXPERIENCE_PROFILE,
  IslandSafetyProvider,
  SafetyGate,
  SafetyResolutionContext,
  STANDARD_POLICY,
  missingSafetyProviderCount,
  resetMissingSafetyProviderCount,
  useIslandSafetyPolicy,
  useSafetyResolution,
  type SafetyResolution,
} from './index';

/** A component that does what an island capability consumer does. */
function CapabilityConsumer({ onPolicy }: { onPolicy?: (chat: boolean) => void }) {
  const policy = useIslandSafetyPolicy();
  onPolicy?.(policy.freeTextChat);
  return <span data-testid="chat">{String(policy.freeTextChat)}</span>;
}

function ResolutionProbe() {
  const resolution = useSafetyResolution();
  return <span data-testid="status">{resolution.status}</span>;
}

/**
 * Something that publishes the moment it mounts — presence, a chat
 * subscription, an uploader, a photo share. Which one does not matter; that it
 * cannot mount unresolved does.
 */
function NetworkSideEffect({ onMount }: { onMount: () => void }) {
  useState(() => {
    onMount();
    return null;
  });
  return <span data-testid="world">world</span>;
}

/** A provider that holds `resolving` until it is told to resolve. */
function DeferredSafetyProvider({ children }: { children: ReactNode }) {
  const [resolution, setResolution] = useState<SafetyResolution>({ status: 'resolving' });
  resolveLater = () =>
    setResolution({ status: 'resolved', profile: 'standard', policy: STANDARD_POLICY });
  return (
    <SafetyResolutionContext.Provider value={resolution}>
      {children}
    </SafetyResolutionContext.Provider>
  );
}

let resolveLater: () => void = () => {};

beforeEach(() => {
  resetMissingSafetyProviderCount();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the shipped path resolves a profile explicitly', () => {
  it('says resolved, not "nobody answered"', () => {
    render(
      <IslandSafetyProvider>
        <ResolutionProbe />
      </IslandSafetyProvider>,
    );
    expect(screen.getByTestId('status')).toHaveTextContent('resolved');
  });

  it('resolves to Standard, which is still the product', () => {
    expect(ACTIVE_EXPERIENCE_PROFILE).toBe('standard');

    render(
      <IslandSafetyProvider>
        <CapabilityConsumer />
      </IslandSafetyProvider>,
    );
    // Standard's answer, arrived at deliberately rather than by default.
    expect(screen.getByTestId('chat')).toHaveTextContent('true');
  });

  it('mounts the world on the FIRST render, with no resolving frame', () => {
    const onMount = vi.fn();
    render(
      <IslandSafetyProvider>
        <SafetyGate fallback={<span data-testid="holding">holding</span>}>
          <NetworkSideEffect onMount={onMount} />
        </SafetyGate>
      </IslandSafetyProvider>,
    );

    expect(screen.getByTestId('world')).toBeInTheDocument();
    expect(screen.queryByTestId('holding')).toBeNull();
    expect(onMount).toHaveBeenCalledTimes(1);
  });
});

describe('while a profile is being resolved', () => {
  it('does not mount the world', () => {
    render(
      <DeferredSafetyProvider>
        <SafetyGate fallback={<span data-testid="holding">holding</span>}>
          <NetworkSideEffect onMount={vi.fn()} />
        </SafetyGate>
      </DeferredSafetyProvider>,
    );

    expect(screen.queryByTestId('world')).toBeNull();
    expect(screen.getByTestId('holding')).toBeInTheDocument();
  });

  it('runs no capability-gated side effect at all', () => {
    // The list of what this stands for is long — presence publication, the chat
    // subscription, the Blossom uploader, a kind 1 share, a theater session,
    // the adoption writer. Every one of them mounts inside the island, so the
    // proof is that the island does not mount.
    const onMount = vi.fn();
    render(
      <DeferredSafetyProvider>
        <SafetyGate>
          <NetworkSideEffect onMount={onMount} />
        </SafetyGate>
      </DeferredSafetyProvider>,
    );

    expect(onMount).not.toHaveBeenCalled();
  });

  it('mounts it once the profile arrives, and only then', () => {
    const onMount = vi.fn();
    render(
      <DeferredSafetyProvider>
        <SafetyGate>
          <NetworkSideEffect onMount={onMount} />
        </SafetyGate>
      </DeferredSafetyProvider>,
    );
    expect(onMount).not.toHaveBeenCalled();

    act(() => resolveLater());

    expect(onMount).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('world')).toBeInTheDocument();
  });
});

describe('a missing provider is a bug, not a profile', () => {
  it('refuses to mount the world', () => {
    // `unprovided` is a distinct state from `resolving` precisely so it can be
    // refused rather than waited for.
    const onMount = vi.fn();
    render(
      <SafetyGate fallback={<span data-testid="holding">holding</span>}>
        <NetworkSideEffect onMount={onMount} />
      </SafetyGate>,
    );

    expect(screen.queryByTestId('world')).toBeNull();
    expect(onMount).not.toHaveBeenCalled();
  });

  it('is detected and reported when a component asks for a policy', () => {
    render(<CapabilityConsumer />);

    expect(missingSafetyProviderCount()).toBeGreaterThan(0);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('no IslandSafetyProvider'),
    );
  });

  it('is not reported when a provider IS present', () => {
    render(
      <IslandSafetyProvider>
        <CapabilityConsumer />
      </IslandSafetyProvider>,
    );
    expect(missingSafetyProviderCount()).toBe(0);
  });

  it('still answers, because hundreds of unit tests render one component', () => {
    // The fallback is tolerated, loudly. What makes it survivable is the two
    // tests above: it is reported, and it cannot mount a world.
    render(<CapabilityConsumer />);
    expect(screen.getByTestId('chat')).toHaveTextContent('true');
  });
});

describe('the gate follows the resolution, never a profile name', () => {
  it('mounts under a curated profile exactly as it does under Standard', () => {
    const onMount = vi.fn();
    render(
      <IslandSafetyProvider profile="family">
        <SafetyGate>
          <NetworkSideEffect onMount={onMount} />
          <CapabilityConsumer />
        </SafetyGate>
      </IslandSafetyProvider>,
    );

    expect(onMount).toHaveBeenCalledTimes(1);
    // …and the world it mounts already knows what it may do.
    expect(screen.getByTestId('chat')).toHaveTextContent('false');
  });
});
