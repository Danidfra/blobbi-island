/**
 * Every kind:31632 definition the tools can see, from the official issuer and
 * from the active signer.
 *
 * ## Identity is the address, never the `d`
 *
 * Two different pubkeys may both publish `blobbi:accessory:party-hat`, and they
 * are two different items, relays will serve both, forever. This browser
 * therefore keys, de-duplicates, sorts and filters on the full
 * `31632:<pubkey>:<d>` address, and labels every row with whose key signed it:
 * `Official`, `You`, or `Third party`. Merging rows that share a `d` would
 * misrepresent the protocol and, worse, would let a stranger's event look like
 * an official one.
 *
 * ## Live without reloading
 *
 * Rows come from a TanStack query; publishing writes the new record straight
 * into that cache (`upsertDefinitionRecord`), so a publication appears here
 * immediately. Because de-duplication is by address with newest-wins, an update
 * REPLACES its row rather than adding a second one, which is exactly what a
 * replaceable event does on a relay.
 */

import { useMemo, useState } from 'react';
import { Loader2, RefreshCcw, Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getPrimaryItemImage } from '@/inventory/package';
import { shortHex } from '@/tools/game-items/signer-identity';
import {
  type IssuerBucket,
  type IssuerFilter,
  type SortKey,
  filterAndSortRecords,
  issuerBucket,
} from '@/tools/game-items/published-items-view';
import type { PublishedDefinitionRecord } from '@/tools/game-items/useItemDefinitions';

import {
  activationStatus,
  activationSubject,
} from '@/tools/game-items/activation-status';

import { ActivationStatusPanel } from './ActivationStatusPanel';
import { CopyButton, RawEventInspector } from './RawEventInspector';

