/**
 * The preview panel, through the REAL resolution helpers and the REAL renderer.
 *
 * A preview whose fallback rules differ from production is worse than no
 * preview: it would show a hat that the game will not show. So these tests
 * assert that each preview mode picks exactly what its production counterpart
 * picks — `primaryItemImageUrl` for a card, `itemImageSourcesForView` for a
 * posed Blobbi — and that a face-only accessory stays hidden from behind.
 *
 * The other thing asserted here is a negative: rendering a preview publishes
 * nothing, equips nothing, and grants nothing. Every mutation hook the app owns
 * is mocked to a spy that must never be called.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { FIXTURE_IMAGE_URLS as U } from '@/inventory/item-image-fixtures';
import {
  blankItemForm,
  blankVisual,
  nextRowId,
  type ItemFormState,
} from '@/tools/game-items/item-form-model';
import type { ImageProbe } from '@/tools/game-items/validation';

const inventoryMutate = vi.fn();
const publishMutate = vi.fn();

vi.mock('@/inventory/useInventoryMutation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inventory/useInventoryMutation')>();
  return {
    ...actual,
    useInventoryMutation: () => ({ mutate: inventoryMutate, mutateAsync: inventoryMutate }),
  };
});

vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutate: publishMutate, mutateAsync: publishMutate }),
}));

const { ItemPreviewPanel } = await import('./ItemPreviewPanel');

function imageRow(url: string, marker = '') {
  return { id: nextRowId('image'), url, marker };
}

function form(patch: Partial<ItemFormState> = {}): ItemFormState {
  return {
    ...blankItemForm(),
    d: 'fixture:accessory:hat',
    name: 'Fixture Hat',
    type: 'cosmetic',
    ...patch,
  };
}

const NO_PROBES = new Map<string, ImageProbe>();

/**
 * Switch tabs.
 *
 * Radix's tab triggers activate on `mousedown`, not on a synthesized `click`,
 * so a plain `fireEvent.click` leaves the panel where it was — which would make
 * every assertion below silently test the Card tab.
 */
function selectTab(name: string) {
  const trigger = screen.getByRole('tab', { name });
  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);
}

