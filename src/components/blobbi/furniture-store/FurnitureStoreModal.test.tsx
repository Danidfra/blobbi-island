/**
 * `<FurnitureStoreModal>` — the foundation, and the fact that it IS only that.
 *
 * This modal is deliberately empty: the Furniture Store's economy has not been
 * designed, and a placeholder price is how a placeholder becomes a promise. So
 * the tests below check two different things — that the dialog works as a
 * dialog, and that it does NOT yet do any of the things a shop does.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';

import { TestApp } from '@/test/TestApp';
import { FurnitureStoreModal } from './FurnitureStoreModal';

async function renderModal(onClose = vi.fn()) {
  render(
    <TestApp>
      <FurnitureStoreModal isOpen onClose={onClose} />
    </TestApp>,
  );
  // `TestApp`'s login provider hydrates asynchronously, and the window portals
  // into the in-frame stage host once it does.
  await screen.findByText('Furniture Store');
  return onClose;
}

describe('the dialog works as a dialog', () => {
  it('is a named dialog the player can identify', async () => {
    await renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Furniture Store')).toBeInTheDocument();
  });

  it('closes from its footer action', async () => {
    const onClose = await renderModal();
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes from the window control', async () => {
    const onClose = await renderModal();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing at all while closed', () => {
    render(
      <TestApp>
        <FurnitureStoreModal isOpen={false} onClose={vi.fn()} />
      </TestApp>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('it is a foundation, and says so', () => {
  it('has a catalog slot ready for one', async () => {
    await renderModal();
    expect(document.querySelector('[data-furniture-store-catalog]')).toBeTruthy();
  });

  it('tells the player the showroom is not stocked rather than showing a blank box', async () => {
    await renderModal();
    expect(screen.getByText(/nothing is on sale here yet/i)).toBeInTheDocument();
  });

  it('shows no price, no currency and no purchase control', async () => {
    await renderModal();
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text).not.toMatch(/\bcoins?\b/i);
    expect(text).not.toMatch(/\d+\s*(c|coin)/i);
    expect(screen.queryByRole('button', { name: /buy|purchase|checkout/i })).toBeNull();
  });

  it('imports nothing that could spend or publish', () => {
    // Structural, not behavioural: there is no code path from this module to a
    // wallet, an inventory write or a Nostr event, and that is the claim.
    const source = readFileSync(
      'src/components/blobbi/furniture-store/FurnitureStoreModal.tsx',
      'utf8',
    );
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const forbidden of [
      '@/inventory',
      '@/hooks/useNostrPublish',
      '@/hooks/useCurrentUser',
      '@/hooks/useIslandInventory',
    ]) {
      expect(imports).not.toContain(forbidden);
    }
    expect(source).not.toMatch(/usePurchase|useBatchPurchase|createEvent|signer/);
  });
});
