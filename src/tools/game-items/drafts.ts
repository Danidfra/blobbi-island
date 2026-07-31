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
 * 2. A stored shape from an older build never corrupts a newer one — and never
 *    CRASHES one either. Two mechanisms, for two different kinds of change:
 *
 *    - **Additive** fields (a new optional input, a new sub-object key) are
 *      HYDRATED from the blank form's defaults on read ({@link hydrateStoredForm}).
 *      A draft written before the field existed simply gets the empty value,
 *      which is what "the author never touched it" means anyway.
 *    - **Incompatible** changes — a field whose default would be WRONG, a
 *      renamed key, a changed meaning — bump {@link DRAFT_SCHEMA_VERSION}, and
 *      the whole store is discarded with a reason the UI shows.
 *
 *    Hydration is not a half-understood migration; it is the same defensive
 *    defaulting `contentToForm` already applies to a fetched event, and it
 *    exists because the alternative was real: an old draft reaching a newer
 *    build's `visual.kind.trim()` took the entire studio down to the error
 *    boundary, losing the author's work to a field they never typed in.
 * 3. Nothing secret is ever written. The form has no key material in it — the
 *    signer is reached through the app's existing account, never copied — and
 *    that is a property of the form model, checked by `drafts.test.ts`.
 */

import {
  type ContentFormState,
  type ItemFormState,
  type VisualFormState,
  blankContent,
  blankItemForm,
  blankVisual,
} from './item-form-model';

/**
 * Bump ONLY for a change an old draft cannot satisfy with defaults — a renamed
 * key, a changed meaning, a field whose empty value would be wrong. Purely
 * additive fields need no bump: {@link hydrateStoredForm} fills them in, and
 * bumping for those would throw away unpublished authoring work to avoid
 * writing an empty string.
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

/** A plain object, as opposed to `null`, an array or a primitive. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Fill a stored form out to the CURRENT {@link ItemFormState} shape.
 *
 * Merged one level at a time, each level over its own blank: a stored value
 * wins where it exists, and a field the stored draft never heard of gets the
 * blank form's value. Shallow-per-level rather than a deep merge on purpose —
 * the arrays (`images`, `topics`, `effects`, …) are the author's data and must
 * be taken whole, not element-wise reconciled against an empty list.
 *
 * Nothing here validates the author's content; a draft is scratch state and is
 * allowed to be half-finished. All this guarantees is that every field the code
 * dereferences EXISTS, which is the difference between an odd-looking form and
 * a white screen.
 */
export function hydrateStoredForm(stored: unknown): ItemFormState {
  const base = blankItemForm();
  if (!isPlainObject(stored)) return base;

  const storedContent = stored.content;
  const content: ContentFormState = {
    ...blankContent(),
    ...(isPlainObject(storedContent) ? storedContent : {}),
  };

  const storedVisual = isPlainObject(storedContent) ? storedContent.visual : undefined;
  const visual: VisualFormState = {
    ...blankVisual(),
    ...(isPlainObject(storedVisual) ? storedVisual : {}),
  };

  return { ...base, ...stored, content: { ...content, visual } };
}

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
  // Hydrated on the way IN, so nothing downstream — the editor, autosave, the
  // draft picker — ever holds a form from an older shape.
  const drafts = store.drafts
    .filter(isStoredDraft)
    .map((draft) => ({ ...draft, form: hydrateStoredForm(draft.form) }));
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
