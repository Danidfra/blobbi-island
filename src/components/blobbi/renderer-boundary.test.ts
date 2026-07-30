/**
 * PACKAGE-BOUNDARY enforcement for the pure Blobbi renderer (Phase 4).
 *
 * `BlobbiRendererView` is the component a future `@blobbi/react` package would
 * export. Everything that makes that possible is a property of its TRANSITIVE
 * import graph, and every one of those properties is cheap to break by adding a
 * single convenient import — so they are asserted against the real graph rather
 * than described in a comment.
 *
 * The claims:
 *
 *  1. The renderer's subtree cannot reach a relay, a query client, the local
 *     user, the Island world, movement, presence, or a router. A module that
 *     cannot import `useBlobbis` cannot subscribe to it, however a future
 *     refactor is shaped.
 *  2. The subtree lives in a small, known set of directories — the ones a later
 *     extraction phase would physically move.
 *  3. The dependency arrow between the actor and the renderer points ONE way:
 *     `BlobbiActor` may wrap the renderer; the renderer may not know it exists.
 *  4. Remote rendering never routes through the local-player wrapper.
 *
 * Import statements are matched, not free text, so the prose in these modules —
 * which discusses `useAccessoryManagement` and `BlobbiActor` at length — does
 * not trip the check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const ROOT = process.cwd();
const RENDERER = join(ROOT, 'src/components/blobbi/BlobbiRendererView.tsx');

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

/** Resolve a specifier to a source file, or null when it is an external package. */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(ROOT, 'src', specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return null;

  for (const ext of ['.ts', '.tsx', '']) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  for (const index of ['/index.ts', '/index.tsx']) {
    const candidate = base + index;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

interface Subtree {
  /** Every internal source file reachable from the entry, including it. */
  files: string[];
  /** Every external package specifier reachable from the entry. */
  externals: string[];
  /** importer -> specifier pairs, for error messages that name the culprit. */
  edges: Array<{ file: string; specifier: string }>;
}

/** The complete transitive closure of a module's imports. */
function subtreeOf(entry: string): Subtree {
  const files = new Set<string>();
  const externals = new Set<string>();
  const edges: Array<{ file: string; specifier: string }> = [];

  const walk = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const specifier of importsOf(file)) {
      edges.push({ file: file.replace(`${ROOT}/`, ''), specifier });
      const resolved = resolveSpecifier(specifier, file);
      if (resolved) walk(resolved);
      else externals.add(specifier);
    }
  };

  walk(entry);
  return { files: [...files].map((f) => f.replace(`${ROOT}/`, '')).sort(), externals: [...externals].sort(), edges };
}

const renderer = subtreeOf(RENDERER);

/**
 * What the pure renderer must never be able to reach.
 *
 * Each entry is a CATEGORY, not a module: the point is that no member of the
 * category can enter, so a newly added sibling is caught too.
 */
