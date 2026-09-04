/**
 * The boundaries this phase promised not to cross, asserted against the SOURCE
 * of the feature rather than against its behavior.
 *
 * Behavioral tests prove that today's code does the right thing. These prove
 * that the wrong thing is not reachable from here at all; that no module in
 * the game item tools imports an inventory mutation, that nothing implements
 * Grant or Placement, that no private key is touched, and that `@blobbi/react`
 * still knows nothing about Nostr. Those are properties a future edit could
 * quietly break while every behavioral test kept passing.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TOOLS_LOGIC = join(ROOT, 'src/tools/game-items');
const TOOLS_UI = join(ROOT, 'src/components/tools/game-items');
const RENDERER = join(ROOT, 'packages/blobbi-react/src');

/**
 * Strip comments so these assertions are about CODE, not about prose.
 *
 * Every module in this feature documents the boundary it respects, and several
 * of them name the very symbols asserted against below, "this deliberately
 * does NOT use `parseOfficialItemDefinition`" must not read as a violation.
 * Block comments and whole-line `//` comments are removed; a trailing comment
 * after code survives, which is fine because the point is to catch imports and
 * call sites, and those are never written inside a trailing comment.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*');
    })
    .join('\n');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Feature sources, excluding tests (which legitimately mock what they assert). */
const featureFiles = [...sourceFiles(TOOLS_LOGIC), ...sourceFiles(TOOLS_UI)].filter(
  (file) => !/\.test\.tsx?$/.test(file),
);

/**
 * The Inventory & Equipment Lab (Phase 9.5) is the ONE sanctioned mutation
 * surface inside the tools: an explicitly developer-initiated UI over the two
 * canonical production writers. Every OTHER tools module keeps the original
 * no-mutation rules unchanged, and the lab gets its own, different rules below
 * (canonical writers only, no hand-built events, no legacy equip vocabulary).
 */
const LAB_FILES = new Set([
  'src/tools/game-items/inventory-equipment-lab.ts',
  'src/components/tools/game-items/InventoryEquipmentLab.tsx',
]);

const featureSources = featureFiles.map((file) => ({
  file: file.slice(ROOT.length + 1),
  text: stripComments(readFileSync(file, 'utf8')),
}));

const nonLabSources = featureSources.filter(({ file }) => !LAB_FILES.has(file));
const labSources = featureSources.filter(({ file }) => LAB_FILES.has(file));

