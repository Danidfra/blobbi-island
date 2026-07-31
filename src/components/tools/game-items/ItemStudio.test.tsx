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

/**
 * Authoring a VISUAL-EFFECT item through the real editor.
 *
 * The pure conversion rules are covered by
 * `src/tools/game-items/effect-item-authoring.test.ts`. What is tested HERE is
 * the wiring those rules depend on: that choosing the `effect` category
 * actually reaches the content editor, that the effect fields are on screen at
 * all (they were not, which is the whole bug), and that what the author types
 * into them lands in the event the studio would publish.
 */
describe('authoring a visual-effect item', () => {
  it('shows wearable slot fields until the item is an effect', () => {
    renderStudio(SIGNER);
    expect(screen.getByLabelText('slot')).toBeInTheDocument();
    expect(screen.queryByLabelText('effect')).toBeNull();
    expect(screen.queryByLabelText('effectSlot')).toBeNull();
  });

  it('choosing the effect category swaps in the effect fields and seeds visual.kind', async () => {
    const { getApi } = renderStudio(SIGNER);

    fireEvent.click(screen.getByRole('button', { name: 'effect' }));

    await waitFor(() => {
      expect(getApi().form.category).toBe('effect');
    });
    expect(getApi().form.content.visual.kind).toBe('blobbi-effect');

    // The wearable question is gone; the effect questions are asked instead.
    expect(screen.queryByLabelText('slot')).toBeNull();
    expect(screen.getByLabelText('kind')).toHaveValue('blobbi-effect');
    expect(screen.getByLabelText('effect')).toBeInTheDocument();
    expect(screen.getByLabelText('effectSlot')).toBeInTheDocument();
  });

  it('carries typed effect fields into the event content', async () => {
    const { getApi } = renderStudio(SIGNER);
    getApi().patch({
      d: 'blobbi:effect:golden-sparkles',
      name: 'Golden Sparkles',
      type: 'cosmetic',
    });

    fireEvent.click(screen.getByRole('button', { name: 'effect' }));
    await waitFor(() => expect(screen.getByLabelText('effect')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('effect'), {
      target: { value: 'golden-sparkles' },
    });
    fireEvent.change(screen.getByLabelText('effectSlot'), {
      target: { value: 'ambient-particles' },
    });

    await waitFor(() => {
      expect(getApi().previewEvent).not.toBeNull();
    });
    expect(JSON.parse(getApi().previewEvent!.content)).toEqual({
      visual: {
        kind: 'blobbi-effect',
        effect: 'golden-sparkles',
        effectSlot: 'ambient-particles',
      },
    });
  });

  it('fills the effect slot in when a known effect is picked from the suggestions', async () => {
    const { getApi } = renderStudio(SIGNER);
    fireEvent.click(screen.getByRole('button', { name: 'effect' }));
    await waitFor(() => expect(screen.getByLabelText('effect')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'celestial-aura' }));

    await waitFor(() => {
      expect(getApi().form.content.visual.effect).toBe('celestial-aura');
    });
    expect(getApi().form.content.visual.effectSlot).toBe('aura');
  });

  it('switching back to wearable clears the effect fields, and nothing else', async () => {
    const { getApi } = renderStudio(SIGNER);
    fireEvent.click(screen.getByRole('button', { name: 'effect' }));
    await waitFor(() => expect(screen.getByLabelText('effect')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('effect'), {
      target: { value: 'mystic-fog' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Wearable' }));

    await waitFor(() => {
      expect(getApi().form.content.visual.kind).toBe('');
    });
    expect(getApi().form.content.visual.effect).toBe('');
    expect(getApi().form.content.visual.effectSlot).toBe('');
    // The category tag is the author's; a content toggle does not touch it.
    expect(getApi().form.category).toBe('effect');
  });

  it('previews the effect itself rather than pasting its token onto a Blobbi', async () => {
    const { getApi, container } = renderStudio(SIGNER);
    fireEvent.click(screen.getByRole('button', { name: 'effect' }));
    await waitFor(() => expect(screen.getByLabelText('effect')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('effect'), {
      target: { value: 'golden-sparkles' },
    });
    await waitFor(() =>
      expect(getApi().form.content.visual.effect).toBe('golden-sparkles'),
    );

    // Radix tabs activate on mousedown; a bare click leaves the panel closed.
    const tab = screen.getByRole('tab', { name: 'On a Blobbi' });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);

    await waitFor(() => {
      expect(container.querySelector('[data-effect-preview-stage]')).not.toBeNull();
    });
    expect(
      container.querySelectorAll('[data-blobbi-effect="golden-sparkles"]').length,
    ).toBeGreaterThan(0);
    // No accessory was invented from the effect's token artwork.
    expect(container.querySelector('[data-accessory-layer-group]')).toBeNull();
  });
});

/**
 * The "Import event JSON" flow, driven through the real dialog.
 *
 * The parse itself is covered exhaustively by
 * `src/tools/game-items/import-event-json.test.ts`. What is tested here is the
 * wiring: that the action exists, that a good paste lands in the editor and
 * autosaves, that a bad one reports why without touching the form, and that an
 * editor holding real work is not replaced without being asked.
 */
describe('importing a pasted event', () => {
  const IMPORT_JSON = JSON.stringify({
    id: '',
    pubkey: '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9',
    created_at: 1785533159,
    kind: KIND_GAME_ITEM_DEFINITION,
    tags: [
      ['d', 'blobbi:effect:golden-sparkles'],
      ['name', 'Golden Sparkles'],
      ['type', 'cosmetic'],
      ['category', 'effect'],
      ['image', 'https://fixtures.invalid/gs.png'],
      ['symbol', '✨'],
      ['rarity', 'rare'],
      ['t', 'visual-effect'],
      ['alt', 'Game item definition: Golden Sparkles'],
      ['unknown_tag', 'kept'],
    ],
    content: JSON.stringify({
      description: 'Golden stars.',
      visual: {
        kind: 'blobbi-effect',
        effect: 'golden-sparkles',
        effectSlot: 'ambient-particles',
        forms: ['baby', 'adult'],
      },
    }),
    sig: '',
  });

  const openImport = () => {
    fireEvent.click(screen.getByRole('button', { name: /Import event JSON/i }));
    return screen.getByLabelText('Event JSON');
  };

  it('offers the action next to the other draft controls', () => {
    renderStudio(SIGNER);
    expect(
      screen.getByRole('button', { name: /Import event JSON/i }),
    ).toBeInTheDocument();
  });

  it('populates the whole form from a pasted unsigned draft', async () => {
    const { getApi } = renderStudio(SIGNER);
    fireEvent.change(openImport(), { target: { value: IMPORT_JSON } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(getApi().form.d).toBe('blobbi:effect:golden-sparkles');
    });
    const { form } = getApi();
    expect(form.name).toBe('Golden Sparkles');
    expect(form.category).toBe('effect');
    expect(form.rarity).toBe('rare');
    expect(form.images).toHaveLength(1);
    expect(form.content.visual.effect).toBe('golden-sparkles');
    expect(form.content.visual.effectSlot).toBe('ambient-particles');
    expect(form.extraTags).toEqual([['unknown_tag', 'kept']]);
    // Provenance is reported, not attached: this publishes as a new event.
    expect(form.loaded).toBeNull();
  });

  it('shows the imported item in the effect editor, ready to keep editing', async () => {
    const { getApi } = renderStudio(SIGNER);
    fireEvent.change(openImport(), { target: { value: IMPORT_JSON } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(getApi().form.d).not.toBe(''));
    expect(screen.getByLabelText('effect')).toHaveValue('golden-sparkles');
    expect(screen.getByLabelText('effectSlot')).toHaveValue('ambient-particles');
    expect(screen.queryByLabelText('slot')).toBeNull();
  });

  it('autosaves the import as a local draft, publishing nothing', async () => {
    const { getApi } = renderStudio(SIGNER);
    fireEvent.change(openImport(), { target: { value: IMPORT_JSON } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(
      () => {
        expect(localStorage.getItem('blobbi-game-item-drafts')).toContain(
          'blobbi:effect:golden-sparkles',
        );
      },
      { timeout: 3000 },
    );
    expect(publishMutateAsync).not.toHaveBeenCalled();
    expect(getApi().form.loaded).toBeNull();
  });

  it('reports a parse error and leaves the editor untouched', async () => {
    const { getApi } = renderStudio(SIGNER);
    fireEvent.change(openImport(), { target: { value: '{ "kind": 1, "tags": [] }' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText(/kind:1 event/)).toBeInTheDocument();
    expect(getApi().form.d).toBe('');
  });

  it('asks before replacing an editor that holds real work', async () => {
    const { getApi } = renderStudio(SIGNER);
    getApi().patch({ d: 'blobbi:accessory:in-progress', name: 'In Progress' });
    await waitFor(() => expect(getApi().isDirty).toBe(true));

    fireEvent.change(openImport(), { target: { value: IMPORT_JSON } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    // Held, not applied.
    expect(await screen.findByText(/holds unsaved work/i)).toBeInTheDocument();
    expect(getApi().form.d).toBe('blobbi:accessory:in-progress');

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(getApi().form.d).toBe('blobbi:accessory:in-progress');
  });

  it('replaces the editor once the replacement is confirmed', async () => {
    const { getApi } = renderStudio(SIGNER);
    getApi().patch({ d: 'blobbi:accessory:in-progress', name: 'In Progress' });
    await waitFor(() => expect(getApi().isDirty).toBe(true));

    fireEvent.change(openImport(), { target: { value: IMPORT_JSON } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Replace editor' }));

    await waitFor(() => {
      expect(getApi().form.d).toBe('blobbi:effect:golden-sparkles');
    });
  });

  it('summarizes what it understood before replacing anything', async () => {
    const { getApi } = renderStudio(SIGNER);
    getApi().patch({ d: 'blobbi:accessory:in-progress', name: 'In Progress' });
    await waitFor(() => expect(getApi().isDirty).toBe(true));

    fireEvent.change(openImport(), { target: { value: IMPORT_JSON } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText('Golden Sparkles')).toBeInTheDocument();
    expect(screen.getByText(/1 primary \+ 0 marked view/)).toBeInTheDocument();
    expect(screen.getByText(/1 unknown tag\(s\) preserved/)).toBeInTheDocument();
  });

  it('imports an event with no image and says so', async () => {
    const { getApi } = renderStudio(SIGNER);
    const noImage = JSON.stringify({
      kind: KIND_GAME_ITEM_DEFINITION,
      tags: [
        ['d', 'blobbi:accessory:no-art'],
        ['name', 'No Art'],
        ['type', 'cosmetic'],
      ],
      content: '',
    });
    fireEvent.change(openImport(), { target: { value: noImage } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(getApi().form.d).toBe('blobbi:accessory:no-art'));
    expect(getApi().form.images).toEqual([]);
    expect(getApi().validation.image.map((i) => i.code)).toContain('no-images');
  });
});
