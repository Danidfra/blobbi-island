import { Position } from '@/lib/types';

export type Boundary =
  | { shape: 'semicircle'; top: number; bottom: number }
  | { shape: 'rectangle'; x: [number, number]; y: [number, number] }
  | { shape: 'arch'; top: number; bottom: number; curvature: number }
  | { shape: 'composite'; areas: { x: [number, number]; y: [number, number] }[] };

export function constrainPosition(position: Position, boundary: Boundary): Position {
  const x = Math.max(0, Math.min(100, position.x));
  const y = Math.max(0, Math.min(100, position.y));

  if (boundary.shape === 'rectangle') {
    return {
      x: Math.max(boundary.x[0], Math.min(boundary.x[1], x)),
      y: Math.max(boundary.y[0], Math.min(boundary.y[1], y)),
    };
  }

  if (boundary.shape === 'composite') {
    let closestPoint: Position | null = null;
    let minDistance = Infinity;

    for (const area of boundary.areas) {
      const clampedX = Math.max(area.x[0], Math.min(area.x[1], x));
      const clampedY = Math.max(area.y[0], Math.min(area.y[1], y));
      const point = { x: clampedX, y: clampedY };

      const dx = x - point.x;
      const dy = y - point.y;
      const distance = dx * dx + dy * dy;

      if (distance < minDistance) {
        minDistance = distance;
        closestPoint = point;
      }
    }
    return closestPoint || { x, y };
  }

  if (boundary.shape === 'semicircle') {
    const centerX = 50;
    const radius = 50;
    const dx = x - centerX;
    const dy = y - boundary.top;

    // Check if the point is inside the circle
    if (dx * dx + dy * dy > radius * radius) {
      const angle = Math.atan2(dy, dx);
      return {
        x: centerX + radius * Math.cos(angle),
        y: boundary.top + radius * Math.sin(angle),
      };
    }
    return { x, y: Math.max(boundary.top, y) };
  }

  if (boundary.shape === 'arch') {
    const normalizedX = (x - 50) / 50; // -1 to 1
    const archY =
      boundary.bottom -
      (1 - Math.pow(Math.abs(normalizedX), boundary.curvature)) * (boundary.bottom - boundary.top);

    return {
      x,
      y: Math.max(archY, y),
    };
  }

  return { x, y };
}
