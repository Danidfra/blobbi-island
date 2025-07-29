import React, { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

/** Get urgency color for badges */
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

/** Individual stat display with icon */
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

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  if (!currentPet) {
    return (
      <div
        className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={(e) => {
          // Close modal when clicking on backdrop
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
      >
        <div className="w-[90%] max-w-md bg-gradient-to-br from-blue-50 to-green-50 border-2 border-primary/20 rounded-xl p-4 shadow-xl">
          <div className="text-center">
            <p className="text-muted-foreground">No Blobbi selected</p>
            <Button onClick={onClose} className="mt-3" size="sm">
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
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-2"
      onClick={(e) => {
        // Close modal when clicking on backdrop
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-2xl h-full max-h-[90%] bg-gradient-to-br from-blue-50 to-green-50 border-2 border-primary/20 rounded-xl overflow-hidden shadow-xl relative">
        {/* Close Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="absolute top-2 right-2 z-10 h-8 w-8 rounded-full bg-white/80 hover:bg-white/90 backdrop-blur-sm"
        >
          <X className="h-3 w-3" />
        </Button>

        {/* Scrollable Content */}
        <div className="h-full overflow-y-auto">
          <div className="flex flex-col lg:flex-row min-h-full">
            {/* Left Section - Accessories Panel */}
            <div className="w-full lg:w-2/5 bg-white/60 backdrop-blur-sm border-b lg:border-b-0 lg:border-r border-primary/20 p-3">
              <Card className="h-full bg-white/80 border-primary/30 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold text-center text-primary">
                    🎒 Accessories
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 flex items-center justify-center p-3">
                  <div className="text-center space-y-2">
                    <div className="text-3xl opacity-50">👜</div>
                    <p className="text-xs text-muted-foreground font-medium">Coming Soon</p>
                    <p className="text-xs text-muted-foreground">
                      Customize your Blobbi!
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Section - Blobbi Info */}
            <div className="w-full lg:w-3/5 p-3 space-y-3">
              {/* Blobbi Header */}
              <div className="text-center space-y-2">
                <div className="flex justify-center">
                  <CurrentBlobbiDisplay
                    size="lg"
                    className="border-2 border-primary/30 shadow-lg"
                    showFallback={true}
                    isSleeping={currentPet.isSleeping}
                  />
                </div>

                <div className="space-y-1">
                  <h2 className="text-lg font-bold text-primary">
                    {currentPet.name || currentPet.id}
                  </h2>
                  <div className="flex items-center justify-center gap-1 flex-wrap">
                    <Badge variant="outline" className="bg-white/80 text-xs">
                      {currentPet.stage} • Gen {currentPet.generation}
                    </Badge>
                    <Badge variant={getUrgencyVariant(careStatus.urgency)} className="bg-white/80 text-xs">
                      {careStatus.condition}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Coins Display */}
              <div className="bg-white/80 rounded-lg p-2 border border-primary/20 shadow-sm">
                <div className="flex items-center justify-center gap-2">
                  <span className="text-lg">🪙</span>
                  <span className="text-sm font-bold text-primary">
                    {ownerProfile?.coins || 0} Coins
                  </span>
                </div>
              </div>

              {/* Urgent Care Alert */}
              {careStatus.urgentNeed && careStatus.urgency !== 'none' && (
                <div className="p-2 bg-destructive/10 border border-destructive/20 rounded-lg text-xs">
                  <div className="flex items-center gap-1">
                    <span className="text-sm">⚠️</span>
                    <span className="font-medium">Urgent:</span>
                    <span>Your Blobbi needs {careStatus.urgentNeed}!</span>
                  </div>
                </div>
              )}

              {/* Stats Grid */}
              <Card className="bg-white/80 border-primary/30 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold text-center text-primary">
                    📊 Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 p-3">
                  {/* Primary Stats */}
                  <div className="grid grid-cols-2 gap-2">
                    <StatDisplay
                      label="Hunger"
                      value={currentPet.hunger}
                      icon={Heart}
                      className="bg-red-50/50 p-2 rounded border border-red-200/50"
                    />
                    <StatDisplay
                      label="Happiness"
                      value={currentPet.happiness}
                      icon={Sparkles}
                      className="bg-yellow-50/50 p-2 rounded border border-yellow-200/50"
                    />
                    <StatDisplay
                      label="Health"
                      value={currentPet.health}
                      icon={Shield}
                      className="bg-green-50/50 p-2 rounded border border-green-200/50"
                    />
                    <StatDisplay
                      label="Hygiene"
                      value={currentPet.hygiene}
                      icon={Droplets}
                      className="bg-blue-50/50 p-2 rounded border border-blue-200/50"
                    />
                    <StatDisplay
                      label="Energy"
                      value={currentPet.energy}
                      icon={Zap}
                      className="bg-purple-50/50 p-2 rounded border border-purple-200/50"
                    />
                    <StatDisplay
                      label="Experience"
                      value={currentPet.experience}
                      max={1000}
                      icon={Star}
                      className="bg-orange-50/50 p-2 rounded border border-orange-200/50"
                    />
                  </div>

                  <Separator className="bg-primary/20" />

                  {/* Additional Info */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Care Streak:</span>
                        <span className="font-medium">{currentPet.careStreak} days</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Sleep:</span>
                        <span className="font-medium capitalize">{careStatus.sleepState}</span>
                      </div>
                      {currentPet.mood && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Mood:</span>
                          <span className="font-medium capitalize">{currentPet.mood}</span>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1">
                      {currentPet.personality && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Type:</span>
                          <span className="font-medium capitalize">{currentPet.personality}</span>
                        </div>
                      )}
                      {currentPet.favoriteFood && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Food:</span>
                          <span className="font-medium">{currentPet.favoriteFood}</span>
                        </div>
                      )}
                      {careStatus.nextCareIn && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Next Care:</span>
                          <span className="font-medium">{Math.round(careStatus.nextCareIn)}m</span>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}