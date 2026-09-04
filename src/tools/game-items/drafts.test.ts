/**
 * Draft persistence, including the failure modes.
 *
 * The behaviors worth protecting are the defensive ones: a corrupt or
 * older-schema draft must never throw during a render and must never silently
 * become a half-restored form. And nothing key-shaped may ever be written,
 * asserted structurally against a fully-populated form rather than by reading
 * the source.
 */

import { describe, expect, it } from 'vitest';

import {
  DRAFT_SCHEMA_VERSION,
  draftLabel,
  emptyDraftStore,
  hydrateStoredForm,
  isMeaningfulDraft,
  parseDraftStore,
  removeDraft,
  serializeDraftStore,
  upsertDraft,
  type StoredDraft,
} from './drafts';
import {
  blankContent,
  blankItemForm,
  blankVisual,
  isEffectItemForm,
  nextRowId,
  type ItemFormState,
} from './item-form-model';

function form(patch: Partial<ItemFormState> = {}): ItemFormState {
  return { ...blankItemForm(), ...patch };
}

function draft(id: string, patch: Partial<ItemFormState> = {}, savedAt = 1): StoredDraft {
  return { id, name: 'Draft', savedAt, form: form(patch) };
}

describe('parseDraftStore', () => {
  it('returns an empty store for missing or blank storage', () => {
    expect(parseDraftStore(null).status).toBe('empty');
    expect(parseDraftStore('').status).toBe('empty');
  });

  it('round-trips a valid store', () => {
    const store = upsertDraft(emptyDraftStore(), draft('d1', { d: 'x:y:z' }));
    const outcome = parseDraftStore(serializeDraftStore(store));
    expect(outcome.status).toBe('ok');
    expect(outcome.store.drafts).toHaveLength(1);
    expect(outcome.store.drafts[0].form.d).toBe('x:y:z');
    expect(outcome.store.activeId).toBe('d1');
  });

  it('discards unreadable JSON without throwing', () => {
    const outcome = parseDraftStore('{{{ not json');
    expect(outcome.status).toBe('discarded');
    expect(outcome.store.drafts).toEqual([]);
    if (outcome.status === 'discarded') {
      expect(outcome.reason).toMatch(/not readable/i);
    }
  });

  it('discards a store from a different schema version', () => {
    const outcome = parseDraftStore(
      JSON.stringify({ version: DRAFT_SCHEMA_VERSION + 1, drafts: [], activeId: null }),
    );
    expect(outcome.status).toBe('discarded');
    if (outcome.status === 'discarded') {
      expect(outcome.reason).toContain(`v${DRAFT_SCHEMA_VERSION}`);
    }
  });

  it('discards a store whose shape is wrong', () => {
    expect(parseDraftStore('"a string"').status).toBe('discarded');
    expect(
      parseDraftStore(JSON.stringify({ version: DRAFT_SCHEMA_VERSION })).status,
    ).toBe('discarded');
  });

  it('drops individual malformed drafts but keeps the good ones', () => {
    const outcome = parseDraftStore(
      JSON.stringify({
        version: DRAFT_SCHEMA_VERSION,
        activeId: 'good',
        drafts: [
          { id: 'bad', name: 'x' },
          draft('good', { d: 'a:b:c' }),
          null,
        ],
      }),
    );
    expect(outcome.status).toBe('ok');
    expect(outcome.store.drafts.map((d) => d.id)).toEqual(['good']);
  });

  it('always writes the current schema version', () => {
    const serialized = serializeDraftStore({
      version: 99,
      drafts: [],
      activeId: null,
    });
    expect(JSON.parse(serialized).version).toBe(DRAFT_SCHEMA_VERSION);
  });
});

describe('store operations', () => {
  it('upserts newest-first and makes the draft active', () => {
    let store = upsertDraft(emptyDraftStore(), draft('a'));
    store = upsertDraft(store, draft('b'));
    expect(store.drafts.map((d) => d.id)).toEqual(['b', 'a']);
    expect(store.activeId).toBe('b');
  });

  it('replaces rather than duplicates on re-save', () => {
    let store = upsertDraft(emptyDraftStore(), draft('a', {}, 1));
    store = upsertDraft(store, draft('a', {}, 2));
    expect(store.drafts).toHaveLength(1);
    expect(store.drafts[0].savedAt).toBe(2);
  });

  it('moves activeId when the active draft is removed', () => {
    let store = upsertDraft(emptyDraftStore(), draft('a'));
    store = upsertDraft(store, draft('b'));
    const next = removeDraft(store, 'b');
    expect(next.drafts.map((d) => d.id)).toEqual(['a']);
    expect(next.activeId).toBe('a');
  });

  it('clears activeId when the last draft is removed', () => {
    const store = upsertDraft(emptyDraftStore(), draft('a'));
    expect(removeDraft(store, 'a').activeId).toBeNull();
  });
});

