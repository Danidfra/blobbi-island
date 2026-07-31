/**
 * The "On a Blobbi" preview for EFFECT items, across every source a form can
 * come from.
 *
 * The report that prompted this file: an imported Bubble Bliss draft appeared
 * not to preview, while Golden Sparkles did — suggesting either a missing entry
 * in an effect map or draft state that was not normalized the way a loaded
 * event is. Neither turned out to be true, and these tests are what keeps it
 * that way: they assert that the four sources produce the SAME preview, and
 * that every declared effect id draws something.
 *
 * ## Why parity is provable rather than argued
 *
 * There is one path. `ItemPreviewPanel` reads `content.visual.effect` and
 * `content.visual.effectSlot` — two strings — and hands them to
 * `resolveEffectPreview`. By the time anything renders, an import, a loaded
 * event, an autosaved draft and live typing are indistinguishable, because they
 * are literally the same two strings. These tests build a form each way and
 * compare the rendered effect subtree.
 */

import { describe, it, expect } from 'vitest';
import { fireEvent, render, within } from '@testing-library/react';

import { BLOBBI_VISUAL_EFFECT_IDS, EFFECT_SLOTS } from '@blobbi/react';
import {
  eventToForm,
  formToUnsignedEvent,
  importEventJson,
  toPreviewEvent,
} from '@/tools/game-items/form-event-conversion';
import {
  blankItemForm,
  blankVisual,
  type ItemFormState,
} from '@/tools/game-items/item-form-model';
import { hydrateStoredForm } from '@/tools/game-items/drafts';
import { KIND_GAME_ITEM_DEFINITION } from '@/inventory/package';

import { ItemPreviewPanel } from './ItemPreviewPanel';
import {
  DEFAULT_PLACEHOLDER_SLOT,
  SLOT_PLACEHOLDER_EFFECTS,
  resolveEffectPreview,
} from './effect-vocabulary';

const PUBKEY = 'a'.repeat(64);
const NO_PROBES = new Map();

/** The event as the request states it, parameterized over the effect. */
function effectEventJson(
  effect: string,
  effectSlot: string,
  extras: { d?: string; name?: string; tags?: string[][] } = {},
): string {
  return JSON.stringify({
    kind: KIND_GAME_ITEM_DEFINITION,
    content: JSON.stringify({
      description: `The ${effect} effect.`,
      visual: { kind: 'blobbi-effect', effect, effectSlot, forms: ['baby', 'adult'] },
    }),
    tags: [
      ['d', extras.d ?? `blobbi:effect:${effect}`],
      // `name` is required by the definition spec, so a fixture exercising an
      // EMPTY effect id still has to carry one.
      ['name', extras.name ?? (effect === '' ? 'Unnamed Effect' : effect)],
      ['type', 'cosmetic'],
      ['category', 'effect'],
      ...(extras.tags ?? []),
    ],
  });
}

/**
 * Render the panel and switch to the tab under test.
 *
 * Queried through `within(container)` rather than `screen`: several of these
 * tests render two or three panels to compare them, and a document-wide query
 * would find the first panel's tab every time and silently assert the same
 * render twice.
 */
function preview(form: ItemFormState) {
  const view = render(<ItemPreviewPanel form={form} probes={NO_PROBES} />);
  // Radix tabs activate on mousedown; a bare click leaves the panel closed.
  const tab = within(view.container).getByRole('tab', { name: 'On a Blobbi' });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
  return view;
}

const stage = (c: HTMLElement) =>
  c.querySelector('[data-effect-preview-stage]') as HTMLElement | null;
const pieces = (c: HTMLElement) => c.querySelectorAll('.blobbi-fx-piece').length;
const drawn = (c: HTMLElement) => [
  ...new Set(
    [...c.querySelectorAll('[data-blobbi-effect]')].map(
      (el) => (el as HTMLElement).dataset.blobbiEffect as string,
    ),
  ),
];
/** The effect subtree only — the comparable part between two sources. */
const effectHtml = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-blobbi-effect-layer]')]
    .map((el) => el.outerHTML)
    .join('\n');

const importForm = (json: string): ItemFormState => {
  const result = importEventJson(json);
  if (!result.ok) throw new Error(result.error);
  return result.value.form;
};

