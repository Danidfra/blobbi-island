/**
 * Treasure Hunt: the playfield.
 *
 * Rendering and input only: the round state it receives IS the game (the pure
 * reducer's state); this component never keeps a parallel copy of targets,
 * digs or time. Presentation-only state is the dragged pointer id, the
 * measured surface size and the transient find toast.
 *
 * ## Input
 *
 * The Air Hockey pointer block, applied to a detector: `preventDefault` +
 * cached rect + `setPointerCapture` on pointer-down, all four terminators
 * (`up`, `cancel`, `lostpointercapture`, plus `blur`), `touch-none
 * select-none` and the `[data-treasure-field]` CSS rule so a phone drag moves
 * the coil instead of the page. The detector follows the pointer through the
 * CLAMPED mapping (a drag that leaves the sand pins the coil to the edge);
 * the shovel uses the STRICT mapping (a tap outside the sand is refused and
 * costs nothing). The rendered sprite hangs off the logical coil point via
 * the calibration in `treasure-hunt-config.ts`: never the other way around.
 *
 * ## What the player is never shown
 *
 * Target positions. The only signal surfaces are the meter, the glow and the
 * beep, all driven by the pure `DetectorSignal`. The dev overlays that DO
 * draw targets and radii render exclusively when the harness passes
 * `devOverlays`: no production caller does.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import {
  evaluateDetectorSignal,
  type Point,
  type TreasureHuntRound,
} from '@/beach/treasure-hunt';
import {
  containerPointToField,
  containerPointToFieldClamped,
  fieldPointToImagePercent,
  fitFieldLayout,
  type FieldMapping,
} from './field-transform';
import {
  DETECTOR_CALIBRATION,
  DETECTOR_DOCK,
  DUG_HOLE_RENDER_FRACTION,
  PLAYFIELD_IMAGE_ASPECT,
  SAND_RECT,
  SHOVEL_CURSOR,
  TREASURE_HUNT_ASSETS,
  findPresentation,
  signalDisplayState,
} from './treasure-hunt-config';

export type TreasureTool = 'detector' | 'shovel';

export interface TreasureHuntDevOverlays {
  revealTargets?: boolean;
  showDetectionRadius?: boolean;
  showDigRadius?: boolean;
  showCoilAnchor?: boolean;
  showCoordinates?: boolean;
}

interface TreasureHuntGameProps {
  round: TreasureHuntRound;
  paused: boolean;
  tool: TreasureTool;
  onToolChange: (tool: TreasureTool) => void;
  onMoveDetector: (position: Point) => void;
  onDig: (position: Point) => void;
  muted: boolean;
  onToggleMuted: () => void;
  /** Small "Rewarded Hunt" indicator; the amount is never shown mid-round. */
  rewarded?: boolean;
  /** Dev-harness override; production leaves it undefined. */
  reducedMotionOverride?: boolean;
  /** Dev-harness overlays; production leaves it undefined. */
  devOverlays?: TreasureHuntDevOverlays;
}

const SAND_HEIGHT_FRACTION = SAND_RECT.y1 - SAND_RECT.y0;

