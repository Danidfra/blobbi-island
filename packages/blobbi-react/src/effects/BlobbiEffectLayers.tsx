/**
 * The generic effect WALKER.
 *
 * One component draws all twelve effects, because an effect is data
 * (`effect-catalog.ts`) rather than code. What this file owns is the three
 * things that data cannot express:
 *
 *  1. turning a range into a value, deterministically;
 *  2. the two-element track/piece structure that makes box-relative travel and
 *     independent in-place animation possible at the same time;
 *  3. the guarantee that none of it can touch layout, hit-testing or the body.
 *
 * ## Why every piece is two elements
 *
 * A particle is a `.blobbi-fx-track` (absolutely positioned, `inset: 0`, i.e.
 * exactly the renderer box) containing a `.blobbi-fx-piece` (small, positioned
 * inside it). The wrapper exists for one reason: CSS percentage translations
 * resolve against the ELEMENT'S OWN size. A 3 %-wide mote asked to
 * `translateY(-45%)` moves by 45 % of 3 %. Put the travel on a box-sized track
 * and `-45%` means 45 % of the box, which is what "drifts up past the head"
 * requires. It also gives each particle two independent animation timelines,
 * travel and twinkle, with no keyframe combinatorics.
 *
 * ## Why it cannot affect anything around it
 *
 * Every element here is `position: absolute` inside the renderer box and
 * carries `pointer-events: none`. Nothing is in flow, so no effect can change a
 * measurement; nothing hit-tests, so no effect can steal a click from the
 * Blobbi underneath. Layers may extend beyond the box (an aura is 1.7× the
 * body): the renderer has always clipped nothing, and overflow is not layout.
 *
 * ## Determinism
 *
 * Every varying number comes from `unitFor(seed, index, field)`. The seed is
 * `instanceId:effectId`, so: the same Blobbi always looks the same (re-renders
 * never teleport a particle, and a server render matches its hydration), while
 * two Blobbis standing side by side get different scatters instead of moving in
 * lockstep. No `Math.random()`, no `Date.now()`, no timer, no
 * `requestAnimationFrame`, no state.
 */
import type { CSSProperties } from 'react';
import {
  BLOBBI_VISUAL_EFFECT_PRESETS,
  type EffectLayer,
  type EffectPieceGroup,
  type EffectRange,
} from './effect-catalog';
import type { ResolvedBlobbiVisualEffect } from './effect-model';
import { pickFor, roundedRangeFor } from './deterministic';
import { pieceShapeStyle } from './effect-shapes';
import { effectStylesheetFor } from './effect-styles';
import { LightningEffect } from './LightningEffect';

/**
 * How far outside the renderer box each layer may reach.
 *
 * The aura presets are up to 172 % of the box, so a layer inset of −40 % gives
 * them room without any element needing its own overflow rules. This changes
 * nothing about layout: the layer is absolutely positioned, and the renderer
 * box's own size is set by its Tailwind size class alone.
 */
const LAYER_INSET = '-40%';

/** Deterministic value from a range, or the range's single value if degenerate. */
function fromRange(
  range: EffectRange | undefined,
  seed: string,
  index: number,
  field: string,
  fallback = 0,
  decimals = 2,
): number {
  if (!range) return fallback;
  const [min, max] = range;
  if (min === max) return min;
  return roundedRangeFor(seed, index, field, min, max, decimals);
}

/**
 * The CSS `animation` shorthand for one element, or `undefined` for none.
 *
 * Built from the preset's own fields only; there is no code path by which a
 * caller-supplied string reaches this. That matters: `animation` accepts a
 * name, and an arbitrary name from outside would be a way to invoke CSS the
 * package did not write.
 */
function animationShorthand(
  name: string | undefined,
  durationS: number,
  delayS: number,
  timing: string,
  direction: 'normal' | 'reverse',
  fill?: 'backwards',
): string | undefined {
  if (!name) return undefined;
  return `${name} ${durationS}s ${timing} ${delayS}s infinite ${direction}${fill ? ` ${fill}` : ''}`;
}

interface PieceNodeProps {
  group: EffectPieceGroup;
  seed: string;
  /** Index WITHIN the effect (not within the group): see `pieceSeedIndex`. */
  index: number;
  /** Clamped caller intensity, folded into each piece's resting opacity. */
  intensity: number;
}

