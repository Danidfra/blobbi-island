/**
 * PACKAGE-PURITY enforcement for `@blobbi/react`.
 *
 * The package's whole value proposition is negative: it is useful to an outside
 * consumer precisely because of what it CANNOT do. It cannot open a relay, read
 * the logged-in user, ask where in a world it is, or build a path into somebody
 * else's `public/` folder. Every one of those properties is a property of the
 * import graph, and every one is cheap to destroy with a single convenient
 * import — so they are asserted against the real graph rather than described in
 * a comment.
 *
 * This file is the successor to Island's `renderer-boundary.test.ts`. That test
 * described a boundary that had to be maintained by hand inside one repository
 * tree; this one describes a boundary the directory layout already enforces,
 * and fails if the layout is subverted.
 *
 * Import statements are matched, not free text, so the prose in these modules —
 * which discusses Nostr, Island and `useAccessoryManagement` at length — does
 * not trip the check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const PACKAGE_ROOT = resolve(__dirname, '..');
const SRC = join(PACKAGE_ROOT, 'src');
const ENTRY = join(SRC, 'index.ts');

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

/** Resolve a RELATIVE specifier to a source file; anything else is external. */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier);
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
  files: string[];
  externals: string[];
  edges: Array<{ file: string; specifier: string }>;
}

function subtreeOf(entry: string): Subtree {
  const files = new Set<string>();
  const externals = new Set<string>();
  const edges: Array<{ file: string; specifier: string }> = [];

  const walk = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const specifier of importsOf(file)) {
      edges.push({ file: relative(PACKAGE_ROOT, file), specifier });
      const resolved = resolveSpecifier(specifier, file);
      if (resolved) walk(resolved);
      else externals.add(specifier);
    }
  };

  walk(entry);
  return {
    files: [...files].map((f) => relative(PACKAGE_ROOT, f)).sort(),
    externals: [...externals].sort(),
    edges,
  };
}

const pkg = subtreeOf(ENTRY);

/** Every source file in the package, tests included. */
function allSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return allSourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const ALL_FILES = allSourceFiles(SRC);
/** What a consumer actually gets: everything except the tests. */
const SHIPPED_FILES = ALL_FILES.filter((file) => !/\.test\.tsx?$/.test(file));

/**
 * What the package must never be able to reach.
 *
 * Each entry is a CATEGORY, not a module: the point is that no member of the
 * category can enter, so a newly added sibling is caught too.
 */
