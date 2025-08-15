import React, { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { X, Heart, Zap, Sparkles, Shield, Star } from 'lucide-react';
import { CurrentBlobbiDisplay } from './CurrentBlobbiDisplay';
import { useCurrentPet } from '@/hooks/useOptimizedStatus';
import { useOwnerProfile } from '@/hooks/useOptimizedStatus';
import { analyzeCareStatus } from '@/lib/blobbi-parsers';
import type { CareUrgency } from '@/lib/blobbi-types';
import { cn } from '@/lib/utils';

interface BlobbiInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
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

export function BlobbiInfoModal({ isOpen, onClose }: BlobbiInfoModalProps) {
  const currentPet = useCurrentPet();
  const ownerProfile = useOwnerProfile();

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
        <div className="w-[90%] max-w-md p-4 rounded-2xl blobbi-card-xl blobbi-gradient-container">
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
      <div className="w-[95%] max-w-2xl max-h-[90vh] p-0 blobbi-card-xl overflow-hidden flex flex-col theme-transition relative">
        <div className="p-4 border-b border-purple-200/60 dark:border-purple-800/60">
          <h2 className="text-xl font-bold text-center text-gray-800 dark:text-gray-200">
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

        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Blobbi Display */}
            <div className="text-center space-y-3">
              <div className="flex justify-center">
                <div className="blobbi-gradient-frame p-2">
                  <CurrentBlobbiDisplay
                    size="lg"
                    showFallback={true}
                    isSleeping={currentPet.isSleeping}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <h2 className="text-2xl font-bold blobbi-text">
                  {currentPet.name || currentPet.id}
                </h2>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <Badge className="blobbi-badge-purple-soft text-xs">
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
              <div className="p-3 grid grid-cols-2 gap-3">
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

        <div className="p-4 border-t border-purple-200/60 dark:border-purple-800/60 flex justify-end">
          <Button variant="outline" onClick={onClose} className="blobbi-button border-purple-200 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/20">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}