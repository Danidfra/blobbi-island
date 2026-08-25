/**
 * The image manager: every `image` tag, its marker, its preview, and its state.
 *
 * THE ONE RULE THIS UI EXISTS TO TEACH: the primary image is the image with no
 * marker. The marker select's first option is labelled "primary (unmarked)" and
 * its value is the empty string; picking it removes the marker rather than
 * setting one. Nothing in this component can emit the literal string
 * `"primary"` into a tag, and `form-event-conversion.ts` re-checks that on the
 * way out.
 *
 * Previews sit on a checkerboard, because accessory artwork is transparent PNG
 * and a white hat on a white card is indistinguishable from a broken image.
 * Load state and measured dimensions come from `useImageProbes`, so a 404 shows
 * as a failed tile with a warning instead of an empty box.
 *
 * Uploads and URLs are the same thing here. A Blossom upload's only effect is
 * to fill in a row's URL — see `image-upload.ts` — so an item assembled from
 * uploads and one assembled from pasted CDN links are literally the same form.
 */

import { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  ExternalLink,
  ImageOff,
  Loader2,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';

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
import { cn } from '@/lib/utils';
import { GAME_ITEM_IMAGE_MARKERS } from '@/inventory/package';
import {
  type ImageRow,
  PRIMARY_MARKER,
  RECOMMENDED_IMAGE_SIZE,
  urlHost,
} from '@/tools/game-items/item-form-model';
import type { ItemStudioApi } from '@/tools/game-items/useItemStudio';
import type { ImageProbe } from '@/tools/game-items/validation';
import {
  SUGGESTABLE_MARKERS,
  type ItemImageUploadApi,
} from '@/tools/game-items/image-upload';

import { Section } from './EditorPrimitives';
import { useExternalEgress } from '@/external-egress';

const CUSTOM_MARKER = '__custom__';
/** Marker label for the UI only. The wire value is the empty string. */
const PRIMARY_LABEL = 'primary (unmarked)';

/** The transparent-artwork checkerboard, inline so it needs no asset. */
const CHECKERBOARD =
  'repeating-conic-gradient(hsl(var(--muted)) 0% 25%, hsl(var(--background)) 0% 50%) 50% / 12px 12px';

export interface ImageManagerProps {
  images: readonly ImageRow[];
  actions: ItemStudioApi['images'];
  probes: ReadonlyMap<string, ImageProbe>;
  uploads: ItemImageUploadApi;
  /** False when there is no signer: Blossom needs one to authorize an upload. */
  canUpload: boolean;
}

export function ImageManager({
  images,
  actions,
  probes,
  uploads,
  canUpload,
}: ImageManagerProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const markerLabel = (marker: string) =>
    marker === PRIMARY_MARKER ? PRIMARY_LABEL : marker;

  return (
    <Section
      title="Images"
      description={
        <>
          One row per <code>image</code> tag. The unmarked row is the primary
          image; the rest are named views. Recommended artwork is{' '}
          {RECOMMENDED_IMAGE_SIZE.width}&times;{RECOMMENDED_IMAGE_SIZE.height}{' '}
          transparent PNG or WebP — anything else publishes fine and only warns.
        </>
      }
      action={
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => actions.add()}>
            Add image
          </Button>
        </div>
      }
    >
      {/* --- Upload dropzone ------------------------------------------------ */}
      <div
        className={cn(
          'rounded-xl border-2 border-dashed p-4 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-muted',
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!canUpload) return;
          uploads.addFiles([...event.dataTransfer.files].filter((f) => f.type.startsWith('image/')));
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            uploads.addFiles([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
        <p className="text-xs text-muted-foreground">
          {canUpload
            ? 'Drop artwork here, or'
            : 'Sign in to upload artwork to Blossom, or paste URLs into the rows below.'}
        </p>
        {canUpload && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 gap-1.5"
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            Choose files
          </Button>
        )}
      </div>

      {uploads.entries.length > 0 && (
        <div className="space-y-2 rounded-xl border bg-muted/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium">
              {uploads.entries.length} file(s) queued — check the suggested markers
              before uploading.
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={uploads.clear}>
                Clear
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={uploads.isUploading}
                onClick={async () => {
                  const uploaded = await uploads.uploadAll();
                  if (uploaded.length > 0) actions.appendMany(uploaded);
                }}
              >
                {uploads.isUploading && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                Upload to Blossom
              </Button>
            </div>
          </div>

          <ul className="space-y-1.5">
            {uploads.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-background px-2 py-1.5 text-xs"
              >
                <span className="min-w-0 flex-1 truncate font-mono">{entry.filename}</span>
                <Select
                  value={entry.marker === PRIMARY_MARKER ? '__primary__' : entry.marker}
                  onValueChange={(value) =>
                    uploads.setMarker(entry.id, value === '__primary__' ? PRIMARY_MARKER : value)
                  }
                >
                  <SelectTrigger className="h-7 w-48 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUGGESTABLE_MARKERS.map((marker) => (
                      <SelectItem
                        key={marker || 'primary'}
                        value={marker === PRIMARY_MARKER ? '__primary__' : marker}
                      >
                        {markerLabel(marker)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <UploadStatusBadge entry={entry} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={`Remove ${entry.filename} from the queue`}
                  onClick={() => uploads.remove(entry.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Uploading only fills in URLs below. It never signs or publishes anything.
          </p>
        </div>
      )}

      {/* --- Rows ----------------------------------------------------------- */}
      {images.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
          No images yet. An item without artwork is valid — lists fall back to an
          emoji or placeholder.
        </p>
      ) : (
        <ul className="space-y-3">
          {images.map((row, index) => (
            <ImageRowEditor
              key={row.id}
              row={row}
              index={index}
              total={images.length}
              probe={probes.get(row.url.trim())}
              actions={actions}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function UploadStatusBadge({ entry }: { entry: ItemImageUploadApi['entries'][number] }) {
  if (entry.status === 'done') {
    return (
      <Badge variant="secondary" className="text-[10px]">
        uploaded
      </Badge>
    );
  }
  if (entry.status === 'uploading') {
    return (
      <Badge variant="outline" className="gap-1 text-[10px]">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        uploading
      </Badge>
    );
  }
  if (entry.status === 'error') {
    return (
      <Badge variant="destructive" className="max-w-48 truncate text-[10px]" title={entry.error}>
        failed: {entry.error}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px]">
      queued
    </Badge>
  );
}

function ImageRowEditor({
  row,
  index,
  total,
  probe,
  actions,
}: {
  row: ImageRow;
  index: number;
  total: number;
  probe: ImageProbe | undefined;
  actions: ItemStudioApi['images'];
}) {
  const { requestEgress } = useExternalEgress();
  const isKnownMarker =
    row.marker === PRIMARY_MARKER ||
    (GAME_ITEM_IMAGE_MARKERS as readonly string[]).includes(row.marker);
  const selectValue = row.marker === PRIMARY_MARKER
    ? '__primary__'
    : isKnownMarker
      ? row.marker
      : CUSTOM_MARKER;
  const url = row.url.trim();

  return (
    <li className="rounded-xl border bg-background p-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        {/* Preview tile */}
        <div className="shrink-0">
          <div
            className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-lg border"
            style={{ background: CHECKERBOARD }}
          >
            {url === '' ? (
              <span className="px-1 text-center text-[10px] text-muted-foreground">
                no URL
              </span>
            ) : probe?.status === 'error' ? (
              <ImageOff className="h-6 w-6 text-destructive" aria-label="Failed to load" />
            ) : (
              <img
                src={url}
                alt={`Image ${index + 1}${row.marker ? ` (${row.marker})` : ' (primary)'}`}
                className="max-h-full max-w-full object-contain"
                loading="lazy"
              />
            )}
          </div>
          <p className="mt-1 text-center text-[10px] text-muted-foreground">
            {probe?.status === 'loaded' && probe.width
              ? `${probe.width}×${probe.height}`
              : probe?.status === 'error'
                ? 'load failed'
                : url === ''
                  ? '—'
                  : 'checking…'}
          </p>
        </div>

        {/* Fields */}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Image {index + 1}
            </span>
            {row.marker === PRIMARY_MARKER && (
              <Badge className="gap-1 text-[10px]">
                <Star className="h-2.5 w-2.5" />
                primary
              </Badge>
            )}
            {!isKnownMarker && row.marker !== '' && (
              <Badge variant="outline" className="text-[10px]">
                custom marker
              </Badge>
            )}
            {url !== '' && (
              <span className="truncate text-[10px] text-muted-foreground">
                {urlHost(url)}
              </span>
            )}
          </div>

          <Input
            value={row.url}
            placeholder="https://blossom.primal.net/…"
            className="h-9 font-mono text-xs"
            aria-label={`Image ${index + 1} URL`}
            onChange={(event) => actions.update(row.id, { url: event.target.value })}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={selectValue}
              onValueChange={(value) => {
                if (value === '__primary__') actions.makePrimary(row.id);
                else if (value === CUSTOM_MARKER) actions.update(row.id, { marker: 'custom-view' });
                else actions.update(row.id, { marker: value });
              }}
            >
              <SelectTrigger className="h-8 w-56 text-xs" aria-label={`Image ${index + 1} marker`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__primary__">{PRIMARY_LABEL}</SelectItem>
                {GAME_ITEM_IMAGE_MARKERS.map((marker) => (
                  <SelectItem key={marker} value={marker}>
                    {marker}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_MARKER}>custom…</SelectItem>
              </SelectContent>
            </Select>

            {selectValue === CUSTOM_MARKER && (
              <Input
                value={row.marker}
                placeholder="future-view"
                className="h-8 w-40 font-mono text-xs"
                aria-label={`Image ${index + 1} custom marker`}
                onChange={(event) => actions.update(row.id, { marker: event.target.value })}
              />
            )}

            <div className="ml-auto flex items-center gap-1">
              <IconAction
                label="Make primary"
                onClick={() => actions.makePrimary(row.id)}
                disabled={row.marker === PRIMARY_MARKER}
              >
                <Star className="h-3.5 w-3.5" />
              </IconAction>
              <IconAction
                label="Move up"
                onClick={() => actions.move(row.id, -1)}
                disabled={index === 0}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </IconAction>
              <IconAction
                label="Move down"
                onClick={() => actions.move(row.id, 1)}
                disabled={index === total - 1}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </IconAction>
              <IconAction label="Duplicate" onClick={() => actions.duplicate(row.id)}>
                <Copy className="h-3.5 w-3.5" />
              </IconAction>
              <IconAction
                label="Copy URL"
                onClick={() => void navigator.clipboard?.writeText(url)}
                disabled={url === ''}
              >
                <span className="text-[10px] font-semibold">URL</span>
              </IconAction>
              {url !== '' && (
                /*
                  This URL is TYPED BY THE AUTHOR — the most untrusted string in
                  the tool. As an anchor it would happily navigate to
                  `javascript:` or `data:`; through the egress boundary it is
                  parsed and refused unless it is `https:`, and the confirmation
                  names the host it actually resolves to rather than whatever was
                  typed.
                */
                <button
                  type="button"
                  onClick={() => void requestEgress({ class: 'external-link', url })}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border hover:bg-accent"
                  aria-label="Open image in a new tab"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              )}
              <IconAction
                label="Remove image"
                onClick={() => actions.remove(row.id)}
                destructive
              >
                <Trash2 className="h-3.5 w-3.5" />
              </IconAction>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn('h-7 w-7', destructive && 'hover:bg-destructive/10 hover:text-destructive')}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
