/**
 * PrizePreviewStage — "how would this look on my Blobbi?", with no writes.
 *
 * Renders the CURRENT companion through the real renderer path
 * (`CurrentBlobbiDisplay` with explicit overrides), wearing everything it
 * already wears PLUS the previewed prize:
 *
 *   accessory prize → added to the worn accessories (replacing whatever
 *     occupies its slot, exactly as equipping would), drawn from its published
 *     front/back views with the renderer's rear hidden-slot rules unchanged;
 *   effect prize    → placed FIRST in the effect list so it wins its slot
 *     (the renderer's documented first-wins rule), while effects in other
 *     slots stay active.
 *
 * PUBLISHES NOTHING, MUTATES NOTHING: no kind:31633, no kind:31634, no signer.
 * The overrides are plain arrays composed here and discarded on unmount. When
 * no companion exists (logged out, no Blobbi yet), a neutral sample Blobbi
 * models the prize instead — labelled as such.
 */

import { useMemo, useState } from 'react';

import type {
  AccessoryPlacementInput,
  BlobbiVisualEffect,
} from '@blobbi/react';
import { useBlobbis } from '@/hooks/useBlobbis';
import { useBlobbonautProfile } from '@/hooks/useBlobbonautProfile';
import { useCharacterEquipmentContext } from '@/hooks/useCharacterEquipmentContext';
import { getBlobbiDisplayName } from '@/lib/blobbi-legacy';
import { CurrentBlobbiDisplay } from '@/components/blobbi/CurrentBlobbiDisplay';
import type { ResolvedArcadePrize } from './useOfficialArcadePrizes';

/** A friendly stand-in when the viewer has no companion to model the prize. */
const SAMPLE_VISUAL = {
  stage: 'adult' as const,
  adultType: 'catti',
  baseColor: '#8E6BE8',
  secondaryColor: '#B79CF2',
  eyeColor: '#3A2A1A',
  name: 'Sample Blobbi',
};

export function PrizePreviewStage({ resolved }: { resolved: ResolvedArcadePrize }) {
  const [facing, setFacing] = useState<'front' | 'back'>('front');

  const { data: blobbis } = useBlobbis();
  const { data: profile } = useBlobbonautProfile();
  const { accessories, effects } = useCharacterEquipmentContext();

  const companion = profile?.currentCompanion
    ? (blobbis?.find((b) => b.id === profile.currentCompanion) ?? null)
    : null;

  const visual = companion
    ? {
        stage: companion.stage,
        adultType: companion.adultType,
        baseColor: companion.baseColor,
        secondaryColor: companion.secondaryColor,
        eyeColor: companion.eyeColor,
        name: getBlobbiDisplayName(companion),
      }
    : SAMPLE_VISUAL;

  const { previewAccessories, previewEffects } = useMemo((): {
    previewAccessories: readonly AccessoryPlacementInput[];
    previewEffects: readonly BlobbiVisualEffect[];
  } => {
    if (resolved.prize.kind === 'effect' && resolved.effectId) {
      // FIRST in the list wins its slot; effects in other slots stay.
      return {
        previewAccessories: accessories,
        previewEffects: [{ id: resolved.effectId }, ...effects],
      };
    }
    if (resolved.slot !== null) {
      // Replace the same slot, exactly as equipping would; keep the rest.
      const preview: AccessoryPlacementInput = {
        code: resolved.prize.itemAddress,
        slot: resolved.slot as AccessoryPlacementInput['slot'],
        x: 50,
        y: 50,
        scale: 1,
        rot: 0,
        flipX: false,
      };
      return {
        previewAccessories: [
          preview,
          ...accessories.filter((a) => a.slot !== resolved.slot),
        ],
        previewEffects: effects,
      };
    }
    // A wearable whose slot is unknown (definition unresolved) cannot be
    // placed honestly; show the Blobbi unchanged rather than guessing.
    return { previewAccessories: accessories, previewEffects: effects };
  }, [resolved, accessories, effects]);

  const canPlace = resolved.prize.kind === 'effect' ? resolved.effectId !== null : resolved.slot !== null;

  return (
    <div data-prize-preview-stage className="flex flex-col items-center gap-1.5">
      <div className="relative flex h-44 w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-b from-island-sky/30 to-island-cream-2">
        <span className="absolute left-2 top-1.5 rounded-full bg-island-purple/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-island-purple">
          Preview
        </span>
        <CurrentBlobbiDisplay
          size="xl"
          transparent
          showFallback={false}
          facing={facing}
          idSuffix={`prize-preview-${resolved.prize.d}`}
          /* Overrides make the composition fully explicit: the companion's own
             visual, its real equipment plus the previewed prize, nothing
             persisted. See the module doc. */
          visualOverride={visual}
          accessoryOverride={previewAccessories}
          effectsOverride={previewEffects}
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-prize-preview-facing
          onClick={() => setFacing((f) => (f === 'front' ? 'back' : 'front'))}
          className="min-h-[32px] rounded-full border-2 border-island-wood/30 bg-island-cream/70 px-3 text-xs font-bold text-island-ink"
        >
          {facing === 'front' ? 'Show back' : 'Show front'}
        </button>
        {!companion && (
          <span className="text-[11px] blobbi-text-muted">
            Shown on a sample Blobbi
          </span>
        )}
        {!canPlace && (
          <span className="text-[11px] blobbi-text-muted">
            Artwork placement unavailable until the item definition loads
          </span>
        )}
      </div>
    </div>
  );
}
