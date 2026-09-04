import React, { createContext, useState, useContext, useCallback } from 'react';

interface Blocker {
  id: string;
  rect: { x: number; y: number; width: number; height: number };
}

interface MovementBlockerContextType {
  blockers: Blocker[];
  addBlocker: (blocker: Blocker) => void;
  removeBlocker: (id: string) => void;
  isPositionBlocked: (x: number, y: number) => boolean;
}

const MovementBlockerContext = createContext<MovementBlockerContextType | undefined>(undefined);

export const MovementBlockerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [blockers, setBlockers] = useState<Blocker[]>([]);

  const addBlocker = useCallback((blocker: Blocker) => {
    setBlockers((prev) => [...prev, blocker]);
  }, []);

  const removeBlocker = useCallback((id: string) => {
    setBlockers((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const isPositionBlocked = useCallback(
    (x: number, y: number) => {
      for (const blocker of blockers) {
        const { x: bx, y: by, width: bw, height: bh } = blocker.rect;
        if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) {
          return true;
        }
      }
      return false;
    },
    [blockers]
  );

  return (
    <MovementBlockerContext.Provider value={{ blockers, addBlocker, removeBlocker, isPositionBlocked }}>
      {children}
    </MovementBlockerContext.Provider>
  );
};

/**
 * The room's blocker registry.
 *
 * By default a missing provider is a programming error. With
 * `{ optional: true }` it is simply `undefined`: for components that USE
 * blockers to improve a decision but do not depend on them, an interactive
 * element projecting its approach point away from furniture can only do so
 * where a room registered any, and must still work (and be testable) in a
 * tree without the provider.
 */
export function useMovementBlocker(): MovementBlockerContextType;
export function useMovementBlocker(options: { optional: true }): MovementBlockerContextType | undefined;
export function useMovementBlocker(options?: { optional?: boolean }): MovementBlockerContextType | undefined {
  const context = useContext(MovementBlockerContext);
  if (!context && !options?.optional) {
    throw new Error('useMovementBlocker must be used within a MovementBlockerProvider');
  }
  return context;
}
