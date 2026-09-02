import { access, lstat, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { BEAT_EXTENSION } from '../shared/beatName';
import { isBeatSortMode, type BeatSortMode } from '../shared/beatSorting';
import { isDockState, type DockState } from '../shared/dockState';
import { DEFAULT_SESSION_BEATS, DEFAULT_SESSION_NAME, DEFAULT_SESSION_STATE } from './defaultSession';
import { seedHarnessContent } from './harnessContent';

export type Session = { name: string; beats: number; usedAt: number };
export type SessionState = {
  /** The beat the EDIT buffer shows; an explicit null records that nothing is open. */
  beat?: string | null;
  cpsByBeat?: Record<string, number>;
  beatSort?: BeatSortMode;
  manualBeatOrder?: string[];
  /** Plugin dock layout. Session-scoped on purpose: beat switches must not
   * close devices or reset them, so this is never pruned per beat. */
  dock?: DockState;
};
type StoredState = SessionState & { usedAt?: number };

export type SessionStore = {
  list(): Promise<Session[]>;
  create(name: string): Promise<void>;
  touch(name: string): Promise<void>;
  getState(name: string): Promise<SessionState>;
  setState(name: string, state: SessionState): Promise<void>;
};

const STATE_FILE = '.session.json';
const SHARED_FILES = ['AGENTS.md'] as const;
const SHARED_FOLDERS = ['.claude', '.agents'] as const;

// Date.now() can repeat across calls that land in the same millisecond (e.g. create()
// immediately followed by touch()), which would make list()'s sort order depend on
// filesystem readdir order instead of recency. Force each stamp to be strictly greater
// than the last one handed out, while staying close to wall-clock time.
let lastUsedAt = 0;
function nextUsedAt(): number {
  lastUsedAt = Math.max(Date.now(), lastUsedAt + 1);
  return lastUsedAt;
}

/**
 * Point a session at the shared harness files.
 *
 * AGENTS.md is found by walking up the tree, but harness commands and skills
 * are looked up from the working directory. Links keep one shared copy and
 * reach it from every session.
 */
async function linkShared(root: string, sessionPath: string): Promise<void> {
  for (const file of SHARED_FILES) {
    await linkSharedPath(root, sessionPath, file);
  }
  for (const folder of SHARED_FOLDERS) {
    await linkSharedPath(root, sessionPath, folder);
  }
}

async function linkSharedPath(root: string, sessionPath: string, name: string): Promise<void> {
  try {
    await access(join(root, name));
  } catch {
    return; // Nothing to share yet.
  }
  try {
    await lstat(join(sessionPath, name));
    return; // The session already has its own, or the link is there.
  } catch {
    // Not present, so make it.
  }
  try {
    await symlink(join('..', name), join(sessionPath, name));
  } catch {
    // A link is a convenience; a session without one still works.
  }
}

/**
 * Seed the one example session into a brand-new sessions root.
 *
 * Fires only when the root has no session folder at all — a genuinely fresh
 * root, first launch or a fresh STRUDEL_BEATS_DIR — so a root the user has
 * already put sessions into is never touched, duplicated, or overwritten.
 * Failures are swallowed like seedHarnessContent's: the example session is a
 * convenience, never a reason to refuse to open.
 */
async function seedDefaultSession(base: string): Promise<void> {
  try {
    const entries = await readdir(base, { withFileTypes: true });
    if (entries.some((entry) => entry.isDirectory() && !entry.name.startsWith('.'))) {
      return;
    }
    const full = join(base, DEFAULT_SESSION_NAME);
    await mkdir(full, { recursive: true });
    for (const [name, content] of Object.entries(DEFAULT_SESSION_BEATS)) {
      await writeFile(join(full, name), content, 'utf8');
    }
    await write(full, { ...DEFAULT_SESSION_STATE, usedAt: nextUsedAt() });
    await linkShared(base, full);
  } catch {
    // Seeding is a convenience. A root it could not reach still works.
  }
}

export const STARTER_BEAT = `// a new beat
setcps(0.5)

stack(
  s("bd*2, ~ sd"),
  s("hh*8").gain(0.4),
)
`;

/**
 * Sessions are folders of beats.
 *
 * Recency lives in each session's own state file rather than in a central
 * index, so a session folder copied or moved in Finder carries its history
 * with it and there is no second source of truth to fall out of step.
 */
export function createSessionStore(root: string): SessionStore {
  const base = resolve(root);

  function locate(name: string): string {
    const full = resolve(base, name);
    if (full === base || !full.startsWith(base + sep) || name.includes('/')) {
      throw new Error(`Session name points outside the sessions folder: ${name}`);
    }
    return full;
  }

  async function exists(full: string): Promise<boolean> {
    try {
      await access(full);
      return true;
    } catch {
      return false;
    }
  }

  return {
    async list() {
      await mkdir(base, { recursive: true });
      // The first thing the app asks the store for is this list, so it is
      // also the moment a fresh root gets its default AGENTS.md and skills,
      // and — only when it has no sessions of its own yet — the example one.
      await seedHarnessContent(base);
      await seedDefaultSession(base);
      const entries = await readdir(base, { withFileTypes: true });
      const sessions = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
          .map(async (entry) => {
            const full = join(base, entry.name);
            const files = await readdir(full);
            return {
              name: entry.name,
              beats: files.filter((file) => file.endsWith(BEAT_EXTENSION)).length,
              usedAt: (await read(full)).usedAt ?? 0,
            };
          }),
      );
      return sessions.sort((a, b) => b.usedAt - a.usedAt);
    },

    async create(name) {
      const full = locate(name);
      if (await exists(full)) {
        throw new Error(`${name} already exists.`);
      }
      await mkdir(full, { recursive: true });
      // Never open onto an empty screen with nothing to play.
      await writeFile(join(full, `untitled${BEAT_EXTENSION}`), STARTER_BEAT, 'utf8');
      await write(full, { usedAt: nextUsedAt() });
      await linkShared(base, full);
    },

    async touch(name) {
      const full = locate(name);
      const { usedAt: _usedAt, ...state } = await read(full);
      await write(full, { ...(await pruneStaleState(full, state)), usedAt: nextUsedAt() });
      await linkShared(base, full);
    },

    async getState(name) {
      const full = locate(name);
      const { usedAt: _usedAt, ...state } = await read(full);
      return pruneStaleState(full, state);
    },

    async setState(name, state) {
      const full = locate(name);
      const previous = await read(full);
      const merged: SessionState = {
        ...previous,
        ...state,
        ...(state.cpsByBeat ? { cpsByBeat: { ...previous.cpsByBeat, ...state.cpsByBeat } } : {}),
      };
      // Written state is the one place every writer funnels through, so this
      // is where per-beat leftovers of deleted beats get dropped.
      await write(full, await pruneStaleState(full, merged));
    },
  };
}

