import React, { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';

import { X, Heart, Zap, Sparkles, Shield, Star, Droplets } from 'lucide-react';
import { StaticBlobbiDisplay } from './StaticBlobbiDisplay';
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

export function BlobbiInfoModal({ isOpen, onClose, backgroundKey = 'blobbi-bg-default' }: BlobbiInfoModalProps) {
  const currentPet = useCurrentPet();
  const ownerProfile = useOwnerProfile();
  const backgroundSrc = getBlobbiBackground(backgroundKey);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

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
      <div className="w-[85%] max-h-[85%] p-0 blobbi-card-xl overflow-hidden flex flex-col theme-transition relative shadow-2xl">
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

        <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0 pl-5 py-5">
          {/* Stage - Left side with background and static Blobbi */}
          <div className="flex flex-col lg:w-2/5 flex-shrink-0">
            {/* Stage Container - This is line 127 equivalent, keeping exact dimensions */}
            <div className="relative aspect-square w-full max-w-sm mx-auto overflow-hidden rounded-lg border border-purple-200/60 dark:border-purple-800/60 h-full">
              {/* Background Layer - z-0 */}
              <div className="absolute inset-0 z-0">
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
                <StaticBlobbiDisplay
                  size="3xl"
                  showFallback={true}
                  isSleeping={currentPet.isSleeping}
                  className="transform-gpu"
                />
              </div>
            </div>
          </div>

          {/* Sidebar - Right side with all informational content */}
          <div className="lg:w-3/5 flex-1 min-h-0 flex flex-col space-y-4">
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

            {/* Scrollable Content */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-2 scrollbar-thin scrollbar-thumb-purple-300 dark:scrollbar-thumb-purple-700 scrollbar-track-transparent hover:scrollbar-thumb-purple-400 dark:hover:scrollbar-thumb-purple-600">
              <div className="space-y-4 pb-2">
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
              </div>
            </div>
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