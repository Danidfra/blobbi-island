import React, { useEffect, useState, useRef } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';


import { ChevronRight, Package, PawPrint, Shirt } from 'lucide-react';
import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { StateCard } from '@/components/ui/state-card';
import { CurrentBlobbiPreview } from './CurrentBlobbiPreview';
import { BlobbiStageBackdrop, StageBackgroundSwatch } from './BlobbiStageBackdrop';
import { StageBackgroundPicker } from './StageBackgroundPicker';
import { InventoryBrowser } from './inventory/InventoryBrowser';
import { WardrobePanel } from './inventory/WardrobePanel';
import { MoodHero, NeedMeters, ProgressionStrip, TraitChips } from './PetCard';
import { PlacementOverlay } from './PlacementOverlay';
import { useEquipmentMutation, type PlacementTransformPatch } from '@/placement/useEquipmentMutation';
import { useCharacterEquipmentContext } from '@/hooks/useCharacterEquipmentContext';
import { buildEquipEntry } from '@/placement/render-model';
import { isEffectPlacementSlot, type PlacementSlot } from '@/placement/policy';
import type { AccessorySlot, BlobbiVisualEffect } from '@blobbi/react';
import { useToast } from '@/hooks/useToast';
import { useCurrentPet } from '@/hooks/useOptimizedStatus';
import { useCoinBalance } from '@/inventory/useCoinWallet';
import { useEconomyEntryStatus } from '@/inventory/useEconomyEntry';
import { CoinAmount } from './CoinAmount';
import { analyzeCareStatus } from '@/lib/blobbi-parsers';
import { STAGE_ASPECT_RATIO, resolveStageBackground } from '@/lib/blobbi-stage-backgrounds';
import type { CollectionCategory } from './inventory/useInventoryCollection';
import { useStageBackground } from '@/hooks/useStageBackground';
import { dbg } from '@/lib/debug';
import { cn } from '@/lib/utils';
import { getBlobbiDisplayName } from '@/lib/blobbi-legacy';
import type { BlobbiVisual } from '@/lib/multiplayer';

/**
 * Three repeated treatments, named once.
 *
 * They are module constants rather than components because each is a plain
 * class string applied to markup that already exists — extracting components
 * would restructure the modal, and this pass is deliberately presentation-only.
 */
const TAB_TRIGGER =
  'flex items-center justify-center rounded-lg py-1 text-xs font-semibold ' +
  'text-island-ink-soft transition-colors duration-150 ' +
  'data-[state=active]:bg-island-cream data-[state=active]:text-island-ink ' +
  'data-[state=active]:shadow-cozy-soft ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'focus-visible:ring-offset-1 focus-visible:ring-offset-island-cream-2 sm:text-sm';

const PANEL = 'rounded-panel border border-island-wood/20 bg-island-cream p-2 shadow-cozy-soft';

/**
 * What the Items tab is responsible for: everything you can USE or spend.
 *
 * Wearables are deliberately absent — they live in the Wardrobe, beside the
 * Blobbi they go on. One collection model still backs both surfaces.
 */
const ITEM_CATEGORIES: readonly CollectionCategory[] = ['food', 'toy', 'care', 'currency'];

interface BlobbiInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Force a specific stage backdrop, by id. Left alone the player's own choice
   * is used — see `useStageBackground`. This exists for previews and tests, and
   * for a future "look at this Blobbi in that scene" flow; it is NOT how the
   * player picks one.
   */
  backgroundKey?: string;
  defaultTab?: 'primary' | 'wardrobe' | 'items';
  readOnly?: boolean;
  previewKey?: string;
  externalBlobbiData?: {
    name: string;
    stage: string;
    hunger: number;
    energy: number;
    happiness: number;
    health: number;
    hygiene: number;
    experience: number;
    careStreak: number;
    generation: number;
    personality?: string | string[];
    trait?: string | string[];
    mood?: string;
    isSleeping?: boolean;
  };
  externalVisual?: BlobbiVisual;
}



