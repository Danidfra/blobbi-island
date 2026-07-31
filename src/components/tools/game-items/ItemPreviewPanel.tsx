/**
 * The preview column: the same item seen four different ways, because "does
 * this item look right?" is four different questions.
 *
 *   Card         what an inventory row, a shop tile or a chest slot shows.
 *                Uses `primaryItemImageUrl` — the SAME helper those screens
 *                use — so a missing primary image looks broken here in exactly
 *                the way it will look broken there.
 *   Views        one tile per published `image` tag, marker and all. Nothing is
 *                invented: a view the item does not publish is shown as absent
 *                rather than substituted, because a side view standing in for a
 *                front view would hide the very gap you are looking for.
 *   Compare      primary / front / back side by side, which is the check that
 *                actually matters for a wearable.
 *   On a Blobbi  the real renderer, real resolution order, no writes.
 *
 * Everything here reads the LIVE form, not a published event, so it updates as
 * you type and never touches a relay.
 */

import { useState } from 'react';
import { ImageOff } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { GAME_ITEM_IMAGE_MARKERS } from '@/inventory/package';
import {
  itemImageByMarker,
  itemImageSourcesForView,
  primaryItemImageUrl,
  type ItemImageCandidate,
} from '@/inventory/item-image-resolution';
import {
  type ItemFormState,
  isEffectItemForm,
  urlHost,
} from '@/tools/game-items/item-form-model';
import { formImageCandidate } from '@/tools/game-items/form-event-conversion';
import type { ImageProbe } from '@/tools/game-items/validation';

import { BlobbiAccessoryPreview } from './BlobbiAccessoryPreview';
import { BlobbiEffectPreview } from './BlobbiEffectPreview';

const CHECKERBOARD =
  'repeating-conic-gradient(hsl(var(--muted)) 0% 25%, hsl(var(--background)) 0% 50%) 50% / 12px 12px';

export interface ItemPreviewPanelProps {
  form: ItemFormState;
  probes: ReadonlyMap<string, ImageProbe>;
}