const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  // ── Host-application aliases ────────────────────────────────────────────
  { pattern: /^@\//, why: 'a host-application `@/` path alias' },
  { pattern: /^@blobbi\/react/, why: 'itself by package name (a resolution cycle)' },
  // ── Data ────────────────────────────────────────────────────────────────
  { pattern: /^@nostrify\//, why: 'a Nostr client' },
  { pattern: /^nostr-tools/, why: 'a Nostr library' },
  { pattern: /^@tanstack\//, why: 'a query client' },
  { pattern: /useBlobbis|useBlobbiEvents|useBlobbonautProfile|useOptimizedStatus/, why: 'a companion data hook' },
  { pattern: /useCurrentUser|useLoggedInAccounts|useLoginActions/, why: 'a current-user hook' },
  { pattern: /useAccessoryManagement|inventory/i, why: 'the inventory/equipment layer' },
  // ── Island world ────────────────────────────────────────────────────────
  { pattern: /location-|useLocation/, why: 'a location module' },
  { pattern: /world-coordinates|world-input|blobbi-world-render/, why: 'world coordinates' },
  { pattern: /boundaries/, why: 'room boundaries' },
  { pattern: /blobbi-ground|blobbi-pose|spatial-intent/, why: 'world/pose geometry' },
  { pattern: /multiplayer|IslandPresence|presence|theater/i, why: 'presence/multiplayer/theater' },
  { pattern: /useMovement|MovementBlocker|MovementController|pending-interaction/, why: 'movement state' },
  { pattern: /asset-paths|island-accessory-sources/, why: 'a host asset-path adapter' },
  // ── App shell ───────────────────────────────────────────────────────────
  { pattern: /^react-router/, why: 'a router' },
  { pattern: /contexts\//, why: 'an app context' },
  { pattern: /useLocalStorage|useAppContext|useTheme|useToast/, why: 'app-shell state' },
  { pattern: /Modal$|Modal'/, why: 'a modal component' },
  { pattern: /BlobbiActor|MovableBlobbi|CurrentBlobbiDisplay|CurrentBlobbiPreview|AccessoryOverlay/, why: 'an Island actor/wrapper component' },
];

describe('the package reaches nothing it must not', () => {
  it('has a subtree to check, and it is small', () => {
    expect(pkg.files.length).toBeGreaterThan(10);
    // A guardrail, not a target: if the graph doubles, the boundary needs a
    // human look rather than a silently passing test.
    expect(pkg.files.length).toBeLessThan(45);
  });

  it.each(FORBIDDEN.map((f) => [f.why, f.pattern] as const))(
    'never imports %s',
    (why, pattern) => {
      const offenders = pkg.edges
        .filter(({ specifier }) => pattern.test(specifier))
        .map(({ file, specifier }) => `${file} -> ${specifier}`);
      expect(offenders, `package imports ${why}`).toEqual([]);
    },
  );

  it('uses no path aliases ANYWHERE in the package, tests included', () => {
    // The subtree walk above only covers what the entry point reaches. A `@/`
    // in a test file would still be a latent coupling to a host tsconfig, so
    // sweep every file on disk rather than only the reachable ones.
    const offenders = ALL_FILES.flatMap((file) =>
      importsOf(file)
        .filter((specifier) => specifier.startsWith('@/'))
        .map((specifier) => `${relative(PACKAGE_ROOT, file)} -> ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it('depends on a tiny, deliberate set of external packages', () => {
    // Anything arriving here is a new peer dependency, which is a decision —
    // so it is recorded in this list and in package.json.
    expect(pkg.externals).toEqual([
      '@blobbi-kit/core/color-guardrails',
      'clsx',
      'react',
      'tailwind-merge',
    ]);
  });

  it('declares every external dependency as a peer dependency', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    const declared = Object.keys(manifest.peerDependencies ?? {});
    // Subpath imports (`@blobbi-kit/core/color-guardrails`) are satisfied by
    // the root package name.
    const required = [...new Set(pkg.externals.map((s) => s.split('/').slice(0, s.startsWith('@') ? 2 : 1).join('/')))];
    expect(required.filter((name) => !declared.includes(name))).toEqual([]);
  });

  it('is not published', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    expect(manifest.private, '@blobbi/react is a local workspace package').toBe(true);
  });

  it('contains exactly one React component file — the renderer', () => {
    const components = pkg.files.filter((f) => f.endsWith('.tsx'));
    expect(components).toEqual(['src/BlobbiRendererView.tsx']);
  });

  it('owns none of the world concerns the host actor owns', () => {
    const renderer = readFileSync(join(SRC, 'BlobbiRendererView.tsx'), 'utf8');
    for (const worldConcern of ['data-blobbi-shadow', 'zIndex', 'animate-float', 'scale-rig']) {
      expect(renderer, `renderer must not own ${worldConcern}`).not.toContain(worldConcern);
    }
  });

  it('emits a clean publishable artifact, when one has been built', () => {
    // `dist/` is gitignored and CI does not build it, so this is a local
    // verification rather than a gate — but when the artifact IS present, the
    // things that would break a real consumer are checked properly: an
    // unresolved path alias, a leaked host module, or a bundled React.
    const dist = join(PACKAGE_ROOT, 'dist');
    if (!existsSync(dist)) {
      expect(existsSync(join(PACKAGE_ROOT, 'tsconfig.build.json'))).toBe(true);
      return;
    }

    const built = allSourceFiles(dist)
      .concat(
        readdirSync(dist, { recursive: true, encoding: 'utf8' })
          .filter((f) => /\.(js|d\.ts)$/.test(f))
          .map((f) => join(dist, f)),
      )
      .filter((f) => /\.(js|d\.ts)$/.test(f));

    const specifiers = [...new Set(built.flatMap(importsOf))];
    expect(specifiers.filter((s) => s.startsWith('@/')), 'unresolved path alias in dist').toEqual([]);
    expect(
      specifiers.filter((s) => !s.startsWith('.')).sort(),
      'dist must import only the declared peers',
    ).toEqual(['@blobbi-kit/core/color-guardrails', 'clsx', 'react', 'react/jsx-runtime', 'tailwind-merge']);
    expect(existsSync(join(dist, 'index.d.ts')), 'declarations must be emitted').toBe(true);
    expect(existsSync(join(dist, 'node_modules')), 'no vendored dependencies').toBe(false);
  });

  it('never fetches anything at runtime', () => {
    // Synchronous rendering is part of the contract: a consumer gets markup on
    // the first render, with no loading state and no network.
    const offenders = SHIPPED_FILES.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /\bfetch\s*\(|XMLHttpRequest|new\s+Image\s*\(|localStorage|import\.meta\.env/.test(source);
    }).map((f) => relative(PACKAGE_ROOT, f));
    expect(offenders).toEqual([]);
  });
});
