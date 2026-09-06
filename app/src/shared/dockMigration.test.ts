import { describe, expect, it } from 'vitest';
import { migrateDockState } from './dockMigration';

describe('dockMigration', () => {
  it('maps plugin state to instance ids', () => {
    const result = migrateDockState({ pluginState: { eq: 1 } }, { eq: 'i-1' });
    expect(result.pluginState).toEqual({ 'i-1': 1 });
  });
});
