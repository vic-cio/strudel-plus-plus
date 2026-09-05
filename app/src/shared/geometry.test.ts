import { describe, expect, it } from 'vitest';
import { defaultGeometry, clampGeometry, applyDelta } from './geometry';

describe('geometry', () => {
  it('creates default geometry', () => {
    const g = defaultGeometry(200, 100, 1);
    expect(g.width).toBe(200);
  });

  it('clamps within container', () => {
    const g = clampGeometry({ x: -10, y: -10, width: 50, height: 50, zIndex: 1 }, { width: 300, height: 300 });
    expect(g.x).toBeGreaterThanOrEqual(0);
  });

  it('applies delta', () => {
    const g = applyDelta({ x: 10, y: 20, width: 100, height: 100, zIndex: 1 }, { x: 5, y: -3 });
    expect(g.x).toBe(15);
  });
});
