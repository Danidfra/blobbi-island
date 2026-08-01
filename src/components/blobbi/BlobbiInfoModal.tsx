import React, { useEffect, useState, useRef } from 'react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';


import { X, Heart, Zap, Sparkles, Shield, Star, Droplets, Package, Wand2 } from 'lucide-react';
import { CurrentBlobbiPreview } from './CurrentBlobbiPreview';
import { BackgroundLayer } from './BackgroundLayer';
import { EquipmentPanel } from './EquipmentPanel';
import { EffectsPanel } from './EffectsPanel';
import { PlacementOverlay } from './PlacementOverlay';
import { useEquipmentMutation, type PlacementTransformPatch } from '@/placement/useEquipmentMutation';
import { useCharacterEquipmentContext } from '@/hooks/useCharacterEquipmentContext';
import { buildEquipEntry } from '@/placement/render-model';
import { isEffectPlacementSlot, type PlacementSlot } from '@/placement/policy';
import type { AccessorySlot, BlobbiVisualEffect } from '@blobbi/react';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import { useCurrentPet } from '@/hooks/useOptimizedStatus';
import { useOwnerProfile } from '@/hooks/useOptimizedStatus';
import { analyzeCareStatus } from '@/lib/blobbi-parsers';
import { getBlobbiBackground } from '@/lib/blobbi-backgrounds';
import { dbg } from '@/lib/debug';
import type { CareUrgency } from '@/lib/blobbi-types';
import { cn } from '@/lib/utils';
import { getBlobbiDisplayName } from '@/lib/blobbi-legacy';
import type { BlobbiVisual } from '@/lib/multiplayer';

