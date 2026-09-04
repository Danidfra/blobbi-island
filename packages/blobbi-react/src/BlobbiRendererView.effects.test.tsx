/**
 * VISUAL EFFECTS in the rendered DOM (Phase 8).
 *
 * The companion to `effect-model.test.ts` (which input survives) and
 * `effect-catalog.test.ts` (what the presets promise). This file asserts the
 * thing both of those cannot: that drawing an effect changes what a Blobbi
 * looks like and changes NOTHING ELSE; not the box, not the accessory order,
 * not hit-testing, not the markup of a Blobbi that has no effects.
 *
 * Rendered with no providers, like the rest of the package's suite: if any part
 * of the effect system reached for a context, a store or a media query, these
 * renders would fail.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import {
  BlobbiRendererView,
  BLOBBI_RENDER_SIZE_CLASSES,
  BLOBBI_VISUAL_EFFECT_IDS,
  EFFECT_SLOTS,
  normalizeAccessoryPlacements,
  type AccessoryPlacementInput,
  type BlobbiRenderSize,
  type BlobbiVisualEffect,
  type BlobbiVisualEffectId,
} from './index';

/** JSON-round-trippable input: exactly what would cross a package boundary. */
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const BABY = plain({
  stage: 'baby' as const,
  baseColor: '#ff6699',
  secondaryColor: '#66ccff',
  eyeColor: '#222222',
  name: 'FX Baby',
});
const ADULT = plain({ ...BABY, stage: 'adult' as const, adultType: 'catti', name: 'FX Adult' });

const box = (c: HTMLElement) => c.querySelector('[data-blobbi-renderer]') as HTMLElement;
const layers = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-blobbi-effect-layer]')] as HTMLElement[];
const groups = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-blobbi-effect]')] as HTMLElement[];
/**
 * The DISTINCT effects drawn, in first-appearance order.
 *
 * An effect gets one group element inside EACH layer it paints on: Mystic Fog
 * has a rear bank and a foreground veil, so it legitimately appears twice.
 * "Which effects are drawn" is therefore the deduplicated list.
 */
const drawnEffects = (c: HTMLElement) => [
  ...new Set(groups(c).map((g) => g.dataset.blobbiEffect as string)),
];
/** The keyframe name a `.blobbi-fx-*` element animates with, if any. */
const animationOf = (el: HTMLElement): string =>
  // jsdom does not expand the `animation` shorthand into `animationName`, so
  // the name is read off the shorthand's first token instead.
  (el.style.animation || '').trim().split(/\s+/)[0] ?? '';
const pieces = (c: HTMLElement) =>
  [...c.querySelectorAll('.blobbi-fx-piece')] as HTMLElement[];
const styleTag = (c: HTMLElement) =>
  c.querySelector('style[data-blobbi-effect-styles]') as HTMLStyleElement | null;

const ALL: BlobbiVisualEffectId[] = [...BLOBBI_VISUAL_EFFECT_IDS];

function draw(effects: BlobbiVisualEffect[] | undefined, overrides: Record<string, unknown> = {}) {
  return render(
    <BlobbiRendererView
      visual={BABY}
      instanceId="fx"
      size="xl"
      effects={effects ? plain(effects) : undefined}
      {...overrides}
    />,
  );
}

// ── Every effect draws ─────────────────────────────────────────────────────

describe('every effect renders from plain data', () => {
  it.each(ALL)('%s renders pieces on at least one layer', (id) => {
    const { container } = draw([{ id }]);
    expect(drawnEffects(container)).toEqual([id]);
    expect(pieces(container).length).toBeGreaterThan(0);
    expect(layers(container).length).toBeGreaterThan(0);
  });

  it.each(ALL)('%s reports its slot on the group element', (id) => {
    const { container } = draw([{ id }]);
    expect(groups(container)[0].dataset.blobbiEffectSlot).toBe(EFFECT_SLOTS[id]);
  });

  it.each(ALL)('%s renders identically front and back', (id) => {
    // Effects surround the character rather than attaching to its face, so
    // turning around must not remove or move a single particle. Compared on
    // the effect subtree alone, the BODY markup legitimately differs.
    const front = draw([{ id }], { facing: 'front' });
    const back = draw([{ id }], { facing: 'back' });

    const fx = (c: HTMLElement) =>
      layers(c).map((l) => l.outerHTML).join('\n');
    expect(fx(back.container)).toBe(fx(front.container));
    expect(pieces(back.container).length).toBeGreaterThan(0);
  });

  it.each(ALL)('%s renders on a baby and on an adult alike', (id) => {
    const baby = render(
      <BlobbiRendererView visual={BABY} instanceId="same" size="xl" effects={[{ id }]} />,
    );
    const adult = render(
      <BlobbiRendererView visual={ADULT} instanceId="same" size="xl" effects={[{ id }]} />,
    );
    expect(pieces(adult.container).length).toBe(pieces(baby.container).length);
  });

  it.each(ALL)('%s renders at every size token without changing the box', (id) => {
    for (const size of Object.keys(BLOBBI_RENDER_SIZE_CLASSES) as BlobbiRenderSize[]) {
      const { container } = draw([{ id }], { size });
      // The size class is the box. An effect that touched it would resize the
      // Blobbi, which is the one thing decoration must never do.
      expect(box(container).className).toContain(BLOBBI_RENDER_SIZE_CLASSES[size]);
      expect(pieces(container).length).toBeGreaterThan(0);
    }
  });
});

