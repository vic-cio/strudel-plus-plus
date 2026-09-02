import { constants, type Dirent } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

export const DEFAULT_SESSIONS_ROOT_NAME = 'strudel++';
export const LEGACY_MIGRATION_DIRECTORY = 'legacy-migration';

export function isLegacyMigrationDirectory(name: string): boolean {
  return name === LEGACY_MIGRATION_DIRECTORY || /^legacy-migration \(\d+\)$/.test(name);
}

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

type EntryKind = 'missing' | 'directory' | 'file' | 'symlink' | 'other';
type MoveResult = 'moved' | 'collision' | 'missing';

type MigrationConflict = {
  source: string;
  archived: string;
};

type MigrationContext = {
  root: string;
  legacyRoot: string;
  conflicts: MigrationConflict[];
  archiveRoot?: string;
};

async function entryKind(path: string): Promise<EntryKind> {
  try {
    const stats = await lstat(path);
    if (stats.isDirectory()) {
      return 'directory';
    }
    if (stats.isFile()) {
      return 'file';
    }
    if (stats.isSymbolicLink()) {
      return 'symlink';
    }
    return 'other';
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
  const rootKind = await entryKind(root);
  if (rootKind !== 'missing' && rootKind !== 'directory') {
    throw new Error(`Sessions root exists but is not a directory: ${root}`);
  }

  const existingLegacyRoots: string[] = [];
  for (const legacyRoot of legacyRoots) {
    if (
      legacyRoot === root ||
      root.startsWith(`${legacyRoot}${sep}`) ||
      legacyRoot.startsWith(`${root}${sep}`)
    ) {
      throw new Error(`Sessions roots cannot contain one another: ${root} and ${legacyRoot}`);
    }
    const legacyKind = await entryKind(legacyRoot);
    if (legacyKind === 'missing') {
      continue;
    }
    if (legacyKind !== 'directory') {
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
    const conflicts: MigrationConflict[] = [];
    await migrateLegacyRoot(root, legacyRoot, conflicts);
    await writeMigrationReport(root, conflicts);
  }
}

async function migrateLegacyRoot(root: string, legacyRoot: string, conflicts: MigrationConflict[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(legacyRoot, { withFileTypes: true });
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) {
      return;
    }
    throw error;
  }

  const context: MigrationContext = { root, legacyRoot, conflicts };
  for (const entry of entries) {
    const source = join(legacyRoot, entry.name);
    if ((await entryKind(source)) === 'missing') {
      continue;
    }

    if (isSharedEntry(entry.name)) {
      await migrateSharedEntry(context, entry.name);
      continue;
    }

    const destination = join(root, entry.name);
    const result = await moveEntry(source, destination);
    if (result === 'moved' || result === 'missing') {
      continue;
    }

    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      await moveSessionWithUniqueName(context, source, entry.name);
      continue;
    }

    await archiveConflict(context, source, entry.name);
  }

  try {
    await rmdir(legacyRoot);
  } catch (error: unknown) {
    if (!hasCode(error, 'ENOENT') && !hasCode(error, 'ENOTEMPTY') && !hasCode(error, 'EEXIST')) {
      throw error;
    }
  }
}

function isSharedEntry(name: string): boolean {
  return name === 'AGENTS.md' || name === '.claude' || name === '.agents';
}

async function migrateSharedEntry(context: MigrationContext, name: string): Promise<void> {
  const source = join(context.legacyRoot, name);
  const destination = join(context.root, name);

  while (true) {
    const sourceKind = await entryKind(source);
    if (sourceKind === 'missing') {
      return;
    }
    const destinationKind = await entryKind(destination);
    if (destinationKind === 'missing') {
      const result = await moveEntry(source, destination);
      if (result === 'moved' || result === 'missing') {
        return;
      }
      continue;
    }

    if (sourceKind === 'directory' && destinationKind === 'directory') {
      await mergeDirectory(context, source, destination, name);
      return;
    }
    if (await entriesEqual(source, destination, sourceKind, destinationKind)) {
      await removeSource(source, sourceKind);
      return;
    }

    await archiveConflict(context, source, name);
    return;
  }
}