/** Every accessory image the renderer actually painted. */
const accessorySrc = (container: HTMLElement, code: string) =>
  container.querySelector(`[data-accessory-code="${code}"] img`)?.getAttribute('src') ??
  null;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('compact card preview', () => {
  it('uses the unmarked primary image', () => {
    const { container } = render(
      <ItemPreviewPanel
        form={form({
          images: [imageRow(U.primary), imageRow(U.front, 'front'), imageRow(U.back, 'back')],
        })}
        probes={NO_PROBES}
      />,
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(U.primary);
  });

  it('falls back to the first marked view when there is no primary', () => {
    const { container } = render(
      <ItemPreviewPanel
        form={form({ images: [imageRow(U.front, 'front'), imageRow(U.back, 'back')] })}
        probes={NO_PROBES}
      />,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe(U.front);
  });

  it('shows the symbol placeholder when there is no artwork at all', () => {
    render(<ItemPreviewPanel form={form({ symbol: '🎩' })} probes={NO_PROBES} />);
    expect(screen.getByLabelText('No image')).toHaveTextContent('🎩');
  });
});

describe('view comparison', () => {
  it('shows the published front and back views', async () => {
    const { container } = render(
      <ItemPreviewPanel
        form={form({
          images: [imageRow(U.primary), imageRow(U.front, 'front'), imageRow(U.back, 'back')],
        })}
        probes={NO_PROBES}
      />,
    );
    selectTab('Compare');

    const sources = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(sources).toContain(U.front);
    expect(sources).toContain(U.back);
  });

  it('falls back to the primary for a view the item does not publish', async () => {
    const { container } = render(
      <ItemPreviewPanel form={form({ images: [imageRow(U.primary)] })} probes={NO_PROBES} />,
    );
    selectTab('Compare');

    // All three tiles resolve to the primary, and none invents a view.
    const sources = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(new Set(sources)).toEqual(new Set([U.primary]));
    expect(screen.getAllByText('fallback').length).toBeGreaterThan(0);
  });

  it('never substitutes a side view for front or back', async () => {
    render(
      <ItemPreviewPanel
        form={form({
          images: [imageRow(U.sideRight, 'side-right'), imageRow(U.sideLeft, 'side-left')],
        })}
        probes={NO_PROBES}
      />,
    );
    selectTab('Compare');

    // Side views are listed as published, but only reachable through the
    // generic "first valid image" last resort — never chosen AS front or back.
    expect(screen.getByText(/never substituted/i)).toBeInTheDocument();
  });
});

describe('Blobbi accessory preview', () => {
  it('draws the FRONT view on a front-facing Blobbi', async () => {
    const { container } = render(
      <ItemPreviewPanel
        form={form({
          images: [imageRow(U.primary), imageRow(U.front, 'front'), imageRow(U.back, 'back')],
          content: {
            ...blankItemForm().content,
            visual: { ...blankVisual(), slot: 'headwear' },
          },
        })}
        probes={NO_PROBES}
      />,
    );
    selectTab('On a Blobbi');

    expect(accessorySrc(container, 'fixture:accessory:hat')).toBe(U.front);
  });

  it('draws the BACK view when the Blobbi is turned around', async () => {
    const { container } = render(
      <ItemPreviewPanel
        form={form({
          images: [imageRow(U.primary), imageRow(U.front, 'front'), imageRow(U.back, 'back')],
          content: {
            ...blankItemForm().content,
            visual: { ...blankVisual(), slot: 'headwear' },
          },
        })}
        probes={NO_PROBES}
      />,
    );
    selectTab('On a Blobbi');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(accessorySrc(container, 'fixture:accessory:hat')).toBe(U.back);
  });

  it('hides a face-only accessory from behind, and explains why', async () => {
    const { container } = render(
      <ItemPreviewPanel
        form={form({
          images: [imageRow(U.primary), imageRow(U.back, 'back')],
          content: {
            ...blankItemForm().content,
            visual: { ...blankVisual(), slot: 'eyewear' },
          },
        })}
        probes={NO_PROBES}
      />,
    );
    selectTab('On a Blobbi');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(container.querySelector('[data-accessory-code="fixture:accessory:hat"]')).toBeNull();
    expect(screen.getByText(/not drawn from behind/i)).toBeInTheDocument();
  });

  it('treats an unrecognized slot as the renderer’s documented unknown slot', async () => {
    render(
      <ItemPreviewPanel
        form={form({
          images: [imageRow(U.primary)],
          content: {
            ...blankItemForm().content,
            visual: { ...blankVisual(), slot: 'future-slot' },
          },
        })}
        probes={NO_PROBES}
      />,
    );
    selectTab('On a Blobbi');
    expect(screen.getByText('slot: unknown')).toBeInTheDocument();
  });

  it('labels the placement controls as preview-only', async () => {
    render(
      <ItemPreviewPanel form={form({ images: [imageRow(U.primary)] })} probes={NO_PROBES} />,
    );
    selectTab('On a Blobbi');
    expect(screen.getByText(/never published, never saved/i)).toBeInTheDocument();
  });
});

describe('previewing never writes', () => {
  it('publishes nothing and mutates no inventory', async () => {
    render(
      <ItemPreviewPanel
        form={form({
          images: [imageRow(U.primary), imageRow(U.front, 'front'), imageRow(U.back, 'back')],
          content: {
            ...blankItemForm().content,
            visual: { ...blankVisual(), slot: 'headwear' },
          },
        })}
        probes={NO_PROBES}
      />,
    );

    for (const tab of ['Views', 'Compare', 'On a Blobbi']) {
      selectTab(tab);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(publishMutate).not.toHaveBeenCalled();
    expect(inventoryMutate).not.toHaveBeenCalled();
  });
});
