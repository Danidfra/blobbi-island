/**
 * ISLAND-SIDE package boundary.
 *
 * The renderer lives in `@blobbi-kit/renderer`, a package published from the
 * blobbi-kit repository and installed from npm. That package proves its own
 * purity in its own test suite (it cannot reach a relay, a user, a world, an asset path, the domain kit or a
 * consumer's CSS build). What THIS file proves is the half that lives on the
 * Island side of the line, and that no amount of package hygiene can
 * guarantee:
 *
 *  1. There is exactly ONE renderer implementation, and it is the package's.
 *     A local re-implementation would compile, pass every behavioral test, and
 *     silently fork the drawing, so its absence is asserted directly.
 *  2. Island talks to the package through its public entry point, not through
 *     its file layout.
 *  3. The dependency arrow between the actor and the renderer points ONE way.
 *  4. Remote rendering never routes through the local-player wrapper, and the
 *     local wrapper is the only place local-companion data enters.
 *  5. The editor overlay shares the package's coordinate space instead of
 *     restating it.
 *  6. The installed package is the canonical one, and its artifact imports
 *     only React.
 *
 * Import statements are matched, not free text, so the prose in these modules,
 * which discusses `useAccessoryManagement` and `BlobbiActor` at length, does
 * not trip the check.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ISLAND = join(ROOT, 'src');
const RENDERER = '@blobbi-kit/renderer';
/** The installed package, through the same symlink the app resolves. */
const INSTALLED = join(ROOT, 'node_modules', '@blobbi-kit', 'renderer');

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

function sourceFiles(dir: string, ext = /\.tsx?$/): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full, ext);
    return ext.test(entry.name) ? [full] : [];
  });
}

const ISLAND_FILES = sourceFiles(ISLAND);
const rel = (file: string) => file.replace(`${ROOT}/`, '');

