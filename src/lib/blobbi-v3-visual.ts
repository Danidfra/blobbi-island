/**
 * The V3 identity of a kind 31124 that Island did not parse through
 * `parsePetState`: a stranger's event, read for drawing only.
 *
 * A V3 Blobbi IS its address: core derives the seed from the event's author
 * and `d` (`parseBlobbiV3Identity`), and the renderer derives everything
 * else from that seed under Algorithm 1. Nothing is read from a colour,
 * trait, seed or algorithm tag, so a forged one changes nothing. A V1 or V2
 * event has no such identity.
 */
import { parseBlobbiV3Identity, parseVisualGeneration } from '@blobbi-kit/core';
import type { BlobbiV3Visual } from '@blobbi-kit/renderer';

export function v3VisualFromEvent(event: { pubkey?: string; tags: string[][] }): BlobbiV3Visual | undefined {
  if (parseVisualGeneration(event.tags) !== 'v3') return undefined;
  const { seed, algorithm } = parseBlobbiV3Identity(event);
  const visual: BlobbiV3Visual = { algorithm };
  if (seed !== undefined) visual.seed = seed;
  return visual;
}
