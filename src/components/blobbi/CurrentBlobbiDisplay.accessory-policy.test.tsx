/**
 * ACCESSORY OWNERSHIP POLICY for `CurrentBlobbiDisplay` (Phase 5).
 *
 * The rule under test is one sentence: *accessories belong to the Blobbi being
 * drawn, not to the component drawing it.* Concretely —
 *
 *   no `visualOverride`                      → local companion + local equipment
 *   `visualOverride`, no `accessoryOverride` → that visual, wearing nothing
 *   `visualOverride` + `accessoryOverride`   → that visual, wearing exactly those
 *
 * The middle row is the fix. Before it, `BlobbiInfoModal`'s read-only preview of
 * ANOTHER player's Blobbi rendered it wearing the local player's hats, because
 * the equipment hook fired regardless of whose visual was on screen. The last
 * test in this file is that leak, asserted not to come back.
 *
 * Local equipment is mocked at the CONTEXT boundary, so these tests need no
 * relay, no signer, no inventory event and no placement event. Since the
 * kind:31634 migration the context already carries policy-approved, renderer-
 * ready accessories — whether an item is owned, official and slot-compatible is
 * decided in `src/placement/policy.ts` and tested there, not here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { AccessoryPlacementInput } from '@blobbi/react';

/**
 * The local player wears exactly one, unmistakable accessory.
 *
 * The `code` is an ITEM ADDRESS now, because that is the identity a kind:31634
 * placement carries and the only one the renderer is handed.
 */
const LOCAL_ITEM = '31632:issuer:blobbi:cosmetic:local_hat';
const LOCAL_EQUIPMENT: readonly AccessoryPlacementInput[] = [
  {
    code: LOCAL_ITEM,
    slot: 'headwear',
    x: 50, y: 20, scale: 1, rot: 0, flipX: false,
  },
];

const LOCAL_DEFINITIONS = new Map([
  [
    LOCAL_ITEM,
    {
      address: LOCAL_ITEM,
      itemId: null,
      d: 'blobbi:cosmetic:local_hat',
      name: 'Local Hat',
      type: 'cosmetic',
      category: 'unknown' as const,
      effects: {},
      action: null,
      stages: [],
      emoji: '🧢',
      image: 'https://example.test/headwear-local.png',
      images: [{ url: 'https://example.test/headwear-local.png' }],
      topics: [],
      slot: 'headwear',
      forms: null,
      source: 'definition' as const,
    },
  ],
]);

/** What a caller would hand over for someone else's Blobbi. */
const SUPPLIED_ACCESSORIES: readonly AccessoryPlacementInput[] = [
  {
    code: 'eyewear-supplied',
    slot: 'eyewear',
    x: 50, y: 45, scale: 1, rot: 0, flipX: false,
    url: 'https://example.test/eyewear-supplied.png',
  },
];

const LOCAL_BLOBBI = {
  id: 'pet-local',
  name: 'Mine',
  stage: 'baby' as const,
  baseColor: '#7ED0A8',
  secondaryColor: '#B7ECD2',
  eyeColor: '#26343F',
};

const REMOTE_VISUAL = {
  stage: 'adult' as const,
  adultType: 'bloomi',
  baseColor: '#F2A0C0',
  secondaryColor: '#FAD4E4',
  name: 'Theirs',
};

vi.mock('@/hooks/useBlobbis', () => ({
  useBlobbis: () => ({ data: [LOCAL_BLOBBI] }),
}));
vi.mock('@/hooks/useBlobbonautProfile', () => ({
  useBlobbonautProfile: () => ({ data: { currentCompanion: 'pet-local' } }),
}));
vi.mock('@/hooks/useCharacterEquipmentContext', () => ({
  useCharacterEquipmentContext: () => ({
    accessories: LOCAL_EQUIPMENT,
    definitionsByAddress: LOCAL_DEFINITIONS,
    hidden: [],
    warnings: [],
    isLoading: false,
    isEmpty: false,
  }),
}));

