/**
 * Draft persistence, including the failure modes.
 *
 * The behaviors worth protecting are the defensive ones: a corrupt or
 * older-schema draft must never throw during a render and must never silently
 * become a half-restored form. And nothing key-shaped may ever be written —
 * asserted structurally against a fully-populated form rather than by reading
 * the source.
 */

import { describe, expect, it } from 'vitest';

import {
  DRAFT_SCHEMA_VERSION,
  draftLabel,
  emptyDraftStore,
  isMeaningfulDraft,
  parseDraftStore,
  removeDraft,
  serializeDraftStore,
  upsertDraft,
  type StoredDraft,
} from './drafts';
import { blankItemForm, nextRowId, type ItemFormState } from './item-form-model';

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
    // `image-2`, … Adding a row after a reload minted `image-1` a second time —
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
