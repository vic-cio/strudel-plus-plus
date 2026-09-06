/**
 * Draggable floating-panel geometry.
 */

export type { Geometry } from './dockReducer';
import type { Geometry as GeometryType, FloatingPanel } from './dockReducer';

export function defaultGeometry(width: number, height: number, zIndex: number): GeometryType {
  return { x: 20 + zIndex * 30, y: 20 + zIndex * 30, width, height, zIndex };
}

export function clampGeometry(geometry: GeometryType, container: { width: number; height: number }): GeometryType {
  return {
    ...geometry,
    x: Math.max(0, Math.min(geometry.x, container.width - geometry.width)),
    y: Math.max(0, Math.min(geometry.y, container.height - geometry.height)),
  };
}

export function applyDelta(geometry: GeometryType, delta: { x?: number; y?: number }): GeometryType {
  return { ...geometry, x: geometry.x + (delta.x ?? 0), y: geometry.y + (delta.y ?? 0) };
}
