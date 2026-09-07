import { desktop } from './desktop';
import { hasDirtyDrafts, dirtyBeats, type DraftState, type DraftSessionState } from './draftState';

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
 * Write every draft this session state holds, through the given writer.
 * Dirty drafts are written in full; conflicts are reported and never
 * overwritten, so a changed-on-disk beat stays visible instead of being
 * clobbered on the way out the door.
 */
async function saveSessionDrafts(
  sessionName: string,
  sessionState: DraftSessionState,
  write: (beat: string, content: string) => Promise<void>,
): Promise<SaveAllResult> {
  const results: SaveAllResult = {};

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
      await write(beat, content);
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

/**
 * Cross-session Save All for the ACTIVE session: writes each dirty draft
 * through desktop.beats.write, which targets the currently active session's
 * beat folder. Conflicts are reported explicitly and never cleared; partial
 * failures are preserved in the result.
 */
export async function saveAllSessions(
  draftState: DraftState,
  sessionName: string,
  openBeat: string | undefined,
): Promise<SaveAllResult> {
  const sessionState = draftState[sessionName];
  if (!sessionState) {
    return {};
  }
  return saveSessionDrafts(sessionName, sessionState, (beat, content) => desktop.beats.write(beat, content));
}

/**
 * Save every dirty draft in every session, for close.
 *
 * The active session's drafts go through desktop.beats.write (its folder is
 * the one the main process has rooted the beat store in). Drafts left in
 * OTHER sessions — the app moved on, but their edits are still only in this
 * renderer — go through desktop.beats.writeIn, which targets the named
 * session's folder without re-rooting anything. Writing those through
 * beats.write would land them in the wrong session's files.
 */
export async function saveAllDrafts(
  draftState: DraftState,
  activeSession: string | undefined,
  openBeat: string | undefined,
): Promise<SaveAllResult> {
  const results: SaveAllResult = {};
  for (const session of Object.keys(draftState)) {
    if (session === activeSession) {
      Object.assign(results, await saveAllSessions(draftState, session, openBeat));
      continue;
    }
    if (dirtyBeats(draftState, session).size === 0) {
      continue;
    }
    Object.assign(
      results,
      await saveSessionDrafts(session, draftState[session]!, (beat, content) =>
        desktop.beats.writeIn(session, beat, content),
      ),
    );
  }
  return results;
}
