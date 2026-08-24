/**
 * EffectsPanel — the production visual-effect management UI (Phase 9).
 *
 * The effect sibling of the inventory's wearables, on the same three events:
 *
 *   what exists   → the trusted official effect registry (+ 31632 for display)
 *   what is owned → kind:31633 quantities
 *   what is active → the kind:31634 placement document
 *
 * ONLY OWNED SUPPORTED OFFICIAL EFFECTS ARE ACTIONABLE. Unowned items appear
 * in a collapsed locked view with honest reasons, never as something that can
 * be equipped. Equipping writes the placement document and nothing else —
 * quantities are untouched in both directions.
 *
 * REPLACEMENT IS EXPLICIT. One effect per slot is the model; when equipping
 * would displace another effect, the card says exactly which one ("Equipping
 * Solar Radiance will replace Celestial Aura in the Aura slot.") and the
 * action is labelled Replace. Nothing is silently swapped.
 *
 * PREVIEW IS LOCAL. The eye toggle hands the parent a plain
 * `BlobbiVisualEffect[]` to draw through the real renderer path
 * (`CurrentBlobbiDisplay.effectsOverride`). It publishes nothing, mutates
 * nothing, and cancelling restores the persisted view.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Sparkles,
} from 'lucide-react';
import type { BlobbiVisualEffect } from '@blobbi/react';
import type { BlobbiEffectSlot } from '@blobbi/react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ItemTile } from '@/components/ui/item-tile';
import { cn } from '@/lib/utils';
import { CollectionGrid } from './inventory/CollectionGrid';

import { primaryItemImageUrl } from '@/inventory/item-image-resolution';
import { useCharacterEquipmentContext } from '@/hooks/useCharacterEquipmentContext';
import {
  useOwnedVisualEffects,
  explainEffectUnavailable,
  type OwnedVisualEffect,
} from '@/effects/useOwnedVisualEffects';
import type { ActiveEffectPlacement } from '@/effects/active-effects';

/** Player-facing names for the four effect slots. */
const EFFECT_SLOT_LABELS: Readonly<Record<BlobbiEffectSlot, string>> = {
  aura: 'Aura',
  'ground-local': 'Ground effect',
  'ambient-particles': 'Ambient particles',
  'body-overlay': 'Body overlay',
};

export interface EffectsPanelProps {
  /** Current Blobbi stage; gates form-restricted effects. */
  stage?: string | undefined;
  /** Equip (or replace) an effect item into its registered slot. */
  onEquip: (address: string, slot: BlobbiEffectSlot) => void;
  /** Remove the effect occupying a slot. Never touches inventory. */
  onRemove: (slot: BlobbiEffectSlot) => void;
  /**
   * Preview control. `effects` is what the preview should draw INSTEAD of the
   * persisted state; `null` ends the preview and restores the persisted view.
   */
  onPreview: (effects: readonly BlobbiVisualEffect[] | null) => void;
  /** The effect id currently being previewed, or `null`. */
  previewingEffectId: string | null;
  /** A publish that failed, surfaced rather than swallowed. */
  publishError?: string | null;
  isPublishing?: boolean;
  className?: string;
}

