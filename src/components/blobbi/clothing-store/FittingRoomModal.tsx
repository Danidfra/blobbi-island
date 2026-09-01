import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';

import type { AccessoryPlacementInput } from '@blobbi/react';
import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { Button } from '@/components/ui/button';
import { ItemTile } from '@/components/ui/item-tile';
import { cn } from '@/lib/utils';
import { useBlobbis } from '@/hooks/useBlobbis';
import { useBlobbonautProfile } from '@/hooks/useBlobbonautProfile';
import { useCharacterEquipmentContext } from '@/hooks/useCharacterEquipmentContext';
import { getBlobbiDisplayName } from '@/lib/blobbi-legacy';
import { CurrentBlobbiDisplay } from '../CurrentBlobbiDisplay';
import {
  CLOTHING_STORE_PRODUCTS,
  OFFICIAL_WEARABLES,
  getQuantity,
  useIslandInventory,
  useItemCatalog,
} from '@/inventory';
import { isEquippableSlot } from '@/placement/policy';

/**
 * The fitting room — "how would this look on my Blobbi?", and nothing else.
 *
 * ## Write-free, structurally
 *
 * This module imports no purchase hook, no inventory mutation, no wallet, no
 * publisher and no signer. There is no code path from this component to a Nostr
 * event, which is a stronger statement than "we do not call it": the preview is
 * composed as plain arrays, handed to the renderer as overrides, and discarded
 * when the dialog unmounts.
 *
 * Ownership is kind:31633 and wearing is kind:31634. Trying something on is
 * neither, so it touches neither. Nothing selected here survives the close.
 *
 * ## How the preview is drawn
 *
 * Through the REAL renderer, not a mock-up. `CurrentBlobbiDisplay` already
 * accepts explicit `visualOverride` / `accessoryOverride` / `effectsOverride`
 * — the Arcade's `PrizePreviewStage` established the pattern — so the fitting
 * room composes an accessory list and lets the renderer do what it does on the
 * world stage: same sprite, same slot rules, same rear-view hiding.
 *
 * The one extension over the prize preview is that this one is MULTI-SLOT: the
 * player builds an outfit across headwear, eyewear and neckwear at once, and a
 * second pick in a slot replaces the first rather than stacking. That is the
 * same rule equipping would apply, which is what makes the preview honest.
 *
 * ## What is on the rail
 *
 * Everything official and wearable, in two visually distinct groups:
 *
 *   OWNED           — kind:31633 says you hold it. Try it on freely.
 *   PREVIEW ONLY    — real, published, and not yours. Shown because a fitting
 *                     room you can only use for things you already bought is a
 *                     mirror, not a shop. Labelled so it never implies ownership.
 *
 * An item whose definition has not resolved to a slot this renderer knows is
 * listed as unavailable rather than placed at a guessed position.
 */

interface FittingRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** A friendly stand-in when the viewer has no companion to dress. */
const SAMPLE_VISUAL = {
  stage: 'adult' as const,
  adultType: 'catti',
  baseColor: '#8E6BE8',
  secondaryColor: '#B79CF2',
  eyeColor: '#3A2A1A',
  name: 'Sample Blobbi',
};

const SLOT_LABELS: Record<string, string> = {
  headwear: 'Headwear',
  eyewear: 'Eyewear',
  neckwear: 'Neckwear',
  back: 'Back',
  handheld: 'Handheld',
  'face-mark': 'Face mark',
  aura: 'Aura',
  'color-overlay': 'Overlay',
};

interface RailItem {
  address: string;
  d: string;
  name: string;
  symbol: string;
  image: string | undefined;
  /** The slot its DEFINITION declares, or null when unresolved. */
  slot: string | null;
  owned: boolean;
  /** Listed by the Clothing Store, whether or not it is priced yet. */
  inStore: boolean;
}

