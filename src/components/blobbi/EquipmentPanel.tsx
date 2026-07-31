/**
 * EquipmentPanel — the production equipment UI, on 31632 + 31633 + 31634.
 *
 * Replaces the legacy `AccessoryInventoryUI`. The three questions it answers
 * come from three different events and are never conflated:
 *
 *   what exists  → trusted official kind:31632 definitions
 *   what is owned → kind:31633 quantities
 *   what is worn  → the kind:31634 placement document
 *
 * EQUIPPING NEVER SPENDS ANYTHING. There is no inventory mutation anywhere in
 * this file: wearing a hat and owning a hat are different facts, and the panel
 * only writes the placement document.
 *
 * Honest empty states. When the trusted issuer has published no cosmetics, this
 * says so; it does not fall back to a bundled list of legacy accessories whose
 * ownership nobody can prove. When a cosmetic exists but cannot be worn, the
 * reason is shown rather than the item silently vanishing.
 */
import { useMemo } from 'react';
import { AlertTriangle, Loader2, PackageOpen, Shirt } from 'lucide-react';
import type { AccessorySlot } from '@blobbi/react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import { primaryItemImageUrl } from '@/inventory/item-image-resolution';
import { usePlacementState } from '@/placement/usePlacementState';
import {
  useEquippableCosmetics,
  explainUnavailable,
} from '@/placement/useEquippableCosmetics';
import type { PlacementTransformPatch } from '@/placement/useEquipmentMutation';
import { getLastEquippedPlacementBySlot } from '@/inventory/package';

export interface EquipmentPanelProps {
  characterId: string | undefined;
  /** Current Blobbi form/stage; gates form-restricted cosmetics. */
  form?: string | undefined;
  /** Slot currently selected for transform editing. */
  selectedSlot?: AccessorySlot | null;
  onSelectSlot?: (slot: AccessorySlot | null) => void;
  /** Unsaved transform edits, keyed by slot. */
  pendingUpdates?: Record<string, PlacementTransformPatch>;
  onTransformChange?: (slot: AccessorySlot, patch: PlacementTransformPatch) => void;
  onSaveTransforms?: () => void;
  onEquip: (address: string, slot: AccessorySlot) => void;
  onUnequip: (slot: AccessorySlot) => void;
  /** A publish that failed, surfaced rather than swallowed. */
  publishError?: string | null;
  isPublishing?: boolean;
  /**
   * Which tab opens first. `worn` is useful when the caller has just equipped
   * something and wants the player looking at the adjustable list.
   */
  defaultTab?: 'owned' | 'worn';
  className?: string;
}

