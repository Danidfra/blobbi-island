/**
 * The Published Items browser's pure view logic: which trust bucket a
 * definition falls into, and how search/filter/sort narrow the list.
 *
 * Separated from the component for one reason that matters more than
 * testability: {@link issuerBucket} is the function that decides whether a row
 * says "Official". Getting that wrong would let a third-party definition wear
 * the official badge, so it lives on its own, is derived only from the parsed
 * issuer pubkey, and is asserted directly.
 *
 * Note what the filters key on throughout: the full address, never the `d`.
 * Two issuers publishing the same `d` are two items, and no amount of filtering
 * may merge them.
 */

import { OFFICIAL_ITEM_ISSUER_PUBKEY } from '@/inventory/constants';

import type { PublishedDefinitionRecord } from './useItemDefinitions';

export type IssuerFilter = 'all' | 'official' | 'mine' | 'third-party';
export type IssuerBucket = 'official' | 'mine' | 'third-party';
export type SortKey = 'updated' | 'name' | 'd';

export interface BrowserFilterOptions {
  search: string;
  issuer: IssuerFilter;
  type: string;
  category: string;
  /** A marker value, `'primary'` for unmarked, or `'all'`. */
  marker: string;
  missingPrimaryOnly: boolean;
  sort: SortKey;
  signerPubkey: string | null;
}

/**
 * Which trust bucket a record falls into.
 *
 * `official` is decided by the issuer pubkey alone; not by the `d` tag, not by
 * the item's name, and not by which relay served it.
 */
export function issuerBucket(
  record: PublishedDefinitionRecord,
  signerPubkey: string | null,
): IssuerBucket {
  if (record.definition.issuer === OFFICIAL_ITEM_ISSUER_PUBKEY) return 'official';
  if (signerPubkey && record.definition.issuer === signerPubkey) return 'mine';
  return 'third-party';
}

/** Apply the browser's search, filters and sort. */
export function filterAndSortRecords(
  records: readonly PublishedDefinitionRecord[],
  options: BrowserFilterOptions,
): PublishedDefinitionRecord[] {
  const needle = options.search.trim().toLowerCase();

  const filtered = records.filter((record) => {
    const def = record.definition;

    if (needle !== '') {
      const haystack = `${def.name} ${def.id} ${def.address}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (
      options.issuer !== 'all' &&
      issuerBucket(record, options.signerPubkey) !== options.issuer
    ) {
      return false;
    }
    if (options.type !== 'all' && def.type !== options.type) return false;
    if (options.category !== 'all' && (def.category ?? '') !== options.category) {
      return false;
    }
    if (options.marker !== 'all') {
      const wanted = options.marker === 'primary' ? '' : options.marker;
      if (!def.images.some((image) => (image.marker ?? '') === wanted)) return false;
    }
    // "Missing primary" means no UNMARKED image, which is exactly the condition
    // that makes list rows fall back to a marked view.
    if (options.missingPrimaryOnly && def.images.some((image) => !image.marker)) {
      return false;
    }
    return true;
  });

  return filtered.sort((a, b) => {
    switch (options.sort) {
      case 'name':
        return a.definition.name.localeCompare(b.definition.name);
      case 'd':
        return a.definition.id.localeCompare(b.definition.id);
      default:
        return b.event.created_at - a.event.created_at;
    }
  });
}
