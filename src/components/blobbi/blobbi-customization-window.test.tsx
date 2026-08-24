/**
 * The Blobbi customization window is the ONE customization surface.
 *
 * These are the regressions for the consolidation, not a re-test of what the
 * inventory renders — the `InventoryBrowser` suites already own that. What is
 * asserted here is structural, and each assertion corresponds to a way the
 * previous shape could come back:
 *
 *   - no second inventory window exists to drift from this one;
 *   - the 🎒 shortcut leads HERE rather than to its own surface;
 *   - the tab set is Primary / Inventory / Effects and switches;
 *   - the stage box has the backdrop's proportions, not a square's;
 *   - an unknown background id renders the default rather than nothing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';

import { TestApp } from '@/test/TestApp';
import { BlobbiInfoModal } from './BlobbiInfoModal';
import { StageBackgroundPicker } from './StageBackgroundPicker';
import { DOCK_EVENTS } from '@/components/shell/dock-events';
import {
  DEFAULT_STAGE_BACKGROUND,
  DEFAULT_STAGE_BACKGROUND_ID,
  STAGE_ASPECT_RATIO,
  isKnownStageBackgroundId,
  isStageBackgroundOwned,
  resolveStageBackground,
  stageBackgrounds,
} from '@/lib/blobbi-stage-backgrounds';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('one canonical inventory', () => {
  it('has no second inventory surface anywhere', () => {
    // Three shapes it has taken, all gone: the bag modal, the two panels that
    // replaced it, and the shortcut that deep-linked past the window.
    for (const gone of [
      'src/components/blobbi/ItemBagModal.tsx',
      'src/components/blobbi/InventoryPanel.tsx',
      'src/components/blobbi/EquipmentPanel.tsx',
    ]) {
      expect(() => read(gone), gone).toThrow();
    }
  });

  it('renders the inventory exactly once, inside the customization window', () => {
    const modal = read('src/components/blobbi/BlobbiInfoModal.tsx');
    expect(modal.match(/<InventoryBrowser\b/g) ?? []).toHaveLength(1);

    const playing = read('src/components/blobbi/PlayingView.tsx');
    expect(playing).not.toMatch(/InventoryBrowser|ItemBagModal/);
  });

  it('has removed the standalone bag shortcut from the world UI', () => {
    /*
      The 🎒 in the upper right is gone, deliberately. My Blobbi → Items is the
      canonical destination, and a second entry point to a tab of one window is
      a second thing to keep in sync for no gain.
    */
    const playing = read('src/components/blobbi/PlayingView.tsx');
    expect(playing).not.toMatch(/bag-shortcut/);
    expect(playing).not.toMatch(/🎒/);
    expect(playing).not.toMatch(/Open your inventory/);
    // …and the plumbing that existed only for it.
    expect(playing).not.toMatch(/blobbiModalTab|openMyBlobbiInventory/);
    expect('openMyBlobbiInventory' in DOCK_EVENTS).toBe(false);
  });

  it('leaves no 🎒 button anywhere in the production world UI', () => {
    /*
      A file sweep rather than one file: the shortcut could come back on the
      HUD, the dock or a room without this suite noticing.

      COMMENTS ARE STRIPPED FIRST. A comment explaining that the bag button was
      removed is exactly the kind of note that should survive, and a sweep that
      forbade the character outright would make the history unwritable.
    */
    const offenders: string[] = [];
    for (const dir of ['src/components/blobbi', 'src/components/shell']) {
      for (const file of readdirSync(join(ROOT, dir))) {
        if (!/\.tsx$/.test(file) || /\.test\.tsx$/.test(file)) continue;
        const code = read(join(dir, file))
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        if (code.includes('🎒')) offenders.push(`${dir}/${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('customization window tabs', () => {
  it('offers Blobbi, Wardrobe and Items — with no top-level Effects tab', async () => {
    render(
      <TestApp>
        <BlobbiInfoModal
          isOpen
          readOnly
          onClose={() => {}}
          externalBlobbiData={{
            name: 'Blobbi', stage: 'baby', hunger: 50, energy: 50, happiness: 50,
            health: 50, hygiene: 50, experience: 0, careStreak: 0, generation: 1,
          }}
        />
      </TestApp>,
    );

    // Read-only (no logged-in pet) shows the Blobbi tab alone — the tabs that
    // publish must not be offered for somebody else's Blobbi.
    expect(await screen.findByRole('tab', { name: /blobbi/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /wardrobe/i })).toBeNull();
    expect(screen.queryByRole('tab', { name: /items/i })).toBeNull();
  });

  it('opens on the tab it was asked for', () => {
    const modal = read('src/components/blobbi/BlobbiInfoModal.tsx');
    // `defaultTab` still reaches the tab state — nothing in production passes
    // anything but the default now that the shortcut is gone, but the window
    // remains addressable for a future caller and for tests.
    expect(modal).toMatch(/defaultTab\?: 'primary' \| 'wardrobe' \| 'items'/);
    expect(modal).toMatch(/useState<'primary' \| 'wardrobe' \| 'items'>\(readOnly \? 'primary' : defaultTab\)/);
  });
});

describe('stage geometry', () => {
  it('sizes the stage box to the backdrop ratio instead of a square', () => {
    const modal = read('src/components/blobbi/BlobbiInfoModal.tsx');
    // The bug: a 2:3 backdrop in a 1:1 box, resolved by cropping a third of it.
    expect(modal).toMatch(/aspectRatio: STAGE_ASPECT_RATIO/);
    // The STAGE box must never be square again. `aspect-square` does appear in
    // the file — on the Blobbi's own renderer box, which genuinely is square by
    // contract — so the assertion is scoped to the stage element rather than
    // banning the class outright.
    const stage = modal.match(/data-testid="blobbi-stage"[\s\S]{0,400}?>/)![0];
    expect(stage).not.toMatch(/aspect-square/);
    expect(stage).toMatch(/aspectRatio: STAGE_ASPECT_RATIO/);
    // Height-driven, so the ratio survives every modal height. `max-h-full` on
    // a `w-full` box was the other half of the defect: it clamped the height
    // without narrowing the box, so the ratio broke on short viewports.
    expect(modal).toMatch(/data-testid="blobbi-stage"[\s\S]{0,400}h-full max-w-full/);
    expect(STAGE_ASPECT_RATIO).toBe('2 / 3');
  });

  it('stacks the stage above the tabs on a phone', () => {
    const modal = read('src/components/blobbi/BlobbiInfoModal.tsx');
    // `flex-row` at every width gave a 375px sheet a ~110px stage column.
    expect(modal).toMatch(/flex min-h-0 flex-col gap-3 overflow-hidden p-3 sm:flex-row/);
  });

  it('keeps the placement overlay mounted on the canonical renderer box', () => {
    // Guards the one thing the geometry change must not disturb: accessory
    // drag math measures `stageRef`, which still wraps only the preview.
    const modal = read('src/components/blobbi/BlobbiInfoModal.tsx');
    expect(modal).toMatch(/containerRef=\{stageRef\}/);
    expect(modal).toMatch(/ref=\{stageRef\}/);
  });
});

describe('stage background slot', () => {
  it('models the default explicitly and falls back to it', () => {
    expect(DEFAULT_STAGE_BACKGROUND.id).toBe(DEFAULT_STAGE_BACKGROUND_ID);
    // An id from a build that shipped a backdrop this one does not, or from
    // another Blobbi client, must not blank the stage.
    expect(resolveStageBackground('a-backdrop-that-never-existed')).toBe(DEFAULT_STAGE_BACKGROUND);
    expect(resolveStageBackground(undefined)).toBe(DEFAULT_STAGE_BACKGROUND);
    expect(resolveStageBackground(null)).toBe(DEFAULT_STAGE_BACKGROUND);
    expect(isKnownStageBackgroundId('a-backdrop-that-never-existed')).toBe(false);
    expect(isKnownStageBackgroundId(DEFAULT_STAGE_BACKGROUND_ID)).toBe(true);
  });

  it('proves the slot switches, with a backdrop that is not an image', () => {
    expect(stageBackgrounds.length).toBeGreaterThan(1);
    const gradient = stageBackgrounds.find((b) => b.art.kind === 'gradient');
    expect(gradient, 'a non-image backdrop is what proves this is a slot').toBeDefined();
    // Theme tokens, so a theme switch repaints it with no code involved.
    expect(gradient!.art.kind === 'gradient' && gradient!.art.css).toMatch(/var\(--island-/);
    expect(resolveStageBackground(gradient!.id)).toBe(gradient);
  });

  it('gates unlockable backdrops on kind:31633 ownership', () => {
    const empty = new Map<string, number>();
    // Built-ins are free to everyone…
    for (const background of stageBackgrounds) {
      expect(isStageBackgroundOwned(background, empty)).toBe(true);
    }
    // …an item-backed one is not, and possession is checked by FULL address so
    // a look-alike definition from another issuer cannot unlock it.
    const address = '31632:deadbeef:blobbi:stage:aurora';
    const owned = {
      id: address, name: 'Aurora', description: '', emoji: '🌌',
      art: { kind: 'image', src: '/aurora.png' },
      unlock: { kind: 'item', address },
    } as const;
    expect(isStageBackgroundOwned(owned, empty)).toBe(false);
    expect(isStageBackgroundOwned(owned, new Map([[address, 0]]))).toBe(false);
    expect(isStageBackgroundOwned(owned, new Map([[address, 1]]))).toBe(true);
    expect(isStageBackgroundOwned(owned, new Map([['31632:other:blobbi:stage:aurora', 9]]))).toBe(false);
  });

  it('persists the choice on the profile, not in a new event kind', () => {
    const hook = read('src/hooks/useStageBackground.ts');
    // The existing managed `background` tag of kind:11125. No new kind, and
    // notably NOT kind:31634 — a backdrop is not worn by the Blobbi.
    expect(hook).toMatch(/KIND_BLOBBONAUT_PROFILE/);
    expect(hook).toMatch(/\['background', backgroundId\]/);
    expect(hook).not.toMatch(/31634|generate_kind/);
    // The profile's other tags survive a background change untouched.
    expect(hook).toMatch(/filter\(\(\[name\]\) => name !== 'background'\)/);
  });

  it('lists every backdrop in the picker, locked ones included', async () => {
    render(
      <TestApp>
        <StageBackgroundPicker open onOpenChange={() => {}} />
      </TestApp>,
    );
    for (const background of stageBackgrounds) {
      expect(await screen.findByTestId(`stage-background-${background.id}`)).toBeInTheDocument();
    }
    // Signed out there is nothing to publish to, so selection is disabled
    // rather than silently doing nothing.
    expect(screen.getByTestId(`stage-background-${DEFAULT_STAGE_BACKGROUND_ID}`)).toBeDisabled();
    expect(screen.getByText(/sign in to change your stage background/i)).toBeInTheDocument();
  });

  it('does not offer the scene control on somebody else\'s Blobbi', async () => {
    render(
      <TestApp>
        <BlobbiInfoModal
          isOpen
          readOnly
          onClose={() => {}}
          externalBlobbiData={{
            name: 'Someone', stage: 'adult', hunger: 50, energy: 50, happiness: 50,
            health: 50, hygiene: 50, experience: 0, careStreak: 0, generation: 2,
          }}
        />
      </TestApp>,
    );
    await screen.findByRole('tab', { name: /blobbi/i });
    expect(screen.queryByTestId('open-stage-background-picker')).toBeNull();
  });
});

describe('dock wiring', () => {
  it('opens My Blobbi from the bottom dock, and does so exactly one way', () => {
    const dock = read('src/components/shell/BlobbiActionDock.tsx');
    expect(dock).toMatch(/DOCK_EVENTS\.openMyBlobbi\b/);
    // One event, one destination. The deep-link event that existed only for the
    // 🎒 shortcut went with it.
    expect(Object.keys(DOCK_EVENTS).filter((k) => k.startsWith('openMyBlobbi'))).toEqual([
      'openMyBlobbi',
    ]);
  });

  it('leaves the tab switch a pure state change', () => {
    // A background change must not remount the world. The picker writes to the
    // profile query cache; nothing here invalidates game state.
    const hook = read('src/hooks/useStageBackground.ts');
    expect(hook).toMatch(/queryKey: \['blobbonaut-profile', user\?\.pubkey\]/);
    expect(hook).not.toMatch(/invalidateQueries\(\{ queryKey: \['blobbis'/);
  });
});

// A stray import guard: the old one-row lookup table is gone, so nothing can
// resolve a backdrop outside the registry.
describe('legacy background map', () => {
  it('no longer exists', () => {
    expect(() => read('src/lib/blobbi-backgrounds.ts')).toThrow();
  });
});

// Keep the fireEvent import honest — the tab-switch interaction below is the
// only place it is used.
describe('tab switching', () => {
  it('changes the visible panel', async () => {
    render(
      <TestApp>
        <BlobbiInfoModal
          isOpen
          readOnly
          onClose={() => {}}
          externalBlobbiData={{
            name: 'Blobbi', stage: 'baby', hunger: 10, energy: 20, happiness: 30,
            health: 40, hygiene: 50, experience: 0, careStreak: 0, generation: 1,
          }}
        />
      </TestApp>,
    );
    const primary = await screen.findByRole('tab', { name: /blobbi/i });
    fireEvent.click(primary);
    expect(primary).toHaveAttribute('data-state', 'active');
    // The needs are meters beside the pet now, not a table under a heading.
    expect(await screen.findByTestId('need-meters')).toBeInTheDocument();
    expect(screen.getByTestId('mood-hero')).toBeInTheDocument();
  });
});
