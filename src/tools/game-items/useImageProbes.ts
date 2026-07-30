/**
 * "Does this URL actually resolve to a picture, and how big is it?"
 *
 * The browser is the only honest answer to that, so each distinct URL gets one
 * `Image()` load. Three properties matter more than the mechanism:
 *
 *  - RESULTS ARE CACHED PER URL and keyed by URL alone. Retyping a marker,
 *    reordering rows or duplicating an entry does not re-probe anything, so a
 *    loaded preview never flickers back to "checking…" because an unrelated
 *    field changed.
 *  - PROBES ARE DEBOUNCED. Typing a URL character by character would otherwise
 *    fire a request per keystroke.
 *  - CANCELLATION NEVER STRANDS A URL. If the effect is torn down while a load
 *    is still in flight, that URL is removed from the cache rather than left
 *    permanently "pending", so the next render probes it again instead of
 *    showing a spinner forever.
 *
 * A failed probe is information, never an error state for the form. Plenty of
 * perfectly valid image hosts refuse a cross-origin `Image()` load, so this
 * feeds a WARNING and never blocks publishing.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { ImageProbe } from './validation';

const DEBOUNCE_MS = 400;

/**
 * Probe every URL in `urls`, returning a stable `url → probe` map.
 *
 * The map grows monotonically within a session: a URL removed from the form
 * keeps its cached result, which is what makes re-adding it instant.
 */
export function useImageProbes(
  urls: readonly string[],
): ReadonlyMap<string, ImageProbe> {
  const [probes, setProbes] = useState<ReadonlyMap<string, ImageProbe>>(
    () => new Map(),
  );
  // The authoritative cache. State mirrors it so renders see the updates; the
  // ref is what the effect reads, so probe results never re-trigger the effect.
  const cache = useRef(new Map<string, ImageProbe>());

  // A stable primitive key, so the effect re-runs on a real URL change rather
  // than on every array identity change.
  const urlKey = useMemo(
    () => [...new Set(urls.map((u) => u.trim()).filter(Boolean))].sort().join('\n'),
    [urls],
  );

  useEffect(() => {
    // Captured once: the Map identity never changes, and reading it through a
    // local binding keeps the cleanup below referring to the same object the
    // effect body used.
    const cached = cache.current;
    const wanted = urlKey === '' ? [] : urlKey.split('\n');
    const fresh = wanted.filter((url) => !cached.has(url));
    if (fresh.length === 0) return;

    let cancelled = false;
    const images: HTMLImageElement[] = [];
    const publish = () => setProbes(new Map(cached));

    const timer = setTimeout(() => {
      for (const url of fresh) {
        cached.set(url, { status: 'pending' });

        const image = new Image();
        images.push(image);
        image.onload = () => {
          if (cancelled) return;
          cached.set(url, {
            status: 'loaded',
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
          publish();
        };
        image.onerror = () => {
          if (cancelled) return;
          cached.set(url, { status: 'error' });
          publish();
        };
        image.src = url;
      }
      publish();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      for (const image of images) {
        image.onload = null;
        image.onerror = null;
      }
      // Anything still in flight is forgotten rather than frozen as "pending".
      for (const url of fresh) {
        if (cached.get(url)?.status === 'pending') {
          cached.delete(url);
        }
      }
    };
  }, [urlKey]);

  return probes;
}
