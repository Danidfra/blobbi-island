import React, { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { X, Heart, Zap, Droplets, Sparkles, Shield, Star } from 'lucide-react';
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

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!currentPet) {
    return (
      <div 
        className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={handleBackdropClick}
      >
        <div className="max-w-md w-full p-4 rounded-2xl blobbi-card-xl blobbi-gradient-container">
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
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
    >
      <div className="max-w-2xl w-full h-full max-h-[90vh] p-0 blobbi-card-xl overflow-hidden flex flex-col theme-transition relative">
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
          <div className="flex flex-col lg:flex-row min-h-full">
            {/* Left Section - Accessories Panel */}
            <div className="w-full lg:w-2/5 bg-white/20 dark:bg-gray-800/20 backdrop-blur-sm border-b lg:border-b-0 lg:border-r border-purple-200/60 dark:border-purple-800/60 p-3">
              <div className="h-full bg-white/50 dark:bg-gray-900/30 border border-purple-200/80 dark:border-purple-700/80 rounded-lg shadow-sm flex flex-col">
                <div className="p-2 border-b border-purple-200/60 dark:border-purple-800/60">
                  <h3 className="text-sm font-bold text-center text-purple-700 dark:text-purple-300">
                    🎒 Accessories
                  </h3>
                </div>
                <div className="flex-1 flex items-center justify-center p-3">
                  <div className="text-center space-y-2">
                    <div className="text-4xl opacity-50">👜</div>
                    <p className="text-xs blobbi-text-muted font-medium">Coming Soon</p>
                    <p className="text-xs blobbi-text-muted">
                      Customize your Blobbi!
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Section - Blobbi Info */}
            <div className="w-full lg:w-3/5 p-4 space-y-4">
              {/* Blobbi Header */}
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
                    📊 Status
                  </h3>
                </div>
                <div className="p-3 space-y-3">
                  {/* Primary Stats */}
                  <div className="grid grid-cols-2 gap-3">
                    <StatDisplay label="Hunger" value={currentPet.hunger} icon={Heart} />
                    <StatDisplay label="Happiness" value={currentPet.happiness} icon={Sparkles} />
                    <StatDisplay label="Health" value={currentPet.health} icon={Shield} />
                    <StatDisplay label="Hygiene" value={currentPet.hygiene} icon={Droplets} />
                    <StatDisplay label="Energy" value={currentPet.energy} icon={Zap} />
                    <StatDisplay label="Experience" value={currentPet.experience} max={1000} icon={Star} />
                  </div>

                  <Separator className="bg-purple-200/60 dark:bg-purple-800/60" />

                  {/* Additional Info */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="blobbi-text-muted">Care Streak:</span>
                      <span className="blobbi-text font-medium">{currentPet.careStreak} days</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="blobbi-text-muted">Sleep:</span>
                      <span className="blobbi-text font-medium capitalize">{careStatus.sleepState}</span>
                    </div>
                    {currentPet.mood && (
                      <div className="flex justify-between">
                        <span className="blobbi-text-muted">Mood:</span>
                        <span className="blobbi-text font-medium capitalize">{currentPet.mood}</span>
                      </div>
                    )}
                    {currentPet.personality && (
                      <div className="flex justify-between">
                        <span className="blobbi-text-muted">Type:</span>
                        <span className="blobbi-text font-medium capitalize">{currentPet.personality}</span>
                      </div>
                    )}
                    {currentPet.favoriteFood && (
                      <div className="flex justify-between">
                        <span className="blobbi-text-muted">Food:</span>
                        <span className="blobbi-text font-medium">{currentPet.favoriteFood}</span>
                      </div>
                    )}
                    {careStatus.nextCareIn && (
                      <div className="flex justify-between">
                        <span className="blobbi-text-muted">Next Care:</span>
                        <span className="blobbi-text font-medium">{Math.round(careStatus.nextCareIn)}m</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}