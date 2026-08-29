/**
 * ISLAND-SIDE package boundary (Phase 5).
 *
 * The renderer now lives in `@blobbi/react`. That package proves its own purity
 * (`packages/blobbi-react/src/package-purity.test.ts` — it cannot reach a relay,
 * a user, a world or an asset path). What THIS file proves is the half that
 * lives on the Island side of the line, and that no amount of package hygiene
 * can guarantee:
 *
 *  1. There is exactly ONE renderer implementation, and it is the package's.
 *     A local re-implementation would compile, pass every behavioral test, and
 *     silently fork the drawing — so its absence is asserted directly.
 *  2. Island talks to the package through its public entry point, not through
 *     its file layout.
 *  3. The dependency arrow between the actor and the renderer points ONE way.
 *  4. Remote rendering never routes through the local-player wrapper, and the
 *     local wrapper is the only place local-companion data enters.
 *  5. The editor overlay shares the package's coordinate space instead of
 *     restating it.
 *
 * Import statements are matched, not free text, so the prose in these modules —
 * which discusses `useAccessoryManagement` and `BlobbiActor` at length — does
 * not trip the check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ISLAND = join(ROOT, 'src');
const PACKAGE = 'packages/blobbi-react';

/** Every module specifier actually imported (static, dynamic, or re-exported). */
function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers = new Set<string>();
  const patterns = [
    /\bimport\s+(?:[\s\S]*?)\bfrom\s*['"]([^'"]+)['"]/g,
    /\bexport\s+(?:[\s\S]*?)\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const ISLAND_FILES = sourceFiles(ISLAND);
const rel = (file: string) => file.replace(`${ROOT}/`, '');

describe('exactly one renderer implementation exists, and Island consumes it', () => {
  it('keeps no second copy of the renderer, the model, or the artwork in src/', () => {
    // The failure mode this guards against is not "somebody deletes the
    // package"; it is "somebody copies a file back into src/ to avoid an
    // import, and the two drift". Names, not contents, because a fork always
    // starts as an exact copy.
    const forbiddenBasenames = [
      'BlobbiRendererView.tsx',
      'blobbi-render-model.ts',
      'blobbi-render-size.ts',
      'accessory-normalize.ts',
      'loadBlobbiSvg.ts',
      'load-blobbi-svg.ts',
    ];
    const strays = ISLAND_FILES.filter((file) =>
      forbiddenBasenames.some((name) => file.endsWith(`/${name}`)),
    ).map(rel);
    expect(strays, 'these belong to @blobbi/react').toEqual([]);
  });

  it('draws no Blobbi body of its own: the SVG pipeline is the package\'s alone', () => {
    // `loadBlobbiSvg`, `customizeAdultSvg`, `customizeBabySvg` and the artwork
    // data modules are all package-internal. Any Island file referencing them
    // by import is building a second pipeline.
    const offenders = ISLAND_FILES.flatMap((file) =>
      importsOf(file)
        .filter((s) => /svg-customizer|svg-resolver|svg-data|@\/blobbi\//.test(s))
        .map((s) => `${rel(file)} -> ${s}`),
    );
    expect(offenders).toEqual([]);
  });

  it('imports the renderer only through the package public entry point', () => {
    // Deep imports (`@blobbi/react/src/...`) would couple Island to the
    // package's file layout, which is exactly what the entry point exists to
    // hide.
    const deep = ISLAND_FILES.flatMap((file) =>
      importsOf(file)
        .filter((s) => s.startsWith('@blobbi/react/') || s.includes(PACKAGE))
        .filter((s) => !s.endsWith('.tsx') && !s.endsWith('.ts'))
        .map((s) => `${rel(file)} -> ${s}`),
    );
    expect(deep).toEqual([]);
  });

  it('actually uses the package in production code, not only in tests', () => {
    const productionImporters = ISLAND_FILES.filter(
      (file) => !/\.test\.tsx?$/.test(file) && importsOf(file).includes('@blobbi/react'),
    ).map(rel);
    expect(productionImporters.length).toBeGreaterThan(5);
    // The three paths that matter: the local wrapper, the remote layer, and a
    // plain card. If any of them stopped consuming the package it would mean a
    // fork had appeared somewhere.
    for (const required of [
      'src/components/blobbi/CurrentBlobbiDisplay.tsx',
      'src/components/blobbi/MultiplayerLayer.tsx',
      'src/components/blobbi/BlobbiCard.tsx',
    ]) {
      expect(productionImporters).toContain(required);
    }
  });
});

describe('the renderer/actor arrow points one way', () => {
  it('BlobbiActor owns the world transforms the package must not', () => {
    // The complement of the package's own purity test: world scale, z-index,
    // ground shadow and the position anchor live in the actor. If these ever
    // moved INTO the renderer, it would stop being portable.
    const actor = readFileSync(join(ROOT, 'src/components/blobbi/BlobbiActor.tsx'), 'utf8');
    expect(actor).toContain('data-blobbi-shadow');
    expect(actor).toContain('data-blobbi-scale-rig');
    expect(actor).toContain('translate(-50%, -100%)');
  });

  it('the package has no idea BlobbiActor exists', () => {
    const packageFiles = sourceFiles(join(ROOT, PACKAGE, 'src')).filter(
      (f) => !/\.test\.tsx?$/.test(f),
    );
    const offenders = packageFiles.flatMap((file) =>
      importsOf(file)
        .filter((s) => /BlobbiActor|MovableBlobbi/.test(s))
        .map((s) => `${rel(file)} -> ${s}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe('the accessory EDITOR shares the package contract instead of restating it', () => {
  const OVERLAY = join(ROOT, 'src/components/blobbi/PlacementOverlay.tsx');

  it('the editor overlay is Island-only and never enters the package', () => {
    // Drag/wheel editing, the placement vocabulary and DOM listeners belong to
    // the editor. The package proved separately that it cannot reach them.
    const specifiers = importsOf(OVERLAY);
    expect(specifiers.some((s) => /placement\/accessory-sources/.test(s))).toBe(true);
    expect(specifiers.some((s) => /useEquipmentMutation/.test(s))).toBe(true);
    // The editor NEVER publishes: it reports patches upward and the modal
    // batches them into one complete-replacement event.
    const overlay = readFileSync(OVERLAY, 'utf8');
    expect(overlay).not.toMatch(/mutateAsync|useNostrPublish/);
  });

  it('uses the SAME box-relative sizing and ordering as the static renderer', () => {
    // Editor placements are authored in this coordinate space and replayed in
    // the world. If the two ever used different size bases or different layer
    // ordering, every saved accessory would shift on save — so both read the
    // constants from one module, which is now the package.
    const specifiers = importsOf(OVERLAY);
    expect(specifiers).toContain('@blobbi/react');

    const overlay = readFileSync(OVERLAY, 'utf8');
    const renderer = readFileSync(join(ROOT, PACKAGE, 'src/BlobbiRendererView.tsx'), 'utf8');
    for (const shared of [
      'ACCESSORY_BASE_PERCENT',                 // one size base
      "transformOrigin: 'center'",              // one transform origin
    ]) {
      expect(overlay, `editor must share ${shared}`).toContain(shared);
      expect(renderer, `renderer must share ${shared}`).toContain(shared);
    }

    // Ordering comes from the same module on both paths — but only the editor
    // CALLS it. The renderer consumes placements that are already normalized,
    // which is exactly why it stays free of equipment parsing.
    expect(overlay).toContain('normalizeAccessoryPlacements');
    expect(renderer).toContain('NormalizedAccessoryPlacement');
    expect(renderer).not.toContain('normalizeAccessoryPlacements(');
  });

  it('mounts the editor on the canonical renderer box, at the canonical size', () => {
    // `stageRef` wraps the preview whose only child is the renderer box, and
    // the preview is `xl` — the size every saved placement was authored in.
    const modal = readFileSync(join(ROOT, 'src/components/blobbi/BlobbiInfoModal.tsx'), 'utf8');
    expect(modal).toMatch(/containerRef=\{stageRef\}/);
    expect(modal).toMatch(/size="xl"/);

    // The preview shrink-wraps that box, so the drag math measures the box and
    // nothing more — no padding, no centering slack.
    const preview = readFileSync(join(ROOT, 'src/components/blobbi/CurrentBlobbiPreview.tsx'), 'utf8');
    expect(preview).toContain('h-fit w-fit');
  });

  it('keeps preview sizing on the one canonical size table', () => {
    // No preview-only multiplier table and no responsive override may come
    // back: `2xl`/`3xl` are real renderer boxes, not scaled-up `lg`s.
    const preview = readFileSync(join(ROOT, 'src/components/blobbi/CurrentBlobbiPreview.tsx'), 'utf8');
    expect(importsOf(join(ROOT, 'src/components/blobbi/CurrentBlobbiPreview.tsx'))).toContain('@blobbi/react');
    expect(preview).not.toMatch(/\b(sm|md|lg|xl):[a-z-]/);
  });
});

describe('remote rendering never subscribes to local-player data', () => {
  const MULTIPLAYER = join(ROOT, 'src/components/blobbi/MultiplayerLayer.tsx');

  it('the multiplayer layer renders remotes through the package, not the local wrapper', () => {
    const specifiers = importsOf(MULTIPLAYER);
    expect(specifiers).toContain('@blobbi/react');
    for (const localOnly of [
      /CurrentBlobbiDisplay/,
      /CurrentBlobbiPreview/,
      /useAccessoryManagement/,
      /useBlobbis$/,
      /useBlobbonautProfile/,
    ]) {
      expect(
        specifiers.filter((s) => localOnly.test(s)),
        `remote rendering must not import ${localOnly}`,
      ).toEqual([]);
    }
  });

  it('the local-player wrapper is the ONLY component holding the companion hooks', () => {
    // Not a ban — a census. `CurrentBlobbiDisplay` exists precisely to own this
    // data, and the package beneath it stays ignorant of it.
    const wrapper = importsOf(join(ROOT, 'src/components/blobbi/CurrentBlobbiDisplay.tsx'));
    expect(wrapper.some((s) => /useBlobbis/.test(s))).toBe(true);
    expect(wrapper.some((s) => /useBlobbonautProfile/.test(s))).toBe(true);
    // Equipment arrives through a CONTEXT, not a query. Resolving kind:31634
    // needs three queries (placement, inventory, catalog) and this component
    // renders once per Blobbi on screen, so the queries live at the app root
    // and this wrapper consumes their result. Asserting the context — rather
    // than a hook — is what stops the queries from creeping back in here.
    expect(wrapper.some((s) => /useCharacterEquipmentContext/.test(s))).toBe(true);
    expect(wrapper.some((s) => /usePlacementState|useIslandInventory|useItemCatalog/.test(s))).toBe(false);
  });
});

describe('Island keeps the asset adapter the package refuses to have', () => {
  it('confines Island asset-path knowledge to the accessory adapter and tag utils', () => {
    // Production modules only: a test that asserts what the adapter builds has
    // to name the same paths the adapter does, and is not a second consumer.
    const importers = ISLAND_FILES.filter(
      (file) =>
        /components\/blobbi\/lib\//.test(file) &&
        !/\.test\.tsx?$/.test(file) &&
        importsOf(file).some((s) => /asset-paths/.test(s)),
    ).map(rel).sort();
    // NOTHING under components/blobbi/lib builds an asset path any more. The
    // equipment path resolves artwork from published definitions, and the last
    // filename-convention module went with the legacy accessory system.
    expect(importers).toEqual([]);
  });

  it('passes that adapter explicitly — the package has no Island default', () => {
    const displayPath = join(ROOT, 'src/components/blobbi/CurrentBlobbiDisplay.tsx');
    const display = readFileSync(displayPath, 'utf8');
    // The resolver is now BUILT per render (it closes over `facing` and the item
    // definitions), so what is asserted is that the wrapper still supplies an
    // Island-made resolver rather than letting the package choose one.
    expect(display).toContain('resolveSources: resolveAccessorySources');
    // Since the kind:31634 migration the adapter is keyed by ITEM ADDRESS, not
    // by a legacy accessory code, and has no filename-convention fallback — an
    // item either has a published definition or it is not drawn.
    expect(display).toContain('createPlacementAccessorySourceResolver');
    expect(importsOf(displayPath)).toContain('@/placement/accessory-sources');

    const normalizer = readFileSync(join(ROOT, PACKAGE, 'src/accessory-normalize.ts'), 'utf8');
    expect(normalizer).toContain('DEFAULT_ACCESSORY_SOURCES');
    expect(normalizer).not.toContain('island');
  });
});

describe('item-definition knowledge stops at the Island adapter', () => {
  /**
   * The renderer package must stay protocol-agnostic. It is not enough that it
   * avoids importing the inventory library — it must not have grown its own
   * copy of the vocabulary either, because a hand-rolled `marker === 'front'`
   * inside the package would fork the policy this phase just centralized.
   */
  const PACKAGE_FILES = sourceFiles(join(ROOT, PACKAGE, 'src'));

  it('the renderer package imports no inventory library', () => {
    for (const file of PACKAGE_FILES) {
      expect(
        importsOf(file).filter((s) => /@nostr-games\/inventory|@\/inventory/.test(s)),
        `${rel(file)} must not import inventory code`,
      ).toEqual([]);
    }
  });

  it('the renderer package speaks no kind, tag or view-marker vocabulary', () => {
    // `package-purity.test.ts` proves the import graph; this proves the source
    // text, which is where a re-implementation would hide.
    const forbidden = [
      /\b31632\b/,
      /\b31633\b/,
      /GameItemDefinition/,
      /GameItemImage/,
      /diagonal-front-(right|left)/,
      /side-(right|left)/,
    ];
    for (const file of PACKAGE_FILES) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        expect(pattern.test(source), `${rel(file)} must not mention ${pattern}`).toBe(false);
      }
    }
  });

  it('only the accessory adapter turns item definitions into renderer sources', () => {
    const importers = ISLAND_FILES.filter(
      (file) =>
        /components\/blobbi\//.test(file) &&
        !/\.test\.tsx?$/.test(file) &&
        importsOf(file).some((s) => /item-image-resolution/.test(s)),
    ).map(rel).sort();
    // `ItemArt`, `EffectsPanel`, the Prize Counter's resolver and the Arcade
    // Token's currency mark read `primaryItemImageUrl` for their CARD
    // THUMBNAILS, which is a UI use and not a renderer source. What matters is
    // that no component builds a renderer candidate list itself: that is
    // `@/placement/accessory-sources` alone, asserted below.
    expect(importers).toEqual([
      'src/components/blobbi/EffectsPanel.tsx',
      'src/components/blobbi/arcade/ArcadeTokenAmount.tsx',
      'src/components/blobbi/arcade/prizes/useOfficialArcadePrizes.ts',
      'src/components/blobbi/inventory/ItemArt.tsx',
    ]);

    const resolverBuilders = ISLAND_FILES.filter(
      (file) =>
        !/\.test\.tsx?$/.test(file) &&
        /createPlacementAccessorySourceResolver/.test(readFileSync(file, 'utf8')) &&
        !/placement\/accessory-sources\.ts$/.test(file),
    ).map(rel).sort();
    // Only the render surfaces may CALL the builder; nobody else may
    // reimplement one. The dev simulation harness is on the list for exactly
    // that reason — it must run the REAL source resolution rather than build
    // its own candidate lists.
    expect(resolverBuilders).toEqual([
      'src/components/blobbi/CurrentBlobbiDisplay.tsx',
      'src/components/blobbi/PlacementOverlay.tsx',
      'src/pages/DevEquipment.tsx',
    ]);
  });
});
