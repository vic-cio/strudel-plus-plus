import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  saveAllSessions,
  saveAllDrafts,
  collectUnpolledDrafts,
  hasUnpolledDrafts,
  cancelSaveAll,
} from './closeCoordinator';
import { recordDraft, markConflict, activateBeat, type DraftState } from './draftState';

vi.mock('./desktop', () => ({
  desktop: {
    beats: {
      write: vi.fn(async () => {}),
      writeIn: vi.fn(async () => {}),
      read: vi.fn(async () => ''),
    },
    sessions: {
      state: vi.fn(async () => ({})),
      setState: vi.fn(async () => {}),
    },
  },
}));

const empty: DraftState = {};

// The mocked desktop is one instance for the whole file; without clearing,
// a not-called assertion in one test sees the calls made by the test before it.
beforeEach(() => {
  vi.clearAllMocks();
});

describe('closeCoordinator', () => {
  describe('collectUnpolledDrafts', () => {
    it('returns empty when no dirty drafts exist', () => {
      expect(collectUnpolledDrafts(empty)).toEqual({});
    });

    it('collects dirty drafts per session', () => {
      let state = activateBeat(empty, 'session', 'one.js', 'disk').state;
      state = recordDraft(state, 'session', 'one.js', 'draft');
      const unpolled = collectUnpolledDrafts(state);
      expect(unpolled['session']).toBeDefined();
      expect(unpolled['session']!.has('one.js')).toBe(true);
    });
  });

  describe('hasUnpolledDrafts', () => {
    it('is false for clean state', () => {
      expect(hasUnpolledDrafts(empty)).toBe(false);
    });

    it('is true when a draft exists', () => {
      let state = activateBeat(empty, 'session', 'a.js', 'disk').state;
      state = recordDraft(state, 'session', 'a.js', 'draft');
      expect(hasUnpolledDrafts(state)).toBe(true);
    });
  });

  describe('saveAllSessions', () => {
    it('returns empty result when session has no drafts', async () => {
      const result = await saveAllSessions(empty, 'session', undefined);
      expect(result).toEqual({});
    });

    it('reports conflict when a conflict exists', async () => {
      const draftState = activateBeat(empty, 'session', 'one.js', 'disk A').state;
      const withDraft = recordDraft(draftState, 'session', 'one.js', 'draft B');
      const withConflict = markConflict(withDraft, 'session', 'one.js', 'disk C');
      const result = await saveAllSessions(withConflict, 'session', 'one.js');
      expect(result['session/one.js']).toBeDefined();
      expect(result['session/one.js']?.conflict).toBe(true);
      expect(result['session/one.js']?.saved).toBe(false);
    });

    it('saves a clean draft and reports success', async () => {
      const draftState = activateBeat(empty, 'session', 'one.js', 'disk A').state;
      const withDraft = recordDraft(draftState, 'session', 'one.js', 'draft B');
      const result = await saveAllSessions(withDraft, 'session', 'one.js');
      expect(result['session/one.js']).toBeDefined();
      expect(result['session/one.js']?.saved).toBe(true);
    });

    it('reports partial failure when one write fails', async () => {
      const { desktop } = await import('./desktop');
      (desktop.beats.write as any).mockRejectedValueOnce(new Error('disk full'));
      const draftState = activateBeat(empty, 'session', 'one.js', 'disk A').state;
      const withDraft = recordDraft(draftState, 'session', 'one.js', 'draft B');
      const result = await saveAllSessions(withDraft, 'session', 'one.js');
      expect(result['session/one.js']?.saved).toBe(false);
      expect(result['session/one.js']?.error).toContain('disk full');
    });
  });

  describe('cancelSaveAll', () => {
    it('returns a typed cancel result', () => {
      const cancel = cancelSaveAll('User cancelled');
      expect(cancel.canceled).toBe(true);
      expect(cancel.reason).toBe('User cancelled');
    });
  });

  describe('saveAllDrafts', () => {
    it('saves the active session through the active beat store seam', async () => {
      const { desktop } = await import('./desktop');
      let state = activateBeat(empty, 'active', 'one.js', 'disk A').state;
      state = recordDraft(state, 'active', 'one.js', 'draft A');
      const result = await saveAllDrafts(state, 'active', 'one.js');
      expect(result['active/one.js']?.saved).toBe(true);
      expect(desktop.beats.write).toHaveBeenCalledWith('one.js', 'draft A');
      expect(desktop.beats.writeIn).not.toHaveBeenCalled();
    });

    it('saves another session\u2019s leftover draft through the named-session seam', async () => {
      const { desktop } = await import('./desktop');
      // The draft was left in "left" when the app switched to "active".
      // Writing it through beats.write would land it in the ACTIVE session\u2019s
      // folder \u2014 the exact corruption close save-all must never cause.
      let state = activateBeat(empty, 'left', 'one.js', 'disk L').state;
      state = recordDraft(state, 'left', 'one.js', 'draft L');
      state = activateBeat(state, 'active', 'two.js', 'disk A').state;
      state = recordDraft(state, 'active', 'two.js', 'draft A');
      const result = await saveAllDrafts(state, 'active', 'two.js');
      expect(result['left/one.js']?.saved).toBe(true);
      expect(result['active/two.js']?.saved).toBe(true);
      expect(desktop.beats.writeIn).toHaveBeenCalledWith('left', 'one.js', 'draft L');
      expect(desktop.beats.write).toHaveBeenCalledWith('two.js', 'draft A');
      expect(desktop.beats.write).not.toHaveBeenCalledWith('one.js', 'draft L');
    });

    it('skips sessions with nothing dirty and reports their absence', async () => {
      const { desktop } = await import('./desktop');
      // "clean" was visited but never edited; it must not produce writes or
      // result entries that the close dialog would list as unsaved.
      let state = activateBeat(empty, 'clean', 'one.js', 'disk').state;
      state = activateBeat(state, 'active', 'two.js', 'disk').state;
      state = recordDraft(state, 'active', 'two.js', 'draft');
      const result = await saveAllDrafts(state, 'active', 'two.js');
      expect(result['clean/one.js']).toBeUndefined();
      expect(Object.keys(result)).toEqual(['active/two.js']);
      expect(desktop.beats.writeIn).not.toHaveBeenCalled();
    });

    it('keeps a conflict unsaved and visible instead of overwriting disk', async () => {
      const { desktop } = await import('./desktop');
      let state = activateBeat(empty, 'left', 'one.js', 'disk A').state;
      state = recordDraft(state, 'left', 'one.js', 'draft B');
      state = markConflict(state, 'left', 'one.js', 'disk C');
      const result = await saveAllDrafts(state, 'active', undefined);
      expect(result['left/one.js']?.conflict).toBe(true);
      expect(result['left/one.js']?.saved).toBe(false);
      expect(desktop.beats.writeIn).not.toHaveBeenCalled();
    });

    it('reports a failed cross-session write as a failure instead of closing over it', async () => {
      const { desktop } = await import('./desktop');
      (desktop.beats.writeIn as any).mockRejectedValueOnce(new Error('session folder is read-only'));
      let state = activateBeat(empty, 'left', 'one.js', 'disk').state;
      state = recordDraft(state, 'left', 'one.js', 'draft');
      const result = await saveAllDrafts(state, 'active', undefined);
      expect(result['left/one.js']?.saved).toBe(false);
      expect(result['left/one.js']?.error).toContain('read-only');
    });
  });

  describe('unpolled edits', () => {
    it('detects unpolled dirty drafts across sessions', () => {
      let state = activateBeat(empty, 's1', 'a.js', 'disk').state;
      state = recordDraft(state, 's1', 'a.js', 'draft');
      expect(hasUnpolledDrafts(state)).toBe(true);
      const unpolled = collectUnpolledDrafts(state);
      expect(unpolled['s1']).toBeDefined();
    });

    it('reports no unpolled drafts for clean state', () => {
      expect(hasUnpolledDrafts(empty)).toBe(false);
    });
  });

  describe('successful close', () => {
    it('returns full success for saved drafts', async () => {
      const draftState = activateBeat(empty, 'session', 'beat.js', 'disk').state;
      const withDraft = recordDraft(draftState, 'session', 'beat.js', 'content');
      const result = await saveAllSessions(withDraft, 'session', 'beat.js');
      expect(result['session/beat.js']?.saved).toBe(true);
      expect(result['session/beat.js']?.conflict).toBeUndefined();
    });
  });
});
