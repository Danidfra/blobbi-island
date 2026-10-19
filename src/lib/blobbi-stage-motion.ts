/**
 * How a Blobbi moves at rest, by life stage: a pure rule the local actor and
 * the remote sprites share, so the two can never disagree.
 *
 * A BABY is a small, light thing: it floats, bobbing gently up and down over
 * its shadow (the Island's own `animate-float`, with the shadow breathing in
 * step on the ground). An ADULT has feet: it stands on the ground, breathes
 * where it stands (the renderer's grounded `idle` motion, whose transform
 * origin is the feet), and WALKS when it moves (the renderer's gait). An EGG
 * rests. Nothing of the baby's hover is inherited by an adult, whatever its
 * generation: the rule is the stage, not the artwork.
 *
 * The float itself is applied by `BlobbiActor` (it owns the wrapper the bob
 * lives on); the body only says whether it floats (`actor-artwork-context`).
 */
import { DEFAULT_STAGE, type BlobbiMotion, type BlobbiVisual } from '@blobbi-kit/renderer';

type Stage = NonNullable<BlobbiVisual['stage']>;

const stageOf = (visual: Pick<BlobbiVisual, 'stage'> | null | undefined): Stage => visual?.stage ?? DEFAULT_STAGE;

/** Whether this Blobbi hovers over its shadow at rest: only a baby does. */
export function stageFloats(visual: Pick<BlobbiVisual, 'stage'> | null | undefined): boolean {
  return stageOf(visual) === 'baby';
}

/**
 * The body motion to draw. Walking is walking for everyone. At rest, a baby
 * is `still` (the Island floats it), an adult breathes in place (`idle`, the
 * renderer's grounded breathing), and an egg is `still`.
 */
export function resolveBodyMotion(visual: Pick<BlobbiVisual, 'stage'> | null | undefined, motion: BlobbiMotion | undefined): BlobbiMotion {
  if (motion === 'walking') return 'walking';
  const stage = stageOf(visual);
  if (stage === 'adult') return 'idle';
  return motion ?? 'still';
}
