import React, { useEffect, useState, useRef } from 'react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';


import { X, Heart, Zap, Sparkles, Shield, Star, Droplets, Package } from 'lucide-react';
import { CurrentBlobbiPreview } from './CurrentBlobbiPreview';
import { BackgroundLayer } from './BackgroundLayer';
import { AccessoryInventoryUI } from './AccessoryInventoryUI';
import { DebugAccessoriesModal } from './DebugAccessoriesModal';
import { AccessoryOverlay } from './AccessoryOverlay';
import { useAccessoryManagement, ACCESSORY_QUERY_KEYS } from './hooks/useAccessoryManagement';
import { useToast } from '@/hooks/useToast';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostr } from '@/hooks/useNostr';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import type { EquipmentConfig } from './lib/accessory-types';
import { useCurrentPet } from '@/hooks/useOptimizedStatus';
import { useOwnerProfile } from '@/hooks/useOptimizedStatus';
import { analyzeCareStatus } from '@/lib/blobbi-parsers';
import { getBlobbiBackground } from '@/lib/blobbi-backgrounds';
import { dbg } from '@/lib/debug';
import { useDebugOverlays } from '@/contexts/DebugOverlaysContext';
import { updateEquipTags } from './lib/accessory-utils';
import type { CareUrgency } from '@/lib/blobbi-types';
import { cn } from '@/lib/utils';
import { getBlobbiDisplayName } from '@/lib/blobbi-legacy';
import { Settings } from 'lucide-react';
import type { BlobbiVisual } from '@/lib/multiplayer';
import { KIND_BLOBBI_STATE } from '@/lib/blobbi-kinds';

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
  const [isDebugModalOpen, setIsDebugModalOpen] = useState(false);
  const [modalMinHeight, setModalMinHeight] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const [primaryTabHeight, setPrimaryTabHeight] = useState<number | null>(null);
  const primaryContentRef = useRef<HTMLDivElement>(null);
  const [selectedAccessory, setSelectedAccessory] = useState<EquipmentConfig | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, Partial<EquipmentConfig>>>({});
  const [committedUpdates, setCommittedUpdates] = useState<Record<string, Partial<EquipmentConfig>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const { isUpdating, equipment } = useAccessoryManagement();
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { showDebugOverlays } = useDebugOverlays();
  const [selectedTab, setSelectedTab] = useState<'primary' | 'inventory'>(readOnly ? 'primary' : defaultTab);

  const handleAccessoryUpdate = (accessoryCode: string, updates: Partial<EquipmentConfig>) => {
    setPendingUpdates(prev => ({
      ...prev,
      [accessoryCode]: { ...prev[accessoryCode], ...updates }
    }));
  };

  const handleSaveChanges = async () => {
    const accessoryCodes = Object.keys(pendingUpdates);
    if (accessoryCodes.length === 0) return;

    if (!user?.pubkey || !currentPet?.id) {
      toast({
        title: "Save Failed",
        description: "User not logged in or no pet selected.",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      // Get current pet event
      const signal = AbortSignal.timeout(5000);
      const petEvents = await nostr.query([{
        kinds: [KIND_BLOBBI_STATE],
        authors: [user.pubkey],
        '#d': [currentPet.id],
        limit: 1,
      }], { signal });

      if (petEvents.length === 0) {
        throw new Error('Pet not found');
      }

      const petEvent = petEvents.sort((a, b) => b.created_at - a.created_at)[0];
      const currentEquipment = equipment || [];

      // Create updated equipment list with all pending updates applied
      const updatedEquipment = currentEquipment.map(accessory => {
        const updates = pendingUpdates[accessory.code];
        if (!updates) return accessory;

        return {
          ...accessory,
          x: updates.x ?? accessory.x,
          y: updates.y ?? accessory.y,
          scale: updates.scale ?? accessory.scale,
          rot: updates.rot ?? accessory.rot,
          flipX: updates.flipX ?? accessory.flipX,
        };
      });

      // Create new equipment event with all updated equipment
      const equipmentTags = updateEquipTags(petEvent.tags, updatedEquipment);

      // Publish the event
      await createEvent({
        kind: KIND_BLOBBI_STATE,
        content: petEvent.content,
        tags: equipmentTags,
      });

      // Move pending updates to committed updates - these are now the user's saved positions
      setCommittedUpdates(prev => ({ ...prev, ...pendingUpdates }));
      setPendingUpdates({});

      // Invalidate query in background to sync with relay (but don't await it)
      queryClient.invalidateQueries({
        queryKey: ACCESSORY_QUERY_KEYS.equipment(currentPet.id)
      });

      toast({
        title: "Accessories Updated",
        description: `${accessoryCodes.length} accessory positions saved successfully.`,
      });
    } catch (error) {
      console.error('Failed to save accessory changes:', error);
      toast({
        title: "Save Failed",
        description: error instanceof Error ? error.message : "Failed to save accessory changes.",
        variant: "destructive",
      });
      // On error, keep the pending updates so user doesn't lose their changes
    } finally {
      setIsSaving(false);
    }
  };

  const handleScaleChange = (value: number[]) => {
    if (!selectedAccessory) return;
    handleAccessoryUpdate(selectedAccessory.code, { scale: value[0] });
  };

  const handleRotationChange = (value: number[]) => {
    if (!selectedAccessory) return;
    handleAccessoryUpdate(selectedAccessory.code, { rot: value[0] });
  };

  const currentAccessory = selectedAccessory ? {
    ...selectedAccessory,
    ...committedUpdates[selectedAccessory.code],
    ...pendingUpdates[selectedAccessory.code]
  } : null;

  const hasUnsavedChanges = Object.keys(pendingUpdates).length > 0;

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

  // Clean up committed updates when query data matches them
  useEffect(() => {
    if (!equipment || Object.keys(committedUpdates).length === 0) return;

    const updatesToClear: string[] = [];

    for (const [accessoryCode, updates] of Object.entries(committedUpdates)) {
      const queryAccessory = equipment.find(eq => eq.code === accessoryCode);
      if (!queryAccessory) continue;

      // Check if query data matches our committed updates (within small tolerance)
      const matches = (
        (updates.x === undefined || Math.abs(queryAccessory.x - updates.x) < 0.1) &&
        (updates.y === undefined || Math.abs(queryAccessory.y - updates.y) < 0.1) &&
        (updates.scale === undefined || Math.abs(queryAccessory.scale - updates.scale) < 0.01) &&
        (updates.rot === undefined || Math.abs(queryAccessory.rot - updates.rot) < 0.1) &&
        (updates.flipX === undefined || queryAccessory.flipX === updates.flipX)
      );

      if (matches) {
        updatesToClear.push(accessoryCode);
      }
    }

    // Clear committed updates that now match the query data
    if (updatesToClear.length > 0) {
      setCommittedUpdates(prev => {
        const updated = { ...prev };
        updatesToClear.forEach(code => delete updated[code]);
        return updated;
      });
    }
  }, [equipment, committedUpdates]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Capture primary tab content height to set as minimum for modal
  useEffect(() => {
    if (primaryContentRef.current && selectedTab === 'primary' && !primaryTabHeight) {
      const height = primaryContentRef.current.offsetHeight;
      setPrimaryTabHeight(height);
      // Set modal minimum height based on primary tab content + padding and other elements
      if (modalRef.current) {
        const modalHeight = modalRef.current.offsetHeight;
        setModalMinHeight(`${modalHeight}px`);
      }
    }
  }, [selectedTab, primaryTabHeight]);

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
        className="w-[85%] !h-[85%] p-0 blobbi-card-xl overflow-hidden flex flex-col theme-transition relative shadow-2xl"
        style={modalMinHeight ? { minHeight: modalMinHeight, height: modalMinHeight } : undefined}
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

        <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0 p-5">
          {/* Stage - Left side with background and static Blobbi */}
          <div className="flex flex-col lg:w-2/5 flex-shrink-0">
            {/* Stage Container - This is line 127 equivalent, keeping exact dimensions */}
            <div
              ref={stageRef}
              className="relative aspect-square w-full max-w-sm mx-auto overflow-hidden rounded-lg border border-purple-200/60 dark:border-purple-800/60 h-full"
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

              {/* Static Blobbi - z-10, centered */}
              <div className="absolute w-full h-full z-10 flex justify-center items-end bottom-10 p-1">
                <CurrentBlobbiPreview
                  key={`preview:${previewKey}`}
                  size="3xl"
                  showFallback={true}
                  isSleeping={blobbiData.isSleeping}
                  isStaticPreview={true}
                  showAccessories={false}
                  className="transform-gpu"
                  visualOverride={readOnly ? externalVisual : undefined}
                  idSuffix={`preview:${previewKey}`}
                />
              </div>

              {/* Single Accessory Overlay - works for both static and draggable modes */}
              {!readOnly && (
                <AccessoryOverlay
                  className="z-20"  // Ensure accessories are on top
                  containerRef={stageRef}
                  selectedAccessory={selectedTab === 'inventory' ? selectedAccessory : undefined}
                  onAccessorySelect={selectedTab === 'inventory' ? setSelectedAccessory : undefined}
                  onAccessoryUpdate={selectedTab === 'inventory' ? handleAccessoryUpdate : undefined}
                  isStatic={selectedTab === 'primary'}
                  sizeMultiplier={2.2} // Match the "3xl" size multiplier from CurrentBlobbiPreview
                  pendingUpdates={{ ...committedUpdates, ...pendingUpdates }} // Merge committed and pending updates
                />
              )}
            </div>


          </div>

          {/* Sidebar - Right side with tabbed interface */}
          <div className="lg:w-3/5 flex-1 min-h-0 flex flex-col">
            <Tabs value={selectedTab} onValueChange={(value) => setSelectedTab(value as 'primary' | 'inventory')} className="flex flex-col h-full">
              {/* Tabs Header - sticky at top */}
              <div className="sticky top-0 backdrop-blur-sm z-20 rounded-xl border-purple-200/60 dark:border-purple-800/60">
                <TabsList className={`grid ${readOnly ? 'grid-cols-1' : 'grid-cols-2'} bg-purple-100/60 dark:bg-purple-900/60`}>
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
                </TabsList>
              </div>

              {/* Tab Content - scrollable panels */}
              <div className="flex-1 min-h-0 relative overflow-y-auto overflow-x-hidden pr-2 scrollbar-thin scrollbar-thumb-purple-300 dark:scrollbar-thumb-purple-700 scrollbar-track-transparent hover:scrollbar-thumb-purple-400 dark:hover:scrollbar-thumb-purple-600">
                {/* Primary Tab Content */}
                <TabsContent value="primary" className="mt-4 space-y-4 pb-2 focus-visible:outline-none" ref={primaryContentRef}>
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
                <TabsContent value="inventory" className="mt-4 pb-2 focus-visible:outline-none h-full flex flex-col">
                  <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-2 scrollbar-thin scrollbar-thumb-purple-300 dark:scrollbar-thumb-purple-700 scrollbar-track-transparent hover:scrollbar-thumb-purple-400 dark:hover:scrollbar-thumb-purple-600">
                    <AccessoryInventoryUI
                      onEquippedAccessoryClick={setSelectedAccessory}
                      selectedAccessory={selectedAccessory}
                      currentAccessory={currentAccessory}
                      hasUnsavedChanges={hasUnsavedChanges}
                      onScaleChange={handleScaleChange}
                      onRotationChange={handleRotationChange}
                      onSaveChanges={handleSaveChanges}
                      isUpdating={isSaving || isUpdating}
                    />
                  </div>

                  {/* Debug button (developer overlays toggle) */}
                  {showDebugOverlays && (
                    <div className="pt-4 border-t border-purple-200/60 dark:border-purple-800/60">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsDebugModalOpen(true)}
                        className="w-full"
                      >
                        <Settings className="h-3 w-3 mr-2" />
                        Debug Accessories
                      </Button>
                    </div>
                  )}
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>

        <div className="p-3 border-t border-purple-200/60 dark:border-purple-800/60 flex flex-col sm:flex-row justify-between items-center gap-2 flex-shrink-0">
          <Button variant="outline" onClick={onClose} className="blobbi-button border-purple-200 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/20">
            Close
          </Button>
        </div>
      </div>

      {/* Debug Accessories Modal (development only) */}
      <DebugAccessoriesModal
        isOpen={isDebugModalOpen}
        onClose={() => setIsDebugModalOpen(false)}
      />
    </div>
  );
}