describe('the tools never mutate an inventory (outside the sanctioned lab)', () => {
  it('found both lab files (the allowlist is not silently stale)', () => {
    expect(labSources.map((s) => s.file).sort()).toEqual([...LAB_FILES].sort());
  });

  it('imports no inventory mutation hook anywhere outside the lab', () => {
    for (const { file, text } of nonLabSources) {
      expect(text, file).not.toMatch(/useInventoryMutation/);
      expect(text, file).not.toMatch(/useBatchPurchase/);
      expect(text, file).not.toMatch(/usePurchaseItem/);
      expect(text, file).not.toMatch(/useUseItem/);
      expect(text, file).not.toMatch(/useCoinsMutation/);
    }
  });

  it('the lab mutates ONLY through the two canonical production writers', () => {
    const labUi = labSources.find((s) => s.file.endsWith('.tsx'))!;
    // The UI file imports both writers; the pure module imports neither.
    expect(labUi.text).toMatch(/from '@\/inventory\/useInventoryMutation'/);
    expect(labUi.text).toMatch(/from '@\/placement\/useEquipmentMutation'/);
    for (const { file, text } of labSources) {
      // No third writer, no direct publisher, no shop/care mutations.
      expect(text, file).not.toMatch(/useNostrPublish/);
      expect(text, file).not.toMatch(/useBatchPurchase|usePurchaseItem|useUseItem|useCoinsMutation/);
      expect(text, file).not.toMatch(/buildGameInventoryEvent|buildGameItemPlacementEvent/);
      // Only the player's own state: no foreign pubkey parameter anywhere.
      expect(text, file).not.toMatch(/ownerPubkey\s*:/);
    }
    const labLogic = labSources.find((s) => s.file.endsWith('.ts'))!;
    expect(labLogic.text).not.toMatch(/useInventoryMutation\(|useEquipmentMutation\(/);
  });

  it('never builds or publishes a kind:31633 event', () => {
    for (const { file, text } of featureSources) {
      expect(text, file).not.toMatch(/buildGameInventoryEvent/);
      expect(text, file).not.toMatch(/KIND_GAME_INVENTORY\b(?!.*type)/);
    }
  });
});

describe('no Grant and no Placement implementation', () => {
  it('never references the grant marker or grant tags', () => {
    for (const { file, text } of featureSources) {
      expect(text, file).not.toMatch(/GRANT_MARKER/);
      expect(text, file).not.toMatch(/BuildGameInventoryGrantInput/);
      expect(text, file).not.toMatch(/grantEventIds/);
    }
  });

  it('never writes an equip tag or a placement record outside the lab', () => {
    for (const { file, text } of nonLabSources) {
      // The preview holds x/y/scale in local state; what must not exist is any
      // path that serializes them into an event.
      expect(text, file).not.toMatch(/['"]equip['"]/);
      expect(text, file).not.toMatch(/EquipTag/);
      expect(text, file).not.toMatch(/EquipmentConfig/);
      expect(text, file).not.toMatch(/useAccessoryManagement/);
    }
    // The lab EQUIPS (that is its job): through the canonical kind:31634
    // writer only, still never through the deleted legacy vocabulary.
    for (const { file, text } of labSources) {
      expect(text, file).not.toMatch(/EquipTag/);
      expect(text, file).not.toMatch(/EquipmentConfig/);
      expect(text, file).not.toMatch(/useAccessoryManagement/);
    }
  });
});

describe('no private key handling', () => {
  it('never mentions a secret key in any form', () => {
    for (const { file, text } of featureSources) {
      expect(text, file).not.toMatch(/\bnsec\b/i);
      expect(text, file).not.toMatch(/privateKey|privkey|secretKey/i);
      expect(text, file).not.toMatch(/generateSecretKey|getPublicKey\(/);
    }
  });

  it('signs only through the account object the app already owns', () => {
    const signingSites = featureSources.filter(({ text }) => text.includes('signEvent'));
    expect(signingSites.map((s) => s.file)).toEqual([
      'src/tools/game-items/usePublishItemDefinition.ts',
    ]);
    expect(signingSites[0].text).toMatch(/user\.signer\.signEvent/);
  });
});

describe('publishing is always explicit', () => {
  it('has exactly one module that publishes an item definition', () => {
    const publishers = featureSources.filter(({ text }) =>
      /publishToRelays\(/.test(text),
    );
    expect(publishers.map((p) => p.file)).toEqual([
      'src/tools/game-items/usePublishItemDefinition.ts',
    ]);
  });

  it('never triggers publishing from a form change, blur or shortcut', () => {
    for (const { file, text } of featureSources) {
      expect(text, file).not.toMatch(/onBlur=\{[^}]*publish/i);
      expect(text, file).not.toMatch(/onChange=\{[^}]*publish/i);
      expect(text, file).not.toMatch(/addEventListener\(\s*['"]keydown/);
    }
  });

  it('reaches the publish mutation only from the review dialog’s action', () => {
    const studio = featureSources.find(
      (s) => s.file === 'src/components/tools/game-items/ItemStudio.tsx',
    );
    expect(studio).toBeDefined();
    // One call site, passed to the dialog as its explicit `onPublish` action.
    expect(studio!.text.match(/publish\.mutateAsync/g)).toHaveLength(1);
    expect(studio!.text).toMatch(/onPublish=\{/);
  });
});

describe('no page reload is ever forced', () => {
  it('never calls window.location.reload', () => {
    for (const { file, text } of featureSources) {
      expect(text, file).not.toMatch(/location\.reload/);
    }
  });
});

describe('@blobbi/react stays protocol-agnostic', () => {
  const rendererSources = sourceFiles(RENDERER)
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .map((file) => ({
      file: file.slice(ROOT.length + 1),
      text: stripComments(readFileSync(file, 'utf8')),
    }));

  it('learns nothing about item definitions, addresses or markers', () => {
    for (const { file, text } of rendererSources) {
      expect(text, file).not.toMatch(/@nostr-games\/inventory/);
      expect(text, file).not.toMatch(/GameItemDefinition/);
      expect(text, file).not.toMatch(/31632|31633/);
      expect(text, file).not.toMatch(/@\/inventory/);
      expect(text, file).not.toMatch(/@\/tools/);
    }
  });

  it('is never imported by the tools' + ' pure logic layer', () => {
    // The renderer belongs to the UI. Pulling it into the domain layer would
    // put React in the middle of event building.
    // TYPE-ONLY imports are the whole exemption: `import type` is erased at
    // compile time, so nothing about the renderer reaches the emitted domain
    // layer. Two modules hold the exemption, the preview model and the lab's
    // pure half (slot/effect-id types): and both are asserted to use the
    // `import type` form only.
    const TYPE_ONLY_EXEMPT = ['preview-model.ts', 'inventory-equipment-lab.ts'];
    for (const file of sourceFiles(TOOLS_LOGIC).filter((f) => !/\.test\.tsx?$/.test(f))) {
      const text = stripComments(readFileSync(file, 'utf8'));
      if (TYPE_ONLY_EXEMPT.some((name) => file.endsWith(name))) continue;
      expect(text, file).not.toMatch(/from '@blobbi\/react'/);
    }
    for (const name of TYPE_ONLY_EXEMPT) {
      const text = stripComments(readFileSync(join(TOOLS_LOGIC, name), 'utf8'));
      expect(text, name).toMatch(/import type \{[^}]*\} from '@blobbi\/react'/);
      expect(text, name).not.toMatch(/^import \{[^}]*\} from '@blobbi\/react'/m);
    }
  });

  it('cannot reach the renderer through the UI layer either', () => {
    // The rule above is written against import TEXT, so it would miss a domain
    // module that imported a UI module which imports the renderer. The effect
    // vocabulary (`components/tools/game-items/effect-vocabulary.ts`) is exactly
    // such a module; it exists in the UI layer BECAUSE the domain layer may not
    // have it: so the arrow it depends on is asserted here rather than assumed.
    for (const file of sourceFiles(TOOLS_LOGIC).filter((f) => !/\.test\.tsx?$/.test(f))) {
      const text = stripComments(readFileSync(file, 'utf8'));
      expect(text, file).not.toMatch(/from '@\/components\//);
    }
  });

  it('gives the effect vocabulary to the UI layer, and the slot names to both', () => {
    // The split this phase chose: twelve effect IDS come from the renderer and
    // therefore live in the UI layer; the four effect SLOT names are item-format
    // vocabulary and are written out in the domain layer, guarded against drift
    // by `effect-item-authoring.test.ts`.
    const vocabulary = stripComments(
      readFileSync(join(TOOLS_UI, 'effect-vocabulary.ts'), 'utf8'),
    );
    expect(vocabulary).toMatch(/from '@blobbi\/react'/);

    const formModel = stripComments(readFileSync(join(TOOLS_LOGIC, 'item-form-model.ts'), 'utf8'));
    expect(formModel).not.toMatch(/from '@blobbi\/react'/);
    expect(formModel).toMatch(/EFFECT_SLOT_SUGGESTIONS/);

    const validation = stripComments(readFileSync(join(TOOLS_LOGIC, 'validation.ts'), 'utf8'));
    expect(validation).not.toMatch(/from '@blobbi\/react'/);
  });
});

describe('the game’s trust boundary is untouched', () => {
  it('does not import the official-issuer parser, which belongs to the catalog', () => {
    // The tools deliberately parse WITHOUT an issuer filter so they can display
    // third-party definitions. What they must not do is feed that into the
    // catalog's own resolution path.
    for (const { file, text } of featureSources) {
      expect(text, file).not.toMatch(/resolveItemDefinition\b/);
      expect(text, file).not.toMatch(/parseOfficialItemDefinition/);
    }
  });
});