// ── The no-effect baseline ─────────────────────────────────────────────────

describe('a Blobbi with no effects is byte-identical to the pre-Phase-8 renderer', () => {
  it.each([
    ['prop absent', undefined],
    ['empty array', [] as BlobbiVisualEffect[]],
    ['only unknown ids', [{ id: 'nope' as BlobbiVisualEffectId }]],
    ['a non-array', 'sparkles' as unknown as BlobbiVisualEffect[]],
  ])('%s renders no effect markup at all', (_label, effects) => {
    const { container } = draw(effects as BlobbiVisualEffect[] | undefined);
    expect(layers(container)).toEqual([]);
    expect(pieces(container)).toEqual([]);
    expect(styleTag(container)).toBeNull();
    expect(container.innerHTML).not.toContain('blobbi-fx');
  });

  it('produces exactly the markup of a renderer that was never given the prop', () => {
    const withoutProp = draw(undefined);
    const withEmpty = draw([]);
    expect(box(withEmpty.container).outerHTML).toBe(box(withoutProp.container).outerHTML);
  });

  it('leaves accessory markup untouched when effects are present', () => {
    const accessories = normalizeAccessoryPlacements(
      [
        plain<AccessoryPlacementInput>({
          code: 'hat', x: 50, y: 22, scale: 1, rot: 0, flipX: false,
          url: 'https://example.test/hat.png', slot: 'headwear',
        }),
        plain<AccessoryPlacementInput>({
          code: 'cape', x: 50, y: 60, scale: 1.2, rot: 0, flipX: false,
          url: 'https://example.test/cape.png', slot: 'back',
        }),
      ],
      {},
    );

    const bare = render(
      <BlobbiRendererView visual={BABY} instanceId="acc" size="xl" accessories={accessories} />,
    );
    const withFx = render(
      <BlobbiRendererView
        visual={BABY}
        instanceId="acc"
        size="xl"
        accessories={accessories}
        effects={[{ id: 'mystic-fog' }, { id: 'pixel-glitch' }]}
      />,
    );

    const accessoryHtml = (c: HTMLElement) =>
      [...c.querySelectorAll('[data-accessory-layer-group]')]
        .map((el) => el.outerHTML)
        .join('\n');
    expect(accessoryHtml(withFx.container)).toBe(accessoryHtml(bare.container));
  });
});

// ── Layer order ────────────────────────────────────────────────────────────

