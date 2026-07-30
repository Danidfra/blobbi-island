/**
 * The Item Studio as a whole: loading a published event, the `d` lock, the
 * read-only path for another issuer's item, and the fact that publishing takes
 * two deliberate actions.
 *
 * The publish mutation is mocked, so nothing here can sign or reach a relay.
 * What is NOT mocked is the form: `useItemStudio`, the conversion layer and the
 * package builder all run for real, because the behavior under test is exactly
 * how those react to a loaded event.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { KIND_GAME_ITEM_DEFINITION } from '@/inventory/package';

const SIGNER = 'b'.repeat(64);
const STRANGER = 'c'.repeat(64);

const publishMutateAsync = vi.fn();
const loadMutateAsync = vi.fn();

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: SIGNER, signer: {} } }),
}));

vi.mock('@/tools/game-items/usePublishItemDefinition', () => ({
  usePublishItemDefinition: () => ({
    mutateAsync: publishMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/tools/game-items/useItemDefinitions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/tools/game-items/useItemDefinitions')>();
  return {
    ...actual,
    useToolRelayUrls: () => ['wss://relay.one'],
    useLoadItemDefinition: () => ({ mutateAsync: loadMutateAsync, isPending: false }),
  };
});

const { ItemStudio } = await import('./ItemStudio');
const { useItemStudio } = await import('@/tools/game-items/useItemStudio');
const { describeSigner } = await import('@/tools/game-items/signer-identity');

function definitionEvent(pubkey: string, extraTags: string[][] = []): NostrEvent {
  return {
    id: 'e'.repeat(64),
    pubkey,
    created_at: 1_700_000_000,
    kind: KIND_GAME_ITEM_DEFINITION,
    tags: [
      ['d', 'blobbi:accessory:hat'],
      ['name', 'Party Hat'],
      ['type', 'cosmetic'],
      ['image', 'https://fixtures.invalid/hat.png'],
      ...extraTags,
    ],
    content: '',
    sig: 'f'.repeat(128),
  };
}

/** Renders the studio and exposes its API to the test. */
function Harness({
  signerPubkey,
  onReady,
}: {
  signerPubkey: string | undefined;
  onReady: (api: ReturnType<typeof useItemStudio>) => void;
}) {
  const studio = useItemStudio(signerPubkey);
  onReady(studio);
  return (
    <ItemStudio
      studio={studio}
      identity={describeSigner(signerPubkey)}
      relayUrls={['wss://relay.one']}
    />
  );
}

/**
 * Takes the signer explicitly with NO default: a default parameter would swallow
 * an intentional `undefined` and silently render the signed-IN studio for the
 * signed-out test.
 */
function renderStudio(signerPubkey: string | undefined) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let api!: ReturnType<typeof useItemStudio>;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const rendered = render(
    <Harness signerPubkey={signerPubkey} onReady={(value) => (api = value)} />,
    { wrapper },
  );
  return { ...rendered, getApi: () => api };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  publishMutateAsync.mockResolvedValue({
    event: definitionEvent(SIGNER),
    record: null,
    outcomes: [{ relay: 'wss://relay.one', ok: true }],
    acceptedRelays: ['wss://relay.one'],
    rejectedRelays: [],
    reachedAnyRelay: true,
  });
});

