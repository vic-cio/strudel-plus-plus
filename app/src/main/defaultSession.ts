import type { SessionState } from './sessions';

/**
 * The app's one seeded example session: a snapshot of a real "we cook" set,
 * so a brand-new sessions root has something to play instead of an empty
 * list. Content is bundled at build time (Vite's `?raw`/JSON imports), the
 * same way harnessContent.ts inlines its defaults, so packaging needs no
 * extra resource step.
 */

import weBegin from '../../default-session/we begin.js?raw';
import eightOhEight from '../../default-session/808ing.js?raw';
import melody from '../../default-session/melody >:).js?raw';
import snapshotState from '../../default-session/session-state.json';

export const DEFAULT_SESSION_NAME = 'we cook';

export const DEFAULT_SESSION_BEATS: Record<string, string> = {
  'we begin.js': weBegin,
  '808ing.js': eightOhEight,
  'melody >:).js': melody,
};

// The snapshot's usedAt is a point-in-time capture from the captain's own
// session; seeding always stamps its own usedAt (nextUsedAt in sessions.ts)
// instead of resurrecting that value.
const { usedAt: _usedAt, ...DEFAULT_SESSION_STATE } = snapshotState as unknown as SessionState & { usedAt?: number };

export { DEFAULT_SESSION_STATE };