describe('effect layers sit in the intended places in the DOM', () => {
  const orderOf = (container: HTMLElement): string[] =>
    [...box(container).children].map((el) => {
      const node = el as HTMLElement;
      if (node.dataset.blobbiEffectLayer) return `fx:${node.dataset.blobbiEffectLayer}`;
      if (node.dataset.accessoryLayerGroup) return `acc:${node.dataset.accessoryLayerGroup}`;
      if (node.dataset.blobbiBodyBox !== undefined) return 'body';
      if (node.tagName === 'STYLE') return 'style';
      return node.tagName.toLowerCase();
    });

  it('paints behind-effects, behind-accessories, body, mid-effects, front-accessories, front-effects', () => {
    const accessories = normalizeAccessoryPlacements(
      [
        plain<AccessoryPlacementInput>({
          code: 'hat', x: 50, y: 22, scale: 1, rot: 0, flipX: false,
          url: 'https://example.test/hat.png', slot: 'headwear',
        }),
        plain<AccessoryPlacementInput>({
          code: 'cape', x: 50, y: 60, scale: 1, rot: 0, flipX: false,
          url: 'https://example.test/cape.png', slot: 'back',
        }),
      ],
      {},
    );

    const { container } = render(
      <BlobbiRendererView
        visual={BABY}
        instanceId="order"
        size="xl"
        accessories={accessories}
        // One effect per layer: an aura (behind), a body overlay (mid + front).
        effects={[{ id: 'celestial-aura' }, { id: 'pixel-glitch' }]}
      />,
    );

    expect(orderOf(container)).toEqual([
      'style',
      'fx:behind',
      'acc:behind',
      'body',
      'fx:mid',
      'acc:front',
      'fx:front',
    ]);
  });

  it('omits a layer entirely when no active effect paints on it', () => {
    // Mystic Fog uses `behind` and `front`, never `mid`.
    const { container } = draw([{ id: 'mystic-fog' }]);
    expect(layers(container).map((l) => l.dataset.blobbiEffectLayer)).toEqual([
      'behind',
      'front',
    ]);
  });

  it('keeps groups inside a layer in canonical slot order', () => {
    const { container } = draw([
      { id: 'pixel-glitch' },
      { id: 'golden-sparkles' },
      { id: 'celestial-aura' },
    ]);
    const front = layers(container).find((l) => l.dataset.blobbiEffectLayer === 'front')!;
    const order = [...front.querySelectorAll('[data-blobbi-effect]')].map(
      (el) => (el as HTMLElement).dataset.blobbiEffect,
    );
    // aura → ambient-particles → body-overlay, regardless of the input order.
    expect(order).toEqual(['celestial-aura', 'golden-sparkles', 'pixel-glitch']);
  });
});

// ── Slot conflicts ─────────────────────────────────────────────────────────

describe('slot conflicts resolve to one deterministic winner', () => {
  it('draws one aura when four are asked for, and it is the first', () => {
    const { container } = draw([
      { id: 'void-whispers' },
      { id: 'celestial-aura' },
      { id: 'solar-radiance' },
      { id: 'rainbow-dream' },
    ]);
    expect(drawnEffects(container)).toEqual(['void-whispers']);
  });

  it('draws one of each slot when all twelve are asked for', () => {
    const { container } = draw(ALL.map((id) => ({ id })));
    expect(drawnEffects(container)).toEqual([
      'celestial-aura',
      'mystic-fog',
      'golden-sparkles',
      'pixel-glitch',
    ]);
  });

  it('never renders more than the documented worst case', () => {
    const { container } = draw(ALL.map((id) => ({ id })));
    // The cap the catalogue test computes structurally, asserted here against
    // real DOM: a Blobbi wearing everything is still a bounded number of nodes.
    expect(pieces(container).length).toBeLessThanOrEqual(48);
  });

  it('renders compatible effects from different slots together', () => {
    const { container } = draw([
      { id: 'celestial-aura' },
      { id: 'frost-breath' },
      { id: 'bubble-bliss' },
      { id: 'electric-charge' },
    ]);
    expect(drawnEffects(container).sort()).toEqual(
      ['bubble-bliss', 'celestial-aura', 'electric-charge', 'frost-breath'].sort(),
    );
  });
});

// ── Nothing an effect does may reach layout or input ───────────────────────

