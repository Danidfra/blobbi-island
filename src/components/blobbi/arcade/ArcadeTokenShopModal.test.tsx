/**
 * What the Token counter tells a Pass holder.
 *
 * The Pass covers a LIMITED number of plays, so "you don't need tokens right
 * now" is true only while the allowance lasts. Telling an exhausted pass
 * holder the same thing would send them away from the one counter that can
 * help them: which is the copy bug these tests exist to prevent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

const PUBKEY = 'f'.repeat(64);

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: PUBKEY } }),
}));
vi.mock('@/inventory/useCoinWallet', () => ({
  useCoinBalance: () => ({ balance: 500, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/hooks/useArcadeTokens', () => ({
  useArcadeTokenBalance: () => ({ balance: 2, isLoading: false }),
  useBuyArcadeTokens: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/inventory/useItemCatalog', () => ({ useItemCatalog: () => ({ data: undefined }) }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ArcadeTokenShopModal } from './ArcadeTokenShopModal';
import {
  ARCADE_PASS_FREE_PLAYS,
  clearArcadePasses,
  consumeArcadeFreePlay,
  grantArcadePass,
} from '@/arcade/pass/arcade-pass-entitlement';

const notice = (kind: 'usable' | 'exhausted') =>
  document.querySelector(`[data-pass-notice="${kind}"]`) as HTMLElement | null;

beforeEach(() => clearArcadePasses());
afterEach(() => clearArcadePasses());

function renderShop() {
  return render(<ArcadeTokenShopModal isOpen onClose={() => {}} />);
}

describe('with no pass', () => {
  it('says nothing about a pass at all', () => {
    renderShop();
    expect(notice('usable')).toBeNull();
    expect(notice('exhausted')).toBeNull();
  });
});

describe('with a usable pass', () => {
  it('names the remaining plays, not just the time', () => {
    grantArcadePass(PUBKEY, { redemptionId: 'r1', nowMs: Date.now() });
    renderShop();

    const text = notice('usable')!.textContent!;
    expect(text).toContain(`${ARCADE_PASS_FREE_PLAYS} free plays`);
    // The old unlimited-pass promise must not survive anywhere.
    expect(text).not.toMatch(/plays are free until/i);
    expect(text).not.toMatch(/unlimited/i);
    expect(notice('exhausted')).toBeNull();
  });
});

describe('with an exhausted pass', () => {
  it('says games cost Tokens again, and does NOT say tokens are unneeded', async () => {
    grantArcadePass(PUBKEY, { redemptionId: 'r1', nowMs: Date.now() });
    for (let i = 0; i < ARCADE_PASS_FREE_PLAYS; i += 1) {
      await consumeArcadeFreePlay(PUBKEY, Date.now());
    }
    renderShop();

    expect(notice('usable')).toBeNull();
    const text = notice('exhausted')!.textContent!;
    expect(text).toMatch(/used up/i);
    expect(text).toMatch(/cost arcade tokens again/i);
    expect(text).not.toMatch(/do not need tokens|don't need tokens/i);
  });
});

describe('with an expired pass', () => {
  it('goes quiet: an expired pass explains nothing', () => {
    grantArcadePass(PUBKEY, {
      redemptionId: 'r1',
      nowMs: Date.now() - 25 * 60 * 60 * 1000,
    });
    renderShop();

    expect(notice('usable')).toBeNull();
    expect(notice('exhausted')).toBeNull();
  });
});
