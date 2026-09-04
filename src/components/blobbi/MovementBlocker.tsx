import React, { useEffect } from 'react';
import { useMovementBlocker } from '@/contexts/MovementBlockerContext';
import { useDebugOverlays } from '@/contexts/DebugOverlaysContext';

interface MovementBlockerProps {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * When false, never render the debug outline (the blocker is still registered
   * for collision). When true (default), the red outline follows the shared
   * developer debug-overlays switch.
   */
  visible?: boolean;
}

export const MovementBlocker: React.FC<MovementBlockerProps> = ({ id, x, y, width, height, visible = true }) => {
  // Optional: furniture registers its own footprint, and a room rendered
  // without a blocker registry (an isolated component test) simply has no
  // collision, exactly as `InteractiveElement` treats a missing provider.
  const registry = useMovementBlocker({ optional: true });
  const addBlocker = registry?.addBlocker;
  const removeBlocker = registry?.removeBlocker;
  const { showDebugOverlays } = useDebugOverlays();

  useEffect(() => {
    if (!addBlocker || !removeBlocker) return;
    const rect = { x, y, width, height };
    addBlocker({ id, rect });

    return () => {
      removeBlocker(id);
    };
  }, [id, x, y, width, height, addBlocker, removeBlocker]);

  // The collision blocker above always registers; the red outline is purely a
  // developer visual and only shows when debug overlays are enabled in dev.
  if (!visible || !showDebugOverlays) {
    return null;
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        width: `${width}%`,
        height: `${height}%`,
        backgroundColor: 'rgba(255, 0, 0, 0.3)',
        border: '1px dashed red',
        zIndex: 1000,
      }}
    />
  );
};
