import { describe, expect, it } from 'vitest';
import {
  acceptDisk,
  activateBeat,
  dirtyBeats,
  getDraftSession,
  hasDirtyDrafts,
  markConflict,
  recordDraft,
  renameBeat,
  saveBeat,
  type DraftState,
} from './draftState';

const empty: DraftState = {};

describe('renderer beat draft state', () => {
  it('restores a draft when a beat is activated again', () => {
    const seeded = activateBeat(empty, 'session', 'one.js', 'disk one').state;
    const edited = recordDraft(seeded, 'session', 'one.js', 'draft one');
    const switched = activateBeat(edited, 'session', 'two.js', 'disk two').state;
    const restored = activateBeat(switched, 'session', 'one.js', 'disk one');

    expect(restored.content).toBe('draft one');
    expect(dirtyBeats(restored.state, 'session')).toEqual(new Set(['one.js']));
  });

  it('saves one beat without clearing another beat draft', () => {
    let state = activateBeat(empty, 'session', 'one.js', 'disk one').state;
    state = recordDraft(state, 'session', 'one.js', 'draft one');
    state = activateBeat(state, 'session', 'two.js', 'disk two').state;
    state = recordDraft(state, 'session', 'two.js', 'draft two');

    const saved = saveBeat(state, 'session', 'two.js', 'draft two');

    expect(dirtyBeats(saved, 'session')).toEqual(new Set(['one.js']));
    expect(activateBeat(saved, 'session', 'one.js', 'disk one').content).toBe('draft one');
    expect(activateBeat(saved, 'session', 'two.js', 'draft two').content).toBe('draft two');
  });

  it('accepts disk content by discarding the conflicting draft', () => {
    let state = activateBeat(empty, 'session', 'one.js', 'disk A').state;
    state = recordDraft(state, 'session', 'one.js', 'draft B');
    state = markConflict(state, 'session', 'one.js', 'disk C');

    const accepted = acceptDisk(state, 'session', 'one.js', 'disk C');

    expect(dirtyBeats(accepted, 'session')).toEqual(new Set());
    expect(activateBeat(accepted, 'session', 'one.js', 'disk C').content).toBe('disk C');
  });

  it('keeps an unresolved conflict dirty when local content returns to baseline', () => {
    let state = activateBeat(empty, 'session', 'one.js', 'disk A').state;
    state = recordDraft(state, 'session', 'one.js', 'draft B');
    state = markConflict(state, 'session', 'one.js', 'disk C');
    state = recordDraft(state, 'session', 'one.js', 'disk A');

    expect(dirtyBeats(state, 'session')).toEqual(new Set(['one.js']));
    expect(hasDirtyDrafts(state)).toBe(true);
    expect(getDraftSession(state, 'session').conflicts['one.js']).toBe('disk C');
  });

  it('keeps dirty state across session boundaries and reports any dirty session', () => {
    const one = recordDraft(activateBeat(empty, 'one', 'beat.js', 'disk').state, 'one', 'beat.js', 'draft');
    const both = recordDraft(activateBeat(one, 'two', 'beat.js', 'disk').state, 'two', 'beat.js', 'draft');

    expect(hasDirtyDrafts(both)).toBe(true);
    expect(renameBeat(both, 'one', 'beat.js', 'renamed.js')).not.toBe(both);
  });
});
