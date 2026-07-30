/**
 * The Item Studio's state machine: one form, and everything derived from it.
 *
 * Kept out of the components so the editor sections stay dumb — each one
 * receives a slice of the form and a setter, and none of them knows how an
 * event is built. The derivation chain runs on every keystroke and touches no
 * network at all:
 *
 *   form → build input → unsigned template → preview event → validation
 *
 * That is the reason the preview feels instant: nothing in that chain queries a
 * relay, and the only asynchronous work in the whole editor is image probing,
 * which is debounced and merely decorates the result.
 *
 * SIGNING IS NOT PART OF THIS CHAIN. The preview event carries an empty `id`
 * and an empty `sig` and always will; the signer is invoked from the review
 * dialog and nowhere else.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  type ImageRow,
  type ItemFormState,
  PRIMARY_MARKER,
  blankImageRow,
  blankItemForm,
  nextRowId,
} from './item-form-model';
import {
  type ConversionResult,
  eventToForm,
  formAddress,
  formToUnsignedEvent,
  toPreviewEvent,
} from './form-event-conversion';
import { type StudioValidation, validateItemForm } from './validation';
import { useImageProbes } from './useImageProbes';
import { useItemDrafts, type ItemDraftsApi } from './useItemDrafts';
import type { KIND_GAME_ITEM_DEFINITION, UnsignedEventTemplate } from '@/inventory/package';

type Template = UnsignedEventTemplate<typeof KIND_GAME_ITEM_DEFINITION>;

export interface ItemStudioApi {
  form: ItemFormState;
  /** Patch top-level scalar fields. */
  patch: (patch: Partial<ItemFormState>) => void;
  /** Replace the whole form (loading a draft, a published event, or resetting). */
  replaceForm: (form: ItemFormState) => void;
  images: {
    add: (marker?: string) => void;
    update: (id: string, patch: Partial<Omit<ImageRow, 'id'>>) => void;
    remove: (id: string) => void;
    move: (id: string, delta: number) => void;
    duplicate: (id: string) => void;
    /** Clear this row's marker, making it the primary image. */
    makePrimary: (id: string) => void;
    /** Append rows for freshly uploaded URLs, keeping suggested markers. */
    appendMany: (entries: readonly { url: string; marker: string }[]) => void;
  };
  build: ConversionResult<Template>;
  previewEvent: NostrEvent | null;
  validation: StudioValidation;
  /**
   * Browser load results per image URL. Exposed so the editor and the preview
   * share ONE set of probes — mounting `useImageProbes` twice would load every
   * image twice and let the two copies disagree about what failed.
   */
  probes: ReadonlyMap<string, import('./validation').ImageProbe>;
  /** The address this form would publish to, or `null` when it cannot form one. */
  address: string | null;
  /**
   * Whether publishing would REPLACE an existing address rather than create a
   * new one — i.e. the form was loaded from a published event and `d` is
   * unchanged.
   */
  updatesLoadedAddress: boolean;
  drafts: ItemDraftsApi;
  /** Load a published event into the editor, returning parser warnings. */
  loadEvent: (event: NostrEvent, relays?: readonly string[]) => ConversionResult<string[]>;
  /** True once the user has touched the form since the last load/reset. */
  isDirty: boolean;
  markClean: () => void;
}

