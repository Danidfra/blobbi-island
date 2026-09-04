/**
 * The production policy that decides which silhouette and size each cloud passage
 * carries.
 *
 * Everything here is sampled over thousands of passages rather than pinned to one
 * timestamp: the point of the policy is its long-run distribution and its
 * invariants, and a single-instant assertion would prove neither.
 */
import { describe, it, expect } from 'vitest';

import { ISLAND_EPOCH_MS } from './island-clock';
import {
  ISLAND_CLOUD_ACTORS,
  ISLAND_CLOUD_SHAPE_PERIOD,
  ISLAND_CLOUD_SPECIAL_SLOTS,
  islandCloudAuthoredShape,
  islandCloudAuthoredSize,
  islandCloudCycleIndexAt,
  islandCloudPassage,
  islandCloudPassageAt,
  islandCloudPassageStartSeconds,
  islandCloudTravel,
  islandCloudWidestRenderedPx,
} from './island-sky-clouds';
import {
  ISLAND_CLOUD_SHAPES,
  type IslandCloudShape,
  type IslandCloudSize,
  isSpecialCloudShape,
} from './island-sky-cloud-shapes';

const W = 1046;
const A = ISLAND_CLOUD_ACTORS[0];
const B = ISLAND_CLOUD_ACTORS[1];
const C = ISLAND_CLOUD_ACTORS[2];

/** Every passage of every actor over a long stretch. */
function allPassages(passagesPerActor = 3000) {
  return ISLAND_CLOUD_ACTORS.flatMap((actor) =>
    Array.from({ length: passagesPerActor }, (_, i) => ({
      actor,
      passage: islandCloudPassage(actor, W, i),
    })),
  );
}

