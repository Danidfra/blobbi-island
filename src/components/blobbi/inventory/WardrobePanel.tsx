import { useState } from 'react';
import { Shirt, Sparkles } from 'lucide-react';
import type { AccessorySlot, BlobbiVisualEffect } from '@blobbi/react';

import { cn } from '@/lib/utils';
import type { PlacementSlot } from '@/placement/policy';
import type { PlacementTransformPatch } from '@/placement/useEquipmentMutation';

import { EffectsPanel } from '../EffectsPanel';
import { InventoryBrowser } from './InventoryBrowser';

/**
 * Wardrobe: everything that changes how the Blobbi LOOKS.
 *
 * ## Why this exists as a tab
 *
 * The previous pass merged wearables and consumables into one Items tab. That
 * was the right consolidation of two duplicate *windows*, and the wrong grouping
 * of two *activities*: wearing a hat is customization, with the Blobbi as the
 * feedback loop, while eating a sandwich is care. A player looking for a hat had
 * to scroll past sandwiches, and a player feeding a hungry Blobbi had to scroll
 * past hats.
 *
 * So the window is now `Blobbi | Wardrobe | Items`, and Effects, which was a
 * top-level tab for something that is plainly a kind of appearance, folds in
 * here as the second half of a two-way segmented control:
 *
 * ```
 *   [ Clothing | Effects ]     ← one strip, not nested tabs
 *   ▣ ▣ ▣ ▣                    ← the grid for whichever is chosen
 *   selected → preview → Wear / Take off / Activate / Remove
 * ```
 *
 * A segmented control rather than nested `<Tabs>`: two levels of tab chrome
 * inside a modal is the "nested tab hell" the brief rules out, and the choice
 * here is between two views of one activity rather than two destinations.
 *
 * ## The feedback loop
 *
 * Both halves are meant to be used with the Blobbi visible beside them,
 * selecting a hat highlights it on the stage and arms its drag handles;
 * previewing an effect draws it on the real renderer. Nothing here publishes:
 * the verbs are handed up to the window, which owns the kind:31634 mutation.
 */

type WardrobeSection = 'wearables' | 'effects';

export interface WardrobePanelProps {
  characterId: string | undefined;
  /** Current Blobbi form/stage; gates form-restricted cosmetics and effects. */
  form?: string | undefined;
  selectedSlot?: AccessorySlot | null;
  onSelectSlot?: (slot: AccessorySlot | null) => void;
  pendingUpdates?: Record<string, PlacementTransformPatch>;
  onTransformChange?: (slot: AccessorySlot, patch: PlacementTransformPatch) => void;
  onSaveTransforms?: () => void;
  onEquip: (address: string, slot: PlacementSlot) => void;
  onUnequip: (slot: PlacementSlot) => void;
  /** Effect preview, drawn on the stage through the real renderer path. */
  onPreviewEffects: (effects: readonly BlobbiVisualEffect[] | null) => void;
  previewingEffectId: string | null;
  publishError?: string | null;
  isPublishing?: boolean;
  /** Told when the section changes, so the stage can drop a stale preview. */
  onSectionChange?: (section: WardrobeSection) => void;
  className?: string;
}

const SECTIONS: readonly { key: WardrobeSection; label: string; icon: React.ElementType }[] = [
  { key: 'wearables', label: 'Clothing', icon: Shirt },
  { key: 'effects', label: 'Effects', icon: Sparkles },
];

export function WardrobePanel({
  characterId,
  form,
  selectedSlot,
  onSelectSlot,
  pendingUpdates,
  onTransformChange,
  onSaveTransforms,
  onEquip,
  onUnequip,
  onPreviewEffects,
  previewingEffectId,
  publishError,
  isPublishing = false,
  onSectionChange,
  className,
}: WardrobePanelProps) {
  const [section, setSection] = useState<WardrobeSection>('wearables');

  const choose = (next: WardrobeSection) => {
    setSection(next);
    // Leaving Effects ends any preview: the stage must show the persisted
    // state unless the player is actively previewing.
    onSectionChange?.(next);
  };

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)} data-testid="wardrobe-panel">
      <div
        role="tablist"
        aria-label="Wardrobe section"
        className="grid shrink-0 grid-cols-2 gap-1 rounded-panel border border-island-wood/20 bg-island-cream-2 p-1"
      >
        {SECTIONS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={section === key}
            data-testid={`wardrobe-${key}`}
            onClick={() => choose(key)}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold',
              'transition-colors duration-150',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'focus-visible:ring-offset-1 focus-visible:ring-offset-island-cream-2',
              section === key
                ? 'bg-island-cream text-island-ink shadow-cozy-soft'
                : 'text-island-ink-soft',
            )}
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {section === 'wearables' ? (
        <InventoryBrowser
          characterId={characterId}
          form={form}
          categories={['wearable']}
          hideCategoryStrip
          emptyTitle="Nothing to wear yet"
          emptyMessage="Cosmetics you own show up here, ready to try on your Blobbi."
          selectedSlot={selectedSlot}
          onSelectSlot={onSelectSlot}
          pendingUpdates={pendingUpdates}
          onTransformChange={onTransformChange}
          onSaveTransforms={onSaveTransforms}
          onEquip={onEquip}
          onUnequip={onUnequip}
          publishError={publishError}
          isPublishing={isPublishing}
        />
      ) : (
        <EffectsPanel
          stage={form}
          onEquip={onEquip}
          onRemove={onUnequip}
          onPreview={onPreviewEffects}
          previewingEffectId={previewingEffectId}
          publishError={publishError}
          isPublishing={isPublishing}
        />
      )}
    </div>
  );
}