describe('exactly one renderer implementation exists, and Island consumes it', () => {
  it('keeps no second copy of the renderer, the model, or the artwork in the repository', () => {
    // The failure mode this guards against is not "somebody deletes the
    // package"; it is "somebody copies a file back into src/ to avoid an
    // import, and the two drift". Names, not contents, because a fork always
    // starts as an exact copy.
    const forbiddenBasenames = [
      'BlobbiRenderer.tsx',
      'BlobbiRendererView.tsx',
      'blobbi-render-model.ts',
      'blobbi-render-size.ts',
      'accessory-normalize.ts',
      'loadBlobbiSvg.ts',
      'load-blobbi-svg.ts',
      'adult-svg-data.ts',
      'adult-svg-customizer.ts',
    ];
    const strays = ISLAND_FILES.filter((file) =>
      forbiddenBasenames.some((name) => file.endsWith(`/${name}`)),
    ).map(rel);
    expect(strays, `these belong to ${RENDERER}`).toEqual([]);
    // The old local workspace package is gone for good.
    expect(existsSync(join(ROOT, 'packages'))).toBe(false);
  });

  it("draws no Blobbi body of its own: the SVG pipeline is the package's alone", () => {
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
    // Deep imports (`@blobbi-kit/renderer/dist/...`) would couple Island to the
    // package's file layout, which is exactly what the entry point exists to
    // hide. The retired `@blobbi/react` name must not come back either.
    const deep = ISLAND_FILES.flatMap((file) =>
      importsOf(file)
        .filter((s) => s.startsWith(`${RENDERER}/`) || s.startsWith('@blobbi/react'))
        .map((s) => `${rel(file)} -> ${s}`),
    );
    expect(deep).toEqual([]);
  });

  it('actually uses the package in production code, not only in tests', () => {
    const productionImporters = ISLAND_FILES.filter(
      (file) => !/\.test\.tsx?$/.test(file) && importsOf(file).includes(RENDERER),
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

describe('the installed renderer is the canonical package', () => {
  it('is declared as the published registry package, not a development link', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.dependencies[RENDERER]).toBe('^0.1.0');
    const declared = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, spec] of Object.entries(declared)) {
      if (name.startsWith('@blobbi')) expect(String(spec), name).not.toMatch(/^file:/);
    }
    expect(declared['@blobbi/renderer']).toBeUndefined();
    const lockfile = readFileSync(join(ROOT, 'package-lock.json'), 'utf8');
    expect(lockfile).not.toContain('../blobbi-kit');
    expect(lockfile).not.toContain('@blobbi/renderer');
  });

  it('resolves to @blobbi-kit/renderer with a real built artifact', () => {
    const manifest = JSON.parse(readFileSync(join(INSTALLED, 'package.json'), 'utf8'));
    expect(manifest.name).toBe(RENDERER);
    expect(manifest.version).toBe('0.1.0');
    expect(manifest.exports['.'].import).toBe('./dist/index.js');
    // Installed under this project from the registry, not linked from elsewhere.
    expect(realpathSync(INSTALLED)).toBe(INSTALLED);
    expect(existsSync(join(INSTALLED, 'dist/index.js'))).toBe(true);
    expect(existsSync(join(INSTALLED, 'dist/index.d.ts'))).toBe(true);
  });

  it('declares React as its only peer and has no runtime dependencies', () => {
    const manifest = JSON.parse(readFileSync(join(INSTALLED, 'package.json'), 'utf8'));
    expect(Object.keys(manifest.peerDependencies)).toEqual(['react']);
    expect(manifest.dependencies).toBeUndefined();
  });

  it('its artifact imports nothing but React: no kit, no Nostr, no inventory, no host', () => {
    const built = sourceFiles(join(INSTALLED, 'dist'), /\.js$/);
    const externals = new Set(
      built.flatMap(importsOf).filter((s) => !s.startsWith('.') && !s.startsWith('/')),
    );
    expect([...externals].sort()).toEqual(['react', 'react/jsx-runtime']);
  });

  it('speaks no kind, tag, view-marker or inventory vocabulary', () => {
    // The package's own tests prove its import graph; this proves the shipped
    // TEXT, which is where a re-implementation of Island policy would hide.
    const built = sourceFiles(join(INSTALLED, 'dist'), /\.(js|d\.ts)$/);
    const forbidden = [
      /\b3163[234]\b/,
      /GameItemDefinition/,
      /GameItemImage/,
      /diagonal-front-(right|left)/,
      /side-(right|left)/,
      /@blobbi-kit\//,
      /nostrify|nostr-tools/,
    ];
    for (const file of built) {
      // Comments stripped: a docblock that names the kit in prose (the color
      // helpers say where their twin lives) is not a module reference.
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const pattern of forbidden) {
        expect(pattern.test(source), `${rel(file)} must not mention ${pattern}`).toBe(false);
      }
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
    const built = sourceFiles(join(INSTALLED, 'dist'), /\.js$/);
    for (const file of built) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/BlobbiActor|MovableBlobbi|data-blobbi-shadow|scale-rig/);
    }
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
    // ordering, every saved accessory would shift on save, so both read the
    // constants from one module, which is the package.
    const specifiers = importsOf(OVERLAY);
    expect(specifiers).toContain(RENDERER);

    const overlay = readFileSync(OVERLAY, 'utf8');
    const renderer = readFileSync(join(INSTALLED, 'dist/BlobbiRenderer.js'), 'utf8');
    // One size base, imported by the editor and applied by the renderer.
    expect(overlay).toContain('ACCESSORY_BASE_PERCENT');
    expect(renderer).toContain('ACCESSORY_BASE_PERCENT');
    // One transform origin.
    expect(overlay).toContain("transformOrigin: 'center'");
    expect(renderer).toMatch(/transformOrigin:\s*["']center["']/);

    // Ordering comes from the same module on both paths, but only the editor
    // CALLS it. The renderer consumes placements that are already normalized,
    // which is exactly why it stays free of equipment parsing.
    expect(overlay).toContain('normalizeAccessoryPlacements');
    expect(renderer).not.toContain('normalizeAccessoryPlacements(');
  });

  it('mounts the editor on the canonical renderer box, filling the square stage', () => {
    // `stageRef` is the square stage; the preview fills it (`size="100%"`) so
    // the drag math measures the box and nothing more. Every saved placement
    // is a percentage of that box, so its pixel size is irrelevant.
    const modal = readFileSync(join(ROOT, 'src/components/blobbi/BlobbiInfoModal.tsx'), 'utf8');
    expect(modal).toMatch(/containerRef=\{stageRef\}/);
    expect(modal).toMatch(/size="100%"/);

    // The preview shrink-wraps that box, so the drag math measures the box and
    // nothing more: no padding, no centering slack.
    const preview = readFileSync(join(ROOT, 'src/components/blobbi/CurrentBlobbiPreview.tsx'), 'utf8');
    expect(preview).toContain('h-fit w-fit');
  });

  it('keeps preview sizing on the one canonical size contract', () => {
    // No preview-only multiplier table and no responsive override may come
    // back: `2xl`/`3xl` are real renderer boxes, not scaled-up `lg`s, and a
    // container-sized preview is a CSS-length `size`, not a class override.
    const previewPath = join(ROOT, 'src/components/blobbi/CurrentBlobbiPreview.tsx');
    const preview = readFileSync(previewPath, 'utf8');
    expect(importsOf(previewPath)).toContain(RENDERER);
    expect(preview).not.toMatch(/\b(sm|md|lg|xl):[a-z-]/);
    expect(preview).not.toContain('boxClassName');
  });
});

describe('remote rendering never subscribes to local-player data', () => {
  const MULTIPLAYER = join(ROOT, 'src/components/blobbi/MultiplayerLayer.tsx');

  it('the multiplayer layer renders remotes through the package, not the local wrapper', () => {
    const specifiers = importsOf(MULTIPLAYER);
    expect(specifiers).toContain(RENDERER);
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
    // Not a ban, a census. `CurrentBlobbiDisplay` exists precisely to own this
    // data, and the package beneath it stays ignorant of it.
    const wrapper = importsOf(join(ROOT, 'src/components/blobbi/CurrentBlobbiDisplay.tsx'));
    expect(wrapper.some((s) => /useBlobbis/.test(s))).toBe(true);
    expect(wrapper.some((s) => /useBlobbonautProfile/.test(s))).toBe(true);
    // Equipment arrives through a CONTEXT, not a query. Resolving kind:31634
    // needs three queries (placement, inventory, catalog) and this component
    // renders once per Blobbi on screen, so the queries live at the app root
    // and this wrapper consumes their result.
    expect(wrapper.some((s) => /useCharacterEquipmentContext/.test(s))).toBe(true);
    expect(wrapper.some((s) => /usePlacementState|useIslandInventory|useItemCatalog/.test(s))).toBe(false);
  });
});

describe('Island keeps the adapters the package refuses to have', () => {
  it('confines Island asset-path knowledge to the accessory adapter and tag utils', () => {
    const importers = ISLAND_FILES.filter(
      (file) =>
        /components\/blobbi\/lib\//.test(file) &&
        !/\.test\.tsx?$/.test(file) &&
        importsOf(file).some((s) => /asset-paths/.test(s)),
    ).map(rel).sort();
    // NOTHING under components/blobbi/lib builds an asset path any more. The
    // equipment path resolves artwork from published definitions.
    expect(importers).toEqual([]);
  });

  it('passes the accessory source adapter explicitly, the package has no Island default', () => {
    const displayPath = join(ROOT, 'src/components/blobbi/CurrentBlobbiDisplay.tsx');
    const display = readFileSync(displayPath, 'utf8');
    // The resolver is BUILT per render (it closes over `facing` and the item
    // definitions), so what is asserted is that the wrapper still supplies an
    // Island-made resolver rather than letting the package choose one.
    expect(display).toContain('resolveSources: resolveAccessorySources');
    // Since the kind:31634 migration the adapter is keyed by ITEM ADDRESS, not
    // by a legacy accessory code, and has no filename-convention fallback.
    expect(display).toContain('createPlacementAccessorySourceResolver');
    expect(importsOf(displayPath)).toContain('@/placement/accessory-sources');
  });

  it('kind:31634 becomes renderer placements in Island, and only in Island', () => {
    // The protocol -> placement adapter is Island's. The package never sees a
    // kind number (asserted above); Island's adapter is the only module that
    // imports both the inventory package and the renderer's placement type.
    const renderModel = join(ROOT, 'src/placement/render-model.ts');
    const specifiers = importsOf(renderModel);
    expect(specifiers).toContain(RENDERER);
    expect(specifiers.some((s) => /@\/inventory\/package/.test(s))).toBe(true);
    expect(readFileSync(renderModel, 'utf8')).toContain('AccessoryPlacementInput');
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
    expect(resolverBuilders).toEqual([
      'src/components/blobbi/CurrentBlobbiDisplay.tsx',
      'src/components/blobbi/PlacementOverlay.tsx',
      'src/pages/DevEquipment.tsx',
    ]);
  });
});
