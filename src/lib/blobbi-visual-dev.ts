/**
 * DEV-only visual generation override: look at the Adult V2 body through the
 * REAL actor pipeline before any Blobbi carries `["visual_generation","v2"]`.
 *
 * What this is: a presentation-layer switch that, in a development build only,
 * sets `visualGeneration: 'v2'` on the `BlobbiVisual` handed to the renderer,
 * AFTER the companion has been parsed and mapped exactly as in production.
 *
 * What this is NOT, by construction:
 *  - it never touches a Nostr event, the parsed companion, the query cache or
 *    any domain state: the input visual is copied, never mutated, and nothing
 *    here imports a publisher, a signer, a relay hook or a mutation;
 *  - it never publishes or persists the `visual_generation` tag anywhere: the
 *    only storage it knows is a dev-only localStorage flag for the override
 *    itself, so the switch survives in-app navigation (the router drops query
 *    strings on `navigate`);
 *  - it cannot reach production: `import.meta.env.DEV` is a literal `false` in
 *    a build, so `readDevVisualGenerationOverride` returns `null` before it
 *    looks at anything, and `applyDevVisualGeneration(visual, null)` returns
 *    the very same object.
 *
 * Activation, in a dev server (`npm run dev`):
 *
 *   ?blobbiVisualGeneration=v2   turn on (and remember for this browser)
 *   ?blobbiVisualGeneration=v1   turn off (and forget)
 *   localStorage 'blobbi-dev-visual-generation' = 'v2'   the remembered form
 *
 * The same `import.meta.env.DEV` convention gates the `/dev/*` routes and
 * `DebugOverlaysContext`; this follows it rather than adding a feature flag,
 * because a flagged surface ships in production when enabled and this must not.
 */
import { useState } from 'react';
import type { BlobbiVisual } from '@blobbi/renderer';

/** True only in dev/local builds. Statically `false` in a production build. */
export const isBlobbiVisualDevMode: boolean = import.meta.env.DEV;

export const BLOBBI_VISUAL_GENERATION_QUERY = 'blobbiVisualGeneration';
export const BLOBBI_VISUAL_GENERATION_STORAGE_KEY = 'blobbi-dev-visual-generation';

/** The only override that exists: draw V2. `null` means "production behaviour". */
export type DevVisualGenerationOverride = 'v2' | null;

/**
 * Strict parse of the query/storage value: `v2` overrides, `v1` explicitly
 * clears, anything else (absent, typo, `V2`, `2`) means "no instruction".
 */
export function parseDevVisualGenerationValue(value: string | null | undefined): 'v1' | 'v2' | null {
  return value === 'v2' ? 'v2' : value === 'v1' ? 'v1' : null;
}

export interface DevVisualGenerationEnvironment {
  /** Whether this is a development build. Production passes `false` and gets `null`. */
  dev: boolean;
  /** `window.location.search`, including the leading `?`, or an empty string. */
  search: string;
  /** A storage for the remembered flag; `null` when unavailable. */
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

function browserEnvironment(): DevVisualGenerationEnvironment {
  let storage: DevVisualGenerationEnvironment['storage'] = null;
  try {
    storage = typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    storage = null;
  }
  return {
    dev: isBlobbiVisualDevMode,
    search: typeof window !== 'undefined' ? window.location.search : '',
    storage,
  };
}

/**
 * Resolve the override. Pure given its environment; the browser variant reads
 * the query string first (and remembers an explicit `v2`/`v1` in storage),
 * then falls back to the remembered flag. Always `null` outside a dev build.
 */
export function readDevVisualGenerationOverride(
  env: DevVisualGenerationEnvironment = browserEnvironment(),
): DevVisualGenerationOverride {
  if (!env.dev) return null;
  const fromQuery = parseDevVisualGenerationValue(new URLSearchParams(env.search).get(BLOBBI_VISUAL_GENERATION_QUERY));
  if (fromQuery) {
    try {
      if (fromQuery === 'v2') env.storage?.setItem(BLOBBI_VISUAL_GENERATION_STORAGE_KEY, 'v2');
      else env.storage?.removeItem(BLOBBI_VISUAL_GENERATION_STORAGE_KEY);
    } catch {
      // Storage failures (private mode) only lose the "remember"; the query still applies.
    }
    return fromQuery === 'v2' ? 'v2' : null;
  }
  try {
    return parseDevVisualGenerationValue(env.storage?.getItem(BLOBBI_VISUAL_GENERATION_STORAGE_KEY)) === 'v2' ? 'v2' : null;
  } catch {
    return null;
  }
}

/**
 * Apply the override to a visual that production has already resolved.
 *
 * With no override the SAME object comes back (referentially), so the
 * production path is untouched. With `'v2'` a copy carries
 * `visualGeneration: 'v2'`; every other field, and the input, are unchanged.
 * The renderer decides what V2 means per stage (a V2 baby draws the V1 baby).
 */
export function applyDevVisualGeneration<V extends BlobbiVisual>(
  visual: V,
  override: DevVisualGenerationOverride,
): V {
  if (override !== 'v2') return visual;
  if (visual.visualGeneration === 'v2') return visual;
  return { ...visual, visualGeneration: 'v2' };
}

/**
 * The override for this mount, read once. A page load is the unit of the
 * switch: toggling means reloading with the query parameter, which keeps
 * every actor on screen on the same generation.
 */
export function useDevVisualGenerationOverride(): DevVisualGenerationOverride {
  const [override] = useState<DevVisualGenerationOverride>(() => readDevVisualGenerationOverride());
  return override;
}
