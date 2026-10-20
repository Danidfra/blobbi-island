/**
 * Leaving for another world, as a short scene: the Blobbi notices, says
 * goodbye with a little wiggle, gathers itself and dissolves into motes (the
 * presence controller's own departure, `useBlobbiPresence`), and only when
 * the departure has finished does the page go. One departure at a time: a
 * second tap, or a tap on another world, is ignored until this one ends or
 * is cancelled. The same scene, phases and rules as Blobbi Home's
 * `useWorldDeparture`; the Island has no face control over its actor, so
 * the goodbye is the wiggle alone.
 *
 *   noticing   it looks up at the player (a moment)
 *   waving     a happy little wiggle (a moment)
 *   leaving    the departure plays; at its end, navigation
 *   gone       navigation was asked for; if the page is still here after
 *              `failMs` (a blocked, refused or failed navigation), it comes
 *              back (arrives) and says so
 *   failed     the navigation did not happen: the Blobbi is back, unless it
 *              has already `left` (see below), in which case it stays gone
 *
 * Stay (`cancel`) ends it at any moment before navigation: the Blobbi is
 * simply here again. Reduced motion: no wave, the short fade. A Blobbi that
 * cannot act (none on screen) does not perform: the page goes at once.
 * Coming back with the browser's Back from a cached page restores it, here.
 *
 * `navigate` is the egress boundary's answer: it resolves `true` only when
 * the page was really asked to go. `false` (denied by the policy, a bad
 * address) is a failed navigation at once, with no wait. Whatever the
 * boundary does before asking (the move to the destination, signed and
 * published) happens inside `navigate`, in the `gone` phase: after the last
 * moment Stay could be pressed. When that move was published, `left` says
 * so, and a navigation that then fails does not bring the Blobbi back (it is
 * in the other world now; the notice says so and offers Try again, which
 * asks the page to go once more, and Dismiss).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BlobbiPresenceState, BlobbiPresenceController } from './useBlobbiPresence';
import type { OpenWorld, World } from './worlds';
import { isTravelUrl } from './worlds';

export type DeparturePhase = 'idle' | 'noticing' | 'waving' | 'leaving' | 'gone' | 'failed';

export const DEPARTURE = { noticeMs: 450, waveMs: 700, reducedNoticeMs: 150, reducedWaveMs: 0, failMs: 5_000 } as const;

export interface UseWorldDepartureOptions {
  presence: { state: BlobbiPresenceState; controller: BlobbiPresenceController };
  /** A Blobbi is on screen and here: it performs the goodbye. Otherwise the page goes at once. */
  canAct: boolean;
  reducedMotion: boolean;
  /** Ask the page to go (the egress boundary). Resolves whether it was asked. */
  navigate: (world: World & { url: string }) => Promise<boolean>;
  /**
   * The Blobbi has already left for the world (its move was published by the boundary): a navigation that fails
   * leaves it gone instead of bringing it back, and so does a cached page shown again. Default: it has not.
   */
  left?: () => boolean;
  failMs?: number;
}

export interface WorldDeparture {
  phase: DeparturePhase;
  world: World | null;
  /** Start leaving for a world. False when it cannot (not open, already leaving). */
  go: (world: OpenWorld) => boolean;
  /** Stay: ends the departure before the page goes. */
  cancel: () => void;
  /** Try the same world again after a failed navigation (the page is asked again; a Blobbi that `left` stays gone). */
  retry: () => boolean;
}

export function useWorldDeparture({ presence, canAct, reducedMotion, navigate, left, failMs = DEPARTURE.failMs }: UseWorldDepartureOptions): WorldDeparture {
  const [phase, setPhase] = useState<DeparturePhase>('idle');
  const [world, setWorld] = useState<World | null>(null);
  const phaseRef = useRef<DeparturePhase>('idle');
  const worldRef = useRef<World | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const live = useRef({ presence, navigate, reducedMotion, failMs, canAct, left });
  live.current = { presence, navigate, reducedMotion, failMs, canAct, left };

  const set = useCallback((next: DeparturePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const after = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  };

  const fail = useCallback(() => {
    if (phaseRef.current !== 'gone') return;
    set('failed');
    // Already moved to the other world: it stays gone (the world's own sync shows it away; nothing undoes a trip)
    if (live.current.left?.()) return;
    const c = live.current.presence.controller;
    if (c.getState() === 'absent' || c.getState() === 'departing') c.enter();
  }, [set]);

  const goNow = useCallback(
    (target: World) => {
      if (!isTravelUrl(target.url)) {
        set('failed');
        return;
      }
      set('gone');
      const url = target.url;
      let asked: Promise<boolean>;
      try {
        asked = live.current.navigate({ ...target, url });
      } catch {
        asked = Promise.resolve(false);
      }
      void asked.then(
        (went) => {
          if (!went) {
            fail();
            return;
          }
          // Asked (after whatever the boundary waited for, such as the move to the destination being signed and
          // published): still here a while later, the navigation did not happen (blocked, offline, refused)
          if (phaseRef.current !== 'gone') return;
          after(live.current.failMs, () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            fail();
          });
        },
        () => fail(),
      );
    },
    [set, fail],
  );

  const go = useCallback(
    (target: OpenWorld): boolean => {
      if (!target.open || !isTravelUrl(target.url)) return false;
      if (phaseRef.current !== 'idle' && phaseRef.current !== 'failed') return false;
      clearTimers();
      worldRef.current = target;
      setWorld(target);
      const o = live.current;
      if (!o.canAct || o.presence.controller.getState() !== 'present') {
        goNow(target);
        return true;
      }
      set('noticing');
      const notice = o.reducedMotion ? DEPARTURE.reducedNoticeMs : DEPARTURE.noticeMs;
      const wave = o.reducedMotion ? DEPARTURE.reducedWaveMs : DEPARTURE.waveMs;
      const leave = () => {
        set('leaving');
        if (!live.current.presence.controller.leave()) goNow(target);
      };
      after(notice, () => {
        set('waving');
        if (wave > 0) after(wave, leave);
        else leave();
      });
      return true;
    },
    [goNow, set],
  );

  // The departure has played to its end: now the page goes
  useEffect(() => {
    if (phase === 'leaving' && presence.state === 'absent' && world) goNow(world);
  }, [phase, presence.state, world, goNow]);

  const cancel = useCallback(() => {
    const p = phaseRef.current;
    if (p === 'idle' || p === 'gone') return;
    clearTimers();
    const c = live.current.presence.controller;
    if (p === 'failed') {
      // Already back (or on its way back): nothing to undo
    } else {
      c.cancel();
    }
    worldRef.current = null;
    setWorld(null);
    set('idle');
  }, [set]);

  const retry = useCallback((): boolean => {
    const w = worldRef.current;
    if (!w || phaseRef.current !== 'failed') return false;
    return go({ ...w, open: isTravelUrl(w.url) });
  }, [go]);

  // Back from the other world with the browser's Back (a cached page): here again, nothing half way
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      const gone = phaseRef.current === 'gone';
      clearTimers();
      const c = live.current.presence.controller;
      // It had dissolved before the page went: it comes back (cancel only ends a journey still under way), unless its
      // move was published, in which case where it is now is the world's own sync's to say
      if (live.current.left?.()) {
        /* stays as it is */
      } else if (gone && c.getState() === 'absent') c.enter();
      else c.cancel();
      worldRef.current = null;
      setWorld(null);
      set('idle');
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [set]);
  useEffect(() => () => clearTimers(), []);

  return { phase, world, go, cancel, retry };
}