describe('draftLabel', () => {
  it('prefers the name, then the d, then a placeholder', () => {
    expect(draftLabel(form({ name: 'Hat', d: 'x:y:z' }))).toBe('Hat');
    expect(draftLabel(form({ d: 'x:y:z' }))).toBe('x:y:z');
    expect(draftLabel(form())).toBe('Untitled item');
  });
});

describe('isMeaningfulDraft', () => {
  it('is false for an untouched form', () => {
    expect(isMeaningfulDraft(blankItemForm())).toBe(false);
  });

  it('is true once any authoring has happened', () => {
    expect(isMeaningfulDraft(form({ name: 'Hat' }))).toBe(true);
    expect(isMeaningfulDraft(form({ d: 'x:y:z' }))).toBe(true);
    expect(isMeaningfulDraft(form({ topics: ['equipable'] }))).toBe(true);
    expect(
      isMeaningfulDraft(
        form({ images: [{ id: nextRowId('image'), url: 'https://a/p.png', marker: '' }] }),
      ),
    ).toBe(true);
  });

  it('ignores a blank image row', () => {
    expect(
      isMeaningfulDraft(
        form({ images: [{ id: nextRowId('image'), url: '', marker: '' }] }),
      ),
    ).toBe(false);
  });
});

describe('nothing secret is ever serialized', () => {
  it('writes no key-shaped field for a fully populated form', () => {
    const populated = form({
      d: 'blobbi:accessory:hat',
      name: 'Hat',
      type: 'cosmetic',
      images: [{ id: nextRowId('image'), url: 'https://a/p.png', marker: '' }],
      loaded: {
        eventId: 'e'.repeat(64),
        pubkey: 'a'.repeat(64),
        createdAt: 1,
        address: `31632:${'a'.repeat(64)}:blobbi:accessory:hat`,
        relays: ['wss://relay.example'],
        isLatestKnown: true,
      },
    });
    const serialized = serializeDraftStore(
      upsertDraft(emptyDraftStore(), { id: 'a', name: 'Hat', savedAt: 1, form: populated }),
    );

    // A pubkey is public and expected; anything private is not.
    for (const forbidden of ['nsec', 'privkey', 'privateKey', 'secret', 'seed', 'sig']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe('row ids survive a page reload without colliding', () => {
  it('advances the counter past ids restored from a previous session', async () => {
    // THE BUG: the counter lives in module scope and restarts at 0 on every page
    // load, but draft rows are persisted and come back carrying `image-1`,
    // `image-2`, … Adding a row after a reload minted `image-1` a second time,
    // React reported duplicate keys, and two DRAFTS sharing an id is worse.
    const { nextRowId, reserveRowIds } = await import('./item-form-model');

    reserveRowIds(['image-7', 'draft-3', 'based-on-2']);

    const minted = nextRowId('image');
    const suffix = Number.parseInt(minted.slice(minted.lastIndexOf('-') + 1), 10);
    expect(suffix).toBeGreaterThan(7);
    expect(minted).not.toBe('image-7');
  });

  it('ignores ids that carry no parsable suffix', async () => {
    const { nextRowId, reserveRowIds } = await import('./item-form-model');
    const before = nextRowId('image');
    const beforeN = Number.parseInt(before.slice(before.lastIndexOf('-') + 1), 10);

    reserveRowIds(['legacy', 'image-', 'image-abc']);

    const after = nextRowId('image');
    const afterN = Number.parseInt(after.slice(after.lastIndexOf('-') + 1), 10);
    expect(afterN).toBe(beforeN + 1);
  });
});

/**
 * A draft written by an OLDER build must not crash a newer one.
 *
 * The failure this pins down was real and user-reported: a draft saved before
 * `visual` grew `kind` / `effect` / `effectSlot` came back without them, a
 * newer build called `visual.kind.trim()`, and the entire Item Studio went to
 * the error boundary, "Cannot read properties of undefined (reading 'trim')".
 * The author's unpublished work was unreachable until localStorage was cleared.
 *
 * The fixture below is the exact previous shape, written out literally rather
 * than generated, so it keeps describing yesterday's build even as
 * `blankItemForm()` moves on.
 */
describe('drafts written by an older build', () => {
  /** `visual` as it was before the effect fields existed. */
  const LEGACY_VISUAL = { slot: 'headwear', forms: ['baby', 'adult'], extra: {} };

  /**
   * `visual` is passed EXPLICITLY, with no default: a default would swallow the
   * `undefined` case below and quietly test the legacy visual instead of a
   * missing one: which is the case most likely to crash.
   */
  const legacyStore = (visual: unknown) =>
    JSON.stringify({
      version: DRAFT_SCHEMA_VERSION,
      activeId: 'draft-legacy',
      drafts: [
        {
          id: 'draft-legacy',
          name: 'Party Hat',
          savedAt: 1_700_000_000_000,
          form: {
            ...blankItemForm(),
            d: 'blobbi:accessory:party-hat',
            name: 'Party Hat',
            type: 'cosmetic',
            content: {
              mode: 'structured',
              description: 'A jaunty paper hat.',
              effects: [],
              metadata: [],
              visual,
              raw: '',
              extra: {},
              rawOnly: false,
            },
          },
        },
      ],
    });

  it('restores the draft instead of discarding or crashing on it', () => {
    const outcome = parseDraftStore(legacyStore(LEGACY_VISUAL));
    expect(outcome.status).toBe('ok');
    expect(outcome.store.drafts).toHaveLength(1);
    expect(outcome.store.drafts[0].form.d).toBe('blobbi:accessory:party-hat');
  });

  it('fills the fields that did not exist yet, and keeps the ones that did', () => {
    const { visual } = parseDraftStore(legacyStore(LEGACY_VISUAL)).store.drafts[0].form.content;
    // Added by hydration…
    expect(visual.kind).toBe('');
    expect(visual.effect).toBe('');
    expect(visual.effectSlot).toBe('');
    // …without touching what the author actually typed.
    expect(visual.slot).toBe('headwear');
    expect(visual.forms).toEqual(['baby', 'adult']);
  });

  it('leaves the restored draft safe to read the way the editor reads it', () => {
    // The exact expression that crashed. Every string field must be a string.
    const { form } = parseDraftStore(legacyStore(LEGACY_VISUAL)).store.drafts[0];
    expect(() => {
      form.content.visual.kind.trim();
      form.content.visual.effect.trim();
      form.content.visual.effectSlot.trim();
      form.content.visual.slot.trim();
      form.category.trim();
    }).not.toThrow();
    expect(isEffectItemForm(form)).toBe(false);
  });

  it('survives a visual that is missing, null, or not an object at all', () => {
    // `undefined` serializes as an ABSENT key, which is the pre-effect-fields
    // draft's older cousin: a build that had no `visual` at all.
    for (const broken of [undefined, null, 'headwear', 42, ['headwear']]) {
      const { store } = parseDraftStore(legacyStore(broken));
      const { visual } = store.drafts[0].form.content;
      expect(visual, JSON.stringify(broken)).toEqual(blankVisual());
    }
  });

  it('survives a draft whose content is missing entirely', () => {
    const raw = JSON.stringify({
      version: DRAFT_SCHEMA_VERSION,
      activeId: null,
      drafts: [
        { id: 'd1', name: 'Bare', savedAt: 1, form: { d: 'blobbi:x:y' } },
      ],
    });
    const { form } = parseDraftStore(raw).store.drafts[0];
    expect(form.content).toEqual(blankContent());
    expect(form.images).toEqual([]);
    expect(form.d).toBe('blobbi:x:y');
  });

  it('re-serializes a hydrated draft to the current shape', () => {
    // The next autosave writes the completed form, so the legacy shape is gone
    // for good rather than being re-hydrated on every load forever.
    const { store } = parseDraftStore(legacyStore(LEGACY_VISUAL));
    const round = parseDraftStore(serializeDraftStore(store));
    expect(round.status).toBe('ok');
    expect(round.store.drafts[0].form.content.visual).toEqual({
      ...blankVisual(),
      slot: 'headwear',
      forms: ['baby', 'adult'],
    });
  });
});

describe('hydrateStoredForm', () => {
  it('returns a blank form for anything that is not an object', () => {
    for (const junk of [null, undefined, 'form', 7, []]) {
      expect(hydrateStoredForm(junk)).toEqual(blankItemForm());
    }
  });

  it('never drops a field the stored form did have', () => {
    const stored = { ...blankItemForm(), d: 'a:b:c', topics: ['equipable'] };
    const hydrated = hydrateStoredForm(stored);
    expect(hydrated.d).toBe('a:b:c');
    expect(hydrated.topics).toEqual(['equipable']);
  });

  it('takes arrays whole rather than merging them element-wise', () => {
    const stored = {
      ...blankItemForm(),
      images: [{ id: 'image-9', url: 'https://x/y.png', marker: '' }],
    };
    expect(hydrateStoredForm(stored).images).toHaveLength(1);
  });
});
