import '@testing-library/jest-dom';
import { beforeEach, vi } from 'vitest';

// jsdom's TextEncoder produces a Uint8Array from a different JS realm than the
// test globals. Libraries like @noble/hashes validate input with an
// `instanceof Uint8Array` check against the current realm, so the cross-realm
// array is rejected ("expected Uint8Array, got object"). Re-wrap the encoder
// output in a same-realm Uint8Array so seed/hashing helpers (e.g.
// deriveBlobbiSeedV1 in @blobbi-kit/core) work under jsdom. Test-only.
const OriginalTextEncoder = globalThis.TextEncoder;
class RealmSafeTextEncoder extends OriginalTextEncoder {
  encode(input?: string): Uint8Array<ArrayBuffer> {
    const src = super.encode(input);
    const copy = new Uint8Array(src.length);
    copy.set(src);
    return copy;
  }
}
globalThis.TextEncoder = RealmSafeTextEncoder as typeof globalThis.TextEncoder;

/**
 * `window.matchMedia`, which jsdom does not implement.
 *
 * Installed fresh before EVERY test rather than once at module load. A test
 * that calls `vi.restoreAllMocks()` in its own `afterEach`: a reasonable thing
 * to do after spying on something else, also resets this `vi.fn()` to a stub
 * that returns `undefined`, and the next test to render anything responsive
 * then dies on `mql.addEventListener is not a function`.
 *
 * That failure lands in whichever unrelated component happens to call
 * `useIsMobile`, so it is worth removing the possibility entirely rather than
 * making each consumer defensive against a browser API that has been universal
 * for a decade.
 */
function installMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/**
 * Reinstall only when the current one is unusable.
 *
 * Non-destructive on purpose: several tests deliberately replace `matchMedia`
 * in a `beforeAll` to simulate a fine pointer or a narrow viewport, and a
 * `beforeEach` that reinstalled unconditionally would silently undo them
 * before every test in the file.
 */
function ensureMatchMedia() {
  try {
    const result = window.matchMedia?.('(min-width: 0px)');
    if (result && typeof result.addEventListener === 'function') return;
  } catch {
    // fall through and reinstall
  }
  installMatchMedia();
}

installMatchMedia();
beforeEach(ensureMatchMedia);

// Mock window.scrollTo
Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
});

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation((_callback) => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
  root: null,
  rootMargin: '',
  thresholds: [],
}));

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation((_callback) => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));