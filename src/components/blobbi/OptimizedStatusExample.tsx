/**
 * Example component demonstrating the Optimized Status Layer
 *
 * This component shows how to use the new typed system and optimistic updates
 * for fast, reactive UI feedback.
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useOptimizedStatus,
  useFeedPet,
  useCleanPet,
  usePutPetToSleep,
  useWakePet
} from '@/hooks/useOptimizedStatus';
import { analyzeCareStatus } from '@/lib/blobbi-parsers';
import type { CareUrgency, PetCondition } from '@/lib/blobbi-types';

// ============================================================================
// Utility Components
// ============================================================================

/** Get color for urgency level */
function getUrgencyColor(urgency: CareUrgency): "default" | "destructive" | "outline" | "secondary" {
  switch (urgency) {
    case 'critical': return 'destructive';
    case 'high': return 'destructive';
    case 'medium': return 'secondary';
    case 'low': return 'outline';
    case 'none': return 'default';
  }
}

/** Get color for pet condition */
function getConditionColor(condition: PetCondition): "default" | "destructive" | "outline" | "secondary" {
  switch (condition) {
    case 'excellent': return 'default';
    case 'good': return 'secondary';
    case 'fair': return 'outline';
    case 'poor': return 'destructive';
    case 'critical': return 'destructive';
  }
}

