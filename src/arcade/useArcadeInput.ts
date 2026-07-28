/**
 * Arcade input — the React half.
 *
 * A thin, boring listener wrapper. Every decision worth arguing about lives in
 * `arcade-input-map.ts`, which has no React and is tested directly; this hook
 * only binds, unbinds and tracks which lanes are currently held.
 *
 * Contract:
 *  - **Input is dead unless `enabled`.** The caller passes
 *    `status === 'playing'`, so a preview, a countdown, a pause screen and a
 *    results screen all ignore the keyboard entirely.
 *  - **Arrow keys and space are `preventDefault`ed while enabled**, so the page
 *    cannot scroll under the game. `Escape` and `Tab` are never suppressed:
 *    closing the shell and traversing focus must keep working.
 *  - **Multiple lanes at once.** Held lanes are a set, not a value, because a
 *    rhythm game needs simultaneous hits.
 *  - **Nothing survives unmount.** Both listeners are removed and the held set
 *    is cleared, so a key held while the shell closes cannot leak a stuck lane
 *    into the next run.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ArcadeInputAction, ArcadeKeymap, ArcadeLane } from './arcade-input-map';
import {
  DEFAULT_ARCADE_KEYMAP,
  resolveKeyAction,
  shouldPreventDefault,
} from './arcade-input-map';

export interface UseArcadeInputOptions {
  /** Only `true` while the game is actually advancing. */
  enabled: boolean;
  /** Every resolved action, in event order. */
  onAction?: (action: ArcadeInputAction) => void;
  /** Convenience: the pause control (keyboard `P`, or a shell button). */
  onPause?: () => void;
  keymap?: ArcadeKeymap;
}

export interface ArcadeInputApi {
  /** Lanes currently held. Empty whenever input is disabled. */
  activeLanes: ReadonlySet<ArcadeLane>;
  /**
   * Feed a lane press/release from a touch zone. Touch and keyboard converge
   * here so a game never has to know which produced an action.
   */
  pressLane: (lane: ArcadeLane) => void;
  releaseLane: (lane: ArcadeLane) => void;
}

export function useArcadeInput({
  enabled,
  onAction,
  onPause,
  keymap = DEFAULT_ARCADE_KEYMAP,
}: UseArcadeInputOptions): ArcadeInputApi {
  const [activeLanes, setActiveLanes] = useState<ReadonlySet<ArcadeLane>>(() => new Set());

  // Handlers are read through refs so changing a callback identity never
  // re-binds the listeners (a re-bind mid-run drops a key that is already down).
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const onPauseRef = useRef(onPause);
  onPauseRef.current = onPause;
  const keymapRef = useRef(keymap);
  keymapRef.current = keymap;
  // Touch zones call in directly, so the "disabled outside playing" rule is
  // enforced here rather than only by not binding the keyboard listeners.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const applyAction = useCallback((action: ArcadeInputAction) => {
    if (!enabledRef.current) return;
    if (action.type === 'pause') {
      onPauseRef.current?.();
      onActionRef.current?.(action);
      return;
    }
    setActiveLanes((prev) => {
      const next = new Set(prev);
      if (action.phase === 'press') {
        if (next.has(action.lane)) return prev;
        next.add(action.lane);
      } else {
        if (!next.has(action.lane)) return prev;
        next.delete(action.lane);
      }
      return next;
    });
    onActionRef.current?.(action);
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Disabling mid-hold must not leave a lane stuck down forever.
      setActiveLanes((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    if (typeof window === 'undefined') return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldPreventDefault(event.key)) event.preventDefault();
      const action = resolveKeyAction(event, 'down', keymapRef.current);
      if (action) applyAction(action);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (shouldPreventDefault(event.key)) event.preventDefault();
      const action = resolveKeyAction(event, 'up', keymapRef.current);
      if (action) applyAction(action);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [enabled, applyAction]);

  const pressLane = useCallback(
    (lane: ArcadeLane) => applyAction({ type: 'lane', lane, phase: 'press' }),
    [applyAction],
  );
  const releaseLane = useCallback(
    (lane: ArcadeLane) => applyAction({ type: 'lane', lane, phase: 'release' }),
    [applyAction],
  );

  return { activeLanes, pressLane, releaseLane };
}
