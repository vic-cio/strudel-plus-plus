import { desktop } from './desktop';
import { hasDirtyDrafts, dirtyBeats, type DraftState } from './draftState';

export type SaveAllResult = Record<string, { saved: boolean; conflict?: boolean; error?: string }>;

/** Explicit cancellation of a save-all / close-protection attempt. */
export type SaveAllCancel = { canceled: true; reason: string };

export type SaveAllOutcome = SaveAllResult | SaveAllCancel;

/**
 * Collect unpolled dirty drafts across all sessions, including conflicts.
 * A draft that has not been explicitly saved (and conflicts) is considered
 * unpolled. This is the renderer-side collection surface for close protection.
 */
export function collectUnpolledDrafts(state: DraftState): Record<string, ReadonlySet<string>> {
  const unpolled: Record<string, ReadonlySet<string>> = {};
  for (const session of Object.keys(state)) {
    const dirty = dirtyBeats(state, session);
    if (dirty.size > 0) {
      unpolled[session] = dirty;
    }
  }
  return unpolled;
}

/** Check whether any session has unpolled dirty drafts or conflicts. */
export function hasUnpolledDrafts(state: DraftState): boolean {
  return hasDirtyDrafts(state);
}

/**
 * Explicit cancel for close / save-all flows. Returns a typed cancel result
 * rather than an exception, so the caller can distinguish user-cancel from
 * failure.
 */
export function cancelSaveAll(reason = 'User cancelled'): SaveAllCancel {
  return { canceled: true, reason };
}

/**
 * Cross-session Save All: writes each dirty draft for every session. Because
 * desktop.beats.write targets the currently active session's beat folder,
 * this contract is intended for use within a single active session or with
 * a session-scoped write mechanism. It reports conflicts explicitly and never
 * clears them; partial failures are preserved in the result. Conflicts are not
 * overwritten.
 */
export async function saveAllSessions(
  draftState: DraftState,
  sessionName: string,
  openBeat: string | undefined,
): Promise<SaveAllResult> {
  const results: SaveAllResult = {};
  // Focus on the requested session (typically the active session) to avoid
  // switching active state while writing. Conflicts are reported but kept.
  const sessionState = draftState[sessionName];
  if (!sessionState) {
    return results;
  }

  // Process dirty drafts first (user edits), then conflicts.
  const beatsToSave = new Set([
    ...Object.keys(sessionState.drafts || {}),
    ...Object.keys(sessionState.conflicts || {}),
  ]);

  for (const beat of beatsToSave) {
    const sessionDrafts = sessionState.drafts || {};
    const sessionConflicts = sessionState.conflicts || {};
    const hasConflict = sessionConflicts[beat] !== undefined;

    if (hasConflict) {
      // Conflict: report conflict; do not overwrite disk without resolution.
      results[`${sessionName}/${beat}`] = { saved: false, conflict: true, error: 'Conflict: disk content changed' };
      continue;
    }

    const content = sessionDrafts[beat] ?? '';
    if (content === '' && !Object.prototype.hasOwnProperty.call(sessionDrafts, beat)) {
      continue;
    }

    try {
      await desktop.beats.write(beat, content);
      results[`${sessionName}/${beat}`] = { saved: true };
    } catch (e) {
      results[`${sessionName}/${beat}`] = {
        saved: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
  return results;
}
