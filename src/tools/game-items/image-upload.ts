/**
 * Blossom uploads for item artwork, on top of the app's EXISTING uploader.
 *
 * `useUploadFile` (`src/hooks/useUploadFile.ts`) is the app's one Blossom
 * client: it builds a `BlossomUploader` against `blossom.primal.net`, signs the
 * authorization with the current account, and returns NIP-94 tags whose first
 * entry carries the URL. The Photo Booth's share flow and the profile editor
 * both go through it. This module adds NO second uploader, no second server
 * list and no credential handling; it queues files, calls that hook once per
 * file, and maps results onto image rows.
 *
 * WHAT THIS ADDS over calling the hook directly:
 *
 *  - a queue with per-file status, so a five-file drop reports which one failed
 *    rather than failing as a unit;
 *  - marker SUGGESTIONS from filenames, shown as editable values before anything
 *    is applied. A file called `hat-back.png` proposes `back`; it never assigns
 *    it silently, because a wrong marker is invisible until an accessory renders
 *    backwards on somebody's Blobbi;
 *  - the guarantee that finishing an upload does exactly one thing: it puts a
 *    URL in a row. It never signs, never publishes, and never touches the rest
 *    of the form.
 */

import { useCallback, useState } from 'react';

import { useUploadFile } from '@/hooks/useUploadFile';
import { GAME_ITEM_IMAGE_MARKERS } from '@/inventory/package';

import { PRIMARY_MARKER, nextRowId } from './item-form-model';

/**
 * Guess a view marker from a filename.
 *
 * Ordered longest-pattern-first: `hat-diagonal-front-right.png` must not match
 * the `front` rule, and `hat-side-left.png` must not match a bare `left`.
 * Returns {@link PRIMARY_MARKER} when nothing matches, which is the correct
 * default: an unmarked image is the primary one.
 */
export function suggestMarkerFromFilename(filename: string): string {
  const name = filename.toLowerCase().replace(/\.[a-z0-9]+$/, '');

  const patterns: readonly [RegExp, string][] = [
    [/diagonal[-_]?front[-_]?right|diag[-_]?fr\b/, 'diagonal-front-right'],
    [/diagonal[-_]?front[-_]?left|diag[-_]?fl\b/, 'diagonal-front-left'],
    [/side[-_]?right|[-_]right$/, 'side-right'],
    [/side[-_]?left|[-_]left$/, 'side-left'],
    [/[-_]?back$|[-_]back[-_]/, 'back'],
    [/[-_]?front$|[-_]front[-_]/, 'front'],
  ];

  for (const [pattern, marker] of patterns) {
    if (pattern.test(name)) return marker;
  }
  return PRIMARY_MARKER;
}

/** Every marker a suggestion may produce, for the mapping UI. */
export const SUGGESTABLE_MARKERS: readonly string[] = [
  PRIMARY_MARKER,
  ...GAME_ITEM_IMAGE_MARKERS,
];

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error';

export interface UploadEntry {
  id: string;
  file: File;
  filename: string;
  /** Editable; seeded from {@link suggestMarkerFromFilename}. */
  marker: string;
  status: UploadStatus;
  url?: string;
  error?: string;
}

export interface ItemImageUploadApi {
  entries: UploadEntry[];
  /** Queue files with suggested markers. Uploads nothing yet. */
  addFiles: (files: readonly File[]) => void;
  setMarker: (id: string, marker: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** Upload every queued file; resolves with the rows that succeeded. */
  uploadAll: () => Promise<{ url: string; marker: string }[]>;
  isUploading: boolean;
  /** True when at least one entry finished successfully. */
  hasCompleted: boolean;
}

/**
 * A Blossom upload queue bound to one image manager.
 *
 * Files upload sequentially rather than in parallel. Each upload signs a
 * Blossom authorization, and a NIP-07 extension or a remote bunker prompting
 * for five signatures at once is a worse experience than five in a row, and on
 * some signers it simply fails.
 */
export function useItemImageUpload(): ItemImageUploadApi {
  const { mutateAsync: uploadFile } = useUploadFile();
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const addFiles = useCallback((files: readonly File[]) => {
    setEntries((previous) => [
      ...previous,
      ...files.map((file) => ({
        id: nextRowId('upload'),
        file,
        filename: file.name,
        marker: suggestMarkerFromFilename(file.name),
        status: 'queued' as const,
      })),
    ]);
  }, []);

  const setMarker = useCallback((id: string, marker: string) => {
    setEntries((previous) =>
      previous.map((entry) => (entry.id === id ? { ...entry, marker } : entry)),
    );
  }, []);

  const remove = useCallback((id: string) => {
    setEntries((previous) => previous.filter((entry) => entry.id !== id));
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  const uploadAll = useCallback(async () => {
    const queued = entries.filter((entry) => entry.status === 'queued' || entry.status === 'error');
    if (queued.length === 0) return [];

    setIsUploading(true);
    const uploaded: { url: string; marker: string }[] = [];

    try {
      for (const entry of queued) {
        setEntries((previous) =>
          previous.map((e) =>
            e.id === entry.id ? { ...e, status: 'uploading', error: undefined } : e,
          ),
        );
        try {
          const tags = await uploadFile(entry.file);
          const url = tags[0]?.[1];
          if (!url) throw new Error('The upload returned no URL.');
          uploaded.push({ url, marker: entry.marker });
          setEntries((previous) =>
            previous.map((e) => (e.id === entry.id ? { ...e, status: 'done', url } : e)),
          );
        } catch (error) {
          setEntries((previous) =>
            previous.map((e) =>
              e.id === entry.id
                ? { ...e, status: 'error', error: (error as Error).message }
                : e,
            ),
          );
        }
      }
    } finally {
      setIsUploading(false);
    }

    return uploaded;
  }, [entries, uploadFile]);

  return {
    entries,
    addFiles,
    setMarker,
    remove,
    clear,
    uploadAll,
    isUploading,
    hasCompleted: entries.some((entry) => entry.status === 'done'),
  };
}
