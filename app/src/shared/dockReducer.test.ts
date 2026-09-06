import { describe, expect, it } from 'vitest';
import { dockReducer } from './dockReducer';
import type { DockAction } from './dockReducer';

describe('dockReducer', () => {
  it('sets dock directly', () => {
    const dock = { split: true, panes: [{ tabs: ['a'] }] };
    expect(dockReducer({ split: false, panes: [] }, { type: 'SET_DOCK', dock })).toEqual(dock);
  });

  it('adds a tab', () => {
    const result = dockReducer(
      { split: false, panes: [{ tabs: [] }] },
      { type: 'ADD_TAB', paneIndex: 0, instanceId: 'i1' },
    );
    expect(result.panes?.[0]?.tabs).toContain('i1');
  });

  it('floats a panel and updates geometry', () => {
    const result = dockReducer(
      { split: false, panes: [{ tabs: ['a'] }] },
      { type: 'FLOAT_PANEL', instanceId: 'a', geometry: { x: 30, y: 30, width: 200, height: 150, zIndex: 2 } },
    );
    expect(result.floating?.length).toBe(1);
    expect(result.floating?.[0].geometry.x).toBe(30);
  });

  it('closes a floating panel', () => {
    const result = dockReducer(
      { split: false, panes: [{ tabs: ['a'] }], floating: [{ instanceId: 'a', geometry: { x: 0, y: 0, width: 100, height: 100, zIndex: 1 } }] },
      { type: 'CLOSE_FLOATING', instanceId: 'a' },
    );
    expect(result.floating).toBeUndefined();
  });

  it('migrates definition-keyed state', () => {
    const result = dockReducer(
      { pluginState: { eq: { gain: 0.5 } } },
      { type: 'MIGRATE_DEFINITION_KEYED', mapping: { eq: 'instance-1' } },
    );
    expect(result.pluginState).toHaveProperty('instance-1');
  });
});
