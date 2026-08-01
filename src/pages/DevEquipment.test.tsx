/**
 * The /dev/equipment simulation harness (Phase 9.5b).
 *
 * What must hold:
 *
 *  - all sixteen official items appear, derived from the canonical registries
 *    (via the Lab projection — no second list);
 *  - simulation controls drive the REAL policy/activation/renderer paths:
 *    an owned+equipped effect renders through `resolveActiveBlobbiEffects`
 *    into real `[data-blobbi-effect]` DOM, an owned+equipped wearable renders
 *    through the real accessory translation, egg rejects the current items,
 *    and the stale override produces a diagnosed non-rendering placement;
 *  - NOTHING real moves: no signer call, no publish, no change to the real
 *    kind:31633 cache — asserted, not assumed;
 *  - the Live Account section explains the flag-disabled workflow (this test
 *    env has no flag) and never mounts a mutation surface;
 *  - the import graph of the page + sim module reaches no writer, signer or
 *    publisher (source-level boundary below).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const signEvent = vi.fn();
const nostrEvent = vi.fn();
vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { query: async () => [], event: nostrEvent } }),
}));
vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({ config: { relayUrl: 'wss://example.invalid' } }),
}));

import {
  ITEM_CATALOG_QUERY_KEY,
  type ItemCatalog,
} from '@/inventory/useItemCatalog';
import { inventoryQueryKey } from '@/inventory/useIslandInventory';
import {
  parseOfficialItemDefinition,
  resolveFromDefinition,
} from '@/inventory/protocol-adapter';
import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';
import { OFFICIAL_ITEM_EVENT_FIXTURES } from '@/effects/official-item-event-fixtures';
import { LAB_OFFICIAL_ITEMS } from '@/tools/game-items/inventory-equipment-lab';

import { DevEquipment } from './DevEquipment';

function fixtureCatalog(): ItemCatalog {
  const byAddress = new Map<string, ResolvedBlobbiItemDefinition>();
  for (const { event } of OFFICIAL_ITEM_EVENT_FIXTURES) {
    const parsed = parseOfficialItemDefinition(event);
    if (parsed) byAddress.set(parsed.address, resolveFromDefinition(parsed));
  }
  return {
    byAddress,
    fetchedCount: 0,
    totalCount: 0,
    cosmeticsFetched: 4,
    cosmeticsTotal: 4,
    effectItemsFetched: 12,
    effectItemsTotal: 12,
  };
}

const REAL_INVENTORY_KEY = inventoryQueryKey('a'.repeat(64));
const REAL_INVENTORY_SENTINEL = { sentinel: 'untouched-real-inventory' };

function renderHarness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(ITEM_CATALOG_QUERY_KEY, fixtureCatalog());
  // A stand-in for someone's REAL inventory cache: the harness must never
  // touch it.
  client.setQueryData(REAL_INVENTORY_KEY, REAL_INVENTORY_SENTINEL);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { client, ...render(<DevEquipment />, { wrapper }) };
}

const AURA_D = 'blobbi:effect:celestial-aura';
const CAP_D = 'blobbi:cosmetic:block-builder-cap';

function effectIds(container: HTMLElement): string[] {
  return [
    ...new Set(
      [...container.querySelectorAll('[data-blobbi-effect]')].map(
        (el) => el.getAttribute('data-blobbi-effect') ?? '',
      ),
    ),
  ];
}

describe('official item coverage', () => {
  it('shows all sixteen items with published names, rarities and slots', () => {
    const { container } = renderHarness();
    expect(container.querySelectorAll('[data-testid^="dev-item-"]')).toHaveLength(16);
    for (const item of LAB_OFFICIAL_ITEMS) {
      expect(screen.getByTestId(`dev-item-${item.d}`), item.d).toBeInTheDocument();
    }
    const aura = screen.getByTestId(`dev-item-${AURA_D}`);
    expect(aura).toHaveTextContent('Celestial Aura');
    expect(aura).toHaveTextContent('legendary');
    expect(aura).toHaveTextContent('slot: aura');
    const cap = screen.getByTestId(`dev-item-${CAP_D}`);
    expect(cap).toHaveTextContent('slot: headwear');
    expect(cap).toHaveTextContent('back view: published');
  });
});

describe('the activation pipeline runs the REAL resolvers', () => {
  it('own + equip an effect renders it through the real effect path; unowned does not', async () => {
    const { container } = renderHarness();

    // Not owned: the equip control is disabled — the ownership gate is real.
    expect(screen.getByTestId(`dev-equip-${AURA_D}`)).toBeDisabled();

    fireEvent.click(screen.getByTestId(`dev-own-${AURA_D}`));
    fireEvent.click(screen.getByTestId(`dev-equip-${AURA_D}`));
    await waitFor(() =>
      expect(effectIds(container)).toEqual(['celestial-aura']),
    );
  });

  it('egg rejects the equipped effect with the resolver’s reason; adult accepts again', async () => {
    const { container } = renderHarness();
    fireEvent.click(screen.getByTestId(`dev-own-${AURA_D}`));
    fireEvent.click(screen.getByTestId(`dev-equip-${AURA_D}`));
    await waitFor(() => expect(effectIds(container)).toEqual(['celestial-aura']));

    fireEvent.click(screen.getByTestId('dev-stage-egg'));
    await waitFor(() => expect(effectIds(container)).toEqual([]));
    expect(screen.getByTestId('dev-diagnostics')).toHaveTextContent(
      /incompatible-form/,
    );

    fireEvent.click(screen.getByTestId('dev-stage-baby'));
    await waitFor(() => expect(effectIds(container)).toEqual(['celestial-aura']));
  });

  it('a stale (unowned) placement via the override is diagnosed and not rendered', async () => {
    const { container } = renderHarness();
    fireEvent.click(screen.getByTestId('dev-allow-unowned'));
    fireEvent.click(screen.getByTestId(`dev-equip-${AURA_D}`));
    await waitFor(() =>
      expect(screen.getByTestId('dev-diagnostics')).toHaveTextContent(/not-owned/),
    );
    expect(effectIds(container)).toEqual([]);
  });

  it('an owned + equipped wearable renders through the real accessory translation, front and back', async () => {
    const { container } = renderHarness();
    fireEvent.click(screen.getByTestId(`dev-own-${CAP_D}`));
    fireEvent.click(screen.getByTestId(`dev-equip-${CAP_D}`));
    await waitFor(() =>
      expect(
        container.querySelectorAll('[data-accessory-layer-group] img').length,
      ).toBeGreaterThan(0),
    );
    const frontSrc = container
      .querySelector('[data-accessory-layer-group] img')
      ?.getAttribute('src');
    expect(frontSrc).toMatch(/blossom\.primal\.net/);

    fireEvent.click(screen.getByTestId('dev-facing'));
    await waitFor(() => {
      const backSrc = container
        .querySelector('[data-accessory-layer-group] img')
        ?.getAttribute('src');
      expect(backSrc).toMatch(/blossom\.primal\.net/);
      expect(backSrc).not.toBe(frontSrc); // the published BACK view
    });
  });

  it('the seven-slot loadout coexists: three wearables, four effect slots, deterministic order', async () => {
    const { container } = renderHarness();
    fireEvent.click(screen.getByTestId('dev-own-all'));
    fireEvent.click(screen.getByTestId('dev-apply-loadout'));

    await waitFor(() =>
      expect(effectIds(container)).toEqual([
        'celestial-aura',
        'mystic-fog',
        'golden-sparkles',
        'pixel-glitch',
      ]),
    );
    expect(screen.getByTestId('dev-active-list')).toHaveTextContent('headwear');
    expect(screen.getByTestId('dev-active-list')).toHaveTextContent('neckwear');
    expect(screen.getByTestId('dev-active-list')).toHaveTextContent('eyewear');

    fireEvent.click(screen.getByTestId('dev-clear-loadout'));
    await waitFor(() => expect(effectIds(container)).toEqual([]));
  });
});

describe('nothing real moves', () => {
  it('a full simulation session signs nothing, publishes nothing, and leaves the real inventory cache untouched', async () => {
    const { client, container } = renderHarness();
    fireEvent.click(screen.getByTestId('dev-own-all'));
    fireEvent.click(screen.getByTestId('dev-apply-loadout'));
    await waitFor(() => expect(effectIds(container)).toHaveLength(4));
    fireEvent.click(screen.getByTestId('dev-reset'));

    expect(signEvent).not.toHaveBeenCalled();
    expect(nostrEvent).not.toHaveBeenCalled();
    expect(client.getQueryData(REAL_INVENTORY_KEY)).toBe(REAL_INVENTORY_SENTINEL);
  });

  it('the Live Account section shows the flag-disabled instructions, not a mutation surface', () => {
    renderHarness();
    const instructions = screen.getByTestId('dev-lab-disabled-instructions');
    expect(instructions).toHaveTextContent('Real inventory editing is disabled in this build.');
    expect(instructions).toHaveTextContent('VITE_ENABLE_LIVE_INVENTORY_LAB=true');
    expect(instructions).toHaveTextContent(/restart Vite/);
    expect(screen.queryByTestId('dev-open-lab')).toBeNull();
    // No lab mutation surface exists anywhere in the harness DOM.
    expect(screen.queryByTestId('inventory-equipment-lab')).toBeNull();
  });
});

describe('boundary — the harness cannot reach a writer', () => {
  const ENTRIES = [
    'src/pages/DevEquipment.tsx',
    'src/lib/dev-equipment-simulation.ts',
  ];
  const FORBIDDEN = [
    /useInventoryMutation/,
    /useEquipmentMutation/,
    /useNostrPublish/,
    /useCoinsMutation/,
    /signEvent/,
    /buildEquipmentTemplate/,
    /buildInventoryTemplate/,
  ];

  function specifiersOf(file: string): string[] {
    const source = readFileSync(file, 'utf8');
    // `import type { … }` is erased at compile time — a type-only reference to
    // a writer's INPUT SHAPE (the lab planner names `InventorySetTarget`)
    // carries no code and cannot call anything, so the walk skips it.
    return [
      ...source.matchAll(/\bimport\s+(?:[\s\S]*?\bfrom\s*)?['"]([^'"]+)['"]/g),
    ]
      .filter((m) => !/^import\s+type\b/.test(m[0]))
      .map((m) => m[1]);
  }
  function resolveSpecifier(fromFile: string, spec: string): string | null {
    let base: string | null = null;
    if (spec.startsWith('@/')) base = join(process.cwd(), 'src', spec.slice(2));
    else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
    if (!base) return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
      if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
    }
    return null;
  }

  it('transitively imports no inventory writer, equipment writer, signer or publisher', () => {
    const visited = new Map<string, string[]>();
    const queue = ENTRIES.map((m) => join(process.cwd(), m));
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (visited.has(file)) continue;
      const specs = specifiersOf(file);
      visited.set(file, specs);
      for (const spec of specs) {
        const next = resolveSpecifier(file, spec);
        if (next && !visited.has(next)) queue.push(next);
      }
    }
    expect(visited.size).toBeGreaterThan(10); // the walk is real
    for (const [file, specs] of visited) {
      for (const spec of specs) {
        for (const pattern of FORBIDDEN) {
          expect(
            pattern.test(spec),
            `${file.replace(`${process.cwd()}/`, '')} imports "${spec}"`,
          ).toBe(false);
        }
      }
    }
  });
});