export function useItemStudio(pubkey: string | undefined): ItemStudioApi {
  const drafts = useItemDrafts();
  const [form, setForm] = useState<ItemFormState>(
    () => drafts.restoredForm ?? blankItemForm(),
  );
  const [isDirty, setIsDirty] = useState(false);

  // A stable preview timestamp. The real `created_at` is stamped at signing;
  // recomputing it every render would make the raw-event panel churn for no
  // reason and would make the preview look like it was changing on its own.
  const [previewCreatedAt] = useState(() => Math.floor(Date.now() / 1000));

  const patch = useCallback(
    (fields: Partial<ItemFormState>) => {
      setForm((previous) => ({ ...previous, ...fields }));
      setIsDirty(true);
    },
    [],
  );

  /**
   * Swap the entire form. Used for loading a draft, loading a published event,
   * and resetting — all of which are deliberate acts that establish a new
   * baseline, so the dirty flag clears rather than sets.
   */
  const replaceForm = useCallback((next: ItemFormState) => {
    setForm(next);
    setIsDirty(false);
  }, []);

  // --- Image row operations ------------------------------------------------

  const setImages = useCallback(
    (mapper: (rows: ImageRow[]) => ImageRow[]) => {
      setForm((previous) => ({ ...previous, images: mapper([...previous.images]) }));
      setIsDirty(true);
    },
    [],
  );

  const images = useMemo(
    () => ({
      add: (marker: string = PRIMARY_MARKER) =>
        setImages((rows) => [...rows, blankImageRow(marker)]),
      update: (id: string, rowPatch: Partial<Omit<ImageRow, 'id'>>) =>
        setImages((rows) =>
          rows.map((row) => (row.id === id ? { ...row, ...rowPatch } : row)),
        ),
      remove: (id: string) => setImages((rows) => rows.filter((row) => row.id !== id)),
      move: (id: string, delta: number) =>
        setImages((rows) => {
          const index = rows.findIndex((row) => row.id === id);
          const target = index + delta;
          if (index < 0 || target < 0 || target >= rows.length) return rows;
          const [row] = rows.splice(index, 1);
          rows.splice(target, 0, row);
          return rows;
        }),
      duplicate: (id: string) =>
        setImages((rows) => {
          const index = rows.findIndex((row) => row.id === id);
          if (index < 0) return rows;
          rows.splice(index + 1, 0, { ...rows[index], id: nextRowId('image') });
          return rows;
        }),
      makePrimary: (id: string) =>
        setImages((rows) =>
          rows.map((row) =>
            row.id === id ? { ...row, marker: PRIMARY_MARKER } : row,
          ),
        ),
      appendMany: (entries: readonly { url: string; marker: string }[]) =>
        setImages((rows) => [
          // Replace a single blank starter row rather than leaving a hole above
          // freshly uploaded artwork.
          ...rows.filter((row) => row.url.trim() !== ''),
          ...entries.map((entry) => ({
            id: nextRowId('image'),
            url: entry.url,
            marker: entry.marker,
          })),
        ]),
    }),
    [setImages],
  );

  // --- Derived state -------------------------------------------------------

  const build = useMemo(() => formToUnsignedEvent(form), [form]);

  const previewEvent = useMemo(
    () =>
      build.ok ? toPreviewEvent(build.value, pubkey ?? '', previewCreatedAt) : null,
    [build, pubkey, previewCreatedAt],
  );

  const probeUrls = useMemo(
    () => form.images.map((row) => row.url.trim()).filter(Boolean),
    [form.images],
  );
  const probes = useImageProbes(probeUrls);

  const validation = useMemo(
    () =>
      validateItemForm({
        form,
        previewEvent,
        buildError: build.ok ? null : build.error,
        probes,
      }),
    [form, previewEvent, build, probes],
  );

  const address = useMemo(() => formAddress(form, pubkey ?? ''), [form, pubkey]);

  const updatesLoadedAddress =
    form.loaded !== null &&
    address !== null &&
    form.loaded.address === address;

  // --- Autosave ------------------------------------------------------------

  const saveNow = drafts.saveNow;
  const skipFirstSave = useRef(true);
  useEffect(() => {
    // Restoring a draft must not immediately rewrite it with an identical copy.
    if (skipFirstSave.current) {
      skipFirstSave.current = false;
      return;
    }
    saveNow(form);
  }, [form, saveNow]);

  // --- Loading a published event ------------------------------------------

  const loadEvent = useCallback(
    (event: NostrEvent, relays: readonly string[] = []): ConversionResult<string[]> => {
      const result = eventToForm(event, { relays });
      if (!result.ok) return { ok: false, error: result.error };
      replaceForm(result.form);
      return { ok: true, value: result.warnings.map((w) => w.message) };
    },
    [replaceForm],
  );

  return {
    form,
    patch,
    replaceForm,
    images,
    build,
    previewEvent,
    validation,
    probes,
    address,
    updatesLoadedAddress,
    drafts,
    loadEvent,
    isDirty,
    markClean: useCallback(() => setIsDirty(false), []),
  };
}