async function mergeDirectory(
  context: MigrationContext,
  source: string,
  destination: string,
  relativePath: string,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(source, { withFileTypes: true });
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const sourceChild = join(source, entry.name);
    if ((await entryKind(sourceChild)) === 'missing') {
      continue;
    }
    const destinationChild = join(destination, entry.name);
    const sourceKind = await entryKind(sourceChild);
    const destinationKind = await entryKind(destinationChild);
    const childRelativePath = join(relativePath, entry.name);

    if (destinationKind === 'missing') {
      const result = await moveEntry(sourceChild, destinationChild);
      if (result === 'moved' || result === 'missing') {
        continue;
      }
      await archiveConflict(context, sourceChild, childRelativePath);
      continue;
    }
    if (sourceKind === 'directory' && destinationKind === 'directory') {
      await mergeDirectory(context, sourceChild, destinationChild, childRelativePath);
      continue;
    }
    if (await entriesEqual(sourceChild, destinationChild, sourceKind, destinationKind)) {
      await removeSource(sourceChild, sourceKind);
      continue;
    }
    await archiveConflict(context, sourceChild, childRelativePath);
  }

  try {
    await rmdir(source);
  } catch (error: unknown) {
    if (!hasCode(error, 'ENOENT') && !hasCode(error, 'ENOTEMPTY') && !hasCode(error, 'EEXIST')) {
      throw error;
    }
  }
}

async function moveSessionWithUniqueName(context: MigrationContext, source: string, originalName: string): Promise<void> {
  let attempt = 1;
  while (true) {
    const suffix = attempt === 1 ? 'legacy' : `legacy ${attempt}`;
    const destination = join(context.root, `${originalName} (${suffix})`);
    const result = await moveEntry(source, destination);
    if (result === 'moved' || result === 'missing') {
      return;
    }
    attempt += 1;
  }
}

async function moveEntry(source: string, destination: string): Promise<MoveResult> {
  const sourceKind = await entryKind(source);
  if (sourceKind === 'missing') {
    return 'missing';
  }

  if (sourceKind === 'directory') {
    try {
      await mkdir(destination);
    } catch (error: unknown) {
      if (hasCode(error, 'EEXIST')) {
        return 'collision';
      }
      throw error;
    }
    let entries: Dirent[];
    try {
      entries = await readdir(source, { withFileTypes: true });
    } catch (error: unknown) {
      if (hasCode(error, 'ENOENT')) {
        try {
          await rmdir(destination);
          return 'missing';
        } catch (cleanupError: unknown) {
          if (hasCode(cleanupError, 'ENOENT')) {
            return 'missing';
          }
          if (hasCode(cleanupError, 'ENOTEMPTY') || hasCode(cleanupError, 'EEXIST')) {
            return 'collision';
          }
          throw cleanupError;
        }
      }
      throw error;
    }
    for (const entry of entries) {
      const result = await moveEntry(join(source, entry.name), join(destination, entry.name));
      if (result === 'collision') {
        return 'collision';
      }
    }
    try {
      await rmdir(source);
    } catch (error: unknown) {
      if (hasCode(error, 'ENOENT')) {
        return 'moved';
      }
      if (hasCode(error, 'ENOTEMPTY') || hasCode(error, 'EEXIST')) {
        return 'collision';
      }
      throw error;
    }
    return 'moved';
  }

  if (sourceKind === 'file') {
    try {
      await copyFile(source, destination, constants.COPYFILE_EXCL);
    } catch (error: unknown) {
      if (hasCode(error, 'EEXIST')) {
        return 'collision';
      }
      throw error;
    }
    if (!(await filesEqual(source, destination))) {
      return 'collision';
    }
    try {
      await unlink(source);
    } catch (error: unknown) {
      if (hasCode(error, 'ENOENT')) {
        return 'moved';
      }
      throw error;
    }
    return 'moved';
  }

  if (sourceKind === 'symlink') {
    const target = await readlink(source);
    try {
      await symlink(target, destination);
    } catch (error: unknown) {
      if (hasCode(error, 'EEXIST')) {
        return 'collision';
      }
      throw error;
    }
    try {
      await unlink(source);
    } catch (error: unknown) {
      if (hasCode(error, 'ENOENT')) {
        return 'moved';
      }
      throw error;
    }
    return 'moved';
  }

  throw new Error(`Cannot migrate unsupported filesystem entry: ${source}`);
}

