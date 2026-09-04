/**
 * Spatial-intent types (Phase 3).
 *
 * Not every `Position` means the same thing. The ground-anchor migration
 * exposed four distinct intents that had been flowing through one generic
 * type, and the bugs it fixed were exactly the accidental mixes (a pose
 * anchor fed into boundary-constrained movement; a wire center rendered as a
 * ground point). These aliases give each intent a name so APIs can state what
 * they accept and return.
 *
 * They are DOCUMENTATION ALIASES, not branded types, by the same reasoning
 * recorded in `src/lib/blobbi-ground.ts`: position values flow through dozens
 * of signatures (movement, boundaries, presence, gaze) and a brand would
 * force churn without preventing the real hazards, which are instead confined
 * to explicit conversion points:
 *
 *  - legacy wire center ↔ ground: ONLY `groundToWireCenter` /
 *    `wireCenterToGround` (src/lib/presence-ground.ts);
 *  - pose anchors enter the world ONLY through `snapTo(...)` (the explicit
 *    boundary-bypassing snap), never through walking `goTo(...)`;
 *  - approach targets are produced ONLY by the canonical
 *    `resolveElementApproachTarget` / config helpers and consumed by
 *    `requestInteraction`.
 */

import type { Position } from '@/lib/types';

/**
 * World-percent position of an actor's GROUND-CONTACT point, where the feet
 * touch the floor. Constrained by room boundaries. The storage semantics of
 * every actor position since the ground-anchor migration.
 */
export type GroundPosition = Position;

/**
 * A GROUND point an actor walks to before an interaction fires (a door's
 * base, the floor in front of a seat or machine). Always boundary-clamped
 * when produced by the canonical resolver, and consumed by
 * `requestInteraction`: never by pose snapping.
 */
export type ApproachTarget = GroundPosition;

/**
 * An explicitly modeled VISUAL pose anchor (a seat cushion contact point, the
 * bed's sleeping spot). May sit OUTSIDE the walk boundary, furniture is not
 * floor: so it must only ever be applied with `snapTo(...)`, never as a walk
 * target.
 */
export type PoseAnchor = Position;

/**
 * The legacy kind-31950 wire format's CENTER point (`anchor`/`goal` in
 * presence content). Never valid inside the Island; convert at the presence
 * adapter boundary only (src/lib/presence-ground.ts).
 */
export type LegacyCenterPosition = Position;

/**
 * A fractional point (0..1 per axis) inside an object's OWN rendered rect,
 * e.g. a seat's cushion line `{ x: 0.5, y: 0.2 }` or a door-base aim point.
 * Meaningless without the object; convert via `elementFractionToWorldPercent`.
 */
export interface ObjectFraction {
  x: number;
  y: number;
}
