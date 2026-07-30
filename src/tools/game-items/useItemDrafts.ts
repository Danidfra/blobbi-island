/**
 * Debounced autosave for the Item Studio, on top of the pure store in
 * `drafts.ts`.
 *
 * `useLocalStorage` is not used here on purpose: it writes on every `setValue`
 * call, and this form changes on every keystroke. The debounce is the whole
 * point — a 700 ms pause is the unit of work, not a character.
 *
 * Cross-tab behavior is deliberately narrow. Another tab's draft edits do NOT
 * stomp this tab's editor: silently swapping the form out from under someone
 * mid-sentence is worse than two tabs diverging, and the loser of that race
 * would lose real work. Published events are a different story — those DO
 * update live, because they are facts about the network rather than local
 * scratch state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  DRAFTS_STORAGE_KEY,
  type DraftStore,
  type StoredDraft,
  draftLabel,
  emptyDraftStore,
  isMeaningfulDraft,
  parseDraftStore,
  removeDraft,
  serializeDraftStore,
  upsertDraft,
} from './drafts';
import { nextRowId, reserveRowIds } from './item-form-model';
import type { ItemFormState } from './item-form-model';

const AUTOSAVE_DEBOUNCE_MS = 700;

export interface ItemDraftsApi {
  store: DraftStore;
  activeDraftId: string;
  /** Epoch ms of the last successful autosave, or `null` if never saved. */
  savedAt: number | null;
  /** Set when a stored draft could not be restored, for a visible notice. */
  restoreError: string | null;
  /** The draft restored at mount, if any — the editor seeds its form from it. */
  restoredForm: ItemFormState | null;
  saveNow: (form: ItemFormState) => void;
  clearActiveDraft: () => void;
  duplicateActiveDraft: (form: ItemFormState) => string;
  selectDraft: (id: string) => ItemFormState | null;
  deleteDraft: (id: string) => void;
  /** Does the active draft hold unsaved-to-relay content worth warning about? */
  hasMeaningfulDraft: (form: ItemFormState) => boolean;
}

function readStore(): { store: DraftStore; error: string | null } {
  try {
    const outcome = parseDraftStore(localStorage.getItem(DRAFTS_STORAGE_KEY));
    return {
      store: outcome.store,
      error: outcome.status === 'discarded' ? outcome.reason : null,
    };
  } catch (error) {
    // A storage access that throws (private mode, quota, disabled cookies) must
    // not take the editor down with it.
    return {
      store: emptyDraftStore(),
      error: `Local drafts are unavailable: ${(error as Error).message}`,
    };
  }
}

function writeStore(store: DraftStore): void {
  try {
    localStorage.setItem(DRAFTS_STORAGE_KEY, serializeDraftStore(store));
  } catch {
    // Out of quota or storage disabled. The editor keeps working in memory;
    // `savedAt` simply stops advancing, which the UI shows.
  }
}

/**
 * Every `nextRowId`-minted id inside a restored store: the draft ids themselves
 * plus each draft's repeatable rows.
 *
 * Listed explicitly rather than deep-walked, because these are exactly the
 * arrays whose members carry a generated `id`; a generic walk would also sweep
 * up unrelated strings and inflate the counter for no reason.
 */
function collectRestoredIds(store: DraftStore): string[] {
  const ids: string[] = [];
  for (const draft of store.drafts) {
    ids.push(draft.id);
    for (const row of draft.form.images) ids.push(row.id);
    for (const row of draft.form.basedOn) ids.push(row.id);
    for (const row of draft.form.content.effects) ids.push(row.id);
    for (const row of draft.form.content.metadata) ids.push(row.id);
  }
  if (store.activeId) ids.push(store.activeId);
  return ids;
}

/** Draft persistence bound to one editor instance. */
export function useItemDrafts(): ItemDraftsApi {
  const initial = useRef<{ store: DraftStore; error: string | null }>();
  if (!initial.current) {
    initial.current = readStore();
    // Restored ids were minted by a PREVIOUS page load, whose counter is gone.
    // Claim them before anything mints a new one, or the next "Add image" reuses
    // `image-1` and React sees two children with the same key. Done here because
    // this is the one place persisted rows re-enter the app.
    reserveRowIds(collectRestoredIds(initial.current.store));
  }

  const [store, setStore] = useState<DraftStore>(initial.current.store);
  const [savedAt, setSavedAt] = useState<number | null>(
    initial.current.store.drafts[0]?.savedAt ?? null,
  );
  const restoreError = initial.current.error;

  const [activeDraftId, setActiveDraftId] = useState<string>(
    () => initial.current!.store.activeId ?? nextRowId('draft'),
  );

  const restoredForm = useMemo(() => {
    const active = initial.current!.store.drafts.find(
      (d) => d.id === initial.current!.store.activeId,
    );
    return active?.form ?? null;
    // Reading the mount-time snapshot exactly once is the intent: a later store
    // change must not re-seed the editor.
  }, []);

  const timer = useRef<ReturnType<typeof setTimeout>>();

  const persist = useCallback((draft: StoredDraft) => {
    setStore((previous) => {
      const next = upsertDraft(previous, draft);
      writeStore(next);
      return next;
    });
    setSavedAt(draft.savedAt);
  }, []);

  const saveNow = useCallback(
    (form: ItemFormState) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!isMeaningfulDraft(form)) return;
        persist({
          id: activeDraftId,
          name: draftLabel(form),
          savedAt: Date.now(),
          form,
        });
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [activeDraftId, persist],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  const clearActiveDraft = useCallback(() => {
    clearTimeout(timer.current);
    setStore((previous) => {
      const next = removeDraft(previous, activeDraftId);
      writeStore(next);
      return next;
    });
    setSavedAt(null);
    setActiveDraftId(nextRowId('draft'));
  }, [activeDraftId]);

  const duplicateActiveDraft = useCallback(
    (form: ItemFormState) => {
      const id = nextRowId('draft');
      setActiveDraftId(id);
      persist({
        id,
        name: `${draftLabel(form)} (copy)`,
        savedAt: Date.now(),
        form,
      });
      return id;
    },
    [persist],
  );

  const selectDraft = useCallback(
    (id: string) => {
      const draft = store.drafts.find((d) => d.id === id);
      if (!draft) return null;
      setActiveDraftId(id);
      setStore((previous) => {
        const next = { ...previous, activeId: id };
        writeStore(next);
        return next;
      });
      setSavedAt(draft.savedAt);
      return draft.form;
    },
    [store.drafts],
  );

  const deleteDraft = useCallback((id: string) => {
    setStore((previous) => {
      const next = removeDraft(previous, id);
      writeStore(next);
      return next;
    });
  }, []);

  return {
    store,
    activeDraftId,
    savedAt,
    restoreError,
    restoredForm,
    saveNow,
    clearActiveDraft,
    duplicateActiveDraft,
    selectDraft,
    deleteDraft,
    hasMeaningfulDraft: isMeaningfulDraft,
  };
}