export function TreasureHuntGame({
  round,
  paused,
  tool,
  onToolChange,
  onMoveDetector,
  onDig,
  muted,
  onToggleMuted,
  rewarded = false,
  reducedMotionOverride,
  devOverlays,
}: TreasureHuntGameProps) {
  const systemReducedMotion = useReducedMotion();
  const reducedMotion = reducedMotionOverride ?? systemReducedMotion;

  const containerRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const draggingRef = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  /** Fine-pointer (mouse/trackpad) device, gates the decorative shovel cursor. */
  const [finePointer] = useState(() => {
    // Same defensive shape as `useImmersive`: a throwing or partial matchMedia
    // (jsdom, odd embedders) must degrade to "coarse", never crash a render.
    try {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
      return window.matchMedia('(pointer: fine)')?.matches === true;
    } catch {
      return false;
    }
  });
  /** Container-local px of the tracked pointer while the shovel is selected. */
  const [cursorPoint, setCursorPoint] = useState<{ x: number; y: number } | null>(null);

  // Measure outside the render path: ResizeObserver + resize + orientation,
  // with a sub-pixel filter so layout jitter cannot re-render the field.
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize((previous) =>
        Math.abs(previous.width - rect.width) < 0.5 &&
        Math.abs(previous.height - rect.height) < 0.5
          ? previous
          : { width: rect.width, height: rect.height }
      );
    };
    measure();
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  const mapping = useMemo<FieldMapping>(
    () => ({
      layout: fitFieldLayout(size.width, size.height, PLAYFIELD_IMAGE_ASPECT),
      sandRect: SAND_RECT,
      fieldWidth: round.policy.fieldWidth,
      fieldHeight: round.policy.fieldHeight,
    }),
    [size, round.policy.fieldWidth, round.policy.fieldHeight]
  );

  const signal = useMemo(
    () => evaluateDetectorSignal(round.coilPosition, round.targets, round.policy),
    [round]
  );
  const docked = tool !== 'detector';
  // The docked detector is DEACTIVATED: its screen shows the no-signal state,
  // so an idle instrument can never keep providing useful guidance.
  const displayState = docked ? signalDisplayState(0) : signalDisplayState(signal.intensity);

  // Transient find toast, derived from the reducer's found list.
  const [toastKind, setToastKind] = useState<string | null>(null);
  const foundCount = round.foundTargetIds.length;
  const lastFoundId = foundCount > 0 ? round.foundTargetIds[foundCount - 1] : null;
  useEffect(() => {
    if (!lastFoundId) return;
    const target = round.targets.find((t) => t.id === lastFoundId);
    if (!target) return;
    setToastKind(target.kind);
    const timer = window.setTimeout(() => setToastKind(null), 2400);
    return () => window.clearTimeout(timer);
    // `round.targets` only changes reference on a hit, so this re-arms exactly
    // once per find (misses and moves keep the same array reference).
  }, [lastFoundId, round.targets]);

  const interactive = round.status === 'searching' && !paused;

  // Brief shovel-dip feedback on each accepted dig (any dig grows the history).
  const digCount = round.digHistory.length;
  const prevDigCount = useRef(digCount);
  const [digAnimating, setDigAnimating] = useState(false);
  useEffect(() => {
    const isNewDig = digCount > prevDigCount.current;
    prevDigCount.current = digCount;
    if (!isNewDig || reducedMotion) return;
    setDigAnimating(true);
    const timer = window.setTimeout(() => setDigAnimating(false), 240);
    return () => window.clearTimeout(timer);
  }, [digCount, reducedMotion]);

  // Switching away from the detector mid-drag releases the pointer capture
  // immediately; the coil simply stays where it was.
  useEffect(() => {
    if (tool === 'detector') return;
    if (draggingRef.current !== null) {
      const element = containerRef.current;
      if (element?.hasPointerCapture?.(draggingRef.current)) {
        element.releasePointerCapture(draggingRef.current);
      }
      draggingRef.current = null;
      rectRef.current = null;
    }
  }, [tool]);

  const toContainerPoint = (event: React.PointerEvent) => {
    const rect =
      rectRef.current ?? containerRef.current?.getBoundingClientRect() ?? null;
    if (!rect) return null;
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const endDrag = (event: React.PointerEvent | null) => {
    if (event && draggingRef.current !== null) {
      const element = containerRef.current;
      if (element?.hasPointerCapture?.(draggingRef.current)) {
        element.releasePointerCapture(draggingRef.current);
      }
    }
    draggingRef.current = null;
    rectRef.current = null;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    event.preventDefault();
    rectRef.current = event.currentTarget.getBoundingClientRect();
    const local = toContainerPoint(event);
    if (!local) return;

    if (tool === 'shovel') {
      const dug = containerPointToField(local.x, local.y, mapping);
      if (dug) onDig(dug);
      rectRef.current = null;
      return;
    }

    draggingRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const coil = containerPointToFieldClamped(local.x, local.y, mapping);
    if (coil) onMoveDetector(coil);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    if (tool === 'shovel' && finePointer) {
      const local = toContainerPoint(event);
      if (local) setCursorPoint(local);
    }
    if (draggingRef.current !== event.pointerId) return;
    const local = toContainerPoint(event);
    if (!local) return;
    const coil = containerPointToFieldClamped(local.x, local.y, mapping);
    if (coil) onMoveDetector(coil);
  };

  const remainingSeconds = Math.max(
    0,
    Math.ceil(round.policy.roundDurationSeconds - round.elapsedSeconds)
  );

  const coilPercent = fieldPointToImagePercent(round.coilPosition, mapping);
  const detectorHeightPercent =
    DETECTOR_CALIBRATION.renderHeightSandFraction * SAND_HEIGHT_FRACTION * 100;
  const detectorAspect =
    DETECTOR_CALIBRATION.viewBoxWidth / DETECTOR_CALIBRATION.viewBoxHeight;
  /** px per logical field unit; the field is isotropic on screen by design. */
  const pxPerUnit = mapping.layout.imageHeight * SAND_HEIGHT_FRACTION;

  /* The rendered detector: at the coil while active, parked toward the tool
     dock while the shovel is selected. Presentation only, the round's
     coilPosition is untouched, so re-selecting the detector animates it
     straight back to the searched spot. */
  const detectorBoxStyle: React.CSSProperties = docked
    ? {
        left: `${DETECTOR_DOCK.leftPercent}%`,
        top: `${DETECTOR_DOCK.topPercent}%`,
        height: `${detectorHeightPercent * DETECTOR_DOCK.scale}%`,
        opacity: DETECTOR_DOCK.opacity,
        aspectRatio: `${detectorAspect}`,
        transform: `translate(-${DETECTOR_CALIBRATION.coilAnchorX * 100}%, -${DETECTOR_CALIBRATION.coilAnchorY * 100}%) rotate(${DETECTOR_CALIBRATION.rotationDeg}deg)`,
      }
    : {
        left: `${coilPercent.leftPercent}%`,
        top: `${coilPercent.topPercent}%`,
        height: `${detectorHeightPercent}%`,
        opacity: 1,
        aspectRatio: `${detectorAspect}`,
        transform: `translate(-${DETECTOR_CALIBRATION.coilAnchorX * 100}%, -${DETECTOR_CALIBRATION.coilAnchorY * 100}%) rotate(${DETECTOR_CALIBRATION.rotationDeg}deg)`,
      };

  /* The detector SVG's own screen is the primary signal instrument: the file
     ships CSS-custom-property hooks (th-display-screen, th-signal-dot,
     th-signal-arc-1..3), set here from the centralized display state and
     rendered through an external <use> so the artwork stays a single asset. */
  const displayVars = {
    ...(displayState.screenFill ? { '--th-screen-fill': displayState.screenFill } : {}),
    '--th-dot-opacity': displayState.dotActive ? 1 : 0.25,
    '--th-arc1-opacity': displayState.activeArcs >= 1 ? 1 : 0.15,
    '--th-arc2-opacity': displayState.activeArcs >= 2 ? 1 : 0.15,
    '--th-arc3-opacity': displayState.activeArcs >= 3 ? 1 : 0.15,
  } as React.CSSProperties;

  /* Decorative desktop shovel cursor: presentation only, blade tip on the
     exact dig point, never rendered outside the sand and never a pointer
     target itself. Dig coordinates always come from the pointer. */
  const shovelCursorVisible = Boolean(
    interactive &&
      tool === 'shovel' &&
      finePointer &&
      cursorPoint &&
      containerPointToField(cursorPoint.x, cursorPoint.y, mapping) !== null
  );
  const shovelCursorHeightPx = SHOVEL_CURSOR.renderHeightSandFraction * pxPerUnit;

  const toolHint =
    tool === 'shovel'
      ? `Tap the sand to dig, ${round.shovelUsesRemaining} dig${round.shovelUsesRemaining === 1 ? '' : 's'} remaining`
      : 'Drag the detector across the sand and watch the signal';

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-treasure-game>
      {/* Top bar */}
      <div
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm font-semibold text-island-ink"
        data-treasure-hud
      >
        {rewarded && (
          <span
            className="rounded-full bg-island-warn/25 px-2 py-0.5 text-xs font-semibold text-island-wood-dark"
            data-treasure-rewarded-chip
          >
            Rewarded Hunt
          </span>
        )}
        <span data-treasure-time>
          <span aria-hidden>⏱️ </span>
          <span className="sr-only">Time remaining: </span>
          {remainingSeconds}s
        </span>
        <span data-treasure-digs aria-live="polite">
          <span aria-hidden>⛏️ </span>
          <span className="sr-only">Shovel uses remaining: </span>
          {round.shovelUsesRemaining}
        </span>
        <span data-treasure-finds>
          <span aria-hidden>🎒 </span>
          <span className="sr-only">Finds: </span>
          {foundCount}
        </span>
        <button
          type="button"
          onClick={onToggleMuted}
          aria-pressed={muted}
          aria-label={muted ? 'Unmute detector sounds' : 'Mute detector sounds'}
          className="min-h-[44px] min-w-[44px] rounded-full border border-island-wood/30 bg-island-cream/80 px-3 text-base"
          data-treasure-mute
        >
          <span aria-hidden>{muted ? '🔇' : '🔊'}</span>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-stretch gap-2">
        {/* Left dock: shovel */}
        <div className="flex shrink-0 flex-col items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => onToolChange('shovel')}
            aria-pressed={tool === 'shovel'}
            aria-label={`Shovel: ${round.shovelUsesRemaining} uses remaining`}
            disabled={!interactive && round.status === 'finished'}
            className={cn(
              'flex min-h-[56px] min-w-[56px] flex-col items-center justify-center rounded-2xl border-2 bg-island-cream/85 p-1.5',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-island-ink',
              !reducedMotion && 'transition-all duration-200',
              tool === 'shovel'
                ? 'border-island-ink opacity-100 shadow-md'
                : 'border-island-wood/30 opacity-45 scale-90'
            )}
            data-treasure-tool-shovel
          >
            <img src={TREASURE_HUNT_ASSETS.shovel} alt="" className="h-8 w-4 object-contain" draggable={false} />
            <span className="text-[10px] font-semibold text-island-ink">Shovel</span>
          </button>
          <span className="text-xs font-bold text-island-ink" aria-hidden>
            ×{round.shovelUsesRemaining}
          </span>
        </div>

        {/* Playfield */}
        <div
          ref={containerRef}
          data-treasure-field
          data-tool={tool}
          className="relative min-h-0 flex-1 touch-none select-none overflow-hidden rounded-2xl bg-sky-200/40"
          style={{ cursor: shovelCursorVisible ? 'none' : undefined }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => endDrag(event)}
          onPointerCancel={(event) => endDrag(event)}
          onPointerLeave={() => setCursorPoint(null)}
          onLostPointerCapture={() => endDrag(null)}
          onBlur={() => endDrag(null)}
        >
          <div
            className="absolute"
            data-treasure-image-box
            style={{
              left: mapping.layout.imageLeft,
              top: mapping.layout.imageTop,
              width: mapping.layout.imageWidth,
              height: mapping.layout.imageHeight,
            }}
          >
            <img
              src={TREASURE_HUNT_ASSETS.playfield}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full"
            />

            {/* Dig markers: every accepted dig, hit or miss, stays visible. */}
            {round.digHistory.map((record, index) => {
              const at = fieldPointToImagePercent(record.position, mapping);
              return (
                <div
                  key={`dig-${index}`}
                  data-dig-marker={record.outcome}
                  className={cn(
                    'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2',
                    record.outcome === 'miss' && 'opacity-75'
                  )}
                  style={{
                    left: `${at.leftPercent}%`,
                    top: `${at.topPercent}%`,
                    height: `${DUG_HOLE_RENDER_FRACTION * SAND_HEIGHT_FRACTION * 100}%`,
                    aspectRatio: '1',
                  }}
                >
                  <img src={TREASURE_HUNT_ASSETS.dugHole} alt="" className="h-full w-full" draggable={false} />
                </div>
              );
            })}

            {/* Revealed finds at their target positions. */}
            {round.targets
              .filter((target) => target.found)
              .map((target) => {
                const at = fieldPointToImagePercent(target.position, mapping);
                const presentation = findPresentation(target.kind);
                return (
                  <div
                    key={target.id}
                    data-find-marker={target.category}
                    role="img"
                    aria-label={`Revealed find: ${presentation.name}`}
                    className={cn(
                      'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-2xl drop-shadow',
                      !reducedMotion && 'arcade-pop-in'
                    )}
                    style={{ left: `${at.leftPercent}%`, top: `${at.topPercent}%` }}
                  >
                    <span aria-hidden>{presentation.icon}</span>
                  </div>
                );
              })}

            {/* Detector: a rendered game object hung off the logical coil
                point via the calibration anchor; never an OS cursor. While the
                shovel is selected it parks toward the dock, dimmed, display
                dark and glow off, deactivated, not just quieter. */}
            <div
              className={cn(
                'pointer-events-none absolute',
                !reducedMotion && 'transition-[left,top,height,opacity] duration-300 ease-out'
              )}
              data-treasure-detector
              data-docked={docked || undefined}
              data-signal-level={displayState.level}
              style={detectorBoxStyle}
            >
              {/* Coil glow scales with the pure signal. Decoration only, and
                  only while the detector is the active tool. */}
              {!docked && (
                <div
                  aria-hidden
                  className={cn(
                    'absolute rounded-full bg-island-warn blur-md transition-opacity',
                    !reducedMotion && signal.intensity > 0 && 'animate-pulse'
                  )}
                  style={{
                    left: `${DETECTOR_CALIBRATION.coilAnchorX * 100}%`,
                    top: `${DETECTOR_CALIBRATION.coilAnchorY * 100}%`,
                    width: '55%',
                    aspectRatio: '1',
                    transform: 'translate(-50%, -50%)',
                    opacity: signal.intensity * 0.7,
                  }}
                />
              )}
              <svg
                viewBox={`0 0 ${DETECTOR_CALIBRATION.viewBoxWidth} ${DETECTOR_CALIBRATION.viewBoxHeight}`}
                className="relative h-full w-full"
                style={displayVars}
                aria-hidden="true"
                focusable="false"
              >
                <use href={`${TREASURE_HUNT_ASSETS.detector}#metal-detector`} />
              </svg>
            </div>

            {/* Decorative desktop shovel cursor (fine pointers only). */}
            {shovelCursorVisible && cursorPoint && (
              <div
                data-treasure-shovel-cursor
                className="pointer-events-none absolute"
                style={{
                  left: cursorPoint.x - mapping.layout.imageLeft,
                  top: cursorPoint.y - mapping.layout.imageTop,
                  height: shovelCursorHeightPx,
                  aspectRatio: `${SHOVEL_CURSOR.viewBoxWidth / SHOVEL_CURSOR.viewBoxHeight}`,
                }}
              >
                <div
                  className="h-full w-full"
                  style={{
                    transform: `translate(-${SHOVEL_CURSOR.tipAnchorX * 100}%, -${SHOVEL_CURSOR.tipAnchorY * 100}%)`,
                  }}
                >
                  <img
                    src={TREASURE_HUNT_ASSETS.shovel}
                    alt=""
                    draggable={false}
                    className={cn('h-full w-full', digAnimating && 'treasure-shovel-dig')}
                  />
                </div>
              </div>
            )}

            {/* ── Dev-harness overlays. Production passes no devOverlays. ── */}
            {devOverlays?.revealTargets &&
              round.targets.map((target) => {
                const at = fieldPointToImagePercent(target.position, mapping);
                return (
                  <div
                    key={`dev-${target.id}`}
                    data-dev-target={target.id}
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-center"
                    style={{ left: `${at.leftPercent}%`, top: `${at.topPercent}%` }}
                  >
                    <div
                      className={cn(
                        'mx-auto h-2.5 w-2.5 rounded-full border border-black/60',
                        target.category === 'litter' && 'bg-stone-400',
                        target.category === 'valuable' && 'bg-amber-400',
                        target.category === 'special' && 'bg-fuchsia-400',
                        target.found && 'opacity-30'
                      )}
                    />
                    <div className="rounded bg-black/60 px-1 text-[9px] leading-tight text-white">
                      {target.id} · {target.category}
                      {devOverlays.showCoordinates && (
                        <div>
                          {target.position.x.toFixed(2)},{target.position.y.toFixed(2)}
                        </div>
                      )}
                    </div>
                    {devOverlays.showDetectionRadius && (
                      <div
                        className="pointer-events-none absolute left-1/2 top-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-blue-500/70"
                        style={{
                          width: target.detectionRadius * 2 * pxPerUnit,
                          height: target.detectionRadius * 2 * pxPerUnit,
                        }}
                      />
                    )}
                    {devOverlays.showDigRadius && (
                      <div
                        className="pointer-events-none absolute left-1/2 top-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-600/80"
                        style={{
                          width: target.digRadius * 2 * pxPerUnit,
                          height: target.digRadius * 2 * pxPerUnit,
                        }}
                      />
                    )}
                  </div>
                );
              })}
            {devOverlays?.showCoilAnchor && (
              <div
                data-dev-coil-anchor
                className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-red-600"
                style={{ left: `${coilPercent.leftPercent}%`, top: `${coilPercent.topPercent}%` }}
              >
                {devOverlays.showCoordinates && (
                  <span className="absolute left-3 top-0 whitespace-nowrap rounded bg-black/60 px-1 text-[9px] text-white">
                    {round.coilPosition.x.toFixed(2)},{round.coilPosition.y.toFixed(2)}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Find toast: brief, non-blocking, out of the core search area. */}
          {toastKind && (
            <div
              role="status"
              data-treasure-toast
              className={cn(
                'pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-island-ink/85 px-4 py-1.5 text-sm font-semibold text-white',
                !reducedMotion && 'arcade-pop-in'
              )}
            >
              You found a {findPresentation(toastKind).name}!
            </div>
          )}

          {paused && (
            <div
              className="absolute inset-0 z-10 flex items-center justify-center bg-island-ink/40"
              data-treasure-paused
            >
              <p className="rounded-full bg-island-cream/95 px-5 py-2 text-base font-bold text-island-ink shadow-cozy-soft">
                Paused
              </p>
            </div>
          )}
        </div>

        {/* Right dock: detector + signal meter */}
        <div className="flex shrink-0 flex-col items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => onToolChange('detector')}
            aria-pressed={tool === 'detector'}
            aria-label="Metal detector"
            disabled={!interactive && round.status === 'finished'}
            className={cn(
              'flex min-h-[56px] min-w-[56px] flex-col items-center justify-center rounded-2xl border-2 bg-island-cream/85 p-1.5',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-island-ink',
              !reducedMotion && 'transition-all duration-200',
              tool === 'detector'
                ? 'border-island-ink opacity-100 shadow-md'
                : 'border-island-wood/30 opacity-45 scale-90'
            )}
            data-treasure-tool-detector
          >
            <img src={TREASURE_HUNT_ASSETS.detector} alt="" className="h-8 w-4 object-contain" draggable={false} />
            <span className="text-[10px] font-semibold text-island-ink">Detector</span>
          </button>

          {/* Compact status only: the detector's own screen is the primary
              signal instrument, so a second prominent meter would compete
              with it. This keeps a text state plus the live region. */}
          <p
            className="text-center text-[10px] font-semibold uppercase leading-tight text-island-ink"
            data-treasure-signal-status
            data-signal-level={displayState.level}
          >
            <span aria-hidden>
              {displayState.level === 'none' ? 'quiet' : displayState.level.replace('-', ' ')}
            </span>
            <span className="sr-only" aria-live="polite">
              {displayState.label}
            </span>
          </p>
        </div>
      </div>

      {/* Contextual hint */}
      <p className="text-center text-sm text-island-ink" data-treasure-hint>
        {toolHint}
      </p>
    </div>
  );
}
