import { useEffect } from 'react';

import { isWithinMoveBlockingUi } from '@/lib/world-input';
import type { PendingInteractionApi } from './usePendingInteraction';

/**
 * Cancel a pending walk-to-interact when the player taps a *different* world
 * point.
 *
 * Extracted from `InteractiveElements` so the arcade, which now owns its own
 * `usePendingInteraction` instance: gets the identical behaviour rather than a
 * second, subtly different copy of it.
 *
 * Interactive elements carry `data-block-move` and stop propagation, so a
 * world-surface `pointerdown` that reaches this listener means the player tapped
 * empty ground (or chose another destination): abandon whatever was pending.
 *
 * The single `[data-world-surface]` element is resolved from the document rather
 * than from a local ref, because the ref is only attached in some location
 * branches and relying on it would silently disable cancellation in most rooms.
 * The listener is bound in the CAPTURE phase so it runs even though
 * `MovableBlobbi` also listens on the same surface, and regardless of any
 * element's `stopPropagation`.
 */
export function useCancelInteractionOnWorldClick(
  { cancel, hasPending }: Pick<PendingInteractionApi, 'cancel' | 'hasPending'>,
  /** Re-resolve the surface when the room changes. */
  locationKey: string,
): void {
  useEffect(() => {
    const surface = document.querySelector('[data-world-surface]') as HTMLElement | null;
    if (!surface) return;

    const onWorldPointerDown = (ev: Event) => {
      if (!hasPending()) return;
      // Ignore clicks that originate on UI / interactive elements; those manage
      // their own pending lifecycle (and remote Blobbi clicks must not cancel).
      // Shared predicate: src/lib/world-input.ts.
      if (isWithinMoveBlockingUi(ev.target)) return;
      cancel();
    };

    surface.addEventListener('pointerdown', onWorldPointerDown, { capture: true });
    surface.addEventListener('touchstart', onWorldPointerDown, { capture: true });
    return () => {
      surface.removeEventListener('pointerdown', onWorldPointerDown, { capture: true });
      surface.removeEventListener('touchstart', onWorldPointerDown, { capture: true });
    };
  }, [cancel, hasPending, locationKey]);
}