// ── The reported case ──────────────────────────────────────────────────────

describe('an imported unsigned Bubble Bliss draft previews before publish', () => {
  const BUBBLE_BLISS = effectEventJson('bubble-bliss', 'ambient-particles', {
    name: 'Bubble Bliss',
    tags: [
      ['image', 'https://fixtures.invalid/bubble.webp'],
      ['symbol', '🫧'],
      ['rarity', 'uncommon'],
      ['max_stack', '1'],
      ['version', '1'],
      ['context', 'game:blobbi'],
      ['context', 'game:blobbi-island'],
      ['t', 'equipable'],
      ['t', 'visual-effect'],
      ['t', 'bubbles'],
      ['alt', 'Game item definition: Bubble Bliss'],
    ],
  });

  it('renders the effect from the import alone — nothing published, nothing signed', () => {
    const form = importForm(BUBBLE_BLISS);
    expect(form.loaded).toBeNull();

    const { container } = preview(form);
    expect(stage(container)).not.toBeNull();
    expect(drawn(container)).toEqual(['bubble-bliss']);
    expect(pieces(container)).toBeGreaterThan(0);
    expect(stage(container)!.dataset.effectPreviewKind).toBe('implemented');
  });

  it('takes the same path Golden Sparkles takes', () => {
    // The original complaint in one assertion: same source, same pipeline, same
    // observable result — the two differ only in which preset is drawn.
    const bubble = preview(importForm(BUBBLE_BLISS));
    const golden = preview(
      importForm(effectEventJson('golden-sparkles', 'ambient-particles')),
    );

    for (const view of [bubble, golden]) {
      expect(stage(view.container)!.dataset.effectPreviewKind).toBe('implemented');
      expect(pieces(view.container)).toBeGreaterThan(0);
    }
    expect(drawn(bubble.container)).toEqual(['bubble-bliss']);
    expect(drawn(golden.container)).toEqual(['golden-sparkles']);
  });
});

// ── One canonical path, four sources ───────────────────────────────────────

describe('every source of a form previews identically', () => {
  const JSON_SOURCE = effectEventJson('bubble-bliss', 'ambient-particles');

  /** The same item, arrived at four different ways. */
  function everySource(): Record<string, ItemFormState> {
    const imported = importForm(JSON_SOURCE);

    // As a published event: build it, sign-shape it, load it back.
    const built = formToUnsignedEvent(imported);
    if (!built.ok) throw new Error(built.error);
    const published = {
      ...toPreviewEvent(built.value, PUBKEY, 1_700_000_000),
      id: 'e'.repeat(64),
      sig: 'f'.repeat(128),
    };
    const loadedResult = eventToForm(published);
    if (!loadedResult.ok) throw new Error(loadedResult.error);

    // As an autosaved draft: through the same hydration a restore performs.
    const restored = hydrateStoredForm(JSON.parse(JSON.stringify(imported)));

    // As live form state: typed by hand, never near an event.
    const typed: ItemFormState = {
      ...blankItemForm(),
      d: 'blobbi:effect:bubble-bliss',
      name: 'bubble-bliss',
      type: 'cosmetic',
      category: 'effect',
      content: {
        ...blankItemForm().content,
        description: 'The bubble-bliss effect.',
        visual: {
          ...blankVisual(),
          kind: 'blobbi-effect',
          effect: 'bubble-bliss',
          effectSlot: 'ambient-particles',
          forms: ['baby', 'adult'],
        },
      },
    };

    return { imported, loaded: loadedResult.form, restored, typed };
  }

  it('draws the same effect from an import, a load, a draft and live typing', () => {
    for (const [label, form] of Object.entries(everySource())) {
      const { container } = preview(form);
      expect(drawn(container), label).toEqual(['bubble-bliss']);
      expect(pieces(container), label).toBeGreaterThan(0);
    }
  });

  it('produces byte-identical effect markup from all four', () => {
    // The strongest form of "one canonical path": not merely the same effect,
    // the same DOM. If any source were normalized differently, this breaks.
    const markup = Object.entries(everySource()).map(
      ([label, form]) => [label, effectHtml(preview(form).container)] as const,
    );
    const [, reference] = markup[0];
    expect(reference.length).toBeGreaterThan(0);
    for (const [label, html] of markup) {
      expect(html, label).toBe(reference);
    }
  });

  it('needs no publish, no signer and no relay to preview', () => {
    // The imported form carries no provenance at all; the preview does not
    // consult one, and the panel renders with no providers around it.
    const form = importForm(JSON_SOURCE);
    expect(form.loaded).toBeNull();
    expect(form.images).toEqual([]);
    const { container } = preview(form);
    expect(pieces(container)).toBeGreaterThan(0);
  });
});