export interface PublishedItemsBrowserProps {
  records: readonly PublishedDefinitionRecord[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  signerPubkey: string | null;
  onRefresh: () => void;
  onOpenInEditor: (record: PublishedDefinitionRecord) => void;
  onUseAsTemplate: (record: PublishedDefinitionRecord) => void;
}

export function PublishedItemsBrowser({
  records,
  isLoading,
  isFetching,
  error,
  signerPubkey,
  onRefresh,
  onOpenInEditor,
  onUseAsTemplate,
}: PublishedItemsBrowserProps) {
  const [search, setSearch] = useState('');
  const [issuer, setIssuer] = useState<IssuerFilter>('all');
  const [type, setType] = useState('all');
  const [category, setCategory] = useState('all');
  const [marker, setMarker] = useState('all');
  const [missingPrimaryOnly, setMissingPrimaryOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('updated');
  const [expanded, setExpanded] = useState<string | null>(null);

  const types = useMemo(
    () => [...new Set(records.map((r) => r.definition.type).filter(Boolean))].sort(),
    [records],
  );
  const categories = useMemo(
    () =>
      [...new Set(records.map((r) => r.definition.category ?? '').filter(Boolean))].sort(),
    [records],
  );
  const markers = useMemo(
    () =>
      [
        ...new Set(
          records.flatMap((r) => r.definition.images.map((i) => i.marker ?? 'primary')),
        ),
      ].sort(),
    [records],
  );

  const visible = useMemo(
    () =>
      filterAndSortRecords(records, {
        search,
        issuer,
        type,
        category,
        marker,
        missingPrimaryOnly,
        sort,
        signerPubkey,
      }),
    [records, search, issuer, type, category, marker, missingPrimaryOnly, sort, signerPubkey],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            placeholder="Search name, d or address"
            className="h-9 pl-8"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <FilterSelect
          label="Issuer"
          value={issuer}
          onChange={(value) => setIssuer(value as IssuerFilter)}
          options={[
            ['all', 'Any issuer'],
            ['official', 'Official'],
            ['mine', 'Current signer'],
            ['third-party', 'Third party'],
          ]}
        />
        <FilterSelect
          label="Type"
          value={type}
          onChange={setType}
          options={[['all', 'Any type'], ...types.map((t) => [t, t] as const)]}
        />
        <FilterSelect
          label="Category"
          value={category}
          onChange={setCategory}
          options={[['all', 'Any category'], ...categories.map((c) => [c, c] as const)]}
        />
        <FilterSelect
          label="Marker"
          value={marker}
          onChange={setMarker}
          options={[['all', 'Any view'], ...markers.map((m) => [m, m] as const)]}
        />
        <FilterSelect
          label="Sort"
          value={sort}
          onChange={(value) => setSort(value as SortKey)}
          options={[
            ['updated', 'Newest first'],
            ['name', 'Name'],
            ['d', 'd tag'],
          ]}
        />

        <Button
          type="button"
          variant={missingPrimaryOnly ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setMissingPrimaryOnly((value) => !value)}
        >
          Missing primary
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onRefresh}
          disabled={isFetching}
        >
          {isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
      </div>

      {error && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error.message}
        </p>
      )}

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="space-y-2 rounded-xl border p-3">
              <div className="flex gap-3">
                <Skeleton className="h-16 w-16 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {records.length === 0
            ? 'No definitions found on the configured relays for these issuers.'
            : 'No items match these filters.'}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {visible.map((record) => (
            <li key={record.address}>
              <ItemCard
                record={record}
                bucket={issuerBucket(record, signerPubkey)}
                expanded={expanded === record.address}
                onToggleExpanded={() =>
                  setExpanded(expanded === record.address ? null : record.address)
                }
                onOpenInEditor={() => onOpenInEditor(record)}
                onUseAsTemplate={() => onUseAsTemplate(record)}
                canEdit={record.definition.issuer === signerPubkey}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-auto min-w-32 text-xs" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([optionValue, optionLabel]) => (
          <SelectItem key={optionValue} value={optionValue} className="text-xs">
            {optionLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const BUCKET_LABEL = {
  official: { label: 'Official', className: 'bg-emerald-600 text-white' },
  mine: { label: 'You', className: 'bg-sky-600 text-white' },
  'third-party': { label: 'Third party', className: 'bg-amber-600 text-white' },
} as const;

function ItemCard({
  record,
  bucket,
  expanded,
  onToggleExpanded,
  onOpenInEditor,
  onUseAsTemplate,
  canEdit,
}: {
  record: PublishedDefinitionRecord;
  bucket: IssuerBucket;
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpenInEditor: () => void;
  onUseAsTemplate: () => void;
  canEdit: boolean;
}) {
  const def = record.definition;
  const image = getPrimaryItemImage(def);
  const badge = BUCKET_LABEL[bucket];
  const subject = activationSubject(def);
  const status = activationStatus(subject);

  return (
    <div className="space-y-3 rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex gap-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
          {image ? (
            <img src={image} alt={def.name} className="max-h-full max-w-full object-contain" loading="lazy" />
          ) : (
            <span className="text-2xl">{def.symbol || '📦'}</span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-semibold">{def.name}</p>
            <Badge className={cn('text-[10px]', badge.className)}>{badge.label}</Badge>
            {record.warnings.length > 0 && (
              <Badge variant="outline" className="text-[10px] text-amber-600">
                {record.warnings.length} warning(s)
              </Badge>
            )}
          </div>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{def.id}</p>
          <div className="flex flex-wrap gap-1">
            {def.type && <Badge variant="secondary" className="text-[10px]">{def.type}</Badge>}
            {def.category && <Badge variant="outline" className="text-[10px]">{def.category}</Badge>}
            {def.rarity && <Badge variant="outline" className="text-[10px]">{def.rarity}</Badge>}
            <Badge variant="outline" className="text-[10px]">
              {def.images.length} image(s)
            </Badge>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {def.images.map((i) => i.marker ?? 'primary').join(' · ') || 'no images'}
          </p>
        </div>
      </div>

      <dl className="space-y-0.5 text-[10px] text-muted-foreground">
        <div className="flex gap-1">
          <dt>author</dt>
          <dd className="font-mono">{shortHex(def.issuer)}</dd>
        </div>
        <div className="flex gap-1">
          <dt>updated</dt>
          <dd>{new Date(record.event.created_at * 1000).toLocaleString()}</dd>
        </div>
        <div className="flex min-w-0 gap-1">
          <dt className="shrink-0">address</dt>
          <dd className="truncate font-mono">{def.address}</dd>
        </div>
      </dl>

      {/* Cosmetics only; `ActivationStatusPanel` renders nothing for the rest. */}
      <ActivationStatusPanel subject={subject} status={status} />

      <div className="flex flex-wrap gap-1.5">
        {canEdit ? (
          <Button type="button" size="sm" variant="outline" onClick={onOpenInEditor}>
            Open in editor
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={onUseAsTemplate}>
            Use as template
          </Button>
        )}
        <CopyButton value={def.address} label="Copy address" />
        <Button type="button" size="sm" variant="ghost" onClick={onToggleExpanded}>
          {expanded ? 'Hide raw event' : 'Raw event'}
        </Button>
      </div>

      {expanded && (
        <RawEventInspector
          event={record.event}
          parsedModel={{ ...def, event: undefined }}
          warnings={record.warnings}
          relays={record.relays}
          defaultOpen
        />
      )}
    </div>
  );
}