async function read(sessionPath: string): Promise<StoredState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(sessionPath, STATE_FILE), 'utf8'));
    if (!isRecord(parsed)) {
      return {};
    }
    const state: StoredState = {};
    if (typeof parsed.beat === 'string') {
      state.beat = parsed.beat;
    } else if (parsed.beat === null) {
      // An explicit null records that the buffer showed no beat at all.
      state.beat = null;
    }
    if (isTempoMap(parsed.cpsByBeat)) {
      state.cpsByBeat = parsed.cpsByBeat;
    }
    if (isBeatSortMode(parsed.beatSort)) {
      state.beatSort = parsed.beatSort;
    }
    if (isStringArray(parsed.manualBeatOrder)) {
      state.manualBeatOrder = parsed.manualBeatOrder;
    }
    if (isDockState(parsed.dock)) {
      state.dock = parsed.dock;
    }
    // Migrate the old session-wide tempo to the beat it belonged to.
    if (typeof parsed.cps === 'number' && Number.isFinite(parsed.cps) && state.beat) {
      state.cpsByBeat = { ...state.cpsByBeat, [state.beat]: parsed.cps };
    }
    if (typeof parsed.usedAt === 'number') {
      state.usedAt = parsed.usedAt;
    }
    return state;
  } catch {
    // Missing or corrupt. Losing the beat you were on beats refusing to open.
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTempoMap(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every((tempo) => typeof tempo === 'number' && Number.isFinite(tempo));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

async function write(sessionPath: string, state: StoredState): Promise<void> {
  await writeFile(join(sessionPath, STATE_FILE), JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Beat files that exist in the session right now, under the same rules the
 * beat store lists them: dotfiles skipped, subfolders walked, `.js` counts.
 */
async function existingBeats(sessionPath: string): Promise<Set<string>> {
  const names = new Set<string>();
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), name);
      } else if (entry.name.endsWith(BEAT_EXTENSION)) {
        names.add(name);
      }
    }
  }
  await walk(sessionPath, '');
  return names;
}

/**
 * Drop per-beat state whose beat no longer exists. Clones get deleted, files
 * get renamed by a harness, and a tempo or drag order for a beat that is gone
 * is nothing but a lie the next open would inherit.
 */
async function pruneStaleState(sessionPath: string, state: SessionState): Promise<SessionState> {
  let existing: Set<string>;
  try {
    existing = await existingBeats(sessionPath);
  } catch {
    // Pruning needs to know which beats exist; without that (folder gone,
    // unreadable) hand the state back untouched rather than guessing.
    return state;
  }
  const pruned: SessionState = { ...state };
  if (pruned.cpsByBeat) {
    const tempos = Object.fromEntries(Object.entries(pruned.cpsByBeat).filter(([name]) => existing.has(name)));
    if (Object.keys(tempos).length > 0) {
      pruned.cpsByBeat = tempos;
    } else {
      delete pruned.cpsByBeat;
    }
  }
  if (pruned.manualBeatOrder) {
    const order = pruned.manualBeatOrder.filter((name) => existing.has(name));
    if (order.length > 0) {
      pruned.manualBeatOrder = order;
    } else {
      delete pruned.manualBeatOrder;
    }
  }
  return pruned;
}
