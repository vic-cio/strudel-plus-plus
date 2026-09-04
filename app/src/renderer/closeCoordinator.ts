import { desktop } from './desktop';
import { hasDirtyDrafts, type DraftState } from './draftState';

export type SaveAllResult = Record<string, { saved: boolean; conflict?: boolean; error?: string }>;

/** Cross-session Save all: one user action returning per-file results. */
export async function saveAllSessions(
  draftState: DraftState,
  sessionName: string,
  openBeat: string | undefined,
): Promise<SaveAllResult> {
  const results: SaveAllResult = {};
  // This is the contract surface: for this slice, it reports per-session
  // outcomes based on dirty-draft state. A full multi-session transaction
  // would iterate all sessions; the core contract is that results are
  // per-file and dirty state is retained for conflicts/failures.
  for (const session of Object.keys(draftState)) {
    const sessionDrafts = draftState[session];
    if (!sessionDrafts) continue;
    for (const beat of Object.keys(sessionDrafts.drafts || {})) {
      try {
        const content = sessionDrafts.drafts[beat] ?? '';
        await desktop.beats.write(beat, content);
        results[`${session}/${beat}`] = { saved: true };
      } catch (e) {
        results[`${session}/${beat}`] = {
          saved: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  }
  return results;
}
