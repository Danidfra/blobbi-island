/**
 * The My Blobbi window's shape after the second visual pass.
 *
 * Three claims, each of which the previous shape could quietly reverse:
 *
 *   1. the tabs are Blobbi / Wardrobe / Items, and Effects is not one of them;
 *   2. wearables live in the Wardrobe and nowhere else, carried items in Items;
 *   3. the Blobbi is sized as a FRACTION of its stage, so it stays the
 *      protagonist at every viewport — and its accessories scale with it,
 *      because they are percentages of the same box.
 *
 * Claim 3 is asserted against the source and the contract rather than through
 * jsdom: jsdom has no layout, so a rendered `h-[46%]` measures zero and any
 * pixel assertion would be theatre. What CAN be pinned is that the box is a
 * percentage of a square parent, that the overlay measures that same element,
 * and that the renderer's own geometry is percentage-based — which together are
 * exactly why the scaling is safe.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render, screen } from '@testing-library/react';

import { TestApp } from '@/test/TestApp';
import { BlobbiInfoModal } from './BlobbiInfoModal';
import { ACCESSORY_BASE_RATIO } from '@blobbi/react';

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const modal = read('src/components/blobbi/BlobbiInfoModal.tsx');

describe('tab architecture', () => {
  it('is Blobbi / Wardrobe / Items', () => {
    expect(modal).toMatch(/<TabsTrigger value="primary"/);
    expect(modal).toMatch(/<TabsTrigger value="wardrobe"/);
    expect(modal).toMatch(/<TabsTrigger value="items"/);
    expect(modal).toMatch(/Wardrobe\s*\n?\s*<\/TabsTrigger>/);
  });

  it('has no top-level Effects tab', () => {
    /*
      Effects became a section of the Wardrobe. An effect is plainly a kind of
      appearance, and a three-tab window that spent a third of its primary
      navigation on four aura slots was over-weighting them.
    */
    expect(modal).not.toMatch(/<TabsTrigger value="effects"/);
    expect(modal).not.toMatch(/<EffectsPanel/);
    // It is reachable — through the wardrobe, which does mount it.
    expect(read('src/components/blobbi/inventory/WardrobePanel.tsx')).toMatch(/<EffectsPanel/);
  });

  it('shows a read-only Blobbi its Blobbi tab alone', async () => {
    render(
      <TestApp>
        <BlobbiInfoModal
          isOpen
          readOnly
          onClose={() => {}}
          externalBlobbiData={{
            name: 'Luna', stage: 'adult', hunger: 70, energy: 40, happiness: 90,
            health: 80, hygiene: 20, experience: 1200, careStreak: 3, generation: 2,
          }}
        />
      </TestApp>,
    );

    expect(await screen.findByRole('tab', { name: /blobbi/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /wardrobe/i })).toBeNull();
    expect(screen.queryByRole('tab', { name: /items/i })).toBeNull();
  });

  it('shows the pet card, not a stat table', async () => {
    render(
      <TestApp>
        <BlobbiInfoModal
          isOpen
          readOnly
          onClose={() => {}}
          externalBlobbiData={{
            name: 'Luna', stage: 'adult', hunger: 70, energy: 40, happiness: 90,
            health: 80, hygiene: 20, experience: 1200, careStreak: 3, generation: 2,
            personality: 'Curious',
          }}
        />
      </TestApp>,
    );

    // Every fact the old two-column list carried is still here, in its new home.
    expect(await screen.findByTestId('mood-hero')).toBeInTheDocument();
    expect(screen.getByTestId('need-meters')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(5);
    expect(screen.getByTestId('progression')).toHaveTextContent('1,200');
    expect(screen.getByTestId('progression')).toHaveTextContent('Gen 2');
    expect(screen.getByTestId('trait-chips')).toHaveTextContent('Curious');
  });
});