async function entriesEqual(source: string, destination: string, sourceKind: EntryKind, destinationKind: EntryKind): Promise<boolean> {
  if (sourceKind === 'file' && destinationKind === 'file') {
    return filesEqual(source, destination);
  }
  if (sourceKind === 'symlink' && destinationKind === 'symlink') {
    return (await readlink(source)) === (await readlink(destination));
  }
  return false;
}

async function filesEqual(source: string, destination: string): Promise<boolean> {
  const [sourceContent, destinationContent] = await Promise.all([readFile(source), readFile(destination)]);
  return sourceContent.equals(destinationContent);
}

async function removeSource(source: string, kind: EntryKind): Promise<void> {
  if (kind === 'directory') {
    await rmdir(source);
    return;
  }
  await unlink(source);
}

async function archiveConflict(context: MigrationContext, source: string, relativePath: string): Promise<void> {
  const archiveRoot = await ensureArchiveRoot(context);
  let attempt = 1;
  while (true) {
    const path = relativePath.split(sep).join('/');
    const pathDirectory = dirname(path);
    const pathName = basename(path);
    const archiveName = attempt === 1 ? pathName : `${pathName} (${attempt})`;
    const destination = join(archiveRoot, pathDirectory, archiveName);
    await mkdir(dirname(destination), { recursive: true });
    const result = await moveEntry(source, destination);
    if (result === 'moved') {
      context.conflicts.push({
        source: join(basename(context.legacyRoot), path),
        archived: relative(context.root, destination),
      });
      return;
    }
    if (result === 'missing') {
      return;
    }
    attempt += 1;
  }
}

async function ensureArchiveRoot(context: MigrationContext): Promise<string> {
  if (context.archiveRoot) {
    return context.archiveRoot;
  }
  let archiveBase: string;
  let baseAttempt = 1;
  while (true) {
    const name = baseAttempt === 1 ? LEGACY_MIGRATION_DIRECTORY : `${LEGACY_MIGRATION_DIRECTORY} (${baseAttempt})`;
    const candidate = join(context.root, name);
    try {
      await mkdir(candidate);
      archiveBase = candidate;
      break;
    } catch (error: unknown) {
      if (hasCode(error, 'EEXIST')) {
        baseAttempt += 1;
        continue;
      }
      throw error;
    }
  }
  const label = basename(context.legacyRoot) || 'legacy-root';
  let attempt = 1;
  while (true) {
    const name = attempt === 1 ? label : `${label} (${attempt})`;
    const candidate = join(archiveBase, name);
    try {
      await mkdir(candidate);
      context.archiveRoot = candidate;
      return candidate;
    } catch (error: unknown) {
      if (hasCode(error, 'EEXIST')) {
        attempt += 1;
        continue;
      }
      throw error;
    }
  }
}

async function writeMigrationReport(root: string, conflicts: readonly MigrationConflict[]): Promise<void> {
  if (conflicts.length === 0) {
    return;
  }
  const report = [
    '# Legacy migration conflicts',
    '',
    'The canonical sessions root kept its existing content. Legacy entries that conflicted were preserved here:',
    '',
    ...conflicts.map(({ source, archived }) => `- \`${source}\` → \`${archived}\``),
    '',
  ].join('\n');

  let attempt = 1;
  while (true) {
    const name = attempt === 1 ? 'LEGACY-MIGRATION.md' : `LEGACY-MIGRATION (${attempt}).md`;
    try {
      await writeFile(join(root, name), report, { encoding: 'utf8', flag: 'wx' });
      return;
    } catch (error: unknown) {
      if (hasCode(error, 'EEXIST')) {
        attempt += 1;
        continue;
      }
      throw error;
    }
  }
}