const { CurrentBlobbiDisplay } = await import('./CurrentBlobbiDisplay');

const wornCodes = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-accessory-code]')]
    .map((el) => el.getAttribute('data-accessory-code'))
    .sort();

describe('accessories follow the visual, not the component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('draws the local companion wearing its own equipment', () => {
    const { container } = render(<CurrentBlobbiDisplay idSuffix="policy-local" />);
    expect(container.querySelector('[data-blobbi-renderer]')).toBeTruthy();
    expect(wornCodes(container)).toEqual([LOCAL_ITEM]);
  });

  it('draws an override visual wearing NOTHING when no accessories are supplied', () => {
    const { container } = render(
      <CurrentBlobbiDisplay idSuffix="policy-override" visualOverride={REMOTE_VISUAL} />,
    );
    // The body still renders — only the borrowed hats are gone.
    expect(container.querySelector('[data-blobbi-renderer]')).toBeTruthy();
    expect(wornCodes(container)).toEqual([]);
  });

  it('draws an override visual wearing exactly the accessories supplied', () => {
    const { container } = render(
      <CurrentBlobbiDisplay
        idSuffix="policy-supplied"
        visualOverride={REMOTE_VISUAL}
        accessoryOverride={SUPPLIED_ACCESSORIES}
      />,
    );
    expect(wornCodes(container)).toEqual(['eyewear-supplied']);
    // And specifically: the local player's hat is not among them.
    expect(wornCodes(container)).not.toContain(LOCAL_ITEM);
  });

  it('ignores accessoryOverride on the local path, so it cannot dress the local Blobbi', () => {
    // Without a `visualOverride` the local companion's own equipment is
    // authoritative. This prop is a description of somebody else's Blobbi; it
    // is not a way to put items on yours.
    const { container } = render(
      <CurrentBlobbiDisplay idSuffix="policy-local-ignore" accessoryOverride={SUPPLIED_ACCESSORIES} />,
    );
    expect(wornCodes(container)).toEqual([LOCAL_ITEM]);
  });

  it('still honors showAccessories={false} on both paths', () => {
    const { container: local } = render(
      <CurrentBlobbiDisplay idSuffix="policy-hide-local" showAccessories={false} />,
    );
    const { container: override } = render(
      <CurrentBlobbiDisplay
        idSuffix="policy-hide-override"
        showAccessories={false}
        visualOverride={REMOTE_VISUAL}
        accessoryOverride={SUPPLIED_ACCESSORIES}
      />,
    );
    expect(wornCodes(local)).toEqual([]);
    expect(wornCodes(override)).toEqual([]);
  });

  it('rear view drops face-only accessories from supplied data too', () => {
    // `eyewear` is face-only, so a Blobbi seen from behind is not wearing it —
    // the same rule the local path has always used, applied to supplied data.
    const { container } = render(
      <CurrentBlobbiDisplay
        idSuffix="policy-rear"
        facing="back"
        visualOverride={REMOTE_VISUAL}
        accessoryOverride={SUPPLIED_ACCESSORIES}
      />,
    );
    expect(wornCodes(container)).toEqual([]);
  });
});

describe('the read-only remote preview cannot leak local equipment', () => {
  it('renders a remote Blobbi with no accessories at all', () => {
    // This is exactly how BlobbiInfoModal drives the preview in `readOnly`
    // mode: an external visual, `showAccessories` true (the inventory tab is
    // not selected), and no accessory data — because the modal never fetched
    // the other player's equipment.
    const { container } = render(
      <CurrentBlobbiDisplay
        idSuffix="preview:remote"
        visualOverride={REMOTE_VISUAL}
        showAccessories
        transparent
      />,
    );
    expect(container.querySelector('[data-blobbi-renderer]')).toBeTruthy();
    expect(wornCodes(container)).toEqual([]);
    expect(container.innerHTML).not.toContain('headwear-local');
  });
});
