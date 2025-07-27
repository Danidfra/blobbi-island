import React, { useEffect } from 'react';
import { useMovementBlocker } from '@/contexts/MovementBlockerContext';

interface MovementBlockerProps {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible?: boolean;
}

export const MovementBlocker: React.FC<MovementBlockerProps> = ({ id, x, y, width, height, visible = true }) => {
  const { addBlocker, removeBlocker } = useMovementBlocker();

  useEffect(() => {
    const rect = { x, y, width, height };
    addBlocker({ id, rect });

    return () => {
      removeBlocker(id);
    };
  }, [id, x, y, width, height, addBlocker, removeBlocker]);

  if (!visible) {
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
