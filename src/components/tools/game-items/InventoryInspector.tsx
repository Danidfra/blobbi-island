/**
 * A READ-ONLY view of a kind:31633 inventory, joined to the definitions its
 * addresses point at.
 *
 * Read-only is a hard property, not a current limitation. There is no quantity
 * control, no grant button, no "add to my inventory", and no code path in this
 * component that reaches `useInventoryMutation`. Its purpose is to answer "did
 * the definition I just published actually resolve for the items people hold?",
 * and a tool that can also change what people hold answers that question less
 * honestly.
 *
 * ## Two queries, no matter how many items
 *
 *   useIslandInventory()              → one kind:31633 event
 *   useItemDefinitionsByAddress(...)  → one batched kind:31632 request
 *
 * Rows are then derived synchronously by `buildInspectorRows`. Nothing is
 * fetched per row, which is why a 50-item inventory costs the same two
 * subscriptions as a 2-item one. Both queries live in TanStack Query, so a
 * newer inventory event, a newly published definition, an account change or a
 * relay change all refresh this view in place; there is no reload anywhere in
 * this file.
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
import type { GameInventory } from '@/inventory/package';
import { shortHex } from '@/tools/game-items/signer-identity';
import {
  type DefinitionSource,
  type InventoryInspectorRow,
  type InventorySortKey,
  filterInspectorRows,
  summarizeRows,
} from '@/tools/game-items/inventory-inspection';
import type { PublishedDefinitionRecord } from '@/tools/game-items/useItemDefinitions';

import { CopyButton, RawEventInspector } from './RawEventInspector';

const SOURCE_BADGE: Record<DefinitionSource, { label: string; className: string }> = {
  published: { label: 'published definition', className: 'bg-emerald-600 text-white' },
  bundled: { label: 'bundled fallback', className: 'bg-sky-600 text-white' },
  unknown: { label: 'unresolved', className: 'bg-destructive text-destructive-foreground' },
};

export interface InventoryInspectorProps {
  inventory: GameInventory | undefined;
  rows: readonly InventoryInspectorRow[];
  ownerPubkey: string | null;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  onRefresh: () => void;
  onOpenInEditor: (record: PublishedDefinitionRecord) => void;
  onUseAsTemplate: (record: PublishedDefinitionRecord) => void;
  signerPubkey: string | null;
}

export function InventoryInspector({
  inventory,
  rows,
  ownerPubkey,
  isLoading,
  isFetching,
  error,
  onRefresh,
  onOpenInEditor,
  onUseAsTemplate,
  signerPubkey,
}: InventoryInspectorProps) {
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<DefinitionSource | 'all'>('all');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState<InventorySortKey>('name');
  const [expanded, setExpanded] = useState<string | null>(null);

  const summary = useMemo(() => summarizeRows(rows), [rows]);
  const types = useMemo(
    () => [...new Set(rows.map((row) => row.type).filter(Boolean))].sort(),
    [rows],
  );
  const visible = useMemo(
    () => filterInspectorRows(rows, { search, source, type, sort }),
    [rows, search, source, type, sort],
  );

  if (!ownerPubkey) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
        Sign in to inspect your inventory. This panel never writes; it only reads
        your kind:31633 event.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* --- Summary ------------------------------------------------------- */}
      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Inventory</h3>
            <p className="font-mono text-[11px] text-muted-foreground">
              {inventory?.address ?? '-'}
            </p>
          </div>
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

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
          <Stat label="Items" value={String(summary.itemCount)} />
          <Stat label="Total quantity" value={String(summary.totalQuantity)} />
          <Stat label="Unresolved" value={String(summary.unresolvedCount)} />
          <Stat label="Definition warnings" value={String(summary.warningCount)} />
          <Stat label="Owner" value={shortHex(ownerPubkey)} mono />
          <Stat
            label="Event id"
            value={inventory?.event.id ? shortHex(inventory.event.id) : '(no event yet)'}
            mono
          />
          <Stat
            label="created_at"
            value={
              inventory?.event.created_at
                ? new Date(inventory.event.created_at * 1000).toLocaleString()
                : '-'
            }
          />
          <Stat label="Bundled fallbacks" value={String(summary.bundledCount)} />
        </dl>

        <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
          Read-only. Quantities cannot be changed here, and nothing on this page
          grants, equips or consumes an item.
        </p>
      </section>

      {/* --- Filters ------------------------------------------------------- */}
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
        <Select value={source} onValueChange={(value) => setSource(value as typeof source)}>
          <SelectTrigger className="h-9 w-40 text-xs" aria-label="Definition source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any source</SelectItem>
            <SelectItem value="published">Published definition</SelectItem>
            <SelectItem value="bundled">Bundled fallback</SelectItem>
            <SelectItem value="unknown">Unresolved</SelectItem>
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="h-9 w-36 text-xs" aria-label="Item type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any type</SelectItem>
            {types.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(value) => setSort(value as InventorySortKey)}>
          <SelectTrigger className="h-9 w-36 text-xs" aria-label="Sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="quantity">Quantity</SelectItem>
            <SelectItem value="address">Address</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error.message}
        </p>
      )}

      {/* --- Rows ---------------------------------------------------------- */}
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((key) => (
            <div key={key} className="flex gap-3 rounded-xl border p-3">
              <Skeleton className="h-12 w-12 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-64" />
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {rows.length === 0
            ? 'This inventory is empty.'
            : 'No entries match these filters.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((row) => (
            <li key={row.address}>
              <InventoryRow
                row={row}
                expanded={expanded === row.address}
                onToggle={() =>
                  setExpanded(expanded === row.address ? null : row.address)
                }
                canEdit={!!signerPubkey && row.issuer === signerPubkey}
                onOpenInEditor={onOpenInEditor}
                onUseAsTemplate={onUseAsTemplate}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn('truncate text-xs font-medium', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}

function InventoryRow({
  row,
  expanded,
  onToggle,
  canEdit,
  onOpenInEditor,
  onUseAsTemplate,
}: {
  row: InventoryInspectorRow;
  expanded: boolean;
  onToggle: () => void;
  canEdit: boolean;
  onOpenInEditor: (record: PublishedDefinitionRecord) => void;
  onUseAsTemplate: (record: PublishedDefinitionRecord) => void;
}) {
  const badge = SOURCE_BADGE[row.source];

  return (
    <div className="space-y-2 rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
          {row.imageUrl ? (
            <img
              src={row.imageUrl}
              alt={row.name}
              className="max-h-full max-w-full object-contain"
              loading="lazy"
            />
          ) : (
            <span className="text-xl">{row.emoji}</span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-semibold">{row.name}</p>
            <Badge variant="secondary" className="text-[10px]">
              ×{row.quantity}
            </Badge>
            <Badge className={cn('text-[10px]', badge.className)}>{badge.label}</Badge>
            {row.isOfficialIssuer ? (
              <Badge variant="outline" className="text-[10px]">
                official issuer
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-amber-600">
                third-party issuer
              </Badge>
            )}
            {row.warningCount > 0 && (
              <Badge variant="outline" className="text-[10px] text-amber-600">
                {row.warningCount} warning(s)
              </Badge>
            )}
          </div>

          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {row.address}
          </p>
          <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
            {row.type && <span>type: {row.type}</span>}
            {row.category && <span>· category: {row.category}</span>}
            {row.rarity && <span>· rarity: {row.rarity}</span>}
            {row.itemId && <span>· itemId: {row.itemId}</span>}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <CopyButton value={row.address} label="Copy address" />
        {row.record &&
          (canEdit ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onOpenInEditor(row.record!)}
            >
              Open in Item Studio
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onUseAsTemplate(row.record!)}
            >
              Use as template
            </Button>
          ))}
        <Button type="button" size="sm" variant="ghost" onClick={onToggle}>
          {expanded ? 'Hide details' : 'Details'}
        </Button>
      </div>

      {expanded && (
        <div className="space-y-2 border-t pt-2">
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Inventory tag
            </p>
            <p className="break-all font-mono text-[11px]">
              {row.rawTag.length > 0 ? JSON.stringify(row.rawTag) : '(not found on the event)'}
            </p>
          </div>

          {row.source === 'unknown' && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
              No kind:31632 event was found at this address on the configured relays,
              and Blobbi Island ships no fallback for it. The item is held, but
              nothing describes it.
            </p>
          )}

          {row.source === 'bundled' && (
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
              Shown from Blobbi Island&rsquo;s bundled metadata. No published
              definition was found at this address, publishing one would replace
              this fallback everywhere in the game.
            </p>
          )}

          {row.record && (
            <RawEventInspector
              event={row.record.event}
              parsedModel={{ ...row.record.definition, event: undefined }}
              warnings={row.record.warnings}
              relays={row.record.relays}
              title="Item definition"
            />
          )}
        </div>
      )}
    </div>
  );
}
