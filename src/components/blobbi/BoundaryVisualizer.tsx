import React from 'react';
import { Boundary, WalkableArea } from '@/lib/boundaries';

interface BoundaryVisualizerProps {
  boundary: Boundary;
}

export function BoundaryVisualizer({ boundary }: BoundaryVisualizerProps) {
  const renderArea = (area: WalkableArea, index: number) => {
    if (area.type === 'rectangle') {
      return (
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
    }
    if (area.type === 'circle') {
      return (
        <div
          key={index}
          className="absolute border-2 border-red-500 rounded-full pointer-events-none"
          style={{
            left: `${area.cx - area.r}%`,
            top: `${area.cy - area.r}%`,
            width: `${area.r * 2}%`,
            height: `${area.r * 2}%`,
          }}
        />
      );
    }
    if (area.type === 'triangle') {
      const points = area.points.map(p => `${p.x}% ${p.y}%`).join(', ');
      return (
        <div
          key={index}
          className="absolute w-full h-full pointer-events-none"
          style={{
            clipPath: `polygon(${points})`,
          }}
        >
          <div className="w-full h-full border-2 border-red-500" />
        </div>
      );
    }
    return null;
  };

  if (boundary.shape === 'rectangle') {
    return renderArea({ type: 'rectangle', x: boundary.x, y: boundary.y }, 0);
  }

  if (boundary.shape === 'composite') {
    return <>{boundary.areas.map(renderArea)}</>;
  }

  return null;
}

