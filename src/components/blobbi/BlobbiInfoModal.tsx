import React, { useEffect, useState, useRef } from 'react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';


import { Heart, Zap, Sparkles, Shield, Star, Droplets, Package, Wand2, PawPrint, Image as ImageIcon, Shirt } from 'lucide-react';
import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { StateCard } from '@/components/ui/state-card';
import { CurrentBlobbiPreview } from './CurrentBlobbiPreview';
import { BlobbiStageBackdrop } from './BlobbiStageBackdrop';
import { StageBackgroundPicker } from './StageBackgroundPicker';
import { EquipmentPanel } from './EquipmentPanel';
import { EffectsPanel } from './EffectsPanel';
import { InventoryPanel } from './InventoryPanel';
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
import { useStageBackground } from '@/hooks/useStageBackground';
import { dbg } from '@/lib/debug';
import type { CareUrgency } from '@/lib/blobbi-types';
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
  'rounded-lg text-xs font-semibold text-island-ink-soft transition-colors ' +
  'data-[state=active]:bg-island-cream data-[state=active]:text-island-ink ' +
  'data-[state=active]:shadow-cozy-soft sm:text-sm';

const PANEL = 'rounded-xl border border-island-wood/20 bg-island-cream p-2 shadow-cozy-soft';

const SECTION_HEAD =
  'text-center text-[0.6875rem] font-bold uppercase tracking-wider text-island-ink-soft';

/**
 * A titled block inside a tab.
 *
 * The Inventory tab now holds two of these — what your Blobbi can WEAR and what
 * you are CARRYING — and without a shared heading treatment they read as two
 * unrelated widgets stacked by accident. The header carries an icon and an
 * optional count so a glance answers "how much is in here" before any
 * scrolling.
 */
