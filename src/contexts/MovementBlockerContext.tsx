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

export const useMovementBlocker = () => {
  const context = useContext(MovementBlockerContext);
  if (!context) {
    throw new Error('useMovementBlocker must be used within a MovementBlockerProvider');
  }
  return context;
};