function EffectPieceNode({ group, seed, index, intensity }: PieceNodeProps) {
  const { track, piece } = group;

  // ── The track: where this particle travels ──────────────────────────────
  const trackDuration = fromRange(track.durationS, seed, index, 'td', 6, 2);
  const trackDelay = fromRange(track.delayS, seed, index, 'tl', 0, 2);
  const trackStyle: CSSProperties = {
    animation: animationShorthand(
      track.animation,
      trackDuration,
      trackDelay,
      track.timing ?? 'ease-in-out',
      track.direction ?? 'normal',
    ),
  };

  if (track.dxPct) {
    setVar(trackStyle, '--fx-dx', `${fromRange(track.dxPct, seed, index, 'dx')}%`);
  }
  if (track.dyPct) {
    setVar(trackStyle, '--fx-dy', `${fromRange(track.dyPct, seed, index, 'dy')}%`);
  }
  if (track.swayPct) {
    setVar(trackStyle, '--fx-sway', `${fromRange(track.swayPct, seed, index, 'sw')}%`);
  }
  // A fixed rotation and an animation would fight over `transform`, so the
  // preset's own rule is enforced here rather than trusted: still tracks only.
  if (track.rotateDeg && !track.animation) {
    const [min, max] = track.rotateDeg;
    if (min !== max || min !== 0) {
      trackStyle.transform = `rotate(${fromRange(track.rotateDeg, seed, index, 'rot', 0, 1)}deg)`;
    }
  }

  // ── The piece: what it is, and what it does in place ────────────────────
  const size = fromRange(piece.sizePct, seed, index, 'sz', 4);
  const x = fromRange(piece.xPct, seed, index, 'x', 50);
  const y = fromRange(piece.yPct, seed, index, 'y', 50);
  const color = pickFor(seed, index, 'c', group.colors);
  const pieceDuration = fromRange(piece.durationS, seed, index, 'pd', 3, 2);
  const pieceDelay = fromRange(piece.delayS, seed, index, 'pl', 0, 2);

  const pieceStyle: CSSProperties = {
    left: `${x}%`,
    top: `${y}%`,
    width: `${size}%`,
    height: `${size}%`,
    // Centring by negative margin rather than by `translate(-50%, -50%)`,
    // because `transform` belongs to the animation. The box is square, so a
    // percentage margin (which always resolves against WIDTH) is the same
    // fraction of the height, the piece lands centred on (x, y) exactly.
    marginLeft: `${-size / 2}%`,
    marginTop: `${-size / 2}%`,
    animation: animationShorthand(
      piece.animation,
      pieceDuration,
      pieceDelay,
      piece.timing ?? 'ease-in-out',
      piece.direction ?? 'normal',
      piece.fill,
    ),
    ...pieceShapeStyle(piece.kind, color, group.accent),
  };

  // The one visibility number, resolved in JS rather than in CSS: the authored
  // opacity times the caller's clamped intensity. Every keyframe expresses
  // opacity as `var(--fx-o)` or a fraction of it, so an animation can never
  // override what the caller asked for, and with animations off (reduced
  // motion) the base rule's `opacity: var(--fx-o)` is what remains on screen.
  setVar(
    pieceStyle,
    '--fx-o',
    String(
      Math.round(fromRange(piece.opacity, seed, index, 'op', 1, 3) * intensity * 1000) /
        1000,
    ),
  );

  if (piece.glitchXPct) {
    setVar(pieceStyle, '--fx-gx', `${fromRange(piece.glitchXPct, seed, index, 'gx')}%`);
  }
  if (piece.glitchYPct) {
    setVar(pieceStyle, '--fx-gy', `${fromRange(piece.glitchYPct, seed, index, 'gy')}%`);
  }


  return (
    <div className="blobbi-fx-track" style={trackStyle}>
      <div className="blobbi-fx-piece" style={pieceStyle} data-fx-shape={piece.kind} />
    </div>
  );
}

/** Set a CSS custom property on a style object without an `any` cast. */
function setVar(style: CSSProperties, name: string, value: string): void {
  (style as Record<string, string>)[name] = value;
}

/**
 * A piece's seed index, unique across the whole effect.
 *
 * Group-local indices would make the first piece of every group share a seed,
 * and three groups' first pieces would then sit at the same relative spot. The
 * offset is the sum of preceding group counts, stable, and derived from the
 * preset rather than from render order.
 */