describe('publish gating', () => {
  it('disables review while required fields are missing', () => {
    renderStudio(SIGNER);
    expect(screen.getByRole('button', { name: /Review publication/ })).toBeDisabled();
    // The count appears both in the publish bar and in the validation panel.
    expect(screen.getAllByText(/blocking error/i).length).toBeGreaterThan(0);
  });

  it('disables review entirely when signed out', () => {
    renderStudio(undefined);
    expect(screen.getByRole('button', { name: /Review publication/ })).toBeDisabled();
    expect(screen.getByText(/Sign in to publish/i)).toBeInTheDocument();
  });

  it('enables review once the event can be built', async () => {
    const { getApi } = renderStudio(SIGNER);
    getApi().loadEvent(definitionEvent(SIGNER));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Review publication/ })).toBeEnabled();
    });
  });

  it('opening the review dialog signs nothing', async () => {
    const { getApi } = renderStudio(SIGNER);
    getApi().loadEvent(definitionEvent(SIGNER));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Review publication/ })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Review publication/ }));

    // The dialog is open (its own action button exists) and nothing was signed.
    expect(
      await screen.findByRole('button', { name: /Sign and publish/ }),
    ).toBeInTheDocument();
    expect(publishMutateAsync).not.toHaveBeenCalled();
  });

  it('publishes only when the explicit action is pressed', async () => {
    const { getApi } = renderStudio(SIGNER);
    getApi().loadEvent(definitionEvent(SIGNER));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Review publication/ })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Review publication/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Sign and publish/ }));

    await waitFor(() => expect(publishMutateAsync).toHaveBeenCalledTimes(1));
  });

  it('states whether publishing replaces an address or creates one', async () => {
    const { getApi } = renderStudio(SIGNER);
    getApi().loadEvent(definitionEvent(SIGNER));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Review publication/ })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Review publication/ }));

    expect(await screen.findByText(/Replaces the existing item/i)).toBeInTheDocument();
  });
});

describe('editing a published item', () => {
  it('locks the d tag and explains why', async () => {
    const { getApi } = renderStudio(SIGNER);
    getApi().loadEvent(definitionEvent(SIGNER));

    await waitFor(() => {
      expect(screen.getByLabelText(/d — item identifier/)).toBeDisabled();
    });
    expect(screen.getByText(/Publishing replaces this address/i)).toBeInTheDocument();
  });

  it('unlocks d only through the explicit "create as a new item" action', async () => {
    const { getApi } = renderStudio(SIGNER);
    getApi().loadEvent(definitionEvent(SIGNER));

    await waitFor(() =>
      expect(screen.getByLabelText(/d — item identifier/)).toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Create as a new item/ }));

    await waitFor(() => {
      expect(screen.getByLabelText(/d — item identifier/)).toBeEnabled();
    });
    expect(getApi().form.loaded).toBeNull();
  });

  it('shows preserved unknown tags', async () => {
    const { getApi } = renderStudio(SIGNER);
    getApi().loadEvent(definitionEvent(SIGNER, [['durability', '40']]));

    await waitFor(() => {
      expect(screen.getByText('["durability","40"]')).toBeInTheDocument();
    });
  });
});

describe('another issuer’s item', () => {
  it('is flagged as not replaceable by this signer', async () => {
    const { getApi } = renderStudio(SIGNER);
    getApi().loadEvent(definitionEvent(STRANGER));

    await waitFor(() => {
      expect(
        screen.getByText(/published by another key/i),
      ).toBeInTheDocument();
    });
  });

  it('offers "use as template", which adds a based_on reference', async () => {
    const { getApi } = renderStudio(SIGNER);
    getApi().loadEvent(definitionEvent(STRANGER));

    const button = await screen.findByRole('button', { name: /Use as template/ });
    fireEvent.click(button);

    await waitFor(() => {
      expect(getApi().form.basedOn.map((row) => row.address)).toContain(
        `31632:${STRANGER}:blobbi:accessory:hat`,
      );
      expect(getApi().form.loaded).toBeNull();
    });
  });
});

describe('drafts', () => {
  it('reports the save state without claiming a publication', () => {
    renderStudio(SIGNER);
    expect(screen.getByText(/Not saved yet/i)).toBeInTheDocument();
  });

  it('autosaves an edited form and restores it on remount', async () => {
    const first = renderStudio(SIGNER);
    first.getApi().patch({ d: 'blobbi:accessory:restored', name: 'Restored Hat' });

    await waitFor(
      () => {
        expect(localStorage.getItem('blobbi-game-item-drafts')).toContain(
          'blobbi:accessory:restored',
        );
      },
      { timeout: 3000 },
    );

    first.unmount();
    const second = renderStudio(SIGNER);
    expect(second.getApi().form.name).toBe('Restored Hat');
  });
});
