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
        <span className="blobbi-stat-label">{label}</span>
        <span className="blobbi-stat-value">{value}/{max}</span>
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
    <div className="blobbi-card-xl blobbi-section space-y-4 theme-transition">
      {/* Pet Header */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-semibold blobbi-text">{currentPet.name}</h3>
          <p className="text-sm blobbi-text-muted">
            <span className="blobbi-badge-baby capitalize">{currentPet.stage}</span> • Gen {currentPet.generation}
          </p>
        </div>
        <Badge
          variant={getUrgencyVariant(careStatus.urgency)}
          className="blobbi-badge"
        >
          {careStatus.condition}
        </Badge>
      </div>

      {/* Urgent Care Alert */}
      {careStatus.urgentNeed && careStatus.urgency !== 'none' && (
        <div className="p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm">
          <span className="font-medium blobbi-text">Urgent:</span>
          <span className="blobbi-text-muted"> Your pet needs {careStatus.urgentNeed}!</span>
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
          className="blobbi-button border-purple-200 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/20"
          variant="outline"
          onClick={() => feedPet(currentPet.id)}
          disabled={currentPet.hunger >= 95}
        >
          🍎 Feed
        </Button>
        <Button
          size="sm"
          className="blobbi-button border-purple-200 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/20"
          variant="outline"
          onClick={() => cleanPet(currentPet.id)}
          disabled={currentPet.hygiene >= 95}
        >
          🧼 Clean
        </Button>
      </div>

      {/* Additional Info */}
      <div className="text-xs blobbi-text-muted space-y-1">
        <div>Care Streak: <span className="blobbi-stat-value">{currentPet.careStreak} days</span></div>
        <div>Sleep State: <span className="blobbi-stat-value">{careStatus.sleepState}</span></div>
        {currentPet.mood && <div>Mood: <span className="blobbi-stat-value">{currentPet.mood}</span></div>}
        {careStatus.nextCareIn && (
          <div>Next care needed in: <span className="blobbi-stat-value">{Math.round(careStatus.nextCareIn)} minutes</span></div>
        )}
      </div>
    </div>
  );
}