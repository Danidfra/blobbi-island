/**
 * Simple Pet Status Bar Component
 * 
 * Demonstrates how to use the optimized status layer for real-time pet stats display
 */

import React from 'react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCurrentPet } from '@/hooks/useOptimizedStatus';
import { useFeedPet, useCleanPet } from '@/hooks/useOptimizedStatus';
import { analyzeCareStatus } from '@/lib/blobbi-parsers';
import type { CareUrgency } from '@/lib/blobbi-types';

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

/** Individual stat display */
function StatDisplay({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
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

export function PetStatusBar() {
  const currentPet = useCurrentPet();
  const feedPet = useFeedPet();
  const cleanPet = useCleanPet();
  
  if (!currentPet) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        No pet selected
      </div>
    );
  }
  
  const careStatus = analyzeCareStatus(currentPet);
  
  return (
    <div className="p-4 space-y-4 border rounded-lg">
      {/* Pet Header */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-semibold">{currentPet.name}</h3>
          <p className="text-sm text-muted-foreground">
            {currentPet.stage} • Gen {currentPet.generation}
          </p>
        </div>
        <Badge variant={getUrgencyVariant(careStatus.urgency)}>
          {careStatus.condition}
        </Badge>
      </div>
      
      {/* Urgent Care Alert */}
      {careStatus.urgentNeed && careStatus.urgency !== 'none' && (
        <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-sm">
          <span className="font-medium">Urgent:</span> Your pet needs {careStatus.urgentNeed}!
        </div>
      )}
      
      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <StatDisplay label="Hunger" value={currentPet.hunger} />
        <StatDisplay label="Happiness" value={currentPet.happiness} />
        <StatDisplay label="Health" value={currentPet.health} />
        <StatDisplay label="Hygiene" value={currentPet.hygiene} />
        <StatDisplay label="Energy" value={currentPet.energy} />
        <StatDisplay label="Experience" value={currentPet.experience} max={1000} />
      </div>
      
      {/* Quick Actions */}
      <div className="flex gap-2">
        <Button 
          size="sm" 
          variant="outline"
          onClick={() => feedPet(currentPet.id)}
          disabled={currentPet.hunger >= 95}
        >
          Feed
        </Button>
        <Button 
          size="sm" 
          variant="outline"
          onClick={() => cleanPet(currentPet.id)}
          disabled={currentPet.hygiene >= 95}
        >
          Clean
        </Button>
      </div>
      
      {/* Additional Info */}
      <div className="text-xs text-muted-foreground space-y-1">
        <div>Care Streak: {currentPet.careStreak} days</div>
        <div>Sleep State: {careStatus.sleepState}</div>
        {currentPet.mood && <div>Mood: {currentPet.mood}</div>}
        {careStatus.nextCareIn && (
          <div>Next care needed in: {Math.round(careStatus.nextCareIn)} minutes</div>
        )}
      </div>
    </div>
  );
}