interface BlobbiInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  backgroundKey?: string;
  defaultTab?: 'primary' | 'inventory';
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
  backgroundKey = 'blobbi-bg-default',
  defaultTab = 'primary',
  readOnly = false,
  previewKey = 'self',
  externalBlobbiData,
  externalVisual
}: BlobbiInfoModalProps) {
  const currentPet = useCurrentPet();
  const ownerProfile = useOwnerProfile();

  // Use external data if in read-only mode, otherwise use current pet data
  const blobbiData = readOnly && externalBlobbiData ? externalBlobbiData : currentPet;
  const backgroundSrc = getBlobbiBackground(backgroundKey);
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


  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && isOpen) {
      onClose();
    }
  };

  if (!isOpen) return null;

  if (!blobbiData) {
    return (
      <div
        className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={handleBackdropClick}
      >
        <div className="w-[85%] max-w-md p-4 rounded-2xl blobbi-card-xl blobbi-gradient-container">
          <div className="text-center p-4">
            <p className="blobbi-text-muted">No Blobbi selected</p>
            <Button onClick={onClose} className="mt-3 blobbi-button" size="sm">
              Close
            </Button>
          </div>
        </div>
      </div>
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
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
      onPointerDown={(e) => e.stopPropagation()}
      data-overlay
      data-block-move
    >
      <div
        ref={modalRef}
        className="w-[85%] max-h-[85%] p-0 blobbi-card-xl overflow-hidden flex flex-col theme-transition relative shadow-2xl"
        role="dialog"
        aria-modal="true"
        data-block-move
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b border-purple-200/60 dark:border-purple-800/60 flex-shrink-0">
          <h2 className="text-lg font-bold text-center text-gray-800 dark:text-gray-200">
            {readOnly ? `Blobbi Info – ${blobbiData.name}` : 'Blobbi Info'}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute top-2 right-2 h-8 w-8 rounded-full"
            data-block-move
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-row gap-4 lg:gap-6 flex-1 min-h-0 p-3 lg:p-5">
          {/* Stage - Left side with background and static Blobbi */}
          <div className="flex flex-col w-1/3 lg:w-2/5 flex-shrink-0 min-h-0">
            {/* Stage Container - constrained to available height on mobile landscape */}
            <div
              className="relative aspect-square w-full max-h-full mx-auto overflow-hidden rounded-lg border border-purple-200/60 dark:border-purple-800/60"
            >
              {/* Background Layer - z-0 */}
              <div className="absolute inset-0 z-0" aria-hidden="true">
                <BackgroundLayer
                  src={backgroundSrc}
                  alt="Blobbi background"
                  fit="cover"
                  fallback={
                    <div className="absolute inset-0 bg-gradient-to-br from-island-sky/40 to-island-sand/60" />
                  }
                />
              </div>

              {/* Optional: Subtle vignette for text contrast */}
              <div className="absolute inset-0 z-5 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
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
            </div>


          </div>

          {/* Sidebar - Right side with tabbed interface */}
          <div className="w-2/3 lg:w-3/5 flex-1 min-h-0 flex flex-col">
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
              <div className="sticky top-0 backdrop-blur-sm z-20 rounded-xl border-purple-200/60 dark:border-purple-800/60">
                <TabsList className={`grid ${readOnly ? 'grid-cols-1' : 'grid-cols-3'} bg-purple-100/60 dark:bg-purple-900/60`}>
                  <TabsTrigger
                    value="primary"
                    className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800 data-[state=active]:text-purple-700 dark:data-[state=active]:text-purple-300"
                  >
                    <Heart className="h-4 w-4 mr-2" />
                    Primary
                  </TabsTrigger>
                  {!readOnly && (
                    <TabsTrigger
                      value="inventory"
                      className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800 data-[state=active]:text-purple-700 dark:data-[state=active]:text-purple-300"
                    >
                      <Package className="h-4 w-4 mr-2" />
                      Inventory
                    </TabsTrigger>
                  )}
                  {!readOnly && (
                    <TabsTrigger
                      value="effects"
                      data-testid="effects-tab"
                      className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800 data-[state=active]:text-purple-700 dark:data-[state=active]:text-purple-300"
                    >
                      <Wand2 className="h-4 w-4 mr-2" />
                      Effects
                    </TabsTrigger>
                  )}
                </TabsList>
              </div>

              {/* Tab Content - scrollable panels */}
              <div className="flex-1 min-h-0 h-0 overflow-y-auto overflow-x-hidden pr-2 scrollbar-thin scrollbar-thumb-purple-300 dark:scrollbar-thumb-purple-700 scrollbar-track-transparent hover:scrollbar-thumb-purple-400 dark:hover:scrollbar-thumb-purple-600">
                {/* Primary Tab Content */}
                <TabsContent value="primary" className="mt-2 space-y-4 pb-2 focus-visible:outline-none">
                  {/* Basic Info */}
                  <div className="blobbi-card rounded-lg p-3">
                    <div className="space-y-1.5">
                      <h2 className="text-xl font-bold blobbi-text">
                        {readOnly ? blobbiData.name : (currentPet ? getBlobbiDisplayName(currentPet) : 'Blobbi')}
                      </h2>
                      <div className="flex items-center gap-2 flex-wrap">
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
                    <div className="blobbi-card rounded-lg p-2">
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-lg">🪙</span>
                        <span className="text-sm font-bold text-purple-700 dark:text-purple-300">
                          {ownerProfile?.coins || 0} Coins
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Urgent Care Alert */}
                  {careStatus?.urgentNeed && careStatus.urgency !== 'none' && (
                    <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-700 dark:text-red-300">
                      <div className="flex items-center gap-2">
                        <span className="text-base">⚠️</span>
                        <span className="font-medium">Urgent:</span>
                        <span>{readOnly ? `This Blobbi needs ${careStatus.urgentNeed}!` : `Your Blobbi needs ${careStatus.urgentNeed}!`}</span>
                      </div>
                    </div>
                  )}

                  {/* Stats Grid */}
                  <div className="blobbi-card rounded-lg">
                    <div className="p-2 border-b border-purple-200/60 dark:border-purple-800/60">
                      <h3 className="text-sm font-bold text-center text-purple-700 dark:text-purple-300">
                        Core Stats
                      </h3>
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
                  <div className="blobbi-card rounded-lg">
                    <div className="p-2 border-b border-purple-200/60 dark:border-purple-800/60">
                      <h3 className="text-sm font-bold text-center text-purple-700 dark:text-purple-300">
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
                  <div className="blobbi-card rounded-lg">
                    <div className="p-2 border-b border-purple-200/60 dark:border-purple-800/60">
                      <h3 className="text-sm font-bold text-center text-purple-700 dark:text-purple-300">
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
                          <Star className="h-3 w-3 text-yellow-500" />
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
                    <div className="blobbi-card rounded-lg">
                      <div className="p-2 border-b border-purple-200/60 dark:border-purple-800/60">
                        <h3 className="text-sm font-bold text-center text-purple-700 dark:text-purple-300">
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

                {/* Inventory Tab Content */}
                <TabsContent value="inventory" className="mt-2 pb-2 focus-visible:outline-none flex flex-col">
                  <div>
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
                  </div>

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
      </div>

    </div>
  );
}
