/**
 * The legacy accessory system is GONE, and stays gone.
 *
 * This is a source-level guard rather than a behavioral test, because the
 * failure it prevents is a reintroduction: someone restores a helper "just for
 * one screen", and Island quietly has two equipment systems again; one the
 * renderer reads and one the editor writes, which is exactly the split-brain
 * this migration removed.
 *
 * What is asserted, over production modules only:
 *
 *   1. no module reads or writes kind:11125 `inv` accessory ownership;
 *   2. no module reads or writes kind:31124 `equip` tags;
 *   3. the deleted modules are still deleted;
 *   4. equipment flows through exactly one write path;
 *   5. nothing builds an accessory asset path from an id or code prefix.
 *
 * Tests are excluded from the sweep: a test that proves an `equip` tag is NOT
 * written has to name the tag to look for it.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

const PRODUCTION_FILES = sourceFiles(SRC);
const rel = (file: string) => file.replace(`${ROOT}/`, '');

/** Production files whose source matches `pattern`. */
function matching(pattern: RegExp): string[] {
  return PRODUCTION_FILES.filter((file) =>
    pattern.test(readFileSync(file, 'utf8')),
  )
    .map(rel)
    .sort();
}

describe('the deleted modules are still deleted', () => {
  const deleted = [
    'src/components/blobbi/hooks/useAccessoryManagement.ts',
    'src/components/blobbi/AccessoryInventoryUI.tsx',
    'src/components/blobbi/AccessoryInventoryGrid.tsx',
    'src/components/blobbi/AccessoryEditPanel.tsx',
    'src/components/blobbi/AccessoryUsageModal.tsx',
    'src/components/blobbi/AccessoryRemovalModal.tsx',
    'src/components/blobbi/AccessoryOverlay.tsx',
    'src/components/blobbi/DebugAccessoriesModal.tsx',
    'src/components/blobbi/lib/accessory-utils.ts',
    'src/components/blobbi/lib/accessory-types.ts',
    'src/components/blobbi/lib/island-accessory-sources.ts',
    'src/inventory/accessory-item-identity.ts',
    'src/inventory/useAccessoryItemDefinitions.ts',
    'src/components/AccessoryItemDefinitionsProvider.tsx',
    'src/contexts/AccessoryItemDefinitionsContext.ts',
    'src/hooks/useAccessoryItemDefinitionsContext.ts',
  ];

  for (const path of deleted) {
    it(`does not exist: ${path}`, () => {
      expect(existsSync(join(ROOT, path))).toBe(false);
    });
  }
});

describe('no production module speaks the legacy equipment vocabulary', () => {
  it('never parses or writes a kind:11125 `inv` accessory tag', () => {
    expect(
      matching(/\b(parseInvTags|updateInvTags|mergeInventoryTags|updateInventoryQuantity)\b/),
    ).toEqual([]);
  });

  it('never parses or writes a kind:31124 `equip` tag', () => {
    expect(
      matching(/\b(parseEquipTag|parseEquipTags|updateEquipTags|createEquipTag)\b/),
    ).toEqual([]);
  });

  it('never builds an `equip` TAG ARRAY on any event', () => {
    // Catches a hand-rolled tag that avoids the deleted helpers. Matches a tag
    // array literal (`['equip', …]`) rather than the string anywhere, because
    // `mode: 'equip'` is the kind:31634 placement mode and is correct.
    expect(matching(/\[\s*["']equip["']\s*,/)).toEqual([]);
  });

  it('never reads the dead accessory query keys', () => {
    expect(matching(/['"]accessory-(equipment|inventory)['"]/)).toEqual([]);
  });

  it('never infers a slot or an artwork path from an item code', () => {
    expect(matching(/\b(inferSlotFromCode|generateAccessoryUrl|SLOT_PREFIXES)\b/)).toEqual(
      [],
    );
  });

  it('keeps no legacy accessory code mapping', () => {
    expect(
      matching(/\b(ACCESSORY_CODE_TO_OFFICIAL_ITEM_D|accessoryItemAddress|legacyCode)\b/),
    ).toEqual([]);
  });
});

describe('equipment has exactly one read path and one write path', () => {
  it('is written only by the placement mutation', () => {
    // Every other module must go through `useEquipmentMutation`; only it may
    // build the event.
    // Since Phase 9.5b the dev harness is simulation-only, so the writer is
    // now the SOLE builder of equipment events.
    expect(matching(/buildEquipmentTemplate/)).toEqual([
      'src/placement/useEquipmentMutation.ts',
    ]);
  });

  it('is read only through the placement state module', () => {
    expect(matching(/KIND_GAME_ITEM_PLACEMENT/)).toEqual([
      'src/inventory/package.ts',
      'src/placement/usePlacementState.ts',
      // Names the kind in the canonical protocol registry; reads nothing.
      'src/protocol/event-registry.ts',
    ]);
  });

  it('renders from the shared equipment context, never from a second query', () => {
    const display = readFileSync(
      join(SRC, 'components/blobbi/CurrentBlobbiDisplay.tsx'),
      'utf8',
    );
    expect(display).toContain('useCharacterEquipmentContext');
    expect(display).not.toMatch(/usePlacementState|useIslandInventory|useItemCatalog/);
  });
});
