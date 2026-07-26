import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Position } from '@/lib/types';
import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import type { TownBushConfig } from '@/lib/town-bushes-config';
import { BUSH_RUSTLE_SFX, TOWN_BACKGROUND_FILE } from '@/lib/town-bushes-config';
import { useSfx } from '@/hooks/useSfx';
import { constrainPosition } from '@/lib/boundaries';
import { locationBoundaries } from '@/lib/location-boundaries';

/**
 * Compute the walk-to target (world-surface percent) for a bush from its
 * rendered rect and the bush's configured fractional offsets.
 *
 * Unlike doors/kiosks — which aim at the *base* of the element so the Blobbi
 * stands in front of them — a bush is a hiding spot: the Blobbi walks INTO it,
 * so the aim point defaults to the sprite's visual center (configurable per
 * bush via `interactionTarget`, never hard-coded here).
 *
 * The result is clamped into the Town walk boundary with the existing
 * `constrainPosition`, so an aim point that falls outside walkable ground (large
 * artwork, corner placement) still resolves to a reachable point instead of a
 * target the Blobbi can never arrive at.
 */
function computeBushTarget(
  el: Element,
  interactionTarget: { x: number; y: number },
): Position | null {
  const surface = el.closest('[data-world-surface]') as HTMLElement | null;
  if (!surface) return null;
  const surfaceRect = surface.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  if (surfaceRect.width === 0 || surfaceRect.height === 0) return null;

  const aimX = rect.left + rect.width * interactionTarget.x;
  const aimY = rect.top + rect.height * interactionTarget.y;

  const raw: Position = {
    x: ((aimX - surfaceRect.left) / surfaceRect.width) * 100,
    y: ((aimY - surfaceRect.top) / surfaceRect.height) * 100,
  };

  const boundary = locationBoundaries[TOWN_BACKGROUND_FILE];
  return boundary ? constrainPosition(raw, boundary) : raw;
}

/** A single leaf particle's randomized trajectory (set once per burst). */
interface Leaf {
  id: number;
  dx: number;
  dy: number;
  rot: number;
  duration: number;
  delay: number;
  hue: string;
  left: number;
}

const LEAF_COLORS = ['#4caf50', '#66bb6a', '#81c784', '#43a047', '#a5d6a7'];

function makeLeaves(seed: number): Leaf[] {
  // A small, fixed-size burst — kept intentionally light (6 spans).
  const count = 6;
  return Array.from({ length: count }, (_, i) => {
    // Deterministic-ish spread using index; randomness only for organic feel.
    const spread = (i / (count - 1)) * 2 - 1; // -1..1
    const dx = spread * (18 + Math.random() * 14); // px, fan left/right
    const dy = -(22 + Math.random() * 20); // px, always upward
    const rot = (Math.random() * 2 - 1) * 220;
    return {
      id: seed * 100 + i,
      dx,
      dy,
      rot,
      duration: 0.6 + Math.random() * 0.3,
      delay: Math.random() * 0.08,
      hue: LEAF_COLORS[i % LEAF_COLORS.length],
      left: 40 + Math.random() * 20, // % across the bush width
    };
  });
}

interface TownBushProps {
  config: TownBushConfig;
  requestInteraction: (opts: RequestInteractionOptions) => void;
  /**
   * The hiding spot the LOCAL player currently occupies, or null when not
   * hidden. Owned by PlayingView (the single source of truth) and shared with
   * the movement/presence layers, so this component never infers hiding from
   * coordinates or timers.
   */
  hiddenIn: string | null;
  /** Mark the local player as hidden inside this bush (fired on arrival only). */
  onHide: (hidingSpotId: string) => void;
}

/**
 * TownBush — one interactive Town bush.
 *
 * Behavior (all reusing existing systems):
 *  - Click/tap: computes the configured aim point (default: the bush's visual
 *    center, clamped to walkable ground) and calls the shared
 *    `requestInteraction` — the existing walk-to-interact / movement system.
 *  - On confirmed ARRIVAL (not on click): plays the rustle SFX, shakes, emits a
 *    small leaf burst, and reports the hide via `onHide`. The Blobbi visual is
 *    then not rendered at all by MovableBlobbi — the bush's z-index NEVER
 *    changes, so hiding can't reorder bushes and nothing of the Blobbi survives
 *    underneath the sprite.
 *  - Leaving: PlayingView clears the hidden state the moment movement starts,
 *    so there is no polling, no timeout and no distance guessing here.
 *  - Hover (pointer devices only): a subtle silent sway, no particles.
 */