/** Stat bar component */
function StatBar({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  const percentage = Math.max(0, Math.min(100, (value / max) * 100));

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value}/{max}</span>
      </div>
      <Progress value={percentage} className="h-2" />
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function OptimizedStatusExample() {
  const {
    status,
    setCurrentCompanion,
    refreshFromRelay
  } = useOptimizedStatus();

  const feedPet = useFeedPet();
  const cleanPet = useCleanPet();
  const putToSleep = usePutPetToSleep();
  const wakePet = useWakePet();

  // Show loading state
  if (status.isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show error state
  if (status.error) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-destructive mb-4">Error: {status.error}</p>
          <Button onClick={refreshFromRelay} variant="outline">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { owner, currentPet, allPets } = status;

  return (
    <div className="space-y-6">
      {/* Owner Profile Section */}
      <Card>
        <CardHeader>
          <CardTitle>Owner Profile</CardTitle>
        </CardHeader>
        <CardContent>
          {owner ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Name</p>
                  <p className="font-medium">{owner.name || 'Unnamed'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Coins</p>
                  <p className="font-medium">{owner.coins}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Petting Level</p>
                  <p className="font-medium">{owner.pettingLevel}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Lifetime Blobbis</p>
                  <p className="font-medium">{owner.lifetimeBlobbis}</p>
                </div>
              </div>

              {owner.achievements.length > 0 && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Achievements</p>
                  <div className="flex flex-wrap gap-1">
                    {owner.achievements.map((achievement, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {achievement}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {owner.inventory.length > 0 && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Inventory</p>
                  <div className="space-y-1">
                    {owner.inventory.map((item, index) => (
                      <div key={index} className="flex justify-between text-sm">
                        <span>{item.itemId}</span>
                        <span className="text-muted-foreground">×{item.quantity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">No owner profile found</p>
          )}
        </CardContent>
      </Card>

      {/* Current Pet Section */}
      <Card>
        <CardHeader>
          <CardTitle>Current Companion</CardTitle>
        </CardHeader>
        <CardContent>
          {currentPet ? (
            <CurrentPetDisplay
              pet={currentPet}
              onFeed={() => feedPet(currentPet.id)}
              onClean={() => cleanPet(currentPet.id)}
              onSleep={() => putToSleep(currentPet.id)}
              onWake={() => wakePet(currentPet.id)}
            />
          ) : (
            <p className="text-muted-foreground">No companion selected</p>
          )}
        </CardContent>
      </Card>

      {/* All Pets Section */}
      <Card>
        <CardHeader>
          <CardTitle>All Pets ({allPets.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {allPets.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {allPets.map(pet => (
                <PetCard
                  key={pet.id}
                  pet={pet}
                  isSelected={pet.id === currentPet?.id}
                  onSelect={() => setCurrentCompanion(pet.id)}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">No pets found</p>
          )}
        </CardContent>
      </Card>

      {/* Debug Section */}
      <Card>
        <CardHeader>
          <CardTitle>Debug Info</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <p><strong>Last Updated:</strong> {status.lastUpdated.toLocaleTimeString()}</p>
            <p><strong>Loading:</strong> {status.isLoading ? 'Yes' : 'No'}</p>
            <Button onClick={refreshFromRelay} variant="outline" size="sm">
              Refresh from Relay
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

interface CurrentPetDisplayProps {
  pet: NonNullable<ReturnType<typeof useOptimizedStatus>['status']['currentPet']>;
  onFeed: () => void;
  onClean: () => void;
  onSleep: () => void;
  onWake: () => void;
}

function CurrentPetDisplay({ pet, onFeed, onClean, onSleep, onWake }: CurrentPetDisplayProps) {
  const careStatus = analyzeCareStatus(pet);

  return (
    <div className="space-y-4">
      {/* Pet Info */}
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-semibold text-lg">{pet.name}</h3>
          <p className="text-sm text-muted-foreground">
            {pet.stage} • Generation {pet.generation}
          </p>
        </div>
        <div className="text-right space-y-1">
          <Badge variant={getConditionColor(careStatus.condition)}>
            {careStatus.condition}
          </Badge>
          {careStatus.urgentNeed && (
            <Badge variant={getUrgencyColor(careStatus.urgency)} className="block">
              Needs {careStatus.urgentNeed}
            </Badge>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="space-y-3">
        <StatBar label="Hunger" value={pet.hunger} />
        <StatBar label="Happiness" value={pet.happiness} />
        <StatBar label="Health" value={pet.health} />
        <StatBar label="Hygiene" value={pet.hygiene} />
        <StatBar label="Energy" value={pet.energy} />
      </div>

      {/* Care Actions */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onFeed} size="sm" variant="outline">
          Feed
        </Button>
        <Button onClick={onClean} size="sm" variant="outline">
          Clean
        </Button>
        {pet.isSleeping ? (
          <Button onClick={onWake} size="sm" variant="outline">
            Wake Up
          </Button>
        ) : (
          <Button onClick={onSleep} size="sm" variant="outline">
            Put to Sleep
          </Button>
        )}
      </div>

      {/* Additional Info */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground">Experience</p>
          <p className="font-medium">{pet.experience} XP</p>
        </div>
        <div>
          <p className="text-muted-foreground">Care Streak</p>
          <p className="font-medium">{pet.careStreak} days</p>
        </div>
        {pet.mood && (
          <div>
            <p className="text-muted-foreground">Mood</p>
            <p className="font-medium">{pet.mood}</p>
          </div>
        )}
        <div>
          <p className="text-muted-foreground">Sleep State</p>
          <p className="font-medium">{careStatus.sleepState}</p>
        </div>
      </div>
    </div>
  );
}

interface PetCardProps {
  pet: NonNullable<ReturnType<typeof useOptimizedStatus>['status']['allPets'][0]>;
  isSelected: boolean;
  onSelect: () => void;
}

function PetCard({ pet, isSelected, onSelect }: PetCardProps) {
  const careStatus = analyzeCareStatus(pet);

  return (
    <Card className={`cursor-pointer transition-colors ${isSelected ? 'ring-2 ring-primary' : ''}`} onClick={onSelect}>
      <CardContent className="p-4">
        <div className="space-y-2">
          <div className="flex justify-between items-start">
            <div>
              <h4 className="font-medium">{pet.name}</h4>
              <p className="text-xs text-muted-foreground">{pet.stage}</p>
            </div>
            <Badge variant={getConditionColor(careStatus.condition)} className="text-xs">
              {careStatus.condition}
            </Badge>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span>Health</span>
              <span>{pet.health}%</span>
            </div>
            <Progress value={pet.health} className="h-1" />
          </div>

          {careStatus.urgentNeed && (
            <Badge variant={getUrgencyColor(careStatus.urgency)} className="text-xs w-full justify-center">
              Needs {careStatus.urgentNeed}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}