describe('the authored shape table', () => {
  it('holds 16 special slots in a 300-passage period, a ~5% rate', () => {
    expect(ISLAND_CLOUD_SHAPE_PERIOD).toBe(300);
    expect(ISLAND_CLOUD_SPECIAL_SLOTS).toHaveLength(16);
    const rate = ISLAND_CLOUD_SPECIAL_SLOTS.length / ISLAND_CLOUD_SHAPE_PERIOD;
    expect(rate).toBeGreaterThan(0.045);
    expect(rate).toBeLessThan(0.06);
  });

  it('makes poop the rarest slot in the table', () => {
    const counts = ISLAND_CLOUD_SPECIAL_SLOTS.reduce<Record<string, number>>((acc, [, shape]) => {
      acc[shape] = (acc[shape] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.poop).toBe(1);
    for (const [shape, count] of Object.entries(counts)) {
      if (shape !== 'poop') expect(count, shape).toBeGreaterThan(counts.poop);
    }
  });

  it('uses each slot position once and keeps them inside the period', () => {
    const slots = ISLAND_CLOUD_SPECIAL_SLOTS.map(([slot]) => slot);
    expect(new Set(slots).size).toBe(slots.length);
    for (const slot of slots) {
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(ISLAND_CLOUD_SHAPE_PERIOD);
    }
  });

  it('spreads the slots rather than clustering them', () => {
    const sorted = ISLAND_CLOUD_SPECIAL_SLOTS.map(([slot]) => slot).sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      // No two specials within ten passages of each other, so a player cannot
      // stumble on two formations back to back.
      expect(sorted[i] - sorted[i - 1], `slots ${sorted[i - 1]}→${sorted[i]}`).toBeGreaterThan(9);
    }
  });

  it('gives every actor a stride coprime with the period, so it walks the whole table', () => {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    for (const actor of ISLAND_CLOUD_ACTORS) {
      expect(gcd(actor.shapeStride, ISLAND_CLOUD_SHAPE_PERIOD), actor.id).toBe(1);
    }
    // Distinct strides and offsets: the actors must not march in step.
    expect(new Set(ISLAND_CLOUD_ACTORS.map((a) => a.shapeStride)).size).toBe(3);
    expect(new Set(ISLAND_CLOUD_ACTORS.map((a) => a.shapeOffset)).size).toBe(3);
  });

  it('visits every slot exactly once per period, for every actor', () => {
    for (const actor of ISLAND_CLOUD_ACTORS) {
      const shapes = Array.from({ length: ISLAND_CLOUD_SHAPE_PERIOD }, (_, i) =>
        islandCloudAuthoredShape(actor, i),
      );
      const specials = shapes.filter(isSpecialCloudShape);
      expect(specials.length, actor.id).toBe(ISLAND_CLOUD_SPECIAL_SLOTS.length);
    }
  });
});

describe('measured shape distribution', () => {
  const passages = allPassages();
  const share = (shape: IslandCloudShape) =>
    passages.filter((p) => p.passage.shape === shape).length / passages.length;

  it('keeps the ordinary cloud the overwhelming majority', () => {
    expect(share('normal')).toBeGreaterThan(0.93);
  });

  it('lands the total special rate near 5%', () => {
    const specials = 1 - share('normal');
    expect(specials).toBeGreaterThan(0.03);
    expect(specials).toBeLessThan(0.06);
  });

  it('hits each formation at roughly its target rate', () => {
    // Targets: egg 1.3%, baby 1.3%, adult 1.4%, heart 1.0%. Suppression (see the
    // conflict rules) shaves a little off each, so the bands are generous below.
    for (const shape of ['blobbi-egg', 'blobbi-baby', 'blobbi-adult'] as const) {
      expect(share(shape), shape).toBeGreaterThan(0.007);
      expect(share(shape), shape).toBeLessThan(0.016);
    }
    expect(share('heart')).toBeGreaterThan(0.005);
    expect(share('heart')).toBeLessThan(0.013);
    // Poop is the easter egg: an order of magnitude rarer than the rest.
    expect(share('poop')).toBeGreaterThan(0);
    expect(share('poop')).toBeLessThan(0.005);
  });

  it('makes every formation actually occur', () => {
    for (const shape of ISLAND_CLOUD_SHAPES) {
      expect(share(shape), shape).toBeGreaterThan(0);
    }
  });

  it('orders the rarity as authored: poop rarest, then heart', () => {
    const rates = (['blobbi-egg', 'blobbi-baby', 'blobbi-adult'] as const).map(share);
    expect(share('heart')).toBeLessThanOrEqual(Math.min(...rates) + 0.0005);
    expect(share('poop')).toBeLessThan(share('heart'));
  });
});

describe('measured size distribution', () => {
  const passages = allPassages();

  it('varies size between passages instead of pinning one per actor', () => {
    // The defect this replaced: cloud-a was always large, b always medium, c always
    // small. Each actor must now use more than one size over time.
    for (const actor of ISLAND_CLOUD_ACTORS) {
      const sizes = new Set(
        passages.filter((p) => p.actor.id === actor.id).map((p) => p.passage.size),
      );
      expect(sizes.size, actor.id).toBeGreaterThan(1);
    }
  });

  it('never gives an actor a size outside its allowed set', () => {
    for (const { actor, passage } of passages) {
      expect(actor.allowedSizes, `${actor.id} got ${passage.size}`).toContain(passage.size);
    }
  });

  it('lets only the nearest actor be large', () => {
    // This is what makes "never all three large at once" structural rather than
    // statistical: two of the three can never be large at all.
    expect(A.allowedSizes).toContain('large');
    expect(B.allowedSizes).not.toContain('large');
    expect(C.allowedSizes).not.toContain('large');
    for (const { actor, passage } of passages) {
      if (passage.size === 'large') expect(actor.id).toBe('cloud-a');
    }
  });

  it('preserves the depth ladder: the highest path never carries the largest size', () => {
    const byHeight = [...ISLAND_CLOUD_ACTORS].sort((a, b) => a.topPercent - b.topPercent);
    // Highest (smallest topPercent) first. Its allowed set must not include large,
    // and the lowest actor's set must not include small.
    expect(byHeight[0].allowedSizes).not.toContain('large');
    expect(byHeight[byHeight.length - 1].allowedSizes).not.toContain('small');
  });
});

describe('conflict resolution', () => {
  it('never shows two special formations at the same time', () => {
    // Sampled second by second over eight hours of wall clock, which covers many
    // passages of all three actors.
    for (let second = 0; second < 8 * 3600; second += 5) {
      const nowMs = ISLAND_EPOCH_MS + second * 1000;
      const specials = ISLAND_CLOUD_ACTORS.filter((actor) =>
        isSpecialCloudShape(islandCloudPassageAt(actor, W, nowMs).shape),
      );
      expect(specials.length, `t=${second}s: ${specials.map((a) => a.id).join()}`).toBeLessThanOrEqual(1);
    }
  });

  it('never lets a large cloud share the sky with a medium one', () => {
    // "A large passage happens alone or alongside only a small distant cloud."
    for (let second = 0; second < 8 * 3600; second += 5) {
      const nowMs = ISLAND_EPOCH_MS + second * 1000;
      const sizes = ISLAND_CLOUD_ACTORS.map(
        (actor) => islandCloudPassageAt(actor, W, nowMs).size,
      );
      if (sizes.includes('large')) {
        const companions = sizes.filter((size) => size !== 'large');
        expect(companions.every((size) => size === 'small'), `t=${second}s: ${sizes.join()}`).toBe(
          true,
        );
      }
    }
  });

  it('never puts all three actors at large', () => {
    for (let second = 0; second < 8 * 3600; second += 5) {
      const nowMs = ISLAND_EPOCH_MS + second * 1000;
      const large = ISLAND_CLOUD_ACTORS.filter(
        (actor) => islandCloudPassageAt(actor, W, nowMs).size === 'large',
      );
      expect(large.length).toBeLessThanOrEqual(1);
    }
  });

  it('resolves by a fixed priority, so every client agrees without coordination', () => {
    // cloud-a yields to nobody: its authored choice is always its final choice.
    for (let index = 0; index < 900; index += 1) {
      const passage = islandCloudPassage(A, W, index);
      expect(passage.shape, `index ${index}`).toBe(islandCloudAuthoredShape(A, index));
      expect(passage.size, `index ${index}`).toBe(islandCloudAuthoredSize(A, index));
      expect(passage.suppressed).toBe(false);
    }
  });

  it('does suppress lower-priority actors sometimes, the rule is not vacuous', () => {
    const suppressed = [B, C].flatMap((actor) =>
      Array.from({ length: 3000 }, (_, i) => islandCloudPassage(actor, W, i)).filter(
        (p) => p.suppressed,
      ),
    );
    expect(suppressed.length).toBeGreaterThan(0);
  });
});

describe('stability across a passage', () => {
  it('keeps shape and size fixed for the whole of a passage', () => {
    // A formation that changed mid-flight would be the most obvious possible bug.
    for (const actor of ISLAND_CLOUD_ACTORS) {
      const { durationSeconds } = islandCloudTravel(actor, W);
      for (const index of [0, 7, 41, 113, 254, 999]) {
        const start = islandCloudPassageStartSeconds(actor, W, index);
        const expected = islandCloudPassage(actor, W, index);
        // Sample right after the start, in the middle, and just before the end.
        for (const fraction of [0.001, 0.25, 0.5, 0.75, 0.999]) {
          const nowMs = ISLAND_EPOCH_MS + (start + durationSeconds * fraction) * 1000;
          const seen = islandCloudPassageAt(actor, W, nowMs);
          expect(seen.cycleIndex, `${actor.id} #${index} @${fraction}`).toBe(index);
          expect(seen.shape).toBe(expected.shape);
          expect(seen.size).toBe(expected.size);
          expect(seen.widthPx).toBe(expected.widthPx);
          expect(seen.topPercent).toBe(expected.topPercent);
        }
      }
    }
  });

  it('only changes the variant when the passage index advances', () => {
    // And the index advances while the cloud is offscreen: the reset point is the
    // start of the travel, which `islandCloudTravel` puts outside the world box.
    for (const actor of ISLAND_CLOUD_ACTORS) {
      const { durationSeconds } = islandCloudTravel(actor, W);
      const start = islandCloudPassageStartSeconds(actor, W, 500);
      const before = islandCloudPassageAt(actor, W, ISLAND_EPOCH_MS + (start - 0.5) * 1000);
      const after = islandCloudPassageAt(actor, W, ISLAND_EPOCH_MS + (start + 0.5) * 1000);
      expect(after.cycleIndex - before.cycleIndex).toBe(1);
      expect(durationSeconds).toBeGreaterThan(60);
    }
  });
});

describe('UTC-derived determinism', () => {
  it('gives the same passage for the same instant, every time', () => {
    const nowMs = ISLAND_EPOCH_MS + 987_654_321;
    for (const actor of ISLAND_CLOUD_ACTORS) {
      const reads = Array.from({ length: 5 }, () =>
        JSON.stringify(islandCloudPassageAt(actor, W, nowMs)),
      );
      expect(new Set(reads).size, actor.id).toBe(1);
    }
  });

  it('gives two clients with matching clocks the same cloud', () => {
    // Multiplayer consistency is the whole reason this is not Math.random(): the
    // only input is the instant, so agreement on the clock is agreement on the sky.
    const clientA = (nowMs: number) =>
      ISLAND_CLOUD_ACTORS.map((actor) => islandCloudPassageAt(actor, W, nowMs));
    const clientB = clientA;
    for (const offset of [0, 1_000, 60_000, 3_600_000]) {
      const nowMs = ISLAND_EPOCH_MS + 123_456_789 + offset;
      expect(clientB(nowMs)).toEqual(clientA(nowMs));
    }
  });

  it('tolerates a few seconds of clock skew between clients', () => {
    // Passages last minutes, so a small skew almost never straddles a boundary.
    let agreements = 0;
    const samples = 2000;
    for (let i = 0; i < samples; i += 1) {
      const nowMs = ISLAND_EPOCH_MS + i * 97_000;
      const mine = ISLAND_CLOUD_ACTORS.map((a) => islandCloudPassageAt(a, W, nowMs).shape).join();
      const theirs = ISLAND_CLOUD_ACTORS.map(
        (a) => islandCloudPassageAt(a, W, nowMs + 3_000).shape,
      ).join();
      if (mine === theirs) agreements += 1;
    }
    expect(agreements / samples).toBeGreaterThan(0.98);
  });

  it('is derived from the island epoch, not from process start', () => {
    // Index 0 begins at the epoch (offset by the actor's authored delay), so the
    // sequence is anchored to a fixed UTC instant rather than to when a tab opened.
    for (const actor of ISLAND_CLOUD_ACTORS) {
      const start = islandCloudPassageStartSeconds(actor, W, 0);
      expect(start).toBe(actor.delaySeconds);
      expect(islandCloudCycleIndexAt(actor, W, ISLAND_EPOCH_MS + start * 1000)).toBe(0);
    }
  });

  it('handles pre-epoch instants with descending indices rather than folding', () => {
    for (const actor of ISLAND_CLOUD_ACTORS) {
      const { durationSeconds } = islandCloudTravel(actor, W);
      const wayBack = ISLAND_EPOCH_MS - durationSeconds * 10 * 1000;
      const index = islandCloudCycleIndexAt(actor, W, wayBack);
      expect(index, actor.id).toBeLessThan(0);
      // …and still produces a valid, stable passage.
      const passage = islandCloudPassageAt(actor, W, wayBack);
      expect(ISLAND_CLOUD_SHAPES).toContain(passage.shape);
      expect(actor.allowedSizes).toContain(passage.size);
    }
  });

  it('degrades to index 0 for a nonsense clock instead of NaN', () => {
    for (const actor of ISLAND_CLOUD_ACTORS) {
      expect(islandCloudCycleIndexAt(actor, W, Number.NaN)).toBe(0);
      expect(islandCloudCycleIndexAt(actor, W, Number.POSITIVE_INFINITY)).toBe(0);
    }
  });

  it('does not front-load a formation at the sequence anchor', () => {
    // Index 0 is where each actor's authored walk begins. If a special sat there,
    // the very first passage after the epoch, and any future re-anchoring, would
    // open with a formation.
    for (const actor of ISLAND_CLOUD_ACTORS) {
      expect(islandCloudPassage(actor, W, 0).shape, actor.id).toBe('normal');
    }
  });

  it('does not guarantee a formation shortly after an arbitrary page load', () => {
    // The real requirement. A player loads at an arbitrary instant, so what matters
    // is that the chance of a formation being on screen in the first few minutes is
    // low: not that some particular absolute time is quiet. Sampled across two
    // thousand unrelated load instants.
    let loadsWithFormation = 0;
    const loads = 2000;
    for (let i = 0; i < loads; i += 1) {
      const loadMs = ISLAND_EPOCH_MS + i * 601_000;
      let sawFormation = false;
      for (let second = 0; second < 180; second += 15) {
        const nowMs = loadMs + second * 1000;
        if (
          ISLAND_CLOUD_ACTORS.some((actor) =>
            isSpecialCloudShape(islandCloudPassageAt(actor, W, nowMs).shape),
          )
        ) {
          sawFormation = true;
          break;
        }
      }
      if (sawFormation) loadsWithFormation += 1;
    }
    // Well under a coin flip, and comfortably in "rare surprise" territory.
    expect(loadsWithFormation / loads).toBeLessThan(0.2);
    expect(loadsWithFormation).toBeGreaterThan(0);
  });
});

describe('travel still clears every variant', () => {
  it('reserves travel width for the widest shape and size each actor can take', () => {
    // The cycle duration must not depend on the size; otherwise the passage index,
    // which is derived from the duration, would depend on the size it selects.
    for (const actor of ISLAND_CLOUD_ACTORS) {
      expect(actor.widthPx, actor.id).toBeGreaterThanOrEqual(
        islandCloudWidestRenderedPx(actor),
      );
    }
  });

  it('keeps both endpoints offscreen for every variant an actor may render', () => {
    for (const actor of ISLAND_CLOUD_ACTORS) {
      const { fromPx, toPx } = islandCloudTravel(actor, W);
      for (let index = 0; index < 600; index += 1) {
        const { widthPx } = islandCloudPassage(actor, W, index);
        for (const x of [fromPx, toPx]) {
          const offscreen = x >= W || x + widthPx <= 0;
          expect(offscreen, `${actor.id} #${index} at ${x} w=${widthPx}`).toBe(true);
        }
      }
    }
  });

  it('keeps every rendered variant inside the upper-sky budget', () => {
    for (const actor of ISLAND_CLOUD_ACTORS) {
      for (let index = 0; index < 600; index += 1) {
        const passage = islandCloudPassage(actor, W, index);
        const inkBottom = passage.topPercent + (passage.heightPx / 697) * 100 * 0.98;
        expect(inkBottom, `${actor.id} #${index} ${passage.shape}`).toBeLessThanOrEqual(26.5);
      }
    }
  });
});

describe('islandCloudAuthoredSize', () => {
  it('cycles the authored sequence and wraps negative indices', () => {
    for (const actor of ISLAND_CLOUD_ACTORS) {
      const period = actor.sizeSequence.length;
      expect(islandCloudAuthoredSize(actor, 0)).toBe(actor.sizeSequence[0]);
      expect(islandCloudAuthoredSize(actor, period)).toBe(actor.sizeSequence[0]);
      expect(islandCloudAuthoredSize(actor, -1)).toBe(
        actor.sizeSequence[period - 1] as IslandCloudSize,
      );
    }
  });
});
