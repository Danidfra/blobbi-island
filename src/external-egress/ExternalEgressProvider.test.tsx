/**
 * The provider, the confirmation, and the guarantee that a denied class never
 * reaches the browser.
 *
 * These mount the real provider and assert on `window.open` / `navigator.share`
 * rather than on which buttons exist, hiding a control is presentation, and the
 * claim being made here is about enforcement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { IslandSafetyProvider, type ExperienceProfile } from '@/safety';

import { ExternalEgressProvider } from './ExternalEgressProvider';
import { EgressRouteGuard } from './EgressRouteGuard';
import { useExternalEgress } from './external-egress-context';
import type { EgressRequest } from './egress';

let openSpy: ReturnType<typeof vi.fn>;
let shareSpy: ReturnType<typeof vi.fn>;
let lastResult: boolean | null = null;

vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));

function Trigger({ request }: { request: EgressRequest }) {
  const { requestEgress } = useExternalEgress();
  return (
    <button
      type="button"
      onClick={async () => {
        lastResult = await requestEgress(request);
      }}
    >
      go
    </button>
  );
}

function mount(profile: ExperienceProfile, request: EgressRequest) {
  return render(
    <IslandSafetyProvider profile={profile}>
      <ExternalEgressProvider>
        <Trigger request={request} />
      </ExternalEgressProvider>
    </IslandSafetyProvider>,
  );
}

const LINK: EgressRequest = { class: 'external-link', url: 'https://soapbox.pub/mkstack' };
const SHARE: EgressRequest = {
  class: 'social-share',
  platform: 'telegram',
  payload: { url: 'https://island.example/', text: '#Blobbi' },
};
const NATIVE: EgressRequest = { class: 'native-share', data: { title: 'My Blobbi' } };

beforeEach(() => {
  lastResult = null;
  openSpy = vi.fn();
  shareSpy = vi.fn(async () => {});
  window.open = openSpy as unknown as typeof window.open;
  Object.defineProperty(navigator, 'share', { value: shareSpy, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Standard: confirmation before leaving', () => {
  it('does not open until the player continues', async () => {
    mount('standard', LINK);
    fireEvent.click(screen.getByRole('button', { name: 'go' }));

    await screen.findByRole('dialog', { name: 'Leaving Blobbi Island' });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('names the destination host, not the whole URL', async () => {
    mount('standard', SHARE);
    fireEvent.click(screen.getByRole('button', { name: 'go' }));

    await screen.findByRole('dialog');
    // The host is parsed from the URL that will actually be opened, so a wrong
    // label cannot mis-state where the player is going.
    expect(screen.getByTestId('egress-destination').textContent).toBe('t.me');
  });

  it('names the platform in the title of a social share', async () => {
    mount('standard', SHARE);
    fireEvent.click(screen.getByRole('button', { name: 'go' }));

    expect(await screen.findByRole('dialog', { name: 'Share with Telegram?' })).toBeInTheDocument();
  });

  it('opens exactly once on Continue', async () => {
    mount('standard', LINK);
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    expect(openSpy.mock.calls[0][0]).toBe('https://soapbox.pub/mkstack');
    await waitFor(() => expect(lastResult).toBe(true));
  });

  it('opens nothing on Cancel, and reports that nothing happened', async () => {
    mount('standard', LINK);
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(lastResult).toBe(false));
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('closes the dialog after answering', async () => {
    mount('standard', LINK);
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shares natively with no confirmation', async () => {
    // A dialog in front of the OS share sheet teaches players to dismiss both.
    mount('standard', NATIVE);
    fireEvent.click(screen.getByRole('button', { name: 'go' }));

    await waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Family: denied below the UI', () => {
  it.each([
    ['an external link', LINK],
    ['a social share', SHARE],
    ['a native share', NATIVE],
  ])('never reaches the browser for %s', async (_label, request) => {
    mount('family', request);
    fireEvent.click(screen.getByRole('button', { name: 'go' }));

    await waitFor(() => expect(lastResult).toBe(false));
    expect(openSpy).not.toHaveBeenCalled();
    expect(shareSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('a missing provider refuses rather than opening', () => {
  it('returns false with no provider mounted', async () => {
    render(<Trigger request={LINK} />);
    fireEvent.click(screen.getByRole('button', { name: 'go' }));

    await waitFor(() => expect(lastResult).toBe(false));
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe('route guard', () => {
  const guarded = (profile: ExperienceProfile) =>
    render(
      <IslandSafetyProvider profile={profile}>
        <EgressRouteGuard egressClass="authoring-tool" message="Not part of this experience.">
          <p>secret tools</p>
        </EgressRouteGuard>
      </IslandSafetyProvider>,
    );

  it('renders the route under Standard', () => {
    guarded('standard');
    expect(screen.getByText('secret tools')).toBeInTheDocument();
  });

  it('does not mount the route under Family', () => {
    // Not hidden: absent. The tools are unlinked rather than unreachable, so
    // the path can simply be typed.
    guarded('family');
    expect(screen.queryByText('secret tools')).toBeNull();
    expect(screen.getByText('Not available')).toBeInTheDocument();
  });

  it('says nothing about age, and nothing a curious visitor could use', () => {
    // A profile is an experience configuration, not an age assertion, and a
    // denied view is not a debugging surface.
    const { container } = guarded('family');
    const text = container.textContent?.toLowerCase() ?? '';
    expect(text).not.toMatch(/child|kid|age|young|parent/);
    expect(text).not.toMatch(/capability|policy|authoringtools|profile/);
  });
});
