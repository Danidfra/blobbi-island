import React from 'react';
import { useLocation } from '@/hooks/useLocation';
import { cn } from '@/lib/utils';

export function SceneTransition() {
  const { isTransitioning } = useLocation();

  return (
    <div
      className={cn(
        'absolute inset-0 bg-black transition-opacity duration-500 z-50',
        isTransitioning ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}
    />
  );
}
