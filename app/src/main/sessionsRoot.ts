import { lstat, mkdir, readdir, rename, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

export const DEFAULT_SESSIONS_ROOT_NAME = 'strudel++';

export function defaultSessionsRoot(home: string = homedir()): string {
  return join(home, 'Music', DEFAULT_SESSIONS_ROOT_NAME);
}

/**
 * Roots used by releases before the sessions directory was renamed.
 *
 * Keep the former development root here as well as the original user-facing
 * root: both can contain captain sessions that must not disappear on upgrade.
 */
export function legacySessionsRoots(home: string = homedir()): string[] {
  return [join(home, 'Music', 'Strudel'), join(home, 'Documents', 'Programming', 'strudel', 'my-sessions')];
}

export type SessionsRootOptions = {
  envRoot?: string;
  home?: string;
  defaultRoot?: string;
  legacyRoots?: readonly string[];
};

/**
 * Resolve the app's sessions root and bring legacy roots under the canonical
 * name. Explicit STRUDEL_BEATS_DIR remains authoritative and is never
 * migrated: it is an intentional escape hatch for alternate data locations.
 */
export async function resolveSessionsRoot(options: SessionsRootOptions = {}): Promise<string> {
  const configured = options.envRoot ?? process.env.STRUDEL_BEATS_DIR;
  if (configured) {
    return resolve(configured);
  }

  const home = options.home ?? homedir();
  const root = resolve(options.defaultRoot ?? defaultSessionsRoot(home));
  const legacyRoots = [...(options.legacyRoots ?? legacySessionsRoots(home))]
    .map((legacyRoot) => resolve(legacyRoot))
    .filter((legacyRoot, index, roots) => legacyRoot !== root && roots.indexOf(legacyRoot) === index);

  await migrateLegacyRoots(root, legacyRoots);
  return root;
}

type PathKind = 'missing' | 'directory' | 'other';

async function pathKind(path: string): Promise<PathKind> {
  try {
    return (await lstat(path)).isDirectory() ? 'directory' : 'other';
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) {
      return 'missing';
    }
    throw error;
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

async function migrateLegacyRoots(root: string, legacyRoots: readonly string[]): Promise<void> {
  const rootKind = await pathKind(root);
  if (rootKind === 'other') {
    throw new Error(`Sessions root exists but is not a directory: ${root}`);
  }

  const existingLegacyRoots: string[] = [];
  for (const legacyRoot of legacyRoots) {
    if (legacyRoot === root || root.startsWith(`${legacyRoot}${sep}`)) {
      throw new Error(`Sessions root cannot be inside its legacy root: ${root}`);
    }
    const legacyKind = await pathKind(legacyRoot);
    if (legacyKind === 'missing') {
      continue;
    }
    if (legacyKind === 'other') {
      throw new Error(`Legacy sessions root exists but is not a directory: ${legacyRoot}`);
    }
    existingLegacyRoots.push(legacyRoot);
  }

  if (existingLegacyRoots.length === 0) {
    return;
  }
  if (rootKind === 'missing') {
    await mkdir(root, { recursive: true });
  }

  for (const legacyRoot of existingLegacyRoots) {
    await migrateLegacyRoot(root, legacyRoot);
  }
}

async function migrateLegacyRoot(root: string, legacyRoot: string): Promise<void> {
  const entries = await readdir(legacyRoot, { withFileTypes: true });
  for (const entry of entries) {
    const source = join(legacyRoot, entry.name);
    if ((await pathKind(source)) === 'missing') {
      // Another startup may have completed this entry between readdir and now.
      continue;
    }

    const destination = join(root, entry.name);
    if ((await pathKind(destination)) === 'missing') {
      await rename(source, destination);
      continue;
    }

    // A session name collision must preserve both folders. The migrated copy
    // remains visible in the new root instead of silently replacing the newer
    // session already there.
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const migratedName = await nextAvailableSessionName(root, entry.name);
      await rename(source, join(root, migratedName));
    }
    // Shared root files/folders with the same name stay in the legacy root;
    // neither copy is overwritten, and the legacy root is retained if needed.
  }

  try {
    await rmdir(legacyRoot);
  } catch (error: unknown) {
    if (!hasCode(error, 'ENOTEMPTY') && !hasCode(error, 'EEXIST')) {
      throw error;
    }
    // A colliding shared file is intentionally retained for safety.
  }
}

async function nextAvailableSessionName(root: string, originalName: string): Promise<string> {
  let attempt = 1;
  while (true) {
    const suffix = attempt === 1 ? 'legacy' : `legacy ${attempt}`;
    const candidate = `${originalName} (${suffix})`;
    if ((await pathKind(join(root, candidate))) === 'missing') {
      return candidate;
    }
    attempt += 1;
  }
}