function TabSection({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: React.ElementType;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2 px-0.5">
        <Icon aria-hidden className="size-3.5 shrink-0 translate-y-0.5 text-island-wood-dark" />
        <h3 className="text-[0.6875rem] font-bold uppercase tracking-wider text-island-ink-soft">
          {title}
        </h3>
        {hint ? (
          <span className="ml-auto truncate text-[0.6875rem] text-island-ink-soft/80">{hint}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}
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
  defaultTab?: 'primary' | 'inventory' | 'effects';
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



function getUrgencyVariant(urgency: CareUrgency): "default" | "destructive" | "outline" | "secondary" {
  switch (urgency) {
    case 'critical':
    case 'high':
      return 'destructive';
    case 'medium':
      return 'secondary';
    case 'low':
      return 'outline';
    case 'none':
    default:
      return 'default';
  }
}

function StatDisplay({
  label,
  value,
  max = 100,
  icon: Icon,
  className
}: {
  label: string;
  value: number;
  max?: number;
  icon: React.ElementType;
  className?: string;
}) {
  const percentage = Math.max(0, Math.min(100, (value / max) * 100));

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Icon className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-medium">{label}</span>
        </div>
        <span className="text-xs text-muted-foreground">{value}/{max}</span>
      </div>
      <Progress value={percentage} className="h-1.5" />
    </div>
  );
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
  const [selectedTab, setSelectedTab] = useState<'primary' | 'inventory' | 'effects'>(readOnly ? 'primary' : defaultTab);
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
      bodyClassName="flex min-h-0 flex-col gap-3 overflow-hidden p-3 sm:flex-row sm:gap-4 lg:gap-6 lg:p-5"
    >
      <div ref={modalRef} className="contents">
          {/* The stage: the backdrop, the Blobbi standing on it, and the one
              control that changes the scene. */}
          <div
            data-testid="blobbi-stage-column"
            className="flex min-h-0 shrink-0 items-center justify-center h-[32dvh] sm:h-auto sm:w-[36%] sm:flex-1 lg:w-2/5"
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
              className="relative h-full max-w-full overflow-hidden rounded-panel border border-island-wood/25 bg-island-cream-2 shadow-cozy-inset"
            >
              {/* Background Layer - z-0 */}
              <div className="absolute inset-0 z-0" aria-hidden="true">
                <BlobbiStageBackdrop background={background} />
              </div>

              {/* Optional: Subtle vignette for text contrast */}
              <div className="absolute inset-0 z-5 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-t from-island-ink/10 to-transparent" />
              </div>

              {/* Static Blobbi - z-10, centered horizontally, anchored to bottom */}
              <div className="absolute inset-0 z-10 flex justify-center items-end pb-[5%]">
                <div ref={stageRef} className="relative">
                  <CurrentBlobbiPreview
                    key={`preview:${previewKey}`}
                    size="xl"
                    showFallback={true}
                    isSleeping={blobbiData.isSleeping}
                    isStaticPreview={true}
                    showAccessories={selectedTab !== 'inventory'}
                    className="transform-gpu"
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
                  {!readOnly && selectedTab === 'inventory' && (
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

              {/*
                "Change background", anchored to the thing it changes.

                Hidden while the Inventory tab is open, because that is when the
                stage becomes a drag surface for accessory placement and a
                floating button in the corner would compete with the drag. Also
                hidden in read-only mode: this is somebody else's Blobbi and the
                scene is not the viewer's to change.
              */}
              {!readOnly && selectedTab !== 'inventory' && (
                <button
                  type="button"
                  data-testid="open-stage-background-picker"
                  onClick={() => setBackgroundPickerOpen(true)}
                  title={`Stage background: ${background.name}`}
                  className={cn(
                    'absolute bottom-2 right-2 z-30 inline-flex items-center gap-1.5 rounded-full',
                    'border border-island-wood/30 bg-island-cream/90 px-2.5 py-1.5 backdrop-blur-sm',
                    'text-[0.6875rem] font-semibold text-island-ink shadow-cozy-raised',
                    'transition-transform duration-150 ease-cozy hover:brightness-105 active:scale-95',
                    'motion-reduce:transition-none motion-reduce:active:scale-100',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  )}
                >
                  <ImageIcon aria-hidden className="size-3.5 text-island-wood-dark" />
                  <span className="sr-only sm:not-sr-only">Background</span>
                </button>
              )}
            </div>
          </div>

          {/* Sidebar - Right side with tabbed interface */}
          <div className="flex min-h-0 w-full flex-1 flex-col sm:w-[64%] lg:w-3/5">
            <Tabs
              value={selectedTab}
              onValueChange={(value) => {
                setSelectedTab(value as 'primary' | 'inventory' | 'effects');
                // Leaving the Effects tab ends any preview: the stage must
                // always show the persisted state unless the player is
                // actively previewing.
                if (value !== 'effects') setPreviewEffects(null);
              }}
              className="flex flex-col h-full"
            >
              {/* Tabs Header - sticky at top */}
              <div className="sticky top-0 z-20">
                <TabsList
                  className={cn(
                    'grid h-auto w-full gap-1 rounded-xl border border-island-wood/20 bg-island-cream-2 p-1',
                    readOnly ? 'grid-cols-1' : 'grid-cols-3',
                  )}
                >
                  <TabsTrigger
                    value="primary"
                    className={TAB_TRIGGER}
                  >
                    <Heart className="h-4 w-4 mr-2" />
                    Primary
                  </TabsTrigger>
                  {!readOnly && (
                    <TabsTrigger
                      value="inventory"
                      className={TAB_TRIGGER}
                    >
                      <Package className="h-4 w-4 mr-2" />
                      Inventory
                    </TabsTrigger>
                  )}
                  {!readOnly && (
                    <TabsTrigger
                      value="effects"
                      data-testid="effects-tab"
                      className={TAB_TRIGGER}
                    >
                      <Wand2 className="h-4 w-4 mr-2" />
                      Effects
                    </TabsTrigger>
                  )}
                </TabsList>
              </div>

              {/* Tab Content - scrollable panels */}
              <div className="min-h-0 h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1 scrollbar-thin scrollbar-track-transparent">
                {/* Primary Tab Content */}
                <TabsContent value="primary" className="mt-2 space-y-4 pb-2 focus-visible:outline-none">
                  {/* Basic Info */}
                  <div className={cn(PANEL, 'p-3')}>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="blobbi-badge text-xs">
                          {blobbiData.stage} • Gen {blobbiData.generation}
                        </Badge>
                        <Badge className="blobbi-badge" variant={getUrgencyVariant(careStatus?.urgency || 'none')}>
                          {careStatus?.condition || 'Unknown'}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Coins Display - Only show in non-read-only mode */}
                  {!readOnly && (
                    <div className={PANEL} data-coin-hud>
                      <div className="flex items-center justify-center gap-2 text-sm font-bold text-island-purple">
                        {economyEntry.phase === 'checking' ||
                        economyEntry.phase === 'applying' ||
                        coinBalance.isLoading ? (
                          <CoinAmount amount={null} loading className="text-sm" />
                        ) : economyEntry.phase === 'ambiguous' ? (
                          <span role="status" className="text-xs font-medium blobbi-text-muted">
                            Confirming your Coin balance…
                          </span>
                        ) : coinBalance.isError ? (
                          <button
                            type="button"
                            className="text-xs font-medium underline blobbi-text-muted"
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
                      </div>
                    </div>
                  )}

                  {/* Urgent Care Alert */}
                  {careStatus?.urgentNeed && careStatus.urgency !== 'none' && (
                    <div role="status" className="rounded-xl border border-island-danger/30 bg-island-danger/10 p-2.5 text-xs text-island-danger">
                      <div className="flex items-center gap-2">
                        <span className="text-base">⚠️</span>
                        <span className="font-medium">Urgent:</span>
                        <span>{readOnly ? `This Blobbi needs ${careStatus.urgentNeed}!` : `Your Blobbi needs ${careStatus.urgentNeed}!`}</span>
                      </div>
                    </div>
                  )}

                  {/* Stats Grid */}
                  <div className="rounded-xl border border-island-wood/20 bg-island-cream shadow-cozy-soft">
                    <div className="border-b border-island-wood/20 px-3 py-2">
                      <h3 className={SECTION_HEAD}>Core Stats</h3>
                    </div>
                    <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <StatDisplay
                        label="Hunger"
                        value={blobbiData.hunger}
                        icon={Heart}
                      />
                      <StatDisplay
                        label="Energy"
                        value={blobbiData.energy}
                        icon={Zap}
                      />
                      <StatDisplay
                        label="Happiness"
                        value={blobbiData.happiness}
                        icon={Sparkles}
                      />
                      <StatDisplay
                        label="Health"
                        value={blobbiData.health}
                        icon={Shield}
                      />
                      <StatDisplay
                        label="Hygiene"
                        value={blobbiData.hygiene}
                        icon={Droplets}
                        className="sm:col-span-2"
                      />
                    </div>
                  </div>

                  {/* Care Status */}
                  <div className="rounded-xl border border-island-wood/20 bg-island-cream shadow-cozy-soft">
                    <div className="p-2 border-b border-island-wood/20">
                      <h3 className="text-sm font-bold text-center text-island-purple">
                        Care Status
                      </h3>
                    </div>
                    <div className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">Condition</span>
                        <Badge className="blobbi-badge" variant={getUrgencyVariant(careStatus?.urgency || 'none')}>
                          {careStatus?.condition || 'Unknown'}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">Urgency</span>
                        <Badge className="blobbi-badge" variant={getUrgencyVariant(careStatus.urgency)}>
                          {careStatus.urgency}
                        </Badge>
                      </div>
                      {careStatus.urgentNeed && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-base">⚠️</span>
                          <span className="font-medium">Needs:</span>
                          <span>{careStatus.urgentNeed}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="rounded-xl border border-island-wood/20 bg-island-cream shadow-cozy-soft">
                    <div className="p-2 border-b border-island-wood/20">
                      <h3 className="text-sm font-bold text-center text-island-purple">
                        Progress
                      </h3>
                    </div>
                    <div className="p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">Experience</span>
                        <span className="text-xs text-muted-foreground">
                          {blobbiData.experience} XP
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">Care Streak</span>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">
                            {blobbiData.careStreak} days
                          </span>
                          <Star aria-hidden className="size-3 text-island-warn" />
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">Generation</span>
                        <span className="text-xs text-muted-foreground">
                          Gen {blobbiData.generation}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Special Traits */}
                  {(blobbiData.personality || blobbiData.trait || blobbiData.mood) && (
                    <div className="rounded-xl border border-island-wood/20 bg-island-cream shadow-cozy-soft">
                      <div className="p-2 border-b border-island-wood/20">
                        <h3 className="text-sm font-bold text-center text-island-purple">
                          Personality
                        </h3>
                      </div>
                      <div className="p-3 space-y-2">
                        {blobbiData.personality && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs">🎭</span>
                            <span className="text-xs font-medium">Personality:</span>
                            <span className="text-xs text-muted-foreground">
                              {Array.isArray(blobbiData.personality)
                                ? blobbiData.personality.join(', ')
                                : blobbiData.personality}
                            </span>
                          </div>
                        )}
                        {blobbiData.trait && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs">✨</span>
                            <span className="text-xs font-medium">Trait:</span>
                            <span className="text-xs text-muted-foreground">
                              {Array.isArray(blobbiData.trait)
                                ? blobbiData.trait.join(', ')
                                : blobbiData.trait}
                            </span>
                          </div>
                        )}
                        {blobbiData.mood && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs">😊</span>
                            <span className="text-xs font-medium">Mood:</span>
                            <span className="text-xs text-muted-foreground">
                              {blobbiData.mood}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/*
                  Inventory Tab — the CANONICAL inventory, and the whole of it.

                  Two sections, because a player owns two different kinds of
                  thing and they answer different questions: what this Blobbi can
                  WEAR (kind:31634 placement over owned cosmetics) and what you
                  are CARRYING (kind:31633 consumables and currency). Both used
                  to exist, in two different windows, both called inventory —
                  the wearables here, and the carried items behind a separate 🎒
                  button. Neither has lost anything; they are simply in the same
                  place now, and there is no second inventory UI to keep in sync.
                */}
                <TabsContent value="inventory" className="mt-2 flex flex-col gap-5 pb-2 focus-visible:outline-none">
                  <TabSection icon={Shirt} title="Wearables" hint="Tap to wear · drag on the stage to place">
                    <EquipmentPanel
                      characterId={characterId}
                      form={currentPet?.stage}
                      selectedSlot={selectedSlot}
                      onSelectSlot={setSelectedSlot}
                      pendingUpdates={pendingUpdates}
                      onTransformChange={handleTransformChange}
                      onSaveTransforms={handleSaveTransforms}
                      onEquip={handleEquip}
                      onUnequip={handleUnequip}
                      publishError={publishError}
                      isPublishing={equipmentMutation.isPending}
                    />
                  </TabSection>

                  <TabSection icon={Package} title="Items" hint="Tap to use on your Blobbi">
                    <InventoryPanel />
                  </TabSection>
                </TabsContent>

                {/* Effects Tab Content */}
                <TabsContent value="effects" className="mt-2 pb-2 focus-visible:outline-none">
                  <EffectsPanel
                    stage={currentPet?.stage}
                    onEquip={handleEquip}
                    onRemove={handleUnequip}
                    onPreview={setPreviewEffects}
                    previewingEffectId={
                      previewEffects && previewEffects.length > 0
                        ? previewEffects[0].id
                        : null
                    }
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