export function TownBush({ config, requestInteraction, hiddenIn, onHide }: TownBushProps) {
  const [isShaking, setIsShaking] = useState(false);
  const [leaves, setLeaves] = useState<Leaf[]>([]);
  const burstSeedRef = useRef(0);
  const shakeTimerRef = useRef<number | null>(null);
  const leafTimerRef = useRef<number | null>(null);

  const { play: playRustle } = useSfx(BUSH_RUSTLE_SFX, { cooldownMs: 500, volume: 0.8 });

  /** Is the local player hidden inside THIS bush right now? */
  const isHiddenHere = hiddenIn === config.id;
  // Read inside the click handler without making it depend on renders.
  const isHiddenHereRef = useRef(isHiddenHere);
  isHiddenHereRef.current = isHiddenHere;

  const clearTimers = useCallback(() => {
    if (shakeTimerRef.current !== null) window.clearTimeout(shakeTimerRef.current);
    if (leafTimerRef.current !== null) window.clearTimeout(leafTimerRef.current);
    shakeTimerRef.current = null;
    leafTimerRef.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // Fired by the movement system once the Blobbi reaches the bush.
  const onArrive = useCallback(() => {
    // Sound plays on arrival, not on click (with built-in cooldown/overlap).
    playRustle();

    // Shake.
    setIsShaking(false);
    // Restart the animation cleanly by toggling on the next frame.
    requestAnimationFrame(() => setIsShaking(true));
    if (shakeTimerRef.current !== null) window.clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = window.setTimeout(() => setIsShaking(false), 650);

    // Leaf burst — a few temporary elements, auto-removed after they finish.
    burstSeedRef.current += 1;
    setLeaves(makeLeaves(burstSeedRef.current));
    if (leafTimerRef.current !== null) window.clearTimeout(leafTimerRef.current);
    leafTimerRef.current = window.setTimeout(() => setLeaves([]), 1100);

    // Explicit hiding state — the Blobbi visual stops being rendered and the
    // spot id is published to multiplayer presence by the layers above.
    onHide(config.id);
  }, [playRustle, onHide, config.id]);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, isTouch = false) => {
      event.stopPropagation();

      // Already hidden in THIS bush: do nothing. No second walk, no repeated
      // rustle/shake/leaves, no re-published presence.
      if (isHiddenHereRef.current) return;

      const target = computeBushTarget(event.currentTarget, config.interactionTarget);
      if (!target) return;

      requestInteraction({
        target,
        touch: isTouch,
        action: onArrive,
        onCancel: () => {
          // Walk abandoned before arrival — nothing was triggered, nothing to undo.
        },
      });
    },
    [requestInteraction, onArrive, config.interactionTarget],
  );

  return (
    <div
      data-block-move
      data-bush-id={config.id}
      className={cn(
        'absolute cursor-pointer select-none bush-hover-sway',
        config.positionClass,
      )}
      // Fixed at all times: hiding never touches the stacking order.
      style={{ zIndex: config.zIndex }}
      onClick={handleClick}
      onTouchStart={(e) => {
        e.preventDefault();
        handleClick(e as unknown as React.MouseEvent<HTMLDivElement>, true);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <img
        src={config.src}
        alt={config.alt}
        draggable={false}
        className={cn(
          'w-full h-full object-contain bush-sway-target',
          isShaking && 'animate-bush-shake',
        )}
      />

      {/* Leaf particle burst — lightweight CSS-animated spans, no canvas/gif. */}
      {leaves.length > 0 && (
        <div className="pointer-events-none absolute inset-0 overflow-visible">
          {leaves.map((leaf) => (
            <span
              key={leaf.id}
              className="animate-leaf-burst absolute block rounded-[2px]"
              style={{
                left: `${leaf.left}%`,
                top: '30%',
                width: 6,
                height: 4,
                backgroundColor: leaf.hue,
                ['--leaf-dx' as string]: `${leaf.dx}px`,
                ['--leaf-dy' as string]: `${leaf.dy}px`,
                ['--leaf-rot' as string]: `${leaf.rot}deg`,
                ['--leaf-duration' as string]: `${leaf.duration}s`,
                animationDelay: `${leaf.delay}s`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
