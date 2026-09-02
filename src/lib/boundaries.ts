import { Position } from '@/lib/types';

export type Boundary =
  | { shape: 'semicircle'; top: number; bottom: number }
  | { shape: 'rectangle'; x: [number, number]; y: [number, number] }
  | { shape: 'arch'; top: number; bottom: number; curvature: number }
  | { shape: 'composite'; areas: WalkableArea[] };

export type WalkableArea =
  | { type: 'rectangle'; x: [number, number]; y: [number, number] }
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'triangle'; points: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }] };


/**
 * Is this point inside one walkable area? Edges count as inside.
 *
 * Exported because route planning needs to reason about the areas a composite
 * boundary is BUILT from, not just about the union. Each area is convex, which
 * is what makes "both endpoints in the same area" a proof that the straight line
 * between them never leaves the floor.
 */
export function areaContains(point: Position, area: WalkableArea, epsilon = 1e-6): boolean {
  if (area.type === 'rectangle') {
    return (
      point.x >= area.x[0] - epsilon &&
      point.x <= area.x[1] + epsilon &&
      point.y >= area.y[0] - epsilon &&
      point.y <= area.y[1] + epsilon
    );
  }
  if (area.type === 'circle') {
    return Math.hypot(point.x - area.cx, point.y - area.cy) <= area.r + epsilon;
  }
  const clamped = constrainToArea(point, area);
  return Math.hypot(clamped.x - point.x, clamped.y - point.y) <= epsilon;
}

/**
 * The nearest point of one walkable area to `position`.
 *
 * Extracted from {@link constrainPosition}'s composite branch, which now calls
 * it — the per-area clamp was already the interesting half, and route planning
 * needs it on its own to find where two areas meet.
 */
export function constrainToArea(position: Position, area: WalkableArea): Position {
  const { x, y } = position;

  if (area.type === 'rectangle') {
    return {
      x: Math.max(area.x[0], Math.min(area.x[1], x)),
      y: Math.max(area.y[0], Math.min(area.y[1], y)),
    };
  }

  if (area.type === 'circle') {
    const dx = x - area.cx;
    const dy = y - area.cy;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > area.r && distance > 0) {
      return { x: area.cx + (dx / distance) * area.r, y: area.cy + (dy / distance) * area.r };
    }
    return { x, y };
  }

  if (isPointInTriangle({ x, y }, area.points)) return { x, y };

  // Closest point on the triangle's edges.
  let closestPointOnEdge = { x: 0, y: 0 };
  let minDistanceSq = Infinity;
  for (let i = 0; i < 3; i++) {
    const p1 = area.points[i];
    const p2 = area.points[(i + 1) % 3];
    const l2 = (p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2;
    if (l2 === 0) continue;
    let t = ((x - p1.x) * (p2.x - p1.x) + (y - p1.y) * (p2.y - p1.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const closest = { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
    const distSq = (x - closest.x) ** 2 + (y - closest.y) ** 2;
    if (distSq < minDistanceSq) {
      minDistanceSq = distSq;
      closestPointOnEdge = closest;
    }
  }
  return closestPointOnEdge;
}

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
      const point = constrainToArea({ x, y }, area);
      const distance = (x - point.x) ** 2 + (y - point.y) ** 2;
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

function isPointInTriangle(point: Position, triangle: { x: number; y: number }[]): boolean {
  const [p1, p2, p3] = triangle;

  const d1 = sign(point, p1, p2);
  const d2 = sign(point, p2, p3);
  const d3 = sign(point, p3, p1);

  const has_neg = d1 < 0 || d2 < 0 || d3 < 0;
  const has_pos = d1 > 0 || d2 > 0 || d3 > 0;

  return !(has_neg && has_pos);
}

function sign(p1: Position, p2: { x: number; y: number }, p3: { x: number; y: number }): number {
  return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
}

