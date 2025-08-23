import React, { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';

import { X, Heart, Zap, Sparkles, Shield, Star, Droplets, Package } from 'lucide-react';
import { CurrentBlobbiPreview } from './CurrentBlobbiPreview';
import { BackgroundLayer } from './BackgroundLayer';
import { useCurrentPet } from '@/hooks/useOptimizedStatus';
import { useOwnerProfile } from '@/hooks/useOptimizedStatus';
import { analyzeCareStatus } from '@/lib/blobbi-parsers';
import { getBlobbiBackground } from '@/lib/blobbi-backgrounds';
import type { CareUrgency } from '@/lib/blobbi-types';
import { cn } from '@/lib/utils';

interface BlobbiInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  backgroundKey?: string;
  defaultTab?: 'primary' | 'inventory';
}

interface AccessoryItem {
  id: string;
  name: string;
  iconSrc: string;
  equipped?: boolean;
  rarity?: string;
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

export function BlobbiInfoModal({ isOpen, onClose, backgroundKey = 'blobbi-bg-default', defaultTab = 'primary' }: BlobbiInfoModalProps) {
  const currentPet = useCurrentPet();
  const ownerProfile = useOwnerProfile();
  const backgroundSrc = getBlobbiBackground(backgroundKey);
  const [selectedTab, setSelectedTab] = useState<'primary' | 'inventory'>(defaultTab);
  const [modalMinHeight, setModalMinHeight] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const [primaryTabHeight, setPrimaryTabHeight] = useState<number | null>(null);
  const primaryContentRef = useRef<HTMLDivElement>(null);

  // Mock accessories data - to be replaced with real data later
  const accessories: AccessoryItem[] = [
    // Uncomment below to test the inventory grid layout:
    // { id: '1', name: 'Party Hat', iconSrc: '/accessories/party-hat.png', rarity: 'Rare', equipped: true },
    // { id: '2', name: 'Sunglasses', iconSrc: '/accessories/sunglasses.png', rarity: 'Common' },
    // { id: '3', name: 'Bow Tie', iconSrc: '/accessories/bow-tie.png', rarity: 'Uncommon' },
    // { id: '4', name: 'Crown', iconSrc: '/accessories/crown.png', rarity: 'Legendary' },
    // { id: '5', name: 'Scarf', iconSrc: '/accessories/scarf.png', rarity: 'Common' },
    // { id: '6', name: 'Earrings', iconSrc: '/accessories/earrings.png', rarity: 'Rare' },
    // { id: '7', name: 'Necklace', iconSrc: '/accessories/necklace.png', rarity: 'Epic' },
    // { id: '8', name: 'Badge', iconSrc: '/accessories/badge.png', rarity: 'Common' },
    // { id: '9', name: 'Tie', iconSrc: '/accessories/tie.png', rarity: 'Uncommon' },
    // Add more items to test scrolling:
    // { id: '10', name: 'Glasses', iconSrc: '/accessories/glasses.png', rarity: 'Rare' },
    // { id: '11', name: 'Bandana', iconSrc: '/accessories/bandana.png', rarity: 'Common' },
    // { id: '12', name: 'Medal', iconSrc: '/accessories/medal.png', rarity: 'Legendary' },
  ];

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

  if (!currentPet) {
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

  const careStatus = analyzeCareStatus(currentPet);

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className="w-[85%] max-h-[85%] p-0 blobbi-card-xl overflow-hidden flex flex-col theme-transition relative shadow-2xl"
        style={modalMinHeight ? { minHeight: modalMinHeight, height: modalMinHeight } : undefined}
      >
        <div className="p-3 border-b border-purple-200/60 dark:border-purple-800/60 flex-shrink-0">
          <h2 className="text-lg font-bold text-center text-gray-800 dark:text-gray-200">
            Blobbi Info
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="absolute top-2 right-2 h-8 w-8 rounded-full"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0 p-5">
          {/* Stage - Left side with background and static Blobbi */}
          <div className="flex flex-col lg:w-2/5 flex-shrink-0">
            {/* Stage Container - This is line 127 equivalent, keeping exact dimensions */}
            <div className="relative aspect-square w-full max-w-sm mx-auto overflow-hidden rounded-lg border border-purple-200/60 dark:border-purple-800/60 h-full">
              {/* Background Layer - z-0 */}
              <div className="absolute inset-0 z-0" aria-hidden="true">
                <BackgroundLayer
                  src={backgroundSrc}
                  alt="Blobbi background"
                  fit="cover"
                  fallback={
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-100 to-blue-100 dark:from-purple-900 dark:to-blue-900" />
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
                  size="3xl"
                  showFallback={true}
                  isSleeping={currentPet.isSleeping}
                  isStaticPreview={true}
                  className="transform-gpu"
                />
              </div>
            </div>
          </div>

          {/* Sidebar - Right side with tabbed interface */}
          <div className="lg:w-3/5 flex-1 min-h-0 flex flex-col">
            <Tabs value={selectedTab} onValueChange={(value) => setSelectedTab(value as 'primary' | 'inventory')} className="flex flex-col h-full">
              {/* Tabs Header - sticky at top */}
              <div className="sticky top-0 backdrop-blur-sm z-20 rounded-xl border-purple-200/60 dark:border-purple-800/60">
                <TabsList className="grid w-full grid-cols-2 bg-purple-100/60 dark:bg-purple-900/60">
                  <TabsTrigger
                    value="primary"
                    className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800 data-[state=active]:text-purple-700 dark:data-[state=active]:text-purple-300"
                  >
                    <Heart className="h-4 w-4 mr-2" />
                    Primary
                  </TabsTrigger>
                  <TabsTrigger
                    value="inventory"
                    className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800 data-[state=active]:text-purple-700 dark:data-[state=active]:text-purple-300"
                  >
                    <Package className="h-4 w-4 mr-2" />
                    Inventory
                  </TabsTrigger>
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
                        {currentPet.name || currentPet.id}
                      </h2>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="blobbi-badge text-xs">
                          {currentPet.stage} • Gen {currentPet.generation}
                        </Badge>
                        <Badge className="blobbi-badge" variant={getUrgencyVariant(careStatus.urgency)}>
                          {careStatus.condition}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Coins Display */}
                  <div className="blobbi-card rounded-lg p-2">
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-lg">🪙</span>
                      <span className="text-sm font-bold text-purple-700 dark:text-purple-300">
                        {ownerProfile?.coins || 0} Coins
                      </span>
                    </div>
                  </div>

                  {/* Urgent Care Alert */}
                  {careStatus.urgentNeed && careStatus.urgency !== 'none' && (
                    <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-700 dark:text-red-300">
                      <div className="flex items-center gap-2">
                        <span className="text-base">⚠️</span>
                        <span className="font-medium">Urgent:</span>
                        <span>Your Blobbi needs {careStatus.urgentNeed}!</span>
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
                        value={currentPet.hunger}
                        icon={Heart}
                      />
                      <StatDisplay
                        label="Energy"
                        value={currentPet.energy}
                        icon={Zap}
                      />
                      <StatDisplay
                        label="Happiness"
                        value={currentPet.happiness}
                        icon={Sparkles}
                      />
                      <StatDisplay
                        label="Health"
                        value={currentPet.health}
                        icon={Shield}
                      />
                      <StatDisplay
                        label="Hygiene"
                        value={currentPet.hygiene}
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
                        <Badge className="blobbi-badge" variant={getUrgencyVariant(careStatus.urgency)}>
                          {careStatus.condition}
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
                          {currentPet.experience} XP
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">Care Streak</span>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">
                            {currentPet.careStreak} days
                          </span>
                          <Star className="h-3 w-3 text-yellow-500" />
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">Generation</span>
                        <span className="text-xs text-muted-foreground">
                          Gen {currentPet.generation}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Special Traits */}
                  {(currentPet.personality || currentPet.trait || currentPet.mood) && (
                    <div className="blobbi-card rounded-lg">
                      <div className="p-2 border-b border-purple-200/60 dark:border-purple-800/60">
                        <h3 className="text-sm font-bold text-center text-purple-700 dark:text-purple-300">
                          Personality
                        </h3>
                      </div>
                      <div className="p-3 space-y-2">
                        {currentPet.personality && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs">🎭</span>
                            <span className="text-xs font-medium">Personality:</span>
                            <span className="text-xs text-muted-foreground">
                              {Array.isArray(currentPet.personality)
                                ? currentPet.personality.join(', ')
                                : currentPet.personality}
                            </span>
                          </div>
                        )}
                        {currentPet.trait && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs">✨</span>
                            <span className="text-xs font-medium">Trait:</span>
                            <span className="text-xs text-muted-foreground">
                              {Array.isArray(currentPet.trait)
                                ? currentPet.trait.join(', ')
                                : currentPet.trait}
                            </span>
                          </div>
                        )}
                        {currentPet.mood && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs">😊</span>
                            <span className="text-xs font-medium">Mood:</span>
                            <span className="text-xs text-muted-foreground">
                              {currentPet.mood}
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
                  {accessories.length === 0 ? (
                    // Empty State
                    <Card className="border-dashed border-purple-200/60 dark:border-purple-800/60">
                      <CardContent className="py-12 px-8 text-center">
                        <div className="max-w-sm mx-auto space-y-4">
                          <Package className="h-12 w-12 mx-auto text-purple-300 dark:text-purple-600" />
                          <div className="space-y-2">
                            <h3 className="text-sm font-medium text-purple-700 dark:text-purple-300">
                              No accessories yet
                            </h3>
                            <p className="text-xs text-muted-foreground">
                              Earn or unlock items to fill your inventory.
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    // Inventory Grid
                    <div className="grid grid-cols-3 gap-3 content-start" style={{ contain: 'content' }}>
                      {accessories.map((accessory) => (
                        <Card
                          key={accessory.id}
                          className="group rounded-xl border bg-white/70 dark:bg-gray-800/70 backdrop-blur p-2 hover:shadow-md transition-shadow focus-within:ring-2 focus-within:ring-purple-500 focus-within:ring-offset-1"
                        >
                          <CardContent className="p-0">
                            {/* Thumbnail */}
                            <div className="relative w-full aspect-[1/1] overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800 mb-2">
                              <img
                                src={accessory.iconSrc}
                                alt={accessory.name}
                                className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                decoding="async"
                                fetchPriority="low"
                                width="100"
                                height="100"
                              />
                              {accessory.equipped && (
                                <div className="absolute top-1 right-1">
                                  <Badge variant="secondary" className="text-xs px-1 py-0">
                                    ✓
                                  </Badge>
                                </div>
                              )}
                            </div>

                            {/* Item Details */}
                            <div className="space-y-1">
                              <h4 className="line-clamp-1 text-xs font-medium text-neutral-800 dark:text-neutral-200">
                                {accessory.name}
                              </h4>
                              {accessory.rarity && (
                                <Badge variant="outline" className="text-xs px-1 py-0">
                                  {accessory.rarity}
                                </Badge>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                  </div>
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
    </div>
  );
}