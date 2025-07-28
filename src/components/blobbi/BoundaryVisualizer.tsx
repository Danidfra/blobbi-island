import React from 'react';
import { Boundary, WalkableArea } from '@/lib/boundaries';

interface BoundaryVisualizerProps {
  boundary: Boundary;
}

export function BoundaryVisualizer({ boundary }: BoundaryVisualizerProps) {
  const strokeWidth = 0.3;

  const renderWalkableArea = (area: WalkableArea, index: number) => {
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
            boxSizing: 'border-box',
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
            boxSizing: 'border-box',
          }}
        />
      );
    }
    if (area.type === 'triangle') {
      const points = area.points.map(p => `${p.x},${p.y}`).join(' ');
      return (
        <svg key={`area-${index}`} className="absolute w-full h-full pointer-events-none" style={{ left: 0, top: 0 }} viewBox="0 0 100 100" preserveAspectRatio="none">
            <polygon points={points} stroke="red" strokeWidth={strokeWidth} fill="none" />
        </svg>
      );
    }
    return null;
  };

  const renderBoundary = () => {
    if (boundary.shape === 'rectangle') {
      return renderWalkableArea({ type: 'rectangle', x: boundary.x, y: boundary.y }, 0);
    }

    if (boundary.shape === 'composite') {
      return <React.Fragment key="composite">{boundary.areas.map((area, index) => renderWalkableArea(area, index))}</React.Fragment>;
    }

    if (boundary.shape === 'arch') {
      const pathPoints: string[] = [];
      const steps = 50;
      for (let i = 0; i <= steps; i++) {
          const p = i / steps;
          const x = p * 100;
          const normalizedX = (x - 50) / 50;
          const y = boundary.bottom - (1 - Math.pow(Math.abs(normalizedX), boundary.curvature)) * (boundary.bottom - boundary.top);
          pathPoints.push(`${x} ${y}`);
      }
      const archLine = `M ${pathPoints[0]} L ${pathPoints.slice(1).join(' L ')}`;
      const fullPath = `${archLine} L 100 100 L 0 100 Z`;

      return (
          <svg className="absolute w-full h-full pointer-events-none" style={{ left: 0, top: 0 }} viewBox="0 0 100 100" preserveAspectRatio="none">
              <path d={fullPath} stroke="red" strokeWidth={strokeWidth} fill="none" />
          </svg>
      );
    }

    if (boundary.shape === 'semicircle') {
      const pathD = `M 0 ${boundary.top} A 50 50 0 0 1 100 ${boundary.top} L 100 100 L 0 100 Z`;
      return (
          <svg className="absolute w-full h-full pointer-events-none" style={{ left: 0, top: 0 }} viewBox="0 0 100 100" preserveAspectRatio="none">
              <path d={pathD} stroke="red" strokeWidth={strokeWidth} fill="none" />
          </svg>
      );
    }

    return null;
  }

  return renderBoundary();
}
