import React, { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { useDebugOverlays } from '@/contexts/DebugOverlaysContext';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import {
  MINE_CAVE_ENTRANCE_SRC,
  MINE_CAVE_SRC,
  mineCaveStructure,
} from '@/lib/mine-cave-config';

/**
 * The Mine exterior's cave, composed on top of `mine-open.webp`.
 *
 * ## Why it is a component rather than another `<InteractiveElement>`
 *
 * Town's shopfronts are "base sprite + door overlay in one positioned wrapper",
 * and that is the pattern this reuses: one percentage-positioned wrapper, the
 * art inside it, and the entry going through the room's shared
 * `requestInteraction` walk-to-interact flow. What it cannot reuse is
 * `InteractiveElement` itself, for two reasons:
 *
 *  1. **The clickable area is a hole.** `mine-open-cave.webp` is mostly rock
 *     with a transparent arch in the middle, and an `<img>` receives pointer
 *     events across its whole rectangle — transparent pixels included. A
 *     door-overlay element here would swallow clicks on the entire hillside.
 *     So the art is inert (`pointer-events: none`) and a separate transparent
 *     `<button>` covers only the opening.
 *  2. **The reveal is three-state, not two.** `InteractiveElement`'s `'door'`
 *     effect is hover-or-a-900ms-touch-timer. The cave has to stay lit for as
 *     long as the Blobbi is walking towards it — however long that takes — which
 *     means following the pending interaction rather than a timeout.
 *
 * ## Layers, back to front
 *
 *   black cave-mouth backing → entrance preview → cave arch → hotspot
 *
 * The first two are clipped by the mouth wrapper so the wide tunnel photo cannot
 * spill past the arch; the arch itself is outside that wrapper and is never
 * clipped.
 *
 * The three layers carry their own z-indexes and the wrapper carries none, on
 * purpose: that keeps them in the world surface's stacking context, where they
 * sort against the Blobbi's Y-derived z-index instead of being sorted as one
 * opaque block. The Blobbi therefore stands *in* the lit opening and is occluded
 * by the rock around it. See `mineCaveStructure.depth`.
 */

/** Idle, being previewed (hover/focus), or locked open while walking over. */
export type MineEntranceVisualState = 'idle' | 'preview' | 'active';

interface MineCaveEntranceProps {
  /** The room's shared walk-to-interact request (see `usePendingInteraction`). */
  requestInteraction: (opts: RequestInteractionOptions) => void;
  /** Fired once the Blobbi has reached the approach anchor. */
  onEnter: () => void;
  /**
   * Changes whenever the room changes. Resets the local visual state, so a
   * re-used instance can never come back still lit.
   */
  locationKey: string;
}

export function MineCaveEntrance({
  requestInteraction,
  onEnter,
  locationKey,
}: MineCaveEntranceProps) {
  const [isPreviewing, setIsPreviewing] = useState(false);
  /**
   * Locked open. Set on activation and cleared *only* by the pending
   * interaction — it fires, or it is cancelled (a tap on other ground, a
   * location change, unmount). Never by a timer, and never by the pointer
   * leaving: the Blobbi may still be walking.
   */
  const [isActive, setIsActive] = useState(false);
  /** Identifies the newest activation; see `activate`. */
  const requestIdRef = useRef(0);
  const reducedMotion = useReducedMotion();
  /*
    The shared visual-debug switch (`DebugOverlaysContext`), which is hard-gated
    to `import.meta.env.DEV` and off by default even there. It outlines the
    invisible hotspot, which is the one thing about this structure that cannot be
    seen while tuning the numbers in `mine-cave-config.ts`.
  */
  const { showDebugOverlays } = useDebugOverlays();

  const visualState: MineEntranceVisualState = isActive
    ? 'active'
    : isPreviewing
      ? 'preview'
      : 'idle';
  const isRevealed = visualState !== 'idle';

  useEffect(() => {
    requestIdRef.current += 1;
    setIsPreviewing(false);
    setIsActive(false);
  }, [locationKey]);

  /**
   * The ONE activation path, shared by mouse, touch, Enter and Space.
   *
   * It hangs off `onClick` alone, deliberately. A tap fires `touchstart` and
   * then a synthetic `click`, and the usual way to suppress the second is
   * `preventDefault()` in `onTouchStart` — but React 18 registers `touchstart`
   * at the root as a PASSIVE listener, so that call does nothing. Handling both
   * events would therefore activate twice on every tap, and the second
   * `requestInteraction` replaces the first: the replacement cancels it, and the
   * cancellation clears the lock the tap had just set, leaving the cave dark
   * while the Blobbi walks. A `<button>` already turns all four inputs into one
   * click, so there is nothing to gain by listening for more than that.
   */
  const activate = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    // Real browsers dispatch clicks as PointerEvents, so the originating device
    // is readable here and touch keeps its more forgiving proximity threshold.
    // Keyboard activation reports `''`, and jsdom sends a plain MouseEvent.
    const isTouch =
      (event.nativeEvent as Partial<PointerEvent>).pointerType === 'touch';

    /*
      Requesting an interaction cancels whatever was pending, so activating twice
      in a row (a double-click) would fire the FIRST request's `onCancel` after
      the second has already re-locked the entrance, and the cave would go dark
      mid-walk. Only the newest request is allowed to release the lock; an
      `onCancel` from a superseded one is stale and ignored. A cancellation from
      anywhere else — other ground, another element, the location changing —
      still matches the current id and resets normally.
    */
    const id = (requestIdRef.current += 1);
    const releaseIfCurrent = () => {
      if (requestIdRef.current !== id) return false;

      setIsActive(false);
      return true;
    };

    /*
      Lock the tunnel open now, synchronously from the activation event, so the
      cave lights up the moment it is clicked/tapped rather than when the walk
      finishes. It has to happen BEFORE `requestInteraction`, because an
      interaction that is already satisfied (the Blobbi is standing on the
      approach anchor) fires its `action` synchronously from inside that call —
      and that action releases the lock. Setting it afterwards would leave the
      entrance lit while the room changes underneath it.
    */
    setIsActive(true);

    requestInteraction({
      target: mineCaveStructure.approach,
      touch: isTouch,
      action: () => {
        if (releaseIfCurrent()) {
          onEnter();
        }
      },
      onCancel: () => {
        releaseIfCurrent();
      },
    });
  };

  const { wrapper, mouth } = mineCaveStructure;

  /** Shared by the mouth's clipped contents and by the hotspot above them. */
  const mouthBox: React.CSSProperties = {
    left: `${mouth.leftPercent}%`,
    width: `${mouth.widthPercent}%`,
    top: `${mouth.topPercent}%`,
    bottom: `${mouth.bottomPercent}%`,
  };

  const fade = reducedMotion ? undefined : 'opacity 300ms ease-out';

  return (
    /*
      Percentage placement inside the scaled VirtualWorld, and `pointer-events-none`
      so the rock — which covers a wide slice of the path — never intercepts a
      movement click. Only the hotspot opts back in.

      Centred by arithmetic rather than by `-translate-x-1/2`, and this is
      load-bearing: a `transform` creates a stacking context, which would trap
      the three z-indexes below INSIDE this element. The wrapper would then be
      sorted against the Blobbi as one block at `z-index: auto`, i.e. underneath
      it — so the Blobbi would walk in front of the whole cave and never appear
      to stand in the mouth. Same reason there is no `filter`, `opacity`,
      `isolation`, `contain`, `will-change` or `z-index` here.
    */
    <div
      data-mine-cave-structure
      className="absolute pointer-events-none"
      style={{
        left: `${wrapper.centerXPercent - wrapper.widthPercent / 2}%`,
        bottom: `${wrapper.bottomPercent}%`,
        width: `${wrapper.widthPercent}%`,
      }}
    >
      {/*
        The opening. `overflow-hidden` + a rounded arch is the clip: the tunnel
        photo is much wider than the arch, and without it the rocky dome around
        the tunnel would stick out either side of the cave. The clip is scoped to
        the opening precisely so it can never cut the arch artwork below.
      */}
      <div
        aria-hidden
        data-mine-cave-mouth
        className="absolute overflow-hidden pointer-events-none"
        style={{
          ...mouthBox,
          borderRadius: mouth.borderRadius,
          zIndex: mineCaveStructure.depth.mouth,
        }}
      >
        {/*
          Idle black. Only ever behind the opening — the surrounding rock is
          opaque artwork, so the few percent of slack around the visible hole
          stay hidden at any scale. Fades out as the tunnel fades in.
        */}
        <div
          data-mine-cave-backing
          className="absolute inset-0 bg-black"
          style={{ opacity: isRevealed ? 0 : 1, transition: fade }}
        />
        <img
          src={MINE_CAVE_ENTRANCE_SRC}
          alt="Mine cave entrance"
          draggable={false}
          data-mine-cave-preview
          /*
            No `data-island-world-grade="exclude"`: this is environment art and
            takes the day/night grade from `[data-island-world-graded] img` like
            every other world sprite.
          */
          className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
          style={{
            objectPosition: mineCaveStructure.entranceObjectPosition,
            opacity: isRevealed ? 1 : 0,
            transition: fade,
          }}
        />
      </div>

      {/*
        The arch. It is also what gives the wrapper its height — everything else
        in here is absolutely positioned — so it stays in flow and only takes
        `relative` to carry a z-index.
      */}
      <img
        src={MINE_CAVE_SRC}
        alt="Mine cave"
        draggable={false}
        data-mine-cave-front
        className="relative block w-full select-none pointer-events-none"
        style={{ zIndex: mineCaveStructure.depth.front }}
      />

      {/*
        The only interactive element in the scene: a real button, so touch,
        Enter and Space all work without re-implementing any of them, and so
        `MovableBlobbi`'s block-list (which already matches `button`) treats a
        tap on it as UI rather than as a walk to that spot. `data-block-move` is
        belt-and-braces for the same contract, and keeps
        `useCancelInteractionOnWorldClick` from cancelling the interaction the
        click is about to create.
      */}
      <button
        type="button"
        data-block-move
        data-mine-cave-hotspot
        aria-label="Enter the mine"
        className={cn(
          'absolute pointer-events-auto cursor-pointer bg-transparent border-0 p-0 appearance-none focus:outline-none focus-visible:outline-none',
          showDebugOverlays && 'outline outline-2 outline-fuchsia-500',
        )}
        style={{
          ...mouthBox,
          borderRadius: mouth.borderRadius,
          zIndex: mineCaveStructure.depth.hotspot,
        }}
        onMouseEnter={() => setIsPreviewing(true)}
        onMouseLeave={() => setIsPreviewing(false)}
        onFocus={() => setIsPreviewing(true)}
        onBlur={() => setIsPreviewing(false)}
        onClick={activate}
        onPointerDown={(event) => event.stopPropagation()}
      />
    </div>
  );
}