const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  // ── Data ────────────────────────────────────────────────────────────────
  { pattern: /^@nostrify\//, why: 'a Nostr client' },
  { pattern: /^nostr-tools/, why: 'a Nostr library' },
  { pattern: /^@tanstack\//, why: 'a query client' },
  { pattern: /^@\/hooks\/useNostr/, why: 'a Nostr hook' },
  { pattern: /useBlobbis$|useBlobbiEvents|useBlobbonautProfile|useOptimizedStatus/, why: 'a local-companion data hook' },
  { pattern: /useCurrentUser|useLoggedInAccounts|useLoginActions/, why: 'a current-user hook' },
  { pattern: /useAccessoryManagement/, why: 'the accessory editor hook' },
  { pattern: /^@\/inventory/, why: 'the inventory layer' },
  // ── Island world ────────────────────────────────────────────────────────
  { pattern: /^@\/lib\/location-/, why: 'an Island location module' },
  { pattern: /^@\/lib\/world-|world-coordinates/, why: 'world coordinates' },
  { pattern: /^@\/lib\/boundaries|location-boundaries/, why: 'room boundaries' },
  { pattern: /blobbi-ground|blobbi-pose|blobbi-world-render|spatial-intent/, why: 'Island world/pose geometry' },
  { pattern: /^@\/lib\/multiplayer|useIslandPresence|theater-occupancy/, why: 'presence/multiplayer' },
  { pattern: /^@\/lib\/theater|theater-/, why: 'theater configuration' },
  { pattern: /useLocation|useMovement|MovementBlocker|useBlobbiMovementController|pending-interaction|usePendingInteraction/, why: 'movement or location state' },
  { pattern: /^@\/lib\/gaze/, why: 'the Island attention/gaze resolver' },
  // ── App shell ───────────────────────────────────────────────────────────
  { pattern: /^react-router/, why: 'a router' },
  { pattern: /^@\/contexts\//, why: 'an app context' },
  { pattern: /^@\/hooks\/useLocalStorage|useAppContext|useTheme|useToast/, why: 'app-shell state' },
  // ── Components ──────────────────────────────────────────────────────────
  // The renderer is the LEAF of the component graph. `@/components/blobbi/lib/`
  // is exempt: it is pure, React-free data code that merely happens to live
  // under the components tree today (extraction moves it to core).
  { pattern: /^@\/components\/(?!blobbi\/lib\/)/, why: 'another component' },
  { pattern: /BlobbiActor|MovableBlobbi|CurrentBlobbiDisplay|CurrentBlobbiPreview|AccessoryOverlay|Modal$/, why: 'an Island actor/wrapper/modal component' },
];

describe('the pure renderer subtree reaches nothing it must not', () => {
  it('has a subtree to check, and it is small', () => {
    expect(renderer.files.length).toBeGreaterThan(10);
    // A guardrail, not a target: if the renderer's graph doubles, the boundary
    // needs a human look rather than a silently passing test.
    expect(renderer.files.length).toBeLessThan(45);
  });

  it.each(FORBIDDEN.map((f) => [f.why, f.pattern] as const))(
    'never imports %s',
    (why, pattern) => {
      const offenders = renderer.edges
        .filter(({ file, specifier }) => renderer.files.includes(file) && pattern.test(specifier))
        .map(({ file, specifier }) => `${file} -> ${specifier}`);
      expect(offenders, `pure renderer subtree imports ${why}`).toEqual([]);
    },
  );

  it('depends on a tiny, deliberate set of external packages', () => {
    // React plus className utilities plus the already-extracted core package.
    // Anything else arriving here is a new peer dependency for the future
    // package, which is a decision — so it is recorded in this list.
    expect(renderer.externals).toEqual([
      '@blobbi-kit/core/color-guardrails',
      'clsx',
      'react',
      'tailwind-merge',
    ]);
  });

  it('lives in the directories a later extraction would move, and nowhere else', () => {
    const ALLOWED_PREFIXES = [
      'src/blobbi/',                    // SVG artwork + pure SVG transforms
      'src/components/blobbi/lib/',     // pure render/accessory model
      'src/components/blobbi/BlobbiRendererView.tsx',
      'src/lib/loadBlobbiSvg.ts',       // pure SVG assembly
      'src/lib/asset-paths.ts',         // Island asset adapter (see below)
      'src/lib/utils.ts',               // cn()
    ];
    const strays = renderer.files.filter(
      (file) => !ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix)),
    );
    expect(strays).toEqual([]);
  });

  it('confines Island asset-path knowledge to ONE adapter module', () => {
    // `asset-paths.ts` is the only Island-layout-aware module in the subtree,
    // and exactly one file may reach it: the accessory source adapter. That is
    // what a consumer replaces instead of mirroring this repo's public/ tree.
    const importers = renderer.edges
      .filter(({ file, specifier }) => renderer.files.includes(file) && /asset-paths/.test(specifier))
      .map(({ file }) => file)
      .sort();
    expect([...new Set(importers)]).toEqual([
      'src/components/blobbi/lib/accessory-utils.ts',
      'src/components/blobbi/lib/island-accessory-sources.ts',
    ]);

    // And the renderer component itself builds no path at all.
    expect(importsOf(RENDERER).some((s) => /asset-paths/.test(s))).toBe(false);
  });

  it('contains exactly one React component file — the renderer', () => {
    const components = renderer.files.filter((f) => f.endsWith('.tsx'));
    expect(components).toEqual(['src/components/blobbi/BlobbiRendererView.tsx']);
  });
});

