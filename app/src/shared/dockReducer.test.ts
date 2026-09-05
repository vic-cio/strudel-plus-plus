import { describe, expect, it } from 'vitest';
import { dockReducer } from './dockReducer';
import type { DockAction } from './dockReducer';

describe('dockReducer', () => {
  it('sets dock directly', () => {
    const dock = { split: true, panes: [{ tabs: ['a'] }] };
    expect(dockReducer({ split: false, panes: [] }, { type: 'SET_DOCK', dock })).toEqual(dock);
  });

  it('adds a tab', () => {
    const result = dockReducer({ split: false, panes: [{ tabs: [] }] }, { type: 'ADD_TAB', paneIndex: 0, instanceId: 'i1' });
    expect(result.panes?.[0]?.tabs).toContain('i1');
  });

  it('migrates definition-keyed state', () => {
    const result = dockReducer({ pluginState: { eq: { gain: 0.5 } } }, { type: 'MIGRATE_DEFINITION_KEYED', mapping: { eq: 'instance-1' } });
    expect(result.pluginState).toHaveProperty('instance-1');
  });
});