export function EquipmentPanel({
  characterId,
  form,
  selectedSlot,
  onSelectSlot,
  pendingUpdates = {},
  onTransformChange,
  onSaveTransforms,
  onEquip,
  onUnequip,
  publishError,
  isPublishing = false,
  defaultTab = 'owned',
  className,
}: EquipmentPanelProps) {
  const cosmetics = useEquippableCosmetics(form);
  const placementQuery = usePlacementState(characterId);
  const state = placementQuery.data;

  const equippedSlots = useMemo(() => {
    if (!state) return [];
    const slots = new Set<string>();
    for (const entry of state.placement.placements) {
      if (entry.mode === 'equip' && entry.slot !== undefined) slots.add(entry.slot);
    }
    return [...slots].map((slot) => ({
      slot: slot as AccessorySlot,
      entry: getLastEquippedPlacementBySlot(state.placement, slot)!,
    }));
  }, [state]);

  const equippedAddresses = new Set(equippedSlots.map((e) => e.entry.item));
  const hasPendingEdits = Object.keys(pendingUpdates).length > 0;
  const isLoading = cosmetics.isLoading || placementQuery.isLoading;

  const selectedEntry = selectedSlot
    ? equippedSlots.find((e) => e.slot === selectedSlot)
    : undefined;
  const selectedPatch = selectedSlot ? (pendingUpdates[selectedSlot] ?? {}) : {};
  const selectedScale =
    selectedPatch.scale ?? selectedEntry?.entry.scale?.x ?? 1;
  const selectedRot =
    selectedPatch.rot ??
    (selectedEntry?.entry.rotation?.type === 'euler' &&
    typeof selectedEntry.entry.rotation.z === 'number'
      ? selectedEntry.entry.rotation.z
      : 0);

  return (
    <div className={cn('space-y-3', className)} data-testid="equipment-panel">
      {publishError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-destructive">Could not save</p>
            <p className="text-muted-foreground">{publishError}</p>
          </div>
        </div>
      )}

      {state && state.warnings.length > 0 && (
        <details className="rounded-md border border-amber-300/50 bg-amber-50/50 p-2 text-xs dark:border-amber-800/50 dark:bg-amber-950/30">
          <summary className="cursor-pointer font-medium">
            {state.warnings.length} equipment data warning
            {state.warnings.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {state.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>
                <code>{w.code}</code> — {w.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Tabs defaultValue={defaultTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="owned">
            Owned
            {cosmetics.available.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {cosmetics.available.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="worn">
            Worn
            {equippedSlots.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {equippedSlots.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------------- */}
        <TabsContent value="owned" className="mt-2 space-y-2">
          {isLoading ? (
            <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />}>
              Loading cosmetics…
            </EmptyState>
          ) : cosmetics.catalogIsEmpty ? (
            <EmptyState icon={<PackageOpen className="h-5 w-5" />}>
              No official cosmetics have been published yet. Items appear here
              once the official issuer publishes their kind:31632 definitions —
              nothing is shown from local data.
            </EmptyState>
          ) : cosmetics.available.length === 0 ? (
            <EmptyState icon={<PackageOpen className="h-5 w-5" />}>
              You do not own any cosmetics this Blobbi can wear yet.
            </EmptyState>
          ) : (
            <ul className="grid grid-cols-3 gap-2">
              {cosmetics.available.map((cosmetic) => {
                const worn = equippedAddresses.has(cosmetic.address);
                return (
                  <li key={cosmetic.address}>
                    <button
                      type="button"
                      disabled={isPublishing}
                      data-testid={`equip-${cosmetic.address}`}
                      onClick={() => onEquip(cosmetic.address, cosmetic.slot)}
                      className={cn(
                        'flex w-full flex-col items-center gap-1 rounded-md border p-2 text-center transition',
                        worn ? 'border-primary bg-primary/5' : 'hover:bg-muted',
                        isPublishing && 'opacity-50',
                      )}
                    >
                      <CosmeticImage
                        url={primaryItemImageUrl(cosmetic.definition)}
                        emoji={cosmetic.definition.emoji}
                        alt={cosmetic.definition.name}
                      />
                      <span className="line-clamp-2 text-[11px] font-medium">
                        {cosmetic.definition.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {cosmetic.slot} · ×{cosmetic.quantity}
                      </span>
                      {worn && (
                        <Badge variant="outline" className="text-[9px]">
                          worn
                        </Badge>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {cosmetics.unavailable.length > 0 && (
            <details className="rounded-md border p-2 text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                {cosmetics.unavailable.length} cosmetic
                {cosmetics.unavailable.length === 1 ? '' : 's'} not available
              </summary>
              <ul className="mt-1 space-y-1">
                {cosmetics.unavailable.map((item) => (
                  <li key={item.address} className="text-muted-foreground">
                    <span className="font-medium">
                      {item.definition?.name ?? item.address}
                    </span>{' '}
                    — {explainUnavailable(item.reason)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        <TabsContent value="worn" className="mt-2 space-y-2">
          {equippedSlots.length === 0 ? (
            <EmptyState icon={<Shirt className="h-5 w-5" />}>
              This Blobbi is not wearing anything yet.
            </EmptyState>
          ) : (
            <ul className="space-y-1">
              {equippedSlots.map(({ slot, entry }) => (
                <li
                  key={slot}
                  className={cn(
                    'flex items-center gap-2 rounded-md border p-2',
                    selectedSlot === slot && 'border-primary bg-primary/5',
                  )}
                >
                  <button
                    type="button"
                    className="flex-1 text-left"
                    data-testid={`select-${slot}`}
                    onClick={() =>
                      onSelectSlot?.(selectedSlot === slot ? null : slot)
                    }
                  >
                    <span className="text-xs font-medium">{slot}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {entry.item}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isPublishing}
                    data-testid={`unequip-${slot}`}
                    onClick={() => onUnequip(slot)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {selectedEntry && (
            <div className="space-y-2 rounded-md border p-2">
              <p className="text-xs font-medium">Adjust {selectedEntry.slot}</p>
              <LabelledSlider
                label="Scale"
                value={selectedScale}
                min={0.25}
                max={2}
                step={0.05}
                onChange={(v) =>
                  onTransformChange?.(selectedEntry.slot, { scale: v })
                }
              />
              <LabelledSlider
                label="Rotation"
                value={selectedRot}
                min={-45}
                max={45}
                step={1}
                onChange={(v) =>
                  onTransformChange?.(selectedEntry.slot, { rot: v })
                }
              />
              <p className="text-[10px] text-muted-foreground">
                Drag the accessory on the preview to reposition it.
              </p>
            </div>
          )}

          {hasPendingEdits && (
            <Button
              className="w-full"
              size="sm"
              disabled={isPublishing}
              data-testid="save-transforms"
              onClick={onSaveTransforms}
            >
              {isPublishing ? 'Saving…' : 'Save positions'}
            </Button>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
      {icon}
      <p>{children}</p>
    </div>
  );
}

function CosmeticImage({
  url,
  emoji,
  alt,
}: {
  url: string | undefined;
  emoji: string;
  alt: string;
}) {
  // No filename guessing: either the definition supplied artwork or the item
  // shows its emoji. There is no third source since the legacy chain was cut.
  if (!url) {
    return <span className="text-2xl">{emoji}</span>;
  }
  return <img src={url} alt={alt} className="h-10 w-10 object-contain" />;
}

function LabelledSlider({
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
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span>{value.toFixed(2)}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => v !== undefined && onChange(v)}
      />
    </div>
  );
}
