/**
 * "What would this look like on an actual Blobbi?"
 *
 * ## This is a preview, and only a preview
 *
 * Nothing here writes. It does not equip, does not grant, does not touch the
 * player's inventory, does not publish an event, and does not read the current
 * player's companion — the Blobbi on screen is a fixture built from constants
 * in this file. The x/y/scale/rotation controls are local component state used
 * to eyeball artwork; they are NOT placement protocol data, are never
 * serialized into the item definition, and disappear when the panel unmounts.
 *
 * ## It uses the production path, not a lookalike
 *
 * The whole point of the panel is to catch "the back view is upside down"
 * before publishing, which only works if the preview resolves images the way
 * the game does. So it composes the real pieces:
 *
 *   itemImageSourcesForView()      front: front→primary→first valid
 *                                  back:  back→primary→front→first valid
 *   normalizeAccessoryPlacements() REAR_VIEW_HIDDEN_SLOTS filtering
 *   BlobbiRendererView             the actual renderer
 *
 * ONE STEP IS DELIBERATELY OMITTED. Island's full resolver
 * (`createIslandAccessorySourceResolver`) appends a legacy tail after the
 * definition-derived URLs: a URL generated from a legacy accessory code, then
 * `public/assets/.../<code>.webp`, then `.png`. Those steps exist for
 * accessories that predate the item protocol and are identified by codes like
 * `headwear-8`. An item being authored here has no legacy code — its identity
 * is a `d` tag — so every one of those steps is guaranteed to miss, and
 * including them would emit an "unknown accessory prefix" warning and two
 * doomed image requests per render. The part of the chain that describes THIS
 * item's artwork is `itemImageSourcesForView`, and that is used verbatim.
 *
 * The renderer still receives nothing but plain strings — it never learns that
 * an item definition, an address or a view marker exists. That boundary is the
 * reason `@blobbi/react` can stay protocol-agnostic, and this panel does not
 * bend it.
 *
 * ## Why an accessory can legitimately vanish
 *
 * `eyewear`, `face-mark` and `handheld` are not drawn on a Blobbi seen from
 * behind, because you would not see them. An item in one of those slots
 * disappearing in back view is correct behavior, so the panel says so in words
 * instead of letting it read as a broken preview.
 */

import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';

import {
  BlobbiRendererView,
  REAR_VIEW_HIDDEN_SLOTS,
  normalizeAccessoryPlacements,
  type AccessoryPlacementInput,
} from '@blobbi/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  itemImageSourcesForView,
  type ItemImageCandidate,
} from '@/inventory/item-image-resolution';
import { PREVIEW_VISUALS, toAccessorySlot } from '@/tools/game-items/preview-model';

const DEFAULT_PLACEMENT = { x: 50, y: 28, scale: 1, rot: 0, flipX: false };

export interface BlobbiAccessoryPreviewProps {
  /** The item's images, exactly as the form currently has them. */
  candidate: ItemImageCandidate;
  /** The item's `visual.slot`, if it declares one. */
  slot: string;
  /** Used only as the accessory `code` for the resolver and as a title. */
  code: string;
}

