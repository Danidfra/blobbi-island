/**
 * The V3 identity of a kind 31124 that Island did not parse through
 * `parsePetState`: a stranger's event, read for drawing only.
 *
 * Nothing is interpreted here. `parseBlobbiV3Identity` is core's reading of
 * the V3 contract (a malformed colour or kind is simply absent, and the seed
 * is canonical or absent), and what it returns is handed to the renderer,
 * which draws exactly what the event states and never guesses at the rest
 * from Island defaults. A V1 or V2 event has no such identity.
 */
import { parseBlobbiV3Identity, parseVisualGeneration } from '@blobbi-kit/core';
import type { BlobbiV3Visual } from '@blobbi-kit/renderer';

export function v3VisualFromTags(tags: string[][]): BlobbiV3Visual | undefined {
  if (parseVisualGeneration(tags) !== 'v3') return undefined;
  const { seed, algorithm, colors, traits } = parseBlobbiV3Identity(tags);
  const visual: BlobbiV3Visual = { colors, traits };
  if (seed !== undefined) visual.seed = seed;
  if (algorithm !== undefined) visual.algorithm = algorithm;
  return visual;
}
