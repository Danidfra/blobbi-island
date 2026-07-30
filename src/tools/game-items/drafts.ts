/**
 * Local, versioned drafts for the Item Studio.
 *
 * Authoring an item is slow work — artwork gets uploaded, markers get assigned,
 * effects get tuned — and none of it is on a relay until the user explicitly
 * signs. Losing that to a reload would be the tool's worst behavior, so the
 * form is mirrored into `localStorage`.
 *
 * THREE PROPERTIES THIS FILE EXISTS TO GUARANTEE:
 *
 * 1. A draft is never confused with a publication. It carries no signature, no
 *    event id, and the UI labels it as local. The `loaded` provenance block is
 *    kept because "I was editing the published carrot" is exactly what you want
 *    restored, but it describes an event that already exists, not this draft.
 * 2. A stored shape from an older build never corrupts a newer one. Every write
 *    stamps {@link DRAFT_SCHEMA_VERSION}; a read of anything else is discarded,
 *    loudly enough for the UI to say so and quietly enough not to lose the
 *    user's current work.
 * 3. Nothing secret is ever written. The form has no key material in it — the
 *    signer is reached through the app's existing account, never copied — and
 *    that is a property of the form model, checked by `drafts.test.ts`.
 */

import type { ItemFormState } from './item-form-model';

/**
 * Bump when {@link ItemFormState} changes shape in a way an old draft cannot
 * satisfy. Old drafts are dropped rather than migrated: a half-understood
 * migration of unpublished authoring data is worse than starting the form
 * empty and saying why.
 */
export const DRAFT_SCHEMA_VERSION = 1;

/** One `localStorage` key holds the whole store, so a save is one write. */
export const DRAFTS_STORAGE_KEY = 'blobbi-game-item-drafts';

export interface StoredDraft {
  id: string;
  /** User-facing label; defaults to the item's `d` or name. */
  name: string;
  /** Epoch milliseconds of the last autosave. */
  savedAt: number;
  form: ItemFormState;
}

export interface DraftStore {
  version: number;
  drafts: StoredDraft[];
  /** Which draft the editor is currently bound to. */
  activeId: string | null;
}

/** A store with nothing in it. */
export function emptyDraftStore(): DraftStore {
  return { version: DRAFT_SCHEMA_VERSION, drafts: [], activeId: null };
}

export type DraftLoadOutcome =
  | { status: 'ok'; store: DraftStore }
  | { status: 'empty'; store: DraftStore }
  /** Present but unusable — wrong version, malformed JSON, wrong shape. */
  | { status: 'discarded'; store: DraftStore; reason: string };

function isStoredDraft(value: unknown): value is StoredDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.id === 'string' &&
    typeof draft.name === 'string' &&
    typeof draft.savedAt === 'number' &&
    !!draft.form &&
    typeof draft.form === 'object' &&
    typeof (draft.form as Record<string, unknown>).d === 'string'
  );
}

/**
 * Read a store from its serialized form.
 *
 * Every failure mode collapses to "start empty and tell the user why" — a
 * corrupt draft must never throw during a render or wipe out the session.
 */
export function parseDraftStore(raw: string | null): DraftLoadOutcome {
  if (raw === null || raw.trim() === '') {
    return { status: 'empty', store: emptyDraftStore() };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      status: 'discarded',
      store: emptyDraftStore(),
      reason: 'The saved drafts were not readable JSON and have been discarded.',
    };
  }
  if (!parsed || typeof parsed !== 'object') {
    return {
      status: 'discarded',
      store: emptyDraftStore(),
      reason: 'The saved drafts had an unexpected shape and have been discarded.',
    };
  }
  const store = parsed as Record<string, unknown>;
  if (store.version !== DRAFT_SCHEMA_VERSION) {
    return {
      status: 'discarded',
      store: emptyDraftStore(),
      reason: `Saved drafts use schema v${String(store.version)}; this build writes v${DRAFT_SCHEMA_VERSION}. They have been discarded.`,
    };
  }
  if (!Array.isArray(store.drafts)) {
    return {
      status: 'discarded',
      store: emptyDraftStore(),
      reason: 'The saved drafts were missing their draft list and have been discarded.',
    };
  }
  const drafts = store.drafts.filter(isStoredDraft);
  return {
    status: 'ok',
    store: {
      version: DRAFT_SCHEMA_VERSION,
      drafts,
      activeId: typeof store.activeId === 'string' ? store.activeId : null,
    },
  };
}

/** Serialize a store for `localStorage`. */
export function serializeDraftStore(store: DraftStore): string {
  return JSON.stringify({ ...store, version: DRAFT_SCHEMA_VERSION });
}

/** The label a draft shows in the picker. */
export function draftLabel(form: ItemFormState): string {
  return form.name.trim() || form.d.trim() || 'Untitled item';
}

/** Insert or replace a draft, keeping the newest first. */
export function upsertDraft(
  store: DraftStore,
  draft: StoredDraft,
): DraftStore {
  const rest = store.drafts.filter((d) => d.id !== draft.id);
  return { ...store, drafts: [draft, ...rest], activeId: draft.id };
}

/** Remove a draft; clears `activeId` when it was the active one. */
export function removeDraft(store: DraftStore, id: string): DraftStore {
  const drafts = store.drafts.filter((d) => d.id !== id);
  return {
    ...store,
    drafts,
    activeId: store.activeId === id ? (drafts[0]?.id ?? null) : store.activeId,
  };
}

/** Does this draft hold anything worth restoring? */
export function isMeaningfulDraft(form: ItemFormState): boolean {
  return (
    form.d.trim() !== '' ||
    form.name.trim() !== '' ||
    form.type.trim() !== '' ||
    form.images.some((row) => row.url.trim() !== '') ||
    form.contexts.length > 0 ||
    form.topics.length > 0 ||
    form.content.description.trim() !== '' ||
    form.content.effects.length > 0 ||
    form.content.metadata.length > 0
  );
}