describe('what lives where', () => {
  it('gives the Wardrobe the wearables and Items everything else', () => {
    // One collection model backs both; these are the lenses.
    expect(read('src/components/blobbi/inventory/WardrobePanel.tsx')).toMatch(
      /categories=\{\['wearable'\]\}/,
    );
    expect(modal).toMatch(
      /const ITEM_CATEGORIES: readonly CollectionCategory\[\] = \['food', 'toy', 'care', 'currency'\]/,
    );
  });

  it('keeps the wardrobe halves on one segmented control, not nested tabs', () => {
    const wardrobe = read('src/components/blobbi/inventory/WardrobePanel.tsx');
    // Two levels of tab chrome inside a modal is the nested-tab hell this
    // deliberately avoids: the strip is buttons with tab semantics, and there
    // is no second `<Tabs>`.
    expect(wardrobe).toMatch(/role="tablist"/);
    // Comments stripped: the file's own docblock explains why it is NOT a
    // nested `<Tabs>`, and that explanation should stay writable.
    const code = wardrobe.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/<Tabs\b/);
    expect(wardrobe).toMatch(/data-testid=\{`wardrobe-\$\{key\}`\}/);
    expect(wardrobe).toMatch(/key: 'wearables'/);
    expect(wardrobe).toMatch(/key: 'effects'/);
  });

  it('arms the placement overlay from the Wardrobe, not from Items', () => {
    expect(modal).toMatch(/selectedTab === 'wardrobe' && \(/);
    // And the Blobbi keeps wearing what it wears while you dress it — that is
    // the feedback loop.
    expect(modal).toMatch(/showAccessories\s*\n/);
  });
});

describe('the Blobbi owns its stage', () => {
  it('sizes the renderer box as a fraction of the stage, not in pixels', () => {
    /*
      THE FIX. It was `size="xl"` — 128 real pixels inside a ~540px-tall desktop
      stage, under a quarter of the height, so the backdrop read as the subject.
      A fraction also removes the need for a viewport breakpoint: the same rule
      holds on a phone and on a desktop.
    */
    expect(modal).toMatch(/ref=\{stageRef\}\s+className="relative aspect-square h-\[46%\]"/);
    expect(modal).toMatch(/boxClassName="h-full w-full"/);
  });

  it('keeps the overlay measuring the same element the renderer fills', () => {
    // `stageRef` IS the box now rather than a shrink-wrap around it, so the
    // overlay's percentage space is the box by construction.
    expect(modal).toMatch(/containerRef=\{stageRef\}/);
    const preview = read('src/components/blobbi/CurrentBlobbiPreview.tsx');
    expect(preview).toMatch(/boxClassName/);
  });

  it('scales accessories and effects with the Blobbi, as one unit', () => {
    /*
      Why resizing the box is safe: everything the renderer paints is already a
      percentage OF the box. Accessory x/y are percentages, accessory size is a
      fixed fraction, and effect shapes are percentage polygons. No
      accessory-by-accessory compensation exists, or is needed.
    */
    expect(ACCESSORY_BASE_RATIO).toBeGreaterThan(0);
    expect(ACCESSORY_BASE_RATIO).toBeLessThan(1);

    const renderer = read('packages/blobbi-react/src/BlobbiRendererView.tsx');
    expect(renderer).toMatch(/width: ACCESSORY_BASE_PERCENT/);
    expect(renderer).toMatch(/height: ACCESSORY_BASE_PERCENT/);

    const overlay = read('src/components/blobbi/PlacementOverlay.tsx');
    // Drag maths is rect-relative, so a bigger box yields the same percentages.
    expect(overlay).toMatch(/rect\.width\) \* 100/);
    expect(overlay).toMatch(/rect\.height\) \* 100/);
  });

  it('keeps the stage portrait, and STABLE across every tab', () => {
    const stage = modal.match(/data-testid="blobbi-stage"[\s\S]{0,400}?>/)![0];
    expect(stage).toMatch(/aspectRatio: STAGE_ASPECT_RATIO/);
    expect(stage).not.toMatch(/aspect-square/);

    /*
      ONE size, every tab. The density pass stepped the stage down on Items
      (24%/22%, 18dvh) and manual review showed what that looks like: switching
      tabs visibly squashes the Blobbi into the corner. The stage column now
      carries a single static class string — no conditional on the selected
      tab, and no width/height transition, because a stage that eases between
      sizes is a stage that changes size.
    */
    const column = modal.match(/data-testid="blobbi-stage-column"[\s\S]{0,1600}?className=("[^"]*"|\{[\s\S]*?\})\n/)![1];
    expect(column).toMatch(/sm:w-\[32%\] lg:w-\[30%\]/);
    expect(column).toMatch(/h-\[26dvh\]/);
    expect(column).not.toMatch(/selectedTab/);
    expect(column).not.toMatch(/transition-\[width/);
    expect(modal).not.toMatch(/sm:w-\[24%\]|lg:w-\[22%\]|h-\[18dvh\]/);
  });

  it('does not touch the world renderer', () => {
    // The size table is the world's contract. Nothing here changed it.
    const table = read('packages/blobbi-react/src/blobbi-render-size.ts');
    expect(table).toMatch(/xl: 128/);
    expect(table).toMatch(/lg: 96/);
    // And the modal still declares the canonical token; only the BOX is sized.
    expect(modal).toMatch(/size="xl"/);
  });
});