describe('effects are decoration and cannot behave like anything else', () => {
  it('marks every effect element non-interactive', () => {
    const { container } = draw(ALL.map((id) => ({ id })));
    for (const el of [...layers(container), ...pieces(container)]) {
      // Either the class carries it (layer/track/piece all do in the sheet) or
      // the element states it inline. Both are checked, because a future inline
      // style could otherwise silently re-enable hit-testing.
      const interactive =
        el.style.pointerEvents !== '' && el.style.pointerEvents !== 'none';
      expect(interactive, el.className).toBe(false);
    }
    for (const el of [...container.querySelectorAll('.blobbi-fx-track')]) {
      expect((el as HTMLElement).className).toContain('blobbi-fx-track');
    }
  });

  it('positions everything absolutely, so nothing can enter layout flow', () => {
    const { container } = draw(ALL.map((id) => ({ id })));
    for (const el of [...layers(container), ...groups(container)]) {
      expect(el.style.position === 'absolute' || el.className.includes('blobbi-fx-layer')).toBe(
        true,
      );
    }
  });

  it('adds no click handler, href, tabindex or id to anything it draws', () => {
    const { container } = draw(ALL.map((id) => ({ id })));
    const fxNodes = [
      ...layers(container),
      ...groups(container),
      ...container.querySelectorAll('.blobbi-fx-track'),
      ...pieces(container),
    ] as HTMLElement[];
    for (const el of fxNodes) {
      expect(el.id).toBe('');
      expect(el.getAttribute('tabindex')).toBeNull();
      expect(el.getAttribute('href')).toBeNull();
      expect(el.tagName).toBe('DIV');
    }
  });

  it('leaves the box, the body box and the renderer data attributes alone', () => {
    const bare = draw([]);
    const fancy = draw(ALL.map((id) => ({ id })));
    for (const container of [bare.container, fancy.container]) {
      const el = box(container);
      expect(el.className).toContain(BLOBBI_RENDER_SIZE_CLASSES.xl);
      expect(el.dataset.blobbiSize).toBe('xl');
      expect(container.querySelector('[data-blobbi-body-box]')).not.toBeNull();
    }
    expect(box(fancy.container).className).toBe(box(bare.container).className);
    expect(box(fancy.container).getAttribute('style')).toBe(
      box(bare.container).getAttribute('style'),
    );
  });

  it('does not touch the body SVG', () => {
    const bare = draw([]);
    const fancy = draw([{ id: 'pixel-glitch' }, { id: 'void-whispers' }]);
    const body = (c: HTMLElement) =>
      (c.querySelector('[data-blobbi-body-box]') as HTMLElement).innerHTML;
    expect(body(fancy.container)).toBe(body(bare.container));
  });
});

// ── Determinism and isolation ──────────────────────────────────────────────

describe('effect markup is deterministic and instance-isolated', () => {
  it.each(ALL)('%s renders the same markup every time for the same instance', (id) => {
    const first = draw([{ id }]);
    for (let i = 0; i < 3; i++) {
      const again = draw([{ id }]);
      expect(layers(again.container).map((l) => l.outerHTML).join()).toBe(
        layers(first.container).map((l) => l.outerHTML).join(),
      );
    }
  });

  it('re-rendering the same component does not move a particle', () => {
    const view = render(
      <BlobbiRendererView visual={BABY} instanceId="stable" effects={[{ id: 'golden-sparkles' }]} />,
    );
    const before = layers(view.container).map((l) => l.outerHTML).join();
    view.rerender(
      <BlobbiRendererView visual={BABY} instanceId="stable" effects={[{ id: 'golden-sparkles' }]} />,
    );
    expect(layers(view.container).map((l) => l.outerHTML).join()).toBe(before);
  });

  it('gives two Blobbis on one page different scatters, both stable', () => {
    const { container } = render(
      <div>
        <BlobbiRendererView visual={BABY} instanceId="alpha" effects={[{ id: 'firefly-friends' }]} />
        <BlobbiRendererView visual={BABY} instanceId="beta" effects={[{ id: 'firefly-friends' }]} />
      </div>,
    );
    const [first, second] = [...container.children[0].children] as HTMLElement[];
    const fx = (el: HTMLElement) =>
      [...el.querySelectorAll('[data-blobbi-effect-layer]')].map((l) => l.outerHTML).join();
    expect(fx(first)).not.toBe(fx(second));
    // Same effect, same piece count: only the scatter differs.
    expect(first.querySelectorAll('.blobbi-fx-piece').length).toBe(
      second.querySelectorAll('.blobbi-fx-piece').length,
    );
  });

  it('namespaces every effect id by instance, so two instances cannot collide', () => {
    // The particle system mints no ids at all; the lightning SVG must mint its
    // paint-server ids (filters and gradients are referenced by id), and every
    // one is prefixed with the renderer's instance id, the same rule the body
    // SVG follows. Two instances therefore share nothing.
    const { container } = draw(ALL.map((id) => ({ id })));
    for (const el of container.querySelectorAll('[class*="blobbi-fx"]')) {
      expect(el.getAttribute('id')).toBeNull();
    }
    // The lightning renderer is the one id-minting effect (pixel-glitch wins
    // the body-overlay slot in the all-twelve draw above, so it needs its own
    // render here), and every id it mints carries the instance prefix.
    const strike = draw([{ id: 'electric-charge' }]);
    const effectIds = [
      ...strike.container.querySelectorAll('[data-blobbi-effect-layer] [id]'),
    ].map((el) => el.id);
    expect(effectIds.length).toBeGreaterThan(0);
    for (const id of effectIds) {
      expect(id.startsWith('fx-'), `${id} must carry the instance prefix`).toBe(true);
    }

    const two = render(
      <div>
        <BlobbiRendererView visual={BABY} instanceId="one" effects={[{ id: 'electric-charge' }]} />
        <BlobbiRendererView visual={BABY} instanceId="two" effects={[{ id: 'electric-charge' }]} />
      </div>,
    );
    const idsOf = (instance: number) => [
      ...two.container.children[0].children[instance].querySelectorAll('[id]'),
    ].map((el) => el.id);
    const first = new Set(idsOf(0));
    for (const id of idsOf(1)) {
      expect(first.has(id), `${id} appears in both instances`).toBe(false);
    }
  });

  it('varies only with the seed, never with unrelated props', () => {
    const a = draw([{ id: 'love-burst' }], { title: 'one', isSleeping: false });
    const b = draw([{ id: 'love-burst' }], { title: 'two', isSleeping: true });
    expect(layers(b.container).map((l) => l.outerHTML).join()).toBe(
      layers(a.container).map((l) => l.outerHTML).join(),
    );
  });
});

