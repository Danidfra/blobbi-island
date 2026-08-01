/**
 * EffectsPanel — the production visual-effect management UI (Phase 9).
 *
 * The effect sibling of `EquipmentPanel`, on the same three events:
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
import { useMemo } from 'react';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Sparkles,
} from 'lucide-react';
import type { BlobbiVisualEffect } from '@blobbi/react';
import { EFFECT_SLOT_ORDER, type BlobbiEffectSlot } from '@blobbi/react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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

  // slot → the ACTIVE placement in it, for equipped badges and replace warnings.
  const activeBySlot = useMemo(() => {
    const map = new Map<string, ActiveEffectPlacement>();
    for (const active of activeEffects) {
      map.set(active.registration.effectSlot, active);
    }
    return map;
  }, [activeEffects]);

  // Grouped by slot in canonical order, so the list reads like the Blobbi
  // renders: aura, ground, particles, overlay.
  const groups = useMemo(
    () =>
      EFFECT_SLOT_ORDER.map((slot) => ({
        slot,
        items: owned.available.filter(
          (item) => item.registration.effectSlot === slot,
        ),
      })).filter((group) => group.items.length > 0),
    [owned.available],
  );

  const stalePlacements = rejectedEffects.filter(
    (r) => r.reason === 'not-owned',
  );

  return (
    <div className={cn('space-y-3', className)} data-testid="effects-panel">
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
        groups.map(({ slot, items }) => (
          <section key={slot} aria-label={EFFECT_SLOT_LABELS[slot]}>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {EFFECT_SLOT_LABELS[slot]}
            </h4>
            <ul className="space-y-2">
              {items.map((item) => (
                <EffectCard
                  key={item.address}
                  item={item}
                  activeInSlot={activeBySlot.get(slot)}
                  isPublishing={isPublishing}
                  previewing={previewingEffectId === item.registration.effectId}
                  onEquip={onEquip}
                  onRemove={onRemove}
                  onPreview={onPreview}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {stalePlacements.length > 0 && (
        <div className="rounded-md border border-amber-300/50 bg-amber-50/50 p-2 text-xs dark:border-amber-800/50 dark:bg-amber-950/30">
          <p className="font-medium">
            {stalePlacements.length} equipped effect
            {stalePlacements.length === 1 ? ' is' : 's are'} no longer in your
            inventory and {stalePlacements.length === 1 ? 'is' : 'are'} not
            shown.
          </p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {stalePlacements.map((r) => (
              <li key={r.registration.address}>
                {r.registration.name} — you can remove it from its slot below or
                leave it for when you own the item again.
              </li>
            ))}
          </ul>
          <div className="mt-1 flex flex-wrap gap-1">
            {stalePlacements.map((r) => (
              <Button
                key={r.registration.address}
                variant="outline"
                size="sm"
                className="h-6 text-[10px]"
                disabled={isPublishing}
                data-testid={`remove-stale-${r.registration.effectSlot}`}
                onClick={() => onRemove(r.registration.effectSlot)}
              >
                Remove {r.registration.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {owned.unavailable.length > 0 && (
        <details className="rounded-md border p-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            <Lock className="mr-1 inline h-3 w-3" />
            {owned.unavailable.length} effect
            {owned.unavailable.length === 1 ? '' : 's'} not available
          </summary>
          <ul className="mt-1 space-y-1">
            {owned.unavailable.map((item) => (
              <li key={item.address} className="text-muted-foreground">
                <span className="font-medium">
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

function EffectCard({
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
  const isEquipped = activeInSlot?.entry.item === item.address;
  const replaces =
    !isEquipped && activeInSlot !== undefined
      ? activeInSlot.registration
      : null;
  const name = definition?.name ?? registration.name;
  const rarity = definition?.rarity ?? registration.rarity;
  const imageUrl = definition ? primaryItemImageUrl(definition) : undefined;

  return (
    <li
      className={cn(
        'rounded-md border p-2',
        isEquipped && 'border-primary bg-primary/5',
        previewing && 'ring-2 ring-purple-400/60',
      )}
      data-testid={`effect-card-${registration.effectId}`}
    >
      <div className="flex items-start gap-2">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={name}
            className="h-10 w-10 shrink-0 rounded object-contain"
          />
        ) : (
          <span className="text-2xl">{registration.symbol}</span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs font-medium">{name}</span>
            <Badge variant="outline" className="text-[9px] capitalize">
              {rarity}
            </Badge>
            {isEquipped && (
              <Badge variant="secondary" className="text-[9px]">
                equipped
              </Badge>
            )}
            {previewing && (
              <Badge className="bg-purple-500 text-[9px] text-white">
                previewing
              </Badge>
            )}
          </div>
          {definition?.description && (
            <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">
              {definition.description}
            </p>
          )}
          {replaces && (
            <p
              className="mt-1 text-[10px] font-medium text-amber-700 dark:text-amber-400"
              data-testid={`replace-warning-${registration.effectId}`}
            >
              Equipping {name} will replace {replaces.name} in the{' '}
              {EFFECT_SLOT_LABELS[registration.effectSlot]} slot.
            </p>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px]"
          aria-pressed={previewing}
          data-testid={`preview-${registration.effectId}`}
          onClick={() =>
            onPreview(previewing ? null : [{ id: registration.effectId }])
          }
        >
          {previewing ? (
            <>
              <EyeOff className="mr-1 h-3 w-3" /> End preview
            </>
          ) : (
            <>
              <Eye className="mr-1 h-3 w-3" /> Preview
            </>
          )}
        </Button>
        {isEquipped ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={isPublishing}
            data-testid={`remove-${registration.effectId}`}
            onClick={() => onRemove(registration.effectSlot)}
          >
            Remove
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={isPublishing}
            data-testid={`equip-${registration.effectId}`}
            onClick={() => onEquip(item.address, registration.effectSlot)}
          >
            {isPublishing ? 'Saving…' : replaces ? 'Replace' : 'Equip'}
          </Button>
        )}
      </div>
    </li>
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