export function EffectsPanel({
  stage,
  onEquip,
  onRemove,
  onPreview,
  previewingEffectId,
  publishError,
  isPublishing = false,
  className,
}: EffectsPanelProps) {
  const owned = useOwnedVisualEffects(stage);
  const { activeEffects, rejectedEffects } = useCharacterEquipmentContext();
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);

  const selected = useMemo(
    () => owned.available.find((item) => item.address === selectedAddress) ?? null,
    [owned.available, selectedAddress],
  );

  /*
    An effect can stop being available while it is selected — a life-stage
    change, the item leaving the inventory. A detail panel describing something
    the player can no longer act on would be worse than no panel.
  */
  useEffect(() => {
    if (selectedAddress && !owned.available.some((item) => item.address === selectedAddress)) {
      setSelectedAddress(null);
    }
  }, [owned.available, selectedAddress]);

  // slot → the ACTIVE placement in it, for equipped badges and replace warnings.
  const activeBySlot = useMemo(() => {
    const map = new Map<string, ActiveEffectPlacement>();
    for (const active of activeEffects) {
      map.set(active.registration.effectSlot, active);
    }
    return map;
  }, [activeEffects]);

  const stalePlacements = rejectedEffects.filter(
    (r) => r.reason === 'not-owned',
  );

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)} data-testid="effects-panel">
      {publishError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-destructive">Could not save</p>
            <p className="text-island-ink-soft">{publishError}</p>
          </div>
        </div>
      )}

      {owned.isLoading ? (
        <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />}>
          Loading effects…
        </EmptyState>
      ) : owned.available.length === 0 ? (
        <EmptyState icon={<Sparkles className="h-5 w-5" />}>
          {owned.ownsNothing
            ? 'You do not own any visual effects yet.'
            : 'None of your visual effects can be used on this Blobbi right now.'}
        </EmptyState>
      ) : (
        <div className="flex min-h-0 flex-col gap-3 lg:flex-row lg:items-start">
          {/* The same bounded, paged collection the wardrobe's clothing uses.
              Effects were a vertical list of description cards with two buttons
              each — three of them filled the pane — which made the rest of the
              wardrobe a scroll. They are a collection like any other. */}
          <CollectionGrid
            className="min-w-0 flex-1"
            items={owned.available}
            keyOf={(item) => item.address}
            label="your effects"
            renderItem={(item) => {
              const active = activeBySlot.get(item.registration.effectSlot);
              const isActive = active?.entry.item === item.address;
              const previewing = previewingEffectId === item.registration.effectId;
              const name = item.definition?.name ?? item.registration.name;
              return (
                <ItemTile
                  role="option"
                  aria-selected={selectedAddress === item.address}
                  data-testid={`effect-card-${item.registration.effectId}`}
                  {...(isActive ? { 'data-active-effect': item.registration.effectSlot } : {})}
                  name={name}
                  selected={selectedAddress === item.address}
                  onClick={() =>
                    setSelectedAddress(selectedAddress === item.address ? null : item.address)
                  }
                  art={
                    item.definition && primaryItemImageUrl(item.definition) ? (
                      <img
                        src={primaryItemImageUrl(item.definition)}
                        alt=""
                        aria-hidden
                        className="h-full w-auto object-contain"
                      />
                    ) : (
                      <span role="img" aria-label={name}>
                        {item.registration.symbol}
                      </span>
                    )
                  }
                  className={cn(
                    isActive && 'border-island-grass-dark/50',
                    previewing && 'ring-2 ring-island-purple/60',
                  )}
                  footnote={
                    isActive ? (
                      <span className="font-semibold text-island-grass-dark">Active</span>
                    ) : previewing ? (
                      <span className="font-semibold text-island-purple">Previewing</span>
                    ) : undefined
                  }
                />
              );
            }}
          />

          <div className="min-h-[7.5rem] shrink-0 lg:min-h-0 lg:w-[15rem] xl:w-[17rem]">
            {selected ? (
              <EffectDetail
                item={selected}
                activeInSlot={activeBySlot.get(selected.registration.effectSlot)}
                isPublishing={isPublishing}
                previewing={previewingEffectId === selected.registration.effectId}
                onEquip={onEquip}
                onRemove={onRemove}
                onPreview={onPreview}
              />
            ) : (
              <p className="rounded-panel border border-dashed border-island-wood/30 p-4 text-center text-xs text-island-ink-soft">
                Pick an effect to preview it.
              </p>
            )}
          </div>
        </div>
      )}

      {stalePlacements.length > 0 && (
        <details
          data-testid="effect-diagnostics"
          className="shrink-0 rounded-panel border border-island-warn/40 bg-island-warn/10 text-xs"
        >
          <summary className="cursor-pointer px-2.5 py-1.5 font-medium text-island-ink">
            <AlertTriangle aria-hidden className="mr-1 inline size-3.5 text-island-warn" />
            {stalePlacements.length} effect
            {stalePlacements.length === 1 ? '' : 's'} you no longer own
          </summary>
          <div className="max-h-40 space-y-1.5 overflow-y-auto border-t border-island-warn/30 px-2.5 py-2">
            {stalePlacements.map((r) => (
              <div key={r.registration.address} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-island-ink-soft">
                  {r.registration.name}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-[0.6875rem]"
                  disabled={isPublishing}
                  data-testid={`remove-stale-${r.registration.effectSlot}`}
                  onClick={() => onRemove(r.registration.effectSlot)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </details>
      )}

      {owned.unavailable.length > 0 && (
        <details className="rounded-panel border border-island-wood/20 bg-island-cream-2/60 p-2 text-xs">
          <summary className="cursor-pointer text-island-ink-soft">
            <Lock className="mr-1 inline h-3 w-3" />
            {owned.unavailable.length} effect
            {owned.unavailable.length === 1 ? '' : 's'} not available
          </summary>
          <ul className="mt-1 space-y-1">
            {owned.unavailable.map((item) => (
              <li key={item.address} className="text-island-ink-soft">
                <span className="font-medium text-island-ink">
                  {item.definition?.name ?? item.registration.name}
                </span>{' '}
                — {explainEffectUnavailable(item.reason)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * The selected effect's detail: what it is, and the one or two things to do.
 *
 * It replaced `EffectCard`, which put a description and two buttons on EVERY
 * item — three of them filled the wardrobe pane and pushed the rest into a
 * scroll. The information is the same; it is now shown for one effect at a time,
 * in a reserved box that does not change the panel's height.
 *
 * REPLACEMENT IS STILL EXPLICIT. When activating would displace another effect,
 * the panel names it and the button reads Replace. Nothing is silently swapped.
 */
function EffectDetail({
  item,
  activeInSlot,
  isPublishing,
  previewing,
  onEquip,
  onRemove,
  onPreview,
}: {
  item: OwnedVisualEffect;
  activeInSlot: ActiveEffectPlacement | undefined;
  isPublishing: boolean;
  previewing: boolean;
  onEquip: (address: string, slot: BlobbiEffectSlot) => void;
  onRemove: (slot: BlobbiEffectSlot) => void;
  onPreview: (effects: readonly BlobbiVisualEffect[] | null) => void;
}) {
  const { registration, definition } = item;
  const isActive = activeInSlot?.entry.item === item.address;
  const replaces = !isActive && activeInSlot !== undefined ? activeInSlot.registration : null;
  const name = definition?.name ?? registration.name;
  const rarity = definition?.rarity ?? registration.rarity;

  return (
    <div
      data-testid="effect-detail"
      className="space-y-2 rounded-panel border border-island-wood/20 bg-island-cream-2/70 p-2.5 shadow-cozy-soft"
    >
      <div className="min-w-0">
        <p className="text-sm font-bold leading-tight text-island-ink">{name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[0.6875rem] text-island-ink-soft">
          <span>{EFFECT_SLOT_LABELS[registration.effectSlot]}</span>
          <Badge variant="outline" className="text-[0.625rem] capitalize">
            {rarity}
          </Badge>
          {isActive && (
            <Badge className="bg-island-grass-dark text-[0.625rem] text-island-cream">Active</Badge>
          )}
          {previewing && (
            <Badge className="bg-island-purple text-[0.625rem] text-island-cream">
              Previewing
            </Badge>
          )}
        </p>
      </div>

      {definition?.description && (
        <p className="line-clamp-3 text-xs leading-snug text-island-ink-soft">
          {definition.description}
        </p>
      )}

      {replaces && (
        <p
          className="text-[0.6875rem] font-medium text-island-warn"
          data-testid={`replace-warning-${registration.effectId}`}
        >
          Activating {name} will replace {replaces.name} in the{' '}
          {EFFECT_SLOT_LABELS[registration.effectSlot]} slot.
        </p>
      )}

      <div className="flex gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          aria-pressed={previewing}
          data-testid={`preview-${registration.effectId}`}
          onClick={() => onPreview(previewing ? null : [{ id: registration.effectId }])}
        >
          {previewing ? (
            <>
              <EyeOff aria-hidden className="mr-1 size-3.5" /> End
            </>
          ) : (
            <>
              <Eye aria-hidden className="mr-1 size-3.5" /> Preview
            </>
          )}
        </Button>

        {isActive ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={isPublishing}
            data-testid={`remove-${registration.effectId}`}
            onClick={() => onRemove(registration.effectSlot)}
          >
            Remove
          </Button>
        ) : (
          <Button
            size="sm"
            className="flex-1"
            disabled={isPublishing}
            data-testid={`equip-${registration.effectId}`}
            onClick={() => onEquip(item.address, registration.effectSlot)}
          >
            {isPublishing ? 'Saving…' : replaces ? 'Replace' : 'Activate'}
          </Button>
        )}
      </div>
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
    <div className="flex flex-col items-center gap-2 rounded-panel border border-dashed border-island-wood/30 p-4 text-center text-xs text-island-ink-soft">
      {icon}
      <p>{children}</p>
    </div>
  );
}
