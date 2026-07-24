import '@testing-library/jest-dom';
import { vi } from 'vitest';

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

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
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