// ── `content.visual.effect` is the canonical source ────────────────────────

describe('the effect id comes from content.visual.effect and nothing else', () => {
  it('ignores a d tag, topics and rarity that disagree with the content', () => {
    // Every tag says "golden sparkles"; the content says bubble-bliss. The
    // content wins, because the content is the definition of the effect.
    const form = importForm(
      effectEventJson('bubble-bliss', 'ambient-particles', {
        d: 'blobbi:effect:golden-sparkles',
        name: 'Golden Sparkles',
        tags: [
          ['rarity', 'rare'],
          ['t', 'golden'],
          ['t', 'sparkles'],
        ],
      }),
    );
    const { container } = preview(form);
    expect(drawn(container)).toEqual(['bubble-bliss']);
  });

  it('previews an effect whose d tag names no effect at all', () => {
    const form = importForm(
      effectEventJson('mystic-fog', 'ground-local', { d: 'x:y:z', name: 'Anything' }),
    );
    expect(drawn(preview(form).container)).toEqual(['mystic-fog']);
  });

  it('routes to the effect preview on visual.kind even with no category tag', () => {
    // `category: "effect"` is a FALLBACK signal, not the identifier.
    const form = importForm(
      JSON.stringify({
        kind: KIND_GAME_ITEM_DEFINITION,
        tags: [
          ['d', 'blobbi:effect:love-burst'],
          ['name', 'Love Burst'],
          ['type', 'cosmetic'],
        ],
        content: JSON.stringify({
          visual: { kind: 'blobbi-effect', effect: 'love-burst', effectSlot: 'ambient-particles' },
        }),
      }),
    );
    expect(form.category).toBe('');
    expect(drawn(preview(form).container)).toEqual(['love-burst']);
  });

  it('keeps drawing an accessory as an accessory', () => {
    const form = importForm(
      JSON.stringify({
        kind: KIND_GAME_ITEM_DEFINITION,
        tags: [
          ['d', 'blobbi:accessory:party-hat'],
          ['name', 'Party Hat'],
          ['type', 'cosmetic'],
          ['category', 'headwear'],
          ['image', 'https://fixtures.invalid/hat.png'],
        ],
        content: JSON.stringify({ visual: { slot: 'headwear', forms: ['baby'] } }),
      }),
    );
    const { container } = preview(form);
    expect(stage(container)).toBeNull();
    expect(container.querySelector('[data-accessory-layer-group]')).not.toBeNull();
  });
});

// ── Every effect id draws something ────────────────────────────────────────

describe('every declared effect id previews', () => {
  it('covers all twelve implemented effects, each with its own preset', () => {
    const seen = new Set<string>();
    for (const id of BLOBBI_VISUAL_EFFECT_IDS) {
      const form = importForm(effectEventJson(id, EFFECT_SLOTS[id]));
      const { container } = preview(form);
      expect(stage(container)!.dataset.effectPreviewKind, id).toBe('implemented');
      expect(drawn(container), id).toEqual([id]);
      expect(pieces(container), id).toBeGreaterThan(0);
      seen.add(id);
    }
    expect(seen.size).toBe(12);
  });

  it('never previews an implemented effect as somebody else', () => {
    for (const id of BLOBBI_VISUAL_EFFECT_IDS) {
      expect(resolveEffectPreview(id, EFFECT_SLOTS[id])).toEqual({
        renderId: id,
        kind: 'implemented',
        placeholderSlot: null,
      });
    }
  });
});

// ── Unknown ids get a labelled stand-in ────────────────────────────────────

