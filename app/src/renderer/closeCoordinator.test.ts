import { describe, expect, it, vi } from 'vitest';
import { saveAllSessions, collectUnpolledDrafts, hasUnpolledDrafts, cancelSaveAll } from './closeCoordinator';
import { recordDraft, markConflict, activateBeat, type DraftState } from './draftState';

vi.mock('./desktop', () => ({
  desktop: {
    beats: {
      write: vi.fn(async () => {}),
      read: vi.fn(async () => ''),
    },
    sessions: {
      state: vi.fn(async () => ({})),
      setState: vi.fn(async () => {}),
    },
  },
}));

const empty: DraftState = {};

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