export function BlobbiInfoModal({
  isOpen,
  onClose,
  backgroundKey,
  defaultTab = 'primary',
  readOnly = false,
  previewKey = 'self',
  externalBlobbiData,
  externalVisual
}: BlobbiInfoModalProps) {
  const currentPet = useCurrentPet();
  // The HUD balance is the canonical inventory Coin; the legacy profile value
  // is never displayed again. The economy-entry status keeps an in-flight or
  // ambiguous initial allocation from being shown as a zero balance.
  const coinBalance = useCoinBalance();
  const economyEntry = useEconomyEntryStatus();

  // Use external data if in read-only mode, otherwise use current pet data
  const blobbiData = readOnly && externalBlobbiData ? externalBlobbiData : currentPet;
  /*
    The stage backdrop.

    `backgroundKey` is an OVERRIDE, not the source of truth: left undefined the
    player's own selection is used, which is what turns the old hardcoded PNG
    into a real slot. A read-only view of somebody else's Blobbi deliberately
    keeps the local player's stage rather than guessing at theirs — the same
    honesty rule the accessory preview follows.
  */
  const stageSelection = useStageBackground();
  const background =
    backgroundKey === undefined ? stageSelection.background : resolveStageBackground(backgroundKey);
  const [backgroundPickerOpen, setBackgroundPickerOpen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Equipment editing state is keyed by SLOT, because a kind:31634 document
  // holds one equipped entry per slot. The legacy editor keyed everything by
  // accessory code, which only worked while an accessory *was* its code.
  const [selectedSlot, setSelectedSlot] = useState<AccessorySlot | null>(null);
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, PlacementTransformPatch>>({});
  const [publishError, setPublishError] = useState<string | null>(null);
  const { toast } = useToast();
  const equipmentMutation = useEquipmentMutation();
  // The same policy-filtered accessories the world draws, so the editor and the
  // world can never disagree about what is worn.
  const { accessories, definitionsByAddress } = useCharacterEquipmentContext();
  const [selectedTab, setSelectedTab] = useState<'primary' | 'wardrobe' | 'items'>(readOnly ? 'primary' : defaultTab);
  /**
   * Effect PREVIEW state — purely visual, never persisted. Non-null while the
   * player is previewing an effect from the Effects tab; drawn through the
   * real renderer path via `effectsOverride` and cleared on cancel, on tab
   * change and whenever a real equip/remove lands (the persisted state is then
   * the truth again).
   */
  const [previewEffects, setPreviewEffects] = useState<readonly BlobbiVisualEffect[] | null>(null);

  const characterId = currentPet?.id;
  const characterName = currentPet?.name;

  const handleTransformChange = (slot: AccessorySlot, patch: PlacementTransformPatch) => {
    setPendingUpdates((prev) => ({ ...prev, [slot]: { ...prev[slot], ...patch } }));
  };

  /**
   * Publish every pending transform edit as ONE complete kind:31634 document.
   *
   * There is no local "committed updates" buffer any more: the mutation updates
   * the query cache optimistically and invalidates after settling, so the UI
   * already shows the new positions and reconciles with the relay on its own.
   * The legacy editor needed that buffer because its write path did neither.
   */
  const handleSaveTransforms = async () => {
    if (!characterId || Object.keys(pendingUpdates).length === 0) return;
    setPublishError(null);
    try {
      await equipmentMutation.mutateAsync({
        characterId,
        ...(characterName === undefined ? {} : { characterName }),
        mutation: { type: 'set-transforms', transforms: pendingUpdates },
      });
      setPendingUpdates({});
      toast({
        title: 'Equipment saved',
        description: 'Accessory positions published.',
      });
    } catch (error) {
      // Kept in `pendingUpdates` so the player does not lose their edits, and
      // surfaced in the panel rather than only in a toast that scrolls away.
      const message = error instanceof Error ? error.message : 'Publish failed.';
      setPublishError(message);
      toast({ title: 'Save failed', description: message, variant: 'destructive' });
    }
  };

  const handleEquip = async (address: string, slot: PlacementSlot) => {
    if (!characterId) return;
    setPublishError(null);
    try {
      await equipmentMutation.mutateAsync({
        characterId,
        ...(characterName === undefined ? {} : { characterName }),
        mutation: {
          type: 'equip',
          slot,
          entry: buildEquipEntry({ itemAddress: address, slot }),
        },
      });
      // A landed equip makes the persisted state the truth again; keeping a
      // preview alive here would hide what was just published.
      setPreviewEffects(null);
      // Transform editing applies to wearable accessory slots only.
      if (!isEffectPlacementSlot(slot)) setSelectedSlot(slot);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Publish failed.';
      setPublishError(message);
      toast({ title: 'Could not equip', description: message, variant: 'destructive' });
    }
  };

  /**
   * Unequip a slot.
   *
   * This publishes a kind:31634 document without that entry and touches NO
   * inventory: taking a hat off does not give it back, because wearing it never
   * took it away.
   */
  const handleUnequip = async (slot: PlacementSlot) => {
    if (!characterId) return;
    setPublishError(null);
    try {
      await equipmentMutation.mutateAsync({
        characterId,
        ...(characterName === undefined ? {} : { characterName }),
        mutation: { type: 'unequip', slot },
      });
      setPreviewEffects(null);
      setPendingUpdates((prev) => {
        const next = { ...prev };
        delete next[slot];
        return next;
      });
      setSelectedSlot((current) => (current === slot ? null : current));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Publish failed.';
      setPublishError(message);
      toast({ title: 'Could not remove', description: message, variant: 'destructive' });
    }
  };


  useEffect(() => {
    setSelectedTab(readOnly ? 'primary' : defaultTab);
  }, [readOnly, defaultTab]);

  // Debug logging for externalBlobbiData changes
  useEffect(() => {
    if (readOnly && externalBlobbiData) {
      dbg('[blobbi-debug][modal] externalBlobbiData changed:', {
        name: externalBlobbiData.name,
        stage: externalBlobbiData.stage,
        generation: externalBlobbiData.generation,
        previewKey,
        timestamp: new Date().toISOString()
      });
    }
  }, [readOnly, externalBlobbiData, previewKey]);

  // Debug logging for externalVisual changes
  useEffect(() => {
    if (readOnly && externalVisual) {
      dbg('[blobbi-debug][modal] externalVisual changed:', {
        name: externalVisual.name,
        stage: externalVisual.stage,
        baseColor: externalVisual.baseColor,
        secondaryColor: externalVisual.secondaryColor,
        previewKey,
        timestamp: new Date().toISOString()
      });
    }
  }, [readOnly, externalVisual, previewKey]);

  // Debug logging for modal open/close
  useEffect(() => {
    dbg('[blobbi-debug][modal] Modal state changed:', {
      isOpen,
      readOnly,
      previewKey,
      timestamp: new Date().toISOString()
    });
  }, [isOpen, readOnly, previewKey]);


  /*
    The hand-rolled `document`-level Escape listener that used to live here is
    gone. BlobbiModal's underlying Radix dialog handles Escape itself, and it
    does so correctly for a STACK: only the topmost dialog closes. The global
    listener fired regardless of what was on top, so opening the consume-item
    dialog from the inventory tab and pressing Escape dismissed this modal out
    from under it.
  */

  if (!isOpen) return null;

  if (!blobbiData) {
    return (
      <BlobbiModal
        open
        onOpenChange={(next) => !next && onClose()}
        presentation="in-frame"
        size="sm"
        title="Blobbi"
        icon={<PawPrint />}
      >
        <StateCard
          kind="empty"
          compact
          title="No Blobbi selected"
          message="Pick a companion from the account menu to see their care sheet."
        />
      </BlobbiModal>
    );
  }

  const careStatus = readOnly ? {
    urgentNeed: undefined,
    urgency: 'none' as const,
    condition: 'good' as const,
    sleepState: 'awake' as const,
    nextCareIn: undefined,
  } : (currentPet ? analyzeCareStatus(currentPet) : {
    urgentNeed: undefined,
    urgency: 'none' as const,
    condition: 'good' as const,
    sleepState: 'awake' as const,
    nextCareIn: undefined,
  });

  return (
    <BlobbiModal
      open
      onOpenChange={(next) => !next && onClose()}
      presentation="in-frame"
      size="full"
      title={readOnly ? blobbiData.name : (currentPet ? getBlobbiDisplayName(currentPet) : 'Blobbi')}
      description={
        readOnly
          ? `${blobbiData.stage} • Generation ${blobbiData.generation}`
          : 'Stats, equipment and effects'
      }
      icon={<PawPrint />}
      /* The body owns its own layout and its inner panes scroll independently,
         so the frame's default padding and single scroller are handed back.

         STACKED on a phone, side-by-side from `sm` up. It used to be `flex-row`
         at every width, which on a 375px sheet gave the stage a 110px column —
         a Blobbi the size of a favicon next to a squeezed tab strip. Stacking
         gives the stage the sheet's full width and the tabs the rest. */
      bodyClassName="flex min-h-0 flex-col gap-3 overflow-hidden p-3 sm:flex-row sm:gap-4 lg:gap-5 lg:p-4"
    >
      <div ref={modalRef} className="contents">
          {/* The stage: the backdrop, the Blobbi standing on it, and the one
              control that changes the scene. */}
          <div
            data-testid="blobbi-stage-column"
            /*
              The stage frames the Blobbi; it does not compete with it.

              NARROWER than it was (38%→32% at `sm`, 36%→30% at `lg`), and on a
              phone a quarter of the height rather than a third. Both changes
              are the same decision from two directions: the previous pass made
              the stage bigger to fix a crop bug, and the Blobbi inside it did
              not grow with it — so the backdrop became the subject. Now the
              Blobbi is a fraction of the stage, so shrinking the stage does not
              shrink the protagonist relative to its scene; it just gives the
              content beside it more room.

              On the ITEMS tab the stage steps down further: a grid of things you
              can eat gains nothing from a large portrait, and the extra width is
              worth more there than the picture is.
            */
            className={cn(
              'flex min-h-0 shrink-0 items-center justify-center transition-[width,height] duration-200 ease-cozy',
              'motion-reduce:transition-none',
              selectedTab === 'items'
                ? 'h-[18dvh] sm:h-auto sm:w-[24%] lg:w-[22%]'
                : 'h-[26dvh] sm:h-auto sm:w-[32%] lg:w-[30%]',
            )}
          >
            {/*
              THE STAGE BOX, and the geometry fix.

              It is sized by HEIGHT (`h-full`) with `aspect-ratio` deriving the
              width, so the box always has the backdrop's own proportions —
              whatever height the modal happens to have. It used to be
              `aspect-square w-full max-h-full`: a square box for a 2:3 portrait
              backdrop, which `object-cover` resolved by cropping a third of the
              picture's height away (see STAGE_ASPECT_RATIO), and `max-h-full`
              then silently broke even the square on a short viewport, because
              clamping the height of a `w-full` box does not narrow it.

              `max-w-full` is the guard for the reverse case — a very tall, very
              narrow container — and the parent's `overflow-hidden` is the
              backstop.
            */}
            <div
              data-testid="blobbi-stage"
              style={{ aspectRatio: STAGE_ASPECT_RATIO }}
              className="relative h-full max-w-full overflow-hidden rounded-panel border-2 border-island-wood/30 bg-island-cream-2 shadow-cozy-frame"
            >
              {/* Background Layer - z-0 */}
              <div className="absolute inset-0 z-0" aria-hidden="true">
                <BlobbiStageBackdrop background={background} />
              </div>

              {/* Optional: Subtle vignette for text contrast */}
              <div className="absolute inset-0 z-5 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-t from-island-ink/10 to-transparent" />
              </div>

              {/*
                THE BLOBBI, and the size fix.

                Its box is a FRACTION OF THE STAGE (`h-[46%]` of a 2:3 scene, so
                ~69% of its width) rather than a fixed 128px. It used to be
                `size="xl"` — 128 real pixels inside a ~540px-tall desktop stage,
                which is under a quarter of the height: the backdrop was the
                subject and the Blobbi was a detail in it. A fraction also means
                one rule covers every viewport, with no breakpoint: the
                protagonist is the same size relative to its scene on a phone and
                on a desktop.

                Safe because everything the renderer paints is already expressed
                in percentages OF this box — accessory x/y, accessory base size,
                every effect shape — so the Blobbi and everything on it scale as
                ONE unit. `size="xl"` is still passed: it is the token the
                renderer reports and the fallback text sizes from, and only the
                BOX is overridden.

                `stageRef` is this element, which now IS the renderer box rather
                than a shrink-wrap around it — so the placement overlay's
                percentage space is still exactly the box, by construction.
              */}
              <div className="absolute inset-0 z-10 flex items-end justify-center pb-[7%]">
                <div ref={stageRef} className="relative aspect-square h-[46%]">
                  <CurrentBlobbiPreview
                    key={`preview:${previewKey}`}
                    size="xl"
                    className="h-full w-full transform-gpu"
                    boxClassName="h-full w-full"
                    showFallback={true}
                    isSleeping={blobbiData.isSleeping}
                    isStaticPreview={true}
                    showAccessories
                    /* Read-only = someone else's Blobbi. No `accessoryOverride`
                       is passed because this modal has not fetched their
                       equipment, so the honest render is a bare Blobbi. It used
                       to inherit the LOCAL player's accessories here, drawing a
                       stranger in your hats (fixed in Phase 5). */
                    visualOverride={readOnly ? externalVisual : undefined}
                    /* Effect PREVIEW: while non-null this replaces the
                       persisted active effects on the stage only. Publishing
                       never happens from here; cancelling (or leaving the
                       Effects tab) restores the persisted view. */
                    effectsOverride={
                      !readOnly && previewEffects !== null
                        ? previewEffects
                        : undefined
                    }
                    idSuffix={`preview:${previewKey}`}
                  />

                  {/* Accessory Overlay for inventory editing. `stageRef` wraps
                      exactly the preview's renderer box (its only child), so
                      the overlay's inset-0 percentage space IS the canonical
                      renderer box — the same space the world renderer uses. */}
                  {!readOnly && selectedTab === 'wardrobe' && (
                    <PlacementOverlay
                      className="absolute inset-0 z-20"
                      accessories={accessories}
                      definitionsByAddress={definitionsByAddress}
                      containerRef={stageRef}
                      selectedSlot={selectedSlot}
                      onSelectSlot={setSelectedSlot}
                      onTransformChange={handleTransformChange}
                      pendingUpdates={pendingUpdates}
                    />
                  )}
                </div>
              </div>

            </div>
          </div>

          {/* Sidebar - Right side with tabbed interface */}
          <div className="flex min-h-0 w-full flex-1 flex-col sm:w-[64%] lg:w-3/5">
            <Tabs
              value={selectedTab}
              onValueChange={(value) => {
                setSelectedTab(value as 'primary' | 'wardrobe' | 'items');
                // Leaving the Wardrobe ends any effect preview: the stage must
                // always show the persisted state unless the player is
                // actively previewing.
                if (value !== 'wardrobe') setPreviewEffects(null);
              }}
              className="flex flex-col h-full"
            >
              {/* The window's primary navigation. Fixed at the top of the
                  pane, so the tab strip never scrolls away from a long
                  inventory — the content region below is what scrolls. */}
              <TabsList
                className={cn(
                  'grid h-auto w-full shrink-0 gap-1 rounded-panel border border-island-wood/20 bg-island-cream-2 p-0.5',
                  readOnly ? 'grid-cols-1' : 'grid-cols-3',
                )}
              >
                <TabsTrigger value="primary" className={TAB_TRIGGER}>
                  <PawPrint aria-hidden className="mr-1.5 size-4" />
                  Blobbi
                </TabsTrigger>
                {!readOnly && (
                  <TabsTrigger value="wardrobe" data-testid="wardrobe-tab" className={TAB_TRIGGER}>
                    <Shirt aria-hidden className="mr-1.5 size-4" />
                    Wardrobe
                  </TabsTrigger>
                )}
                {!readOnly && (
                  <TabsTrigger value="items" className={TAB_TRIGGER}>
                    <Package aria-hidden className="mr-1.5 size-4" />
                    Items
                  </TabsTrigger>
                )}
              </TabsList>

              {/* Tab Content - scrollable panels */}
              {/* THE one scroll region in this window. The frame's own
                  scroller is handed back (see `bodyClassName`), the stage does
                  not scroll, and the tab strip above is `shrink-0` — so there
                  is exactly one thing that moves and no two scrollers to fight
                  each other on a phone. */}
              <div className="min-h-0 h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1 scrollbar-thin scrollbar-track-transparent">
                {/*
                  Blobbi — the pet card.

                  One headline, five needs, three trophies, some character, and
                  the scene control. It used to be a badge row, an alert, a
                  five-row stat table under a heading, and a two-column
                  definition list — every fact present, correctly grouped, and
                  reading like a profile analytics panel. See `PetCard.tsx` for
                  what the reference study changed and why.
                */}
                <TabsContent
                  value="primary"
                  className="mt-2.5 flex flex-col gap-2.5 pb-1 focus-visible:outline-none"
                >
                  {/*
                    HORIZONTAL composition, because the information is finite.

                    It was one column of six blocks separated by `space-y-4` —
                    386px of content carrying 80px of pure gap, in a pane about
                    650px WIDE. On a 1440×800 laptop that overflowed, so a player
                    scrolled to find out their Blobbi was hungry.

                    Now: the mood spans the top, needs and progression share the
                    middle row, and coins + appearance are one footer strip. Same
                    content, roughly half the height, and nothing hidden behind a
                    click — the brief's one hard constraint.
                  */}
                  <MoodHero care={careStatus} stats={blobbiData} />

                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <NeedMeters stats={blobbiData} />
                    <div className="flex flex-col gap-2.5">
                      <ProgressionStrip stats={blobbiData} />
                      <TraitChips stats={blobbiData} />
                    </div>
                  </div>

                  {!readOnly && (
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {/* The Coin balance sits with progression rather than in
                          its own panel — it is a number you have earned. */}
                      <div className="flex items-center justify-between rounded-panel border border-island-wood/20 bg-island-cream px-3 py-2 shadow-cozy-soft">
                        <span className="text-xs font-semibold text-island-ink-soft">Coins</span>
                        <span data-coin-hud>
                          {economyEntry.phase === 'checking' ||
                          economyEntry.phase === 'applying' ||
                          coinBalance.isLoading ? (
                            <CoinAmount amount={null} loading className="text-sm" />
                          ) : economyEntry.phase === 'ambiguous' ? (
                            <span role="status" className="text-xs font-medium text-island-ink-soft">
                              Confirming your Coin balance…
                            </span>
                          ) : coinBalance.isError ? (
                            <button
                              type="button"
                              className="text-xs font-medium text-island-ink-soft underline"
                              onClick={() => coinBalance.refetch()}
                            >
                              Balance unavailable — tap to retry
                            </button>
                          ) : (
                            <CoinAmount
                              amount={coinBalance.balance}
                              className="text-sm"
                              aria-label={`${coinBalance.balance} Blobbi Coins`}
                            />
                          )}
                        </span>
                      </div>

                      {/* The stage's scene, named as a customization. */}
                      <button
                        type="button"
                        data-testid="open-stage-background-picker"
                        onClick={() => setBackgroundPickerOpen(true)}
                        className={cn(
                          PANEL,
                          'flex w-full items-center gap-2.5 p-2 text-left',
                          'transition-transform duration-150 ease-cozy hover:-translate-y-0.5 active:scale-[0.99]',
                          'motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-island-cream',
                        )}
                      >
                        {/* w-7, not w-10: the swatch is 2:3, so its WIDTH sets
                            the row's height. Ten became sixty pixels of row for
                            a thumbnail. */}
                        <span
                          aria-hidden
                          className="block w-7 shrink-0 overflow-hidden rounded border border-island-wood/25"
                          style={{ aspectRatio: STAGE_ASPECT_RATIO }}
                        >
                          <StageBackgroundSwatch background={background} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-bold text-island-ink">
                            Stage background
                          </span>
                          <span className="block truncate text-[0.6875rem] text-island-ink-soft">
                            {background.emoji} {background.name}
                          </span>
                        </span>
                        <ChevronRight aria-hidden className="size-4 shrink-0 text-island-ink-soft" />
                      </button>
                    </div>
                  )}
                </TabsContent>

                {/*
                  Wardrobe — everything that changes how the Blobbi LOOKS.

                  Wearables and effects behind one segmented control, with the
                  Blobbi visible beside them. Effects stopped being a top-level
                  tab because an effect is plainly a kind of appearance, and a
                  three-tab window that spent a third of its navigation on four
                  aura slots was over-weighting them.
                */}
                <TabsContent
                  value="wardrobe"
                  className="mt-3 flex min-h-0 flex-col pb-2 focus-visible:outline-none"
                >
                  <WardrobePanel
                    characterId={characterId}
                    form={currentPet?.stage}
                    selectedSlot={selectedSlot}
                    onSelectSlot={setSelectedSlot}
                    pendingUpdates={pendingUpdates}
                    onTransformChange={handleTransformChange}
                    onSaveTransforms={handleSaveTransforms}
                    onEquip={handleEquip}
                    onUnequip={handleUnequip}
                    onPreviewEffects={setPreviewEffects}
                    previewingEffectId={
                      previewEffects && previewEffects.length > 0 ? previewEffects[0].id : null
                    }
                    onSectionChange={(section) => {
                      if (section !== 'effects') setPreviewEffects(null);
                    }}
                    publishError={publishError}
                    isPublishing={equipmentMutation.isPending}
                  />
                </TabsContent>

                {/*
                  Items — the bag of usable things.

                  Lighter than it was: wearables moved to the Wardrobe, so what
                  is left is food, toys, care items and currency.
                */}
                <TabsContent
                  value="items"
                  className="mt-3 flex min-h-0 flex-col pb-2 focus-visible:outline-none"
                >
                  <InventoryBrowser
                    characterId={characterId}
                    form={currentPet?.stage}
                    categories={ITEM_CATEGORIES}
                    onEquip={handleEquip}
                    onUnequip={handleUnequip}
                    publishError={publishError}
                    isPublishing={equipmentMutation.isPending}
                  />
                </TabsContent>

              </div>
            </Tabs>
          </div>
      </div>

      <StageBackgroundPicker
        open={backgroundPickerOpen}
        onOpenChange={setBackgroundPickerOpen}
      />
    </BlobbiModal>
  );
}