function pieceSeedIndex(
  groups: readonly EffectPieceGroup[],
  groupIndex: number,
  pieceIndex: number,
): number {
  let offset = 0;
  for (let i = 0; i < groupIndex; i++) offset += groups[i].count;
  return offset + pieceIndex;
}

export interface BlobbiEffectLayerProps {
  /** Already normalized: known ids, one per slot, in canonical slot order. */
  effects: readonly ResolvedBlobbiVisualEffect[];
  layer: EffectLayer;
  /** The renderer's instance id, half of the particle seed. */
  instanceId: string;
}

/**
 * One effect layer (`behind`, `mid` or `front`).
 *
 * Renders nothing at all when no active effect has pieces on this layer, so an
 * effect-free Blobbi produces exactly the DOM it produced before this system
 * existed: the property `BlobbiRendererView.effects.test.tsx` asserts against
 * the Phase-6 baseline.
 */
export function BlobbiEffectLayer({
  effects,
  layer,
  instanceId,
}: BlobbiEffectLayerProps) {
  if (effects.length === 0) return null;

  const rendered = effects.flatMap((effect) => {
    const preset = BLOBBI_VISUAL_EFFECT_PRESETS[effect.id];
    const seed = `${instanceId}:${effect.id}`;

    // Lightning is structure, not scatter: its channel is a connected SVG
    // stroke that no generic piece walk can express, so it mounts as its own
    // renderer on the mid layer (over the body, under the front accessories),
    // alongside the effect's ordinary spark pieces. The special case is named
    // here, once, rather than smuggled into the data model as a component,
    // presets stay plain data.
    const structural =
      effect.id === 'electric-charge' && layer === 'mid' ? (
        <LightningEffect
          key={`${effect.id}-strike`}
          instanceId={instanceId}
          seed={seed}
          intensity={effect.intensity}
        />
      ) : null;

    const nodes = preset.groups.flatMap((group, groupIndex) => {
      if (group.layer !== layer) return [];
      return Array.from({ length: group.count }, (_, pieceIndex) => {
        const index = pieceSeedIndex(preset.groups, groupIndex, pieceIndex);
        return (
          <EffectPieceNode
            key={`${effect.id}-${index}`}
            group={group}
            seed={seed}
            index={index}
            intensity={effect.intensity}
          />
        );
      });
    });

    if (nodes.length === 0 && structural === null) return [];
    return [
      <div
        key={effect.id}
        // A plain positioned group, deliberately WITHOUT an `opacity` of its
        // own: a group opacity would create a stacking context and flatten the
        // layer ordering the effect depends on. Intensity is already folded
        // into each piece's `--fx-o`.
        style={GROUP_STYLE}
        data-blobbi-effect={effect.id}
        data-blobbi-effect-slot={effect.slot}
      >
        {structural}
        {nodes}
      </div>,
    ];
  });

  if (rendered.length === 0) return null;

  return (
    <div
      className="blobbi-fx-layer"
      data-blobbi-effect-layer={layer}
      style={{ inset: LAYER_INSET }}
    >
      {rendered}
    </div>
  );
}

/** Shared, frozen: every effect group is the same positioned, transparent box. */
const GROUP_STYLE: CSSProperties = { position: 'absolute', inset: 0 };

/**
 * The `<style>` element carrying the rules for the active effects.
 *
 * Emitted next to the layers, containing ONLY the keyframes those effects use,
 * and nothing when there are no effects. Duplicated identically if several
 * effect-bearing Blobbis are on screen; see `BLOBBI_EFFECT_STYLESHEET` for the
 * hoist-it-once alternative, and the audit §7 for why the package owns its CSS
 * as text at all.
 */
export function BlobbiEffectStyles({
  effects,
}: {
  effects: readonly ResolvedBlobbiVisualEffect[];
}) {
  if (effects.length === 0) return null;

  const animations = new Set<string>();
  for (const effect of effects) {
    const preset = BLOBBI_VISUAL_EFFECT_PRESETS[effect.id];
    for (const group of preset.groups) {
      if (group.track.animation) animations.add(group.track.animation);
      if (group.piece.animation) animations.add(group.piece.animation);
    }
    // Keyframes a structural renderer uses that no group names.
    for (const name of preset.extraAnimations ?? []) animations.add(name);
  }

  return (
    <style data-blobbi-effect-styles="">{effectStylesheetFor(animations)}</style>
  );
}