export function ItemPreviewPanel({ form, probes }: ItemPreviewPanelProps) {
  const candidate = formImageCandidate(form);
  // An effect item's image is a TOKEN representing the effect, not artwork to
  // be worn. Drawing it as an accessory would preview something the game never
  // renders, so the last tab previews the effect itself instead.
  const isEffect = isEffectItemForm(form);

  return (
    <Tabs defaultValue="card" className="w-full">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="card" className="text-xs">
          Card
        </TabsTrigger>
        <TabsTrigger value="views" className="text-xs">
          Views
        </TabsTrigger>
        <TabsTrigger value="compare" className="text-xs">
          Compare
        </TabsTrigger>
        <TabsTrigger value="blobbi" className="text-xs">
          On a Blobbi
        </TabsTrigger>
      </TabsList>

      <TabsContent value="card" className="pt-4">
        <CompactCardPreview form={form} candidate={candidate} />
      </TabsContent>

      <TabsContent value="views" className="pt-4">
        <ViewGallery form={form} probes={probes} />
      </TabsContent>

      <TabsContent value="compare" className="pt-4">
        <ViewComparison candidate={candidate} />
      </TabsContent>

      <TabsContent value="blobbi" className="pt-4">
        {isEffect ? (
          <BlobbiEffectPreview
            effect={form.content.visual.effect}
            effectSlot={form.content.visual.effectSlot}
          />
        ) : (
          <BlobbiAccessoryPreview
            candidate={candidate}
            slot={form.content.visual.slot}
            code={form.d || 'preview-item'}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}

/** Exactly what a list row renders: primary image, or the emoji/placeholder. */
function CompactCardPreview({
  form,
  candidate,
}: {
  form: ItemFormState;
  candidate: ItemImageCandidate;
}) {
  const url = primaryItemImageUrl(candidate);

  return (
    <div className="space-y-3">
      <div className="mx-auto w-full max-w-56 rounded-2xl border bg-card p-3 shadow-sm">
        <div
          className="flex aspect-square items-center justify-center overflow-hidden rounded-xl border"
          style={{ background: CHECKERBOARD }}
        >
          {url ? (
            <img
              src={url}
              alt={form.name || 'Item preview'}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-4xl" aria-label="No image">
              {form.symbol || '📦'}
            </span>
          )}
        </div>
        <div className="space-y-1 pt-2.5">
          <p className="truncate text-sm font-semibold">
            {form.name || <span className="text-muted-foreground">Unnamed item</span>}
          </p>
          {/*
            `max-w-full break-all` on every badge, because all three render FREE
            TEXT. `type`, `category` and `rarity` are plain inputs the author can
            put anything into — including a pasted URL — and a Badge is an
            `inline-flex` that otherwise sizes to its content and refuses to
            wrap. One long value made a badge 543px wide inside this 198px card
            and scrolled the whole page sideways at 375px.
          */}
          <div className="flex min-w-0 flex-wrap gap-1">
            {form.type && (
              <Badge variant="secondary" className="max-w-full break-all text-[10px]">
                {form.type}
              </Badge>
            )}
            {form.category && (
              <Badge variant="outline" className="max-w-full break-all text-[10px]">
                {form.category}
              </Badge>
            )}
            {form.rarity && (
              <Badge variant="outline" className="max-w-full break-all text-[10px] capitalize">
                {form.rarity}
              </Badge>
            )}
          </div>
        </div>
      </div>
      <p className="text-center text-[11px] text-muted-foreground">
        Uses the unmarked primary image, falling back exactly as inventory and shop
        rows do.
      </p>
    </div>
  );
}

/** One tile per published image tag. */
function ViewGallery({
  form,
  probes,
}: {
  form: ItemFormState;
  probes: ReadonlyMap<string, ImageProbe>;
}) {
  const rows = form.images.filter((row) => row.url.trim() !== '');
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRow = rows.find((row) => row.id === selected) ?? null;

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
        No images to show yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {selectedRow && (
        <div className="space-y-2">
          <div
            className="flex items-center justify-center overflow-hidden rounded-xl border p-2"
            style={{ background: CHECKERBOARD }}
          >
            <img
              src={selectedRow.url}
              alt={selectedRow.marker || 'primary'}
              className="max-h-64 max-w-full object-contain"
            />
          </div>
          <p className="break-all text-center text-[11px] text-muted-foreground">
            {selectedRow.url}
          </p>
        </div>
      )}

      <ul className="grid grid-cols-3 gap-2">
        {rows.map((row) => {
          const probe = probes.get(row.url.trim());
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => setSelected(selected === row.id ? null : row.id)}
                className={cn(
                  'w-full space-y-1 rounded-lg border p-1.5 text-left transition-colors hover:border-primary',
                  selected === row.id && 'border-primary ring-1 ring-primary',
                )}
              >
                <div
                  className="flex aspect-square items-center justify-center overflow-hidden rounded"
                  style={{ background: CHECKERBOARD }}
                >
                  {probe?.status === 'error' ? (
                    <ImageOff className="h-5 w-5 text-destructive" />
                  ) : (
                    <img
                      src={row.url}
                      alt={row.marker || 'primary'}
                      className="max-h-full max-w-full object-contain"
                      loading="lazy"
                    />
                  )}
                </div>
                <p className="truncate text-[10px] font-medium">
                  {row.marker || 'primary'}
                </p>
                <p className="truncate text-[9px] text-muted-foreground">
                  {probe?.status === 'loaded' && probe.width
                    ? `${probe.width}×${probe.height}`
                    : urlHost(row.url)}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The three views a posed Blobbi can actually ask for, side by side.
 *
 * Each tile shows both what the item PUBLISHES for that marker and what the
 * renderer would ACTUALLY paint after fallback — those differ exactly when a
 * view is missing, which is the thing worth seeing.
 */
function ViewComparison({ candidate }: { candidate: ItemImageCandidate }) {
  const cells = [
    {
      label: 'primary',
      published: primaryItemImageUrl(candidate),
      resolved: primaryItemImageUrl(candidate),
    },
    {
      label: 'front',
      published: itemImageByMarker(candidate, 'front')?.url,
      resolved: itemImageSourcesForView(candidate, 'front')[0],
    },
    {
      label: 'back',
      published: itemImageByMarker(candidate, 'back')?.url,
      resolved: itemImageSourcesForView(candidate, 'back')[0],
    },
  ];

  const others = GAME_ITEM_IMAGE_MARKERS.filter(
    (marker) => marker !== 'front' && marker !== 'back',
  )
    .map((marker) => ({ marker, url: itemImageByMarker(candidate, marker)?.url }))
    .filter((entry) => !!entry.url);

  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-3 gap-2">
        {cells.map((cell) => (
          <li key={cell.label} className="space-y-1">
            <div
              className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border"
              style={{ background: CHECKERBOARD }}
            >
              {cell.resolved ? (
                <img
                  src={cell.resolved}
                  alt={cell.label}
                  className="max-h-full max-w-full object-contain"
                  loading="lazy"
                />
              ) : (
                <span className="text-[10px] text-muted-foreground">none</span>
              )}
            </div>
            <p className="text-center text-[10px] font-medium">{cell.label}</p>
            <p className="text-center text-[9px] text-muted-foreground">
              {cell.published
                ? 'published'
                : cell.resolved
                  ? 'fallback'
                  : 'not available'}
            </p>
          </li>
        ))}
      </ul>

      {others.length > 0 && (
        <div className="rounded-lg bg-muted/50 p-2">
          <p className="text-[10px] text-muted-foreground">
            Also published (never substituted for a front or back pose):{' '}
            {others.map((entry) => entry.marker).join(', ')}
          </p>
        </div>
      )}
    </div>
  );
}
