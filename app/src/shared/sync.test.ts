import { describe, expect, it } from 'vitest';
import { resolveDiskChange } from './sync';

describe('resolveDiskChange', () => {
  it('does nothing when the disk already holds what we last wrote', () => {
    // The watcher echoes our own save back at us while the user keeps typing.
    expect(resolveDiskChange({ diskContent: 'a', bufferContent: 'b', lastSavedContent: 'a' })).toEqual({
      kind: 'noop',
    });
  });

  it('does nothing when the disk matches the buffer', () => {
    expect(resolveDiskChange({ diskContent: 'a', bufferContent: 'a', lastSavedContent: 'z' })).toEqual({
      kind: 'noop',
    });
  });

  it('applies the disk content when the buffer has no unsaved edits', () => {
    expect(resolveDiskChange({ diskContent: 'agent', bufferContent: 'mine', lastSavedContent: 'mine' })).toEqual({
      kind: 'apply',
      content: 'agent',
    });
  });

  it('reports a conflict when the buffer has unsaved edits', () => {
    expect(resolveDiskChange({ diskContent: 'agent', bufferContent: 'typing', lastSavedContent: 'mine' })).toEqual({
      kind: 'conflict',
      diskContent: 'agent',
    });
  });

  it('does not report a conflict when the agent converged on what the buffer holds', () => {
    expect(resolveDiskChange({ diskContent: 'same', bufferContent: 'same', lastSavedContent: 'old' })).toEqual({
      kind: 'noop',
    });
  });
});
