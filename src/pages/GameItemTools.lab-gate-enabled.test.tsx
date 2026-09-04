/**
 * The Equipment Lab's build gate, the ENABLED build
 * (`VITE_ENABLE_LIVE_INVENTORY_LAB=true`).
 *
 * The disabled twin is `GameItemTools.lab-gate.test.tsx`; see its module doc
 * for why the two states are separate files.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const labMounts = vi.hoisted(() => vi.fn());

// The page and the flag module both read the env at THEIR import time, so
// the variable is stubbed before the page is (dynamically) imported below,
// exactly what a VITE_ENABLE_LIVE_INVENTORY_LAB=true build does statically.
vi.stubEnv('VITE_ENABLE_LIVE_INVENTORY_LAB', 'true');

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

async function renderTools(initialEntry = '/tools/game-items') {
  // Imported AFTER the env stub so the module-level flag evaluation sees it.
  const { GameItemTools } = await import('./GameItemTools');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <GameItemTools />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('enabled build', () => {
  it('shows the fourth tab, mounts the Lab only when selected, and hides the disabled note', async () => {
    await renderTools();

    const tab = screen.getByTestId('lab-tab');
    expect(tab).toHaveTextContent('Equipment Lab');
    expect(screen.queryByTestId('lab-disabled-note')).toBeNull();
    expect(labMounts).not.toHaveBeenCalled(); // not mounted until selected

    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    await waitFor(() =>
      expect(screen.getByTestId('lab-stub')).toBeInTheDocument(),
    );
    expect(labMounts).toHaveBeenCalled();
  });

  it('the ?tab=lab deep link opens the Lab directly', async () => {
    await renderTools('/tools/game-items?tab=lab');
    await waitFor(() =>
      expect(screen.getByTestId('lab-stub')).toBeInTheDocument(),
    );
  });
});
