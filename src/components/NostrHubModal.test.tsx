/**
 * The Nostr Hub, the Station's one interface, mounted over the REAL safety
 * and egress boundary.
 *
 * Pins the section model (four sections, one expanded at a time, an initial
 * section a chair can ask for, the others still reachable), what the
 * Connected Experiences section shows (Nostr Farm and its player-language
 * copy, one launch action, no fake cards, no iframe), and what a launch does:
 * an egress request confirmed in the shared dialog, opened once with opener
 * isolation, and nothing at all before the player continues or when they
 * cancel. Escape inside the confirmation closes the confirmation, not the
 * hub. The Family profile gets a plain explanation instead of a dead button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { ExternalEgressProvider } from '@/external-egress';
import { IslandSafetyProvider } from '@/safety';
import type { ExperienceProfile } from '@/safety/experience-profile';
import { NOSTR_FARM_EXPERIENCE, NOSTR_FARM_URL, clearLaunchHint } from '@/connected-experiences';
import {
  FIRST_LAUNCH_NOTE,
  LAUNCH_UNAVAILABLE_NOTE,
} from '@/components/blobbi/nostr-station/ConnectedExperiencesSection';

import { NostrHubModal, type NostrHubSectionId } from './NostrHubModal';

vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));

let openSpy: ReturnType<typeof vi.fn>;

function mount({
  profile = 'standard',
  initialSection = 'connected-experiences',
  onClose = vi.fn(),
}: { profile?: ExperienceProfile; initialSection?: NostrHubSectionId | null; onClose?: () => void } = {}) {
  const view = render(
    <IslandSafetyProvider profile={profile}>
      <ExternalEgressProvider>
        <NostrHubModal isOpen onClose={onClose} initialSection={initialSection} />
      </ExternalEgressProvider>
    </IslandSafetyProvider>,
  );
  return { view, onClose };
}

const hub = () => screen.getByTestId('nostr-hub');
const section = (id: NostrHubSectionId) => screen.getByTestId(`hub-section-${id}`);
const launchButton = () => screen.getByRole('button', { name: /Open Nostr Farm/ });
const confirmation = () => screen.queryByRole('dialog', { name: 'Leaving Blobbi Island' });

beforeEach(() => {
  openSpy = vi.fn();
  window.open = openSpy as unknown as typeof window.open;
  clearLaunchHint(NOSTR_FARM_EXPERIENCE.id);
});

afterEach(() => {
  vi.restoreAllMocks();
  clearLaunchHint(NOSTR_FARM_EXPERIENCE.id);
});

describe('one Station interface, four sections', () => {
  it('is the hub dialog, with every section present', () => {
    mount({ initialSection: null });
    expect(screen.getByRole('dialog', { name: /NOSTR HUB/ })).toBeInTheDocument();
    for (const id of ['educational', 'connected-experiences', 'social', 'futuristic'] as const) {
      expect(section(id)).toBeInTheDocument();
    }
    expect(screen.getByText('Connected Experiences')).toBeInTheDocument();
    expect(hub().dataset.hubSection).toBeUndefined();
    expect(screen.queryByTestId('connected-experiences')).toBeNull();
  });

  it('opens straight into the section a chair asks for', () => {
    mount({ initialSection: 'connected-experiences' });
    expect(hub().dataset.hubSection).toBe('connected-experiences');
    expect(section('connected-experiences').dataset.expanded).toBe('true');
    expect(screen.getByTestId('connected-experiences')).toBeInTheDocument();
  });

  it('collapses back to the overview and expands another section with the same mechanics', () => {
    mount();
    fireEvent.click(section('connected-experiences'));
    expect(hub().dataset.hubSection).toBeUndefined();
    expect(screen.queryByTestId('connected-experiences')).toBeNull();

    fireEvent.click(section('educational'));
    expect(hub().dataset.hubSection).toBe('educational');
    expect(section('educational').dataset.expanded).toBe('true');
    expect(screen.queryByTestId('connected-experiences')).toBeNull();
  });

  it('closes from the close button, the footer and Escape', () => {
    const close = vi.fn();
    mount({ onClose: close });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: /EXIT HUB/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(3);
  });

  it('renders nothing while closed', () => {
    render(<NostrHubModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('nostr-hub')).toBeNull();
  });
});

describe('the Connected Experiences section', () => {
  it('presents Nostr Farm with its player-facing copy and one launch action', () => {
    mount();
    const list = screen.getByTestId('connected-experiences');
    expect(within(list).getByText('Nostr Farm')).toBeInTheDocument();
    expect(within(list).getByText(NOSTR_FARM_EXPERIENCE.tagline)).toBeInTheDocument();
    expect(within(list).getByText(NOSTR_FARM_EXPERIENCE.description)).toBeInTheDocument();
    expect(screen.getByTestId('connected-experience-interop')).toHaveTextContent(
      NOSTR_FARM_EXPERIENCE.interoperability,
    );
    expect(screen.getByTestId('connected-experience-badge')).toHaveTextContent('Works with Blobbi Island');
    expect(launchButton()).toBeEnabled();
  });

  it('shows one real experience and a quiet note about the future, never fake cards', () => {
    mount();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByTestId('connected-experiences-more')).toHaveTextContent(/More experiences coming later/);
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(1);
  });

  it('renders no iframe and no anchor to the Farm: the launch is a request, not an embed', () => {
    const { view } = mount();
    expect(view.baseElement.querySelector('iframe')).toBeNull();
    expect(view.baseElement.querySelector('a[href*="farm"]')).toBeNull();
  });

  it('a click inside the Farm card does not collapse the section', () => {
    mount();
    fireEvent.click(screen.getByTestId('connected-experience-nostr-farm'));
    expect(hub().dataset.hubSection).toBe('connected-experiences');
  });
});

describe('launching Nostr Farm', () => {
  it('asks through the shared confirmation, naming the host and the Farm, and opens nothing yet', async () => {
    mount();
    fireEvent.click(launchButton());

    await screen.findByRole('dialog', { name: 'Leaving Blobbi Island' });
    expect(screen.getByTestId('egress-destination')).toHaveTextContent('farm.blobbi.pet');
    expect(screen.getByTestId('egress-label')).toHaveTextContent('Nostr Farm');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('cancelling keeps the player in the hub with nothing opened', async () => {
    const { onClose } = mount();
    fireEvent.click(launchButton());
    await screen.findByRole('dialog', { name: 'Leaving Blobbi Island' });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(confirmation()).toBeNull());
    expect(openSpy).not.toHaveBeenCalled();
    expect(hub().dataset.hubSection).toBe('connected-experiences');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByTestId('first-launch-note')).toBeNull();
  });

  it('Escape in the confirmation closes the confirmation, not the hub', async () => {
    const { onClose } = mount();
    fireEvent.click(launchButton());
    const dialog = await screen.findByRole('dialog', { name: 'Leaving Blobbi Island' });

    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(confirmation()).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('continuing opens the official Farm URL once, in a new tab, with opener isolation', async () => {
    mount();
    fireEvent.click(launchButton());
    await screen.findByRole('dialog', { name: 'Leaving Blobbi Island' });

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    const [url, target, features] = openSpy.mock.calls[0] as [string, string, string];
    expect(new URL(url).origin).toBe(new URL(NOSTR_FARM_URL).origin);
    expect(target).toBe('_blank');
    expect(features).toContain('noopener');
    expect(features).toContain('noreferrer');
    // The Island stays: the hub is still open on the section, the launch is reusable.
    await waitFor(() => expect(confirmation()).toBeNull());
    expect(hub().dataset.hubSection).toBe('connected-experiences');
    expect(launchButton()).toBeEnabled();
  });

  it('explains what happens next on the FIRST launch only', async () => {
    const first = mount();
    fireEvent.click(launchButton());
    await screen.findByRole('dialog', { name: 'Leaving Blobbi Island' });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByTestId('first-launch-note')).toHaveTextContent(FIRST_LAUNCH_NOTE);

    first.view.unmount();
    mount();
    fireEvent.click(launchButton());
    await screen.findByRole('dialog', { name: 'Leaving Blobbi Island' });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('first-launch-note')).toBeNull();
  });
});

describe('Family profile', () => {
  it('says plainly that opening other apps is off, and never reaches the browser', async () => {
    mount({ profile: 'family' });
    expect(screen.getByTestId('launch-unavailable')).toHaveTextContent(LAUNCH_UNAVAILABLE_NOTE);
    expect(launchButton()).toBeDisabled();
    fireEvent.click(launchButton());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(confirmation()).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });
});
