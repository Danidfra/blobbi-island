/**
 * `<BadgesStoreModal>`: the shop window over an empty catalog.
 *
 * What has to hold while there is no badge protocol:
 *
 *  1. an INTENTIONAL empty state, not a broken-looking blank panel;
 *  2. no invented merchandise, no invented tabs, no faked ownership;
 *  3. opening and browsing writes NOTHING.
 *
 * The third is asserted structurally rather than by spying: the module's own
 * import graph is checked for any path to a publisher, a signer, a wallet or an
 * inventory mutation. A spy proves a particular click did not publish; the
 * import check proves no click could.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';

import { BADGE_CATALOG } from '@/badges';
import { BadgesStoreModal } from './BadgesStoreModal';

const noop = () => {};

describe('the empty case is intentional', () => {
  it('shows the empty state rather than a grid of nothing', () => {
    render(<BadgesStoreModal isOpen onClose={noop} />);
    expect(screen.getByTestId).toBeTruthy();
    expect(document.querySelector('[data-badges-store-empty]')).toBeTruthy();
    expect(document.querySelectorAll('[data-badges-store-item]')).toHaveLength(0);
  });

  it('says what the store is for, and that nothing is minted yet', () => {
    render(<BadgesStoreModal isOpen onClose={noop} />);
    const empty = document.querySelector('[data-badges-store-empty]')!;
    expect(empty.textContent).toMatch(/no badges have been minted/i);
    expect(empty.textContent).toMatch(/buy/i);
    expect(empty.textContent).toMatch(/earned/i);
    expect(empty.textContent).toMatch(/mission/i);
  });

  it('shows no category tabs over an empty catalog', () => {
    render(<BadgesStoreModal isOpen onClose={noop} />);
    expect(document.querySelectorAll('[data-badges-store-tab]')).toHaveLength(0);
    expect(BADGE_CATALOG).toHaveLength(0);
  });

  it('renders nothing at all when closed', () => {
    const { container } = render(<BadgesStoreModal isOpen={false} onClose={noop} />);
    expect(container.textContent).toBe('');
  });

  it('names itself, and says browsing changes nothing', () => {
    render(<BadgesStoreModal isOpen onClose={noop} />);
    expect(screen.getByText('Badges Store')).toBeTruthy();
    expect(document.body.textContent).toMatch(/browsing changes nothing/i);
  });
});

describe('opening the store is write-free by construction', () => {
  const source = readFileSync(
    'src/components/blobbi/badges-store/BadgesStoreModal.tsx',
    'utf8',
  );

  it('imports no publisher, signer, wallet or inventory mutation', () => {
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const specifier of imports) {
      expect(specifier, specifier).not.toMatch(
        /publish|signer|wallet|purchase|inventory|nostr/i,
      );
    }
  });

  it('reaches the protocol only through the badge domain adapter', () => {
    expect(source).toContain("from '@/badges'");
    expect(source).toContain('acquireBadge');
    // No local ownership store to drift out of sync with the truth.
    expect(source).not.toMatch(/localStorage|sessionStorage/);
  });
});