export function BlobbiAccessoryPreview({
  candidate,
  slot,
  code,
}: BlobbiAccessoryPreviewProps) {
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [stage, setStage] = useState<'baby' | 'adult'>('baby');
  const [placement, setPlacement] = useState(DEFAULT_PLACEMENT);

  const accessorySlot = toAccessorySlot(slot);
  const hiddenFromBehind = REAR_VIEW_HIDDEN_SLOTS.has(accessorySlot);
  const previewCode = code.trim() || 'preview-item';

  const accessories = useMemo(() => {
    // The item's own artwork, in the same priority order production uses for
    // this pose. See the module note for why the legacy tail is not appended.
    const sources = itemImageSourcesForView(candidate, facing);
    const resolveSources = () => sources;
    const input: AccessoryPlacementInput = {
      code: previewCode,
      slot: accessorySlot,
      x: placement.x,
      y: placement.y,
      scale: placement.scale,
      rot: placement.rot,
      flipX: placement.flipX,
    };
    return normalizeAccessoryPlacements([input], { facing, resolveSources });
  }, [previewCode, candidate, facing, accessorySlot, placement]);

  const hasArtwork = (candidate.images?.length ?? 0) > 0 || !!candidate.image;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleRow
          label="Facing"
          value={facing}
          options={[
            ['front', 'Front'],
            ['back', 'Back'],
          ]}
          onChange={(value) => setFacing(value as 'front' | 'back')}
        />
        <ToggleRow
          label="Stage"
          value={stage}
          options={[
            ['baby', 'Baby'],
            ['adult', 'Adult'],
          ]}
          onChange={(value) => setStage(value as 'baby' | 'adult')}
        />
        <Badge variant="outline" className="text-[10px]">
          slot: {accessorySlot}
        </Badge>
      </div>

      <div className="flex justify-center rounded-xl border bg-gradient-to-b from-sky-50 to-emerald-50 py-4 dark:from-slate-900 dark:to-slate-800">
        <BlobbiRendererView
          visual={PREVIEW_VISUALS[stage]}
          instanceId="game-item-studio-preview"
          size="xl"
          facing={facing}
          accessories={accessories}
          transparent
          title={`Preview: ${previewCode}`}
        />
      </div>

      {!hasArtwork && (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          No image URLs yet, so the Blobbi is wearing nothing.
        </p>
      )}

      {facing === 'back' && hiddenFromBehind && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          A <code>{accessorySlot}</code> accessory is not drawn from behind — you
          would not see it. That is the renderer&rsquo;s rear-view slot rule, not a
          missing image, and publishing a <code>back</code> view does not change it.
        </p>
      )}

      <div className="space-y-3 rounded-xl border border-dashed p-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium text-muted-foreground">
            Preview-only placement — never published, never saved
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setPlacement(DEFAULT_PLACEMENT)}
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
        </div>

        <PreviewSlider
          label="x"
          value={placement.x}
          min={0}
          max={100}
          step={1}
          onChange={(x) => setPlacement((p) => ({ ...p, x }))}
        />
        <PreviewSlider
          label="y"
          value={placement.y}
          min={0}
          max={100}
          step={1}
          onChange={(y) => setPlacement((p) => ({ ...p, y }))}
        />
        <PreviewSlider
          label="scale"
          value={placement.scale}
          min={0.1}
          max={3}
          step={0.05}
          onChange={(scale) => setPlacement((p) => ({ ...p, scale }))}
        />
        <PreviewSlider
          label="rotation"
          value={placement.rot}
          min={-180}
          max={180}
          step={1}
          onChange={(rot) => setPlacement((p) => ({ ...p, rot }))}
        />
        <div className="flex items-center gap-2">
          <Switch
            id="preview-flip"
            checked={placement.flipX}
            onCheckedChange={(flipX) => setPlacement((p) => ({ ...p, flipX }))}
          />
          <Label htmlFor="preview-flip" className="text-xs">
            flip horizontally
          </Label>
        </div>
      </div>
    </div>
  );
}

/** The small segmented control both preview tabs use. */
export function ToggleRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex rounded-lg border p-0.5">
        {options.map(([optionValue, optionLabel]) => (
          <Button
            key={optionValue}
            type="button"
            size="sm"
            variant={value === optionValue ? 'secondary' : 'ghost'}
            className="h-7 px-2.5 text-xs"
            onClick={() => onChange(optionValue)}
          >
            {optionLabel}
          </Button>
        ))}
      </div>
    </div>
  );
}

function PreviewSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([next]) => onChange(next)}
        className="flex-1"
        aria-label={`Preview ${label}`}
      />
      <span className="w-12 shrink-0 text-right font-mono text-[11px]">{value}</span>
    </div>
  );
}
