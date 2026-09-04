/**
 * The Equipment Lab's build gate, the DISABLED build (the default).
 *
 * What must hold:
 *
 *  - the Lab tab does not exist and the three read-only tabs all do;
 *  - the Lab component NEVER mounts; not via the tab list, not via a forged
 *    tab value (`coerceToolTab` falls back to the studio), so no Lab mutation
 *    hook can initialize and no Lab mutation surface reaches the DOM;
 *  - the disabled note shows.
 *
 * The flag is fixed at module load exactly as it is in a real build, so this
 * file pins the disabled state and `GameItemTools.lab-gate-enabled.test.tsx`
 * pins the enabled one, two files because the page (correctly) evaluates the
 * flag once, at import. Heavy tab children are stubbed: this test is about
 * the GATE. The Lab stub records every mount, "does not mount" is an
 * assertion, not an assumption.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const labMounts = vi.hoisted(() => vi.fn());

// No env stubbing here: the vitest environment has no
// VITE_ENABLE_LIVE_INVENTORY_LAB, which IS the default build. The real
// feature-flags module (and the page's inline env comparison) both read that
// absence.

vi.mock('@/components/tools/game-items/InventoryEquipmentLab', () => ({
  InventoryEquipmentLab: () => {
    labMounts();
    return <div data-testid="lab-stub" />;
  },
}));
vi.mock('@/components/tools/game-items/ItemStudio', () => ({
  ItemStudio: () => <div data-testid="studio-stub" />,
}));
vi.mock('@/components/tools/game-items/PublishedItemsBrowser', () => ({
  PublishedItemsBrowser: () => <div data-testid="published-stub" />,
}));
vi.mock('@/components/tools/game-items/InventoryInspector', () => ({
  InventoryInspector: () => <div data-testid="inspector-stub" />,
}));
vi.mock('@/components/tools/game-items/SignerBanner', () => ({
  SignerBanner: () => <div data-testid="signer-banner-stub" />,
}));
vi.mock('@/tools/game-items/useItemStudio', () => ({
  useItemStudio: () => ({}),
}));
vi.mock('@/tools/game-items/useItemDefinitions', () => ({
  useItemDefinitionsByAddress: () => ({ data: [], isLoading: false, isFetching: false, error: null }),
  useItemDefinitionsByAuthor: () => ({ data: [], isLoading: false, isFetching: false, error: null }),
  useRefreshDefinitions: () => () => {},
  useToolRelayUrls: () => [],
}));
vi.mock('@/tools/game-items/inventory-inspection', () => ({
  buildInspectorRows: () => [],
}));
vi.mock('@/inventory/useIslandInventory', () => ({
  useIslandInventory: () => ({ data: undefined, isLoading: false, isFetching: false, error: null }),
  inventoryQueryKey: (pubkey: string | undefined) => ['inv', pubkey],
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: null }),
}));
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { GameItemTools } from './GameItemTools';

function renderTools(initialEntry = '/tools/game-items') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <GameItemTools />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('disabled build (the default)', () => {
  it('shows the three read-only tabs, no Lab tab, and the disabled note, and never mounts the Lab', () => {
    renderTools();

    expect(screen.getByText('Item Studio')).toBeInTheDocument();
    expect(screen.getByText('Published Items')).toBeInTheDocument();
    expect(screen.getByText('Inventory Inspector')).toBeInTheDocument();
    expect(screen.queryByTestId('lab-tab')).toBeNull();
    expect(screen.getByTestId('lab-disabled-note')).toHaveTextContent(
      'Live Inventory Lab is disabled in this build.',
    );
    expect(screen.queryByTestId('lab-stub')).toBeNull();
    expect(labMounts).not.toHaveBeenCalled();
  });

  it('no tab value can reveal the Lab; its trigger and content do not exist', () => {
    renderTools();

    // The read-only tabs still switch normally…
    fireEvent.mouseDown(screen.getByText('Inventory Inspector'));
    fireEvent.click(screen.getByText('Inventory Inspector'));
    expect(screen.getByTestId('inspector-stub')).toBeInTheDocument();

    // …but nothing in the DOM references the lab at all: no trigger, no
    // content region, no mounted stub. A stale persisted value would go
    // through `coerceToolTab`, which maps 'lab' to 'studio' in this build.
    expect(screen.queryByTestId('lab-tab')).toBeNull();
    expect(screen.queryByTestId('lab-stub')).toBeNull();
    expect(labMounts).not.toHaveBeenCalled();
  });

  it('the ?tab=lab deep link (and garbage values) fall back to the studio', () => {
    for (const entry of [
      '/tools/game-items?tab=lab',
      '/tools/game-items?tab=</script>',
      '/tools/game-items?tab=LAB',
    ]) {
      const { unmount } = renderTools(entry);
      expect(screen.getByTestId('studio-stub')).toBeInTheDocument();
      expect(screen.queryByTestId('lab-tab')).toBeNull();
      expect(screen.queryByTestId('lab-stub')).toBeNull();
      unmount();
    }
    expect(labMounts).not.toHaveBeenCalled();
  });

  it('the deep link still selects the read-only tabs it names', () => {
    renderTools('/tools/game-items?tab=inventory');
    expect(screen.getByTestId('inspector-stub')).toBeInTheDocument();
  });
});