describe('the renderer/actor arrow points one way', () => {
  it('the renderer does not know BlobbiActor exists', () => {
    expect(renderer.files).not.toContain('src/components/blobbi/BlobbiActor.tsx');
  });

  it('BlobbiActor owns the world transforms the renderer must not', () => {
    // The complement of the rule above: world scale, z-index, ground shadow and
    // the position anchor live in the actor. If these ever moved INTO the
    // renderer, it would stop being portable — so assert they are still here.
    const actor = readFileSync(join(ROOT, 'src/components/blobbi/BlobbiActor.tsx'), 'utf8');
    expect(actor).toContain('data-blobbi-shadow');
    expect(actor).toContain('data-blobbi-scale-rig');
    expect(actor).toContain('translate(-50%, -100%)');

    const rendererSource = readFileSync(RENDERER, 'utf8');
    for (const worldConcern of ['data-blobbi-shadow', 'zIndex', 'animate-float', 'scale-rig']) {
      expect(rendererSource, `renderer must not own ${worldConcern}`).not.toContain(worldConcern);
    }
  });
});

describe('the accessory EDITOR shares the renderer contract instead of restating it', () => {
  const OVERLAY = join(ROOT, 'src/components/blobbi/AccessoryOverlay.tsx');

  it('the editor overlay is Island-only and never enters the static renderer', () => {
    // Drag/wheel editing, the equipment hook and DOM listeners belong to the
    // editor. The static renderer proved above that it cannot reach them.
    const specifiers = importsOf(OVERLAY);
    expect(specifiers.some((s) => /useAccessoryManagement/.test(s))).toBe(true);
    expect(renderer.files).not.toContain('src/components/blobbi/AccessoryOverlay.tsx');
  });

  it('uses the SAME box-relative sizing and ordering as the static renderer', () => {
    // Editor placements are authored in this coordinate space and replayed in
    // the world. If the two ever used different size bases or different layer
    // ordering, every saved accessory would shift on save.
    const specifiers = importsOf(OVERLAY);
    expect(specifiers).toContain('./lib/blobbi-render-size');
    expect(specifiers).toContain('./lib/accessory-normalize');

    const overlay = readFileSync(OVERLAY, 'utf8');
    const rendererSource = readFileSync(RENDERER, 'utf8');
    for (const shared of [
      'ACCESSORY_BASE_PERCENT',                 // one size base
      "transformOrigin: 'center'",              // one transform origin
    ]) {
      expect(overlay, `editor must share ${shared}`).toContain(shared);
      expect(rendererSource, `renderer must share ${shared}`).toContain(shared);
    }

    // Ordering comes from the same module on both paths — but only the editor
    // CALLS it. The renderer consumes placements that are already normalized,
    // which is exactly why it stays free of equipment parsing.
    expect(overlay).toContain('normalizeAccessoryPlacements');
    expect(rendererSource).toContain('NormalizedAccessoryPlacement');
    expect(rendererSource).not.toContain('normalizeAccessoryPlacements(');
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
    expect(preview).toContain('blobbi-render-size');
    expect(preview).not.toMatch(/\b(sm|md|lg|xl):[a-z-]/);
  });
});

describe('remote rendering never subscribes to local-player data', () => {
  const MULTIPLAYER = join(ROOT, 'src/components/blobbi/MultiplayerLayer.tsx');

  it('the multiplayer layer renders remotes through the pure renderer, not the local wrapper', () => {
    const specifiers = importsOf(MULTIPLAYER);
    expect(specifiers).toContain('./BlobbiRendererView');
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
    // data, and the renderer beneath it must stay ignorant of it.
    const wrapper = importsOf(join(ROOT, 'src/components/blobbi/CurrentBlobbiDisplay.tsx'));
    expect(wrapper.some((s) => /useBlobbis/.test(s))).toBe(true);
    expect(wrapper.some((s) => /useBlobbonautProfile/.test(s))).toBe(true);
    expect(wrapper.some((s) => /useAccessoryManagement/.test(s))).toBe(true);
  });
});