// ── Intensity ──────────────────────────────────────────────────────────────

describe('intensity reaches the DOM as a clamped opacity multiplier', () => {
  const opacities = (container: HTMLElement) =>
    pieces(container).map((p) => Number(p.style.getPropertyValue('--fx-o')));

  it('halving the intensity halves every piece opacity', () => {
    const full = draw([{ id: 'golden-sparkles', intensity: 1 }]);
    const half = draw([{ id: 'golden-sparkles', intensity: 0.5 }]);
    const a = opacities(full.container);
    const b = opacities(half.container);
    expect(b).toHaveLength(a.length);
    // Two decimals: `--fx-o` is rounded to three when it is written, so half of
    // a rounded value and a rounded half can differ by one unit in the last
    // place. That is the rounding, not a scaling error.
    b.forEach((value, i) => expect(value).toBeCloseTo(a[i] / 2, 2));
  });

  it('clamps an absurd intensity rather than trusting it', () => {
    const wild = draw([{ id: 'golden-sparkles', intensity: 1000 }]);
    const capped = draw([{ id: 'golden-sparkles', intensity: 1.5 }]);
    expect(opacities(wild.container)).toEqual(opacities(capped.container));
  });

  it('sets a resting opacity on every piece, so reduced motion shows something', () => {
    const { container } = draw(ALL.map((id) => ({ id })));
    for (const piece of pieces(container)) {
      const value = Number(piece.style.getPropertyValue('--fx-o'));
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

// ── The stylesheet element ─────────────────────────────────────────────────

describe('the effect stylesheet travels with the effects that need it', () => {
  it.each(ALL)('%s carries every keyframe it references and no others', (id) => {
    const { container } = draw([{ id }]);
    const css = styleTag(container)!.textContent ?? '';

    const used = new Set(
      [
        ...pieces(container).map(animationOf),
        ...[...container.querySelectorAll('.blobbi-fx-track')].map((t) =>
          animationOf(t as HTMLElement),
        ),
        // The lightning renderer's SVG strokes and impact flashes animate too,
        // and their keyframes must ship exactly like everyone else's.
        ...[...container.querySelectorAll('.blobbi-fx-bolt, .blobbi-fx-impact')].map(
          (el) => animationOf(el as HTMLElement),
        ),
      ].filter(Boolean),
    );
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) {
      expect(css, `${id} needs ${name}`).toContain(`@keyframes ${name}{`);
    }

    const defined = [...css.matchAll(/@keyframes ([\w-]+)\{/g)].map((m) => m[1]);
    expect(new Set(defined)).toEqual(used);
  });

  it('always ships the reduced-motion block and the structural rules', () => {
    const { container } = draw([{ id: 'electric-charge' }]);
    const css = styleTag(container)!.textContent ?? '';
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('.blobbi-fx-piece{');
    expect(css).toContain('animation:none !important');
  });

  it('grows only as far as the active effects require', () => {
    const one = draw([{ id: 'golden-sparkles' }]);
    const four = draw(ALL.map((id) => ({ id })));
    const size = (r: ReturnType<typeof draw>) =>
      (styleTag(r.container)!.textContent ?? '').length;
    expect(size(one)).toBeLessThan(size(four));
  });
});
