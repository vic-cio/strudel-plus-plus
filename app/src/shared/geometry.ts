/**
 * Draggable floating-panel geometry.
 */

export type Geometry = import('./dockReducer').Geometry;
export function defaultGeometry(width: number, height: number, zIndex: number): Geometry {
  return { x: 20 + zIndex * 30, y: 20 + zIndex * 30, width, height, zIndex };
}

export function clampGeometry(geometry: Geometry, container: { width: number; height: number }): Geometry {
  return {
    ...geometry,
    x: Math.max(0, Math.min(geometry.x, container.width - geometry.width)),
    y: Math.max(0, Math.min(geometry.y, container.height - geometry.height)),
  };
}

export function applyDelta(geometry: Geometry, delta: { x?: number; y?: number }): Geometry {
  return { ...geometry, x: geometry.x + (delta.x ?? 0), y: geometry.y + (delta.y ?? 0) };
}