describe('a valid blobbi-effect id this client cannot draw', () => {
  it('shows a stand-in rather than an empty box', () => {
    const form = importForm(effectEventJson('moon-halo', 'aura'));
    const { container } = preview(form);

    expect(stage(container)!.dataset.effectPreviewKind).toBe('placeholder');
    expect(pieces(container)).toBeGreaterThan(0);
    expect(within(container).getByText('Approximate preview')).toBeInTheDocument();
  });

  it('says the id is unimplemented, and that the drawing is a stand-in', () => {
    const { container } = preview(importForm(effectEventJson('moon-halo', 'aura')));
    expect(container.textContent).toContain('moon-halo');
    expect(container.textContent).toMatch(/not an effect this client implements/i);
    expect(container.textContent).toMatch(/stand-in, not this item’s artwork/i);
  });

  it.each([
    ['ambient-particles', 'golden-sparkles'],
    ['ground-local', 'mystic-fog'],
    ['body-overlay', 'pixel-glitch'],
    ['aura', 'celestial-aura'],
  ])('places the stand-in by effectSlot: %s', (slot, expected) => {
    const { container } = preview(importForm(effectEventJson('not-real-yet', slot)));
    expect(drawn(container)).toEqual([expected]);
    expect(EFFECT_SLOTS[expected as 'golden-sparkles']).toBe(slot);
    expect(stage(container)!.dataset.effectPreviewRendering).toBe(expected);
  });

  it('falls back to a default slot when the declared one is not a slot either', () => {
    const { container } = preview(
      importForm(effectEventJson('not-real-yet', 'behind-the-ears')),
    );
    expect(drawn(container)).toEqual([
      SLOT_PLACEHOLDER_EFFECTS.get(DEFAULT_PLACEHOLDER_SLOT)!,
    ]);
    expect(container.textContent).toMatch(/not one of the four effect slots/i);
  });

  it('previews from the slot alone when no effect is named yet', () => {
    // Half-authored: the author picked a slot and has not typed an id. Showing
    // where it will sit is more useful than showing nothing.
    const { container } = preview(importForm(effectEventJson('', 'aura')));
    expect(stage(container)!.dataset.effectPreviewKind).toBe('placeholder');
    expect(drawn(container)).toEqual(['celestial-aura']);
  });

  it('draws nothing when the item names neither an effect nor a slot', () => {
    // An untouched effect item is not an effect yet; a stand-in here would be
    // inventing one.
    const { container } = preview(importForm(effectEventJson('', '')));
    expect(stage(container)!.dataset.effectPreviewKind).toBe('none');
    expect(pieces(container)).toBe(0);
    expect(container.textContent).toMatch(/No .*visual\.effect.* yet/i);
  });
});

// ── The resolver itself ────────────────────────────────────────────────────

describe('resolveEffectPreview', () => {
  it('is total: no input throws, and every result is renderable or explicitly none', () => {
    const inputs = ['', '  ', 'moon-halo', 'golden-sparkles', '__proto__', 'AURA'];
    const slots = ['', 'aura', 'nonsense', 'ground-local', '__proto__'];
    for (const effect of inputs) {
      for (const slot of slots) {
        const result = resolveEffectPreview(effect, slot);
        expect(['implemented', 'placeholder', 'none']).toContain(result.kind);
        if (result.kind === 'none') expect(result.renderId).toBeNull();
        else expect(BLOBBI_VISUAL_EFFECT_IDS).toContain(result.renderId);
      }
    }
  });

  it('trims, and is case-sensitive like the wire format', () => {
    expect(resolveEffectPreview('  bubble-bliss  ', '').kind).toBe('implemented');
    // `Bubble-Bliss` is a different string on the wire, so it is unknown here.
    expect(resolveEffectPreview('Bubble-Bliss', 'ambient-particles').kind).toBe(
      'placeholder',
    );
  });

  it('never lets a slot override an implemented id', () => {
    // A definition may declare the wrong slot; the effect it names still wins.
    expect(resolveEffectPreview('bubble-bliss', 'aura')).toEqual({
      renderId: 'bubble-bliss',
      kind: 'implemented',
      placeholderSlot: null,
    });
  });
});
