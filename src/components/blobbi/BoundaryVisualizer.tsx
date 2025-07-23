import React from 'react';
import { Boundary } from '@/lib/boundaries';

interface BoundaryVisualizerProps {
  boundary: Boundary;
}

export function BoundaryVisualizer({ boundary }: BoundaryVisualizerProps) {
  const renderArea = (area: { x: [number, number]; y: [number, number] }, index: number) => (
    <div
      key={index}
      className="absolute border-2 border-red-500 pointer-events-none"
      style={{
        left: `${area.x[0]}%`,
        top: `${area.y[0]}%`,
        width: `${area.x[1] - area.x[0]}%`,
        height: `${area.y[1] - area.y[0]}%`,
      }}
    />
  );

  if (boundary.shape === 'rectangle') {
    return renderArea({ x: boundary.x, y: boundary.y }, 0);
  }

  if (boundary.shape === 'composite') {
    return <>{boundary.areas.map(renderArea)}</>;
  }

  return null;
}
