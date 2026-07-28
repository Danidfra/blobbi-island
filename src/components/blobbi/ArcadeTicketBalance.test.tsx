/**
 * The arcade ticket chip.
 *
 * Two properties are load-bearing and easy to regress: the balance comes from
 * the canonical kind:31633 inventory (NOT from `sessionStorage`, which is where
 * the unrelated Arcade PASS lives), and rendering it never publishes anything.
 *
 * Note on the `renderProbe` sibling: `NostrLoginProvider` inside `TestApp`
 * mounts its subtree asynchronously, so a synchronous `querySelector` straight
 * after `render()` always sees an empty container. The probe gives every test —
 * including the ones asserting ABSENCE — a positive thing to await first, so
 * "not rendered" can never be confused with "not rendered YET".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { ArcadeTicketBalance } from './ArcadeTicketBalance';
import { buildEmptyInventory, dTagToAddress, itemIdToAddress } from '@/inventory';
import { addInventoryItemQuantity } from '@nostr-games/inventory';
import { ARCADE_TICKET_D } from '@/protocol/event-registry';
import type { GameInventory } from '@nostr-games/inventory';

const mockUseIslandInventory = vi.fn();
const mockUseItemCatalog = vi.fn();

vi.mock('@/inventory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inventory')>();
  return {
    ...actual,
    useIslandInventory: () => mockUseIslandInventory(),
    useItemCatalog: () => mockUseItemCatalog(),
  };
});

const TICKET = dTagToAddress(ARCADE_TICKET_D)!;

async function renderInventory(inv: GameInventory) {
  mockUseIslandInventory.mockReturnValue({ data: inv, isLoading: false });
  render(
    <TestApp>
      <div data-testid="render-probe" />
      <ArcadeTicketBalance />
    </TestApp>,
  );
  // The whole subtree (probe + chip) mounts together.
  await screen.findByTestId('render-probe');
}

async function renderWith(quantity: number) {
  let inv = buildEmptyInventory('owner');
  if (quantity > 0) inv = addInventoryItemQuantity(inv, TICKET, quantity);
  await renderInventory(inv);
}

const chip = () => document.querySelector('[data-arcade-ticket-balance]');

describe('ArcadeTicketBalance', () => {
  beforeEach(() => {
    mockUseItemCatalog.mockReturnValue({ data: undefined }); // bundled fallback
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('shows the ticket quantity from the kind:31633 inventory', async () => {
    await renderWith(12);

    expect(chip()).not.toBeNull();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(chip()!.getAttribute('aria-label')).toBe('12 Arcade Tickets');
  });

  it('singularises a balance of one', async () => {
    await renderWith(1);
    expect(chip()!.getAttribute('aria-label')).toBe('1 Arcade Ticket');
  });

  it('renders nothing at zero, matching the bag convention', async () => {
    await renderWith(0);
    expect(chip()).toBeNull();
  });

  it('ignores other items in the inventory', async () => {
    let inv = buildEmptyInventory('owner');
    inv = addInventoryItemQuantity(inv, itemIdToAddress('food_apple')!, 9);
    await renderInventory(inv);

    expect(chip()).toBeNull();
    expect(screen.queryByText('9')).toBeNull();
  });

  it('does NOT read the Arcade Pass session flag', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    // Holding a PASS must not conjure a ticket balance: different concepts,
    // different storage, different lifetimes.
    sessionStorage.setItem('has-arcade-pass', 'true');
    getItem.mockClear();

    await renderWith(0);

    const passReads = getItem.mock.calls.filter(
      ([key]) => key === 'has-arcade-pass',
    );
    expect(passReads).toHaveLength(0);
    expect(chip()).toBeNull();

    getItem.mockRestore();
  });

  it('renders the production artwork from the OFFLINE bundled fallback', async () => {
    // No catalog data at all — i.e. every definition relay unreachable.
    await renderWith(4);

    const img = chip()!.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe(
      'https://assets.blobbi.pet/items/arcade/arcade-ticket-v1.webp',
    );
  });

  it('degrades to the emoji when the artwork itself fails to load', async () => {
    await renderWith(4);

    const img = chip()!.querySelector('img')!;
    fireEvent.error(img);

    // A broken remote asset must not leave a broken-image glyph in the HUD.
    expect(chip()!.querySelector('img')).toBeNull();
    expect(chip()!.textContent).toContain('🎟️');
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('prefers a published image over the emoji once one exists', async () => {
    mockUseItemCatalog.mockReturnValue({
      data: {
        byAddress: new Map([
          [
            TICKET,
            {
              address: TICKET,
              itemId: 'cur_arcade_ticket',
              d: ARCADE_TICKET_D,
              name: 'Arcade Ticket',
              type: 'currency',
              category: 'currency' as const,
              effects: {},
              action: null,
              stages: ['egg', 'baby', 'adult'] as const,
              emoji: '🎟️',
              image: 'https://cdn.example/arcade-ticket.png',
              topics: ['currency', 'arcade'],
              source: 'definition' as const,
            },
          ],
        ]),
        fetchedCount: 1,
        totalCount: 20,
      },
    });

    await renderWith(4);

    const img = chip()!.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('https://cdn.example/arcade-ticket.png');
  });
});