export function FittingRoomModal({ isOpen, onClose }: FittingRoomModalProps) {
  const { data: blobbis } = useBlobbis();
  const { data: profile } = useBlobbonautProfile();
  const { accessories, effects } = useCharacterEquipmentContext();
  const { data: catalog } = useItemCatalog();
  const inventory = useIslandInventory();

  const [facing, setFacing] = useState<'front' | 'back'>('front');

  /**
   * The outfit being tried on: slot → item address.
   *
   * Keyed by SLOT, which is what makes "a second hat replaces the first" fall
   * out of the data instead of needing a rule. Local state only — it is created
   * with the dialog and dies with it.
   */
  const [tryingOn, setTryingOn] = useState<Record<string, string>>({});

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

  const rail = useMemo((): RailItem[] => {
    const storeAddresses = new Set(CLOTHING_STORE_PRODUCTS.map((p) => p.address));
    return OFFICIAL_WEARABLES.map((wearable) => {
      const definition = catalog?.byAddress.get(wearable.address);
      const declared = definition?.slot ?? undefined;
      return {
        address: wearable.address,
        d: wearable.d,
        name: definition?.name ?? wearable.name,
        symbol: wearable.symbol,
        image: definition?.image ?? wearable.primaryImage ?? undefined,
        slot: isEquippableSlot(declared) ? declared : null,
        owned: inventory.data
          ? getQuantity(inventory.data, wearable.address) > 0
          : false,
        inStore: storeAddresses.has(wearable.address),
      };
    });
  }, [catalog, inventory.data]);

  /**
   * Artwork for the items being tried on.
   *
   * The equipment context only resolves definitions for what the Blobbi already
   * wears, which is everything the world stage needs and not nearly enough for
   * a fitting room — the whole point here is items it does NOT wear. Handing the
   * catalog's own definitions to the renderer is what makes the preview draw.
   * It grants nothing: a definition says what a thing looks like.
   */
  const previewDefinitions = useMemo(
    () => catalog?.byAddress ?? new Map(),
    [catalog],
  );

  /**
   * The accessory list the renderer draws: the Blobbi's REAL equipment, with
   * each tried-on item replacing whatever occupies its slot.
   *
   * Exactly what equipping would produce — which is the point. A preview that
   * composed differently from the real thing would be a lie told carefully.
   */
  const previewAccessories = useMemo((): readonly AccessoryPlacementInput[] => {
    const entries = Object.entries(tryingOn);
    if (entries.length === 0) return accessories;

    const previewed: AccessoryPlacementInput[] = entries.map(([slot, address]) => ({
      code: address,
      slot: slot as AccessoryPlacementInput['slot'],
      x: 50,
      y: 50,
      scale: 1,
      rot: 0,
      flipX: false,
    }));
    const replacedSlots = new Set(entries.map(([slot]) => slot));
    return [
      ...previewed,
      ...accessories.filter((a) => !replacedSlots.has(a.slot as string)),
    ];
  }, [tryingOn, accessories]);

  const tryOn = (item: RailItem) => {
    if (!item.slot) return;
    setTryingOn((current) => {
      // Tapping the item already in that slot takes it back off.
      if (current[item.slot!] === item.address) {
        const { [item.slot!]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [item.slot!]: item.address };
    });
  };

  const isTryingOn = (item: RailItem) =>
    item.slot !== null && tryingOn[item.slot] === item.address;

  const previewCount = Object.keys(tryingOn).length;

  if (!isOpen) return null;

  return (
    <BlobbiModal
      open={isOpen}
      onOpenChange={(next) => !next && onClose()}
      presentation="in-frame"
      size="lg"
      title="Fitting Room"
      description="Try things on. Nothing here is bought, worn or saved."
      icon="🪞"
      bodyClassName="flex min-h-0 flex-col gap-3 p-3 sm:p-4"
      footer={
        <>
          <Button
            variant="soft"
            onClick={() => setTryingOn({})}
            disabled={previewCount === 0}
            className="min-h-[44px]"
            data-fitting-room-reset
          >
            <RotateCcw aria-hidden className="mr-1.5 size-4" />
            Reset
          </Button>
          <Button variant="accent" onClick={onClose} className="min-h-[44px]">
            Done
          </Button>
        </>
      }
    >
      <div
        data-fitting-room-stage
        className="relative flex h-48 shrink-0 items-center justify-center overflow-hidden rounded-panel bg-gradient-to-b from-island-sky/30 to-island-cream-2"
      >
        <span className="absolute left-2 top-1.5 rounded-full bg-island-purple/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-island-purple">
          Preview
        </span>
        <CurrentBlobbiDisplay
          size="xl"
          transparent
          showFallback={false}
          facing={facing}
          idSuffix="fitting-room-preview"
          /* Fully explicit composition: the companion's own visual, its real
             equipment with the tried-on items layered over it, and its real
             effects untouched. Nothing persisted — see the module doc. */
          visualOverride={visual}
          accessoryOverride={previewAccessories}
          effectsOverride={effects}
          definitionsOverride={previewDefinitions}
        />
        <button
          type="button"
          data-fitting-room-facing
          onClick={() => setFacing((f) => (f === 'front' ? 'back' : 'front'))}
          className="absolute bottom-2 right-2 min-h-[32px] rounded-full border-2 border-island-wood/30 bg-island-cream/80 px-3 text-xs font-bold text-island-ink"
        >
          {facing === 'front' ? 'Show back' : 'Show front'}
        </button>
      </div>

      <p className="shrink-0 text-center text-xs text-island-ink-soft" role="status">
        {!companion
          ? 'Shown on a sample Blobbi — sign in to dress your own.'
          : previewCount === 0
            ? `${visual.name} is wearing what they already own.`
            : `Trying on ${previewCount} item${previewCount === 1 ? '' : 's'}. Nothing is saved.`}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {rail.map((item) => {
            const selected = isTryingOn(item);
            const unavailable = item.slot === null;
            return (
              <ItemTile
                key={item.address}
                data-fitting-room-item={item.address}
                data-owned={item.owned ? 'yes' : 'no'}
                data-trying-on={selected ? 'yes' : 'no'}
                name={item.name}
                selected={selected}
                disabled={unavailable}
                art={
                  item.image ? <img src={item.image} alt="" /> : <span>{item.symbol}</span>
                }
                footnote={
                  unavailable
                    ? 'Placement unavailable'
                    : (SLOT_LABELS[item.slot!] ?? item.slot!)
                }
              >
                <span
                  className={cn(
                    'mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide',
                    item.owned
                      ? 'bg-island-success/15 text-island-success'
                      : 'bg-island-wood/15 text-island-ink-soft',
                  )}
                  data-fitting-room-ownership={item.owned ? 'owned' : 'preview-only'}
                >
                  {item.owned ? 'Owned' : 'Preview only'}
                </span>
                <Button
                  variant={selected ? 'accent' : 'soft'}
                  onClick={() => tryOn(item)}
                  disabled={unavailable}
                  className="mt-1 min-h-[36px] w-full text-xs"
                  data-fitting-room-try={item.address}
                >
                  {unavailable ? 'Unavailable' : selected ? 'Take off' : 'Try on'}
                </Button>
              </ItemTile>
            );
          })}
        </div>
      </div>

      <p className="shrink-0 text-center text-[0.6875rem] text-island-ink-soft">
        Nothing in here is bought or worn. Buy at the till, dress up from My Blobbi.
      </p>
    </BlobbiModal>
  );
}
