import { constants, type Dirent } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

export const DEFAULT_SESSIONS_ROOT_NAME = 'strudel++';
export const LEGACY_MIGRATION_DIRECTORY = 'legacy-migration';
export const LEGACY_MIGRATION_MARKER = '.strudel-legacy-archive';
export const LEGACY_MIGRATION_MARKER_CONTENT = 'strudel++ legacy migration archive\n';

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
type CopyResult = 'copied' | 'changed' | 'missing';

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
    if (legacyRoot === root || root.startsWith(`${legacyRoot}${sep}`) || legacyRoot.startsWith(`${root}${sep}`)) {
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
    let remaining: string[];
    try {
      remaining = await migrateLegacyRoot(root, legacyRoot, conflicts);
    } catch (error: unknown) {
      await writeMigrationReport(root, conflicts);
      const recovery = await writeIncompleteMigrationReport(
        root,
        legacyRoot,
        await remainingLegacyEntries(legacyRoot),
        error,
      );
      throw new Error(`Legacy sessions root migration incomplete. See ${relative(root, recovery)}`);
    }
    await writeMigrationReport(root, conflicts);
    if (remaining.length > 0) {
      const recovery = await writeIncompleteMigrationReport(root, legacyRoot, remaining);
      throw new Error(`Legacy sessions root migration incomplete. See ${relative(root, recovery)}`);
    }
  }
}

async function migrateLegacyRoot(root: string, legacyRoot: string, conflicts: MigrationConflict[]): Promise<string[]> {
  const context: MigrationContext = { root, legacyRoot, conflicts };
  for (let pass = 0; pass < 2; pass += 1) {
    const entries = await readDirectoryEntries(legacyRoot);
    if (entries.length === 0) {
      try {
        await rmdir(legacyRoot);
        return [];
      } catch (error: unknown) {
        if (hasCode(error, 'ENOENT')) {
          return [];
        }
        if (!hasCode(error, 'ENOTEMPTY') && !hasCode(error, 'EEXIST')) {
          throw error;
        }
      }
      continue;
    }

    await migrateLegacyEntries(context, entries);
    try {
      await rmdir(legacyRoot);
      return [];
    } catch (error: unknown) {
      if (hasCode(error, 'ENOENT')) {
        return [];
      }
      if (!hasCode(error, 'ENOTEMPTY') && !hasCode(error, 'EEXIST')) {
        throw error;
      }
    }
  }

  return (await readDirectoryEntries(legacyRoot)).map((entry) => entry.name);
}

async function readDirectoryEntries(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) {
      return [];
    }
    throw error;
  }
}

async function remainingLegacyEntries(legacyRoot: string): Promise<string[]> {
  return (await readDirectoryEntries(legacyRoot)).map((entry) => entry.name);
}

async function migrateLegacyEntries(context: MigrationContext, entries: readonly Dirent[]): Promise<void> {
  for (const entry of entries) {
    const source = join(context.legacyRoot, entry.name);
    if ((await entryKind(source)) === 'missing') {
      continue;
    }

    if (isSharedEntry(entry.name)) {
      await migrateSharedEntry(context, entry.name);
      continue;
    }

    const destination = join(context.root, entry.name);
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

async function moveSessionWithUniqueName(
  context: MigrationContext,
  source: string,
  originalName: string,
): Promise<void> {
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
    return moveDirectoryEntry(source, destination);
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

async function moveDirectoryEntry(source: string, destination: string): Promise<MoveResult> {
  if ((await entryKind(destination)) !== 'missing') {
    return 'collision';
  }
  const stage = await createStageDirectory(destination);
  try {
    const copied = await copyDirectoryContents(source, stage);
    if (copied === 'missing') {
      return 'missing';
    }
    if (copied === 'changed') {
      return 'collision';
    }
    if ((await entryKind(source)) !== 'directory') {
      return 'missing';
    }

    const published = await publishStage(stage, destination);
    if (published === 'collision') {
      return 'collision';
    }
    if (await entriesEqual(source, destination, 'directory', 'directory')) {
      await removeTree(source);
      return 'moved';
    }
    return 'collision';
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function createStageDirectory(destination: string): Promise<string> {
  const parent = dirname(destination);
  const baseName = `.${basename(destination)}.migration-stage`;
  let attempt = 1;
  while (true) {
    const name = attempt === 1 ? baseName : `${baseName}-${attempt}`;
    const stage = join(parent, name);
    try {
      await mkdir(stage);
      return stage;
    } catch (error: unknown) {
      if (hasCode(error, 'EEXIST')) {
        attempt += 1;
        continue;
      }
      throw error;
    }
  }
}

async function copyDirectoryContents(source: string, destination: string): Promise<CopyResult> {
  let entries: Dirent[];
  try {
    entries = await readdir(source, { withFileTypes: true });
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) {
      return 'missing';
    }
    throw error;
  }
  for (const entry of entries) {
    const result = await copyEntry(join(source, entry.name), join(destination, entry.name));
    if (result === 'changed') {
      return 'changed';
    }
  }
  return 'copied';
}

async function copyEntry(source: string, destination: string): Promise<CopyResult> {
  const sourceKind = await entryKind(source);
  if (sourceKind === 'missing') {
    return 'missing';
  }
  if (sourceKind === 'directory') {
    try {
      await mkdir(destination);
    } catch (error: unknown) {
      if (hasCode(error, 'EEXIST')) {
        return 'changed';
      }
      throw error;
    }
    return copyDirectoryContents(source, destination);
  }
  if (sourceKind === 'file') {
    try {
      await copyFile(source, destination, constants.COPYFILE_EXCL);
    } catch (error: unknown) {
      if (hasCode(error, 'EEXIST')) {
        return 'changed';
      }
      throw error;
    }
    return (await filesEqual(source, destination)) ? 'copied' : 'changed';
  }
  if (sourceKind === 'symlink') {
    const target = await readlink(source);
    try {
      await symlink(target, destination);
      return 'copied';
    } catch (error: unknown) {
      if (hasCode(error, 'EEXIST')) {
        return 'changed';
      }
      throw error;
    }
  }
  throw new Error(`Cannot migrate unsupported filesystem entry: ${source}`);
}

async function publishStage(stage: string, destination: string): Promise<MoveResult> {
  try {
    await mkdir(destination);
  } catch (error: unknown) {
    if (hasCode(error, 'EEXIST')) {
      return 'collision';
    }
    throw error;
  }

  const published: string[] = [];
  let collision = false;
  try {
    const entries = await readdir(stage, { withFileTypes: true });
    for (const entry of entries) {
      const result = await moveEntry(join(stage, entry.name), join(destination, entry.name));
      if (result === 'collision') {
        collision = true;
        break;
      }
      if (result === 'moved') {
        published.push(entry.name);
      }
    }
  } catch (error: unknown) {
    await rollbackPublished(destination, stage, published);
    throw error;
  }

  if (collision) {
    await rollbackPublished(destination, stage, published);
    return 'collision';
  }
  await rmdir(stage);
  return 'moved';
}

async function rollbackPublished(destination: string, stage: string, published: readonly string[]): Promise<void> {
  for (const name of [...published].reverse()) {
    const result = await moveEntry(join(destination, name), join(stage, name));
    if (result === 'collision') {
      throw new Error(`Could not roll back staged migration entry: ${join(destination, name)}`);
    }
  }
  try {
    await rmdir(destination);
  } catch (error: unknown) {
    if (!hasCode(error, 'ENOENT') && !hasCode(error, 'ENOTEMPTY') && !hasCode(error, 'EEXIST')) {
      throw error;
    }
  }
}

async function entriesEqual(
  source: string,
  destination: string,
  sourceKind: EntryKind,
  destinationKind: EntryKind,
): Promise<boolean> {
  if (sourceKind === 'directory' && destinationKind === 'directory') {
    return directoriesEqual(source, destination);
  }
  if (sourceKind === 'file' && destinationKind === 'file') {
    return filesEqual(source, destination);
  }
  if (sourceKind === 'symlink' && destinationKind === 'symlink') {
    return (await readlink(source)) === (await readlink(destination));
  }
  return false;
}

async function directoriesEqual(source: string, destination: string): Promise<boolean> {
  let sourceEntries: Dirent[];
  let destinationEntries: Dirent[];
  try {
    [sourceEntries, destinationEntries] = await Promise.all([
      readdir(source, { withFileTypes: true }),
      readdir(destination, { withFileTypes: true }),
    ]);
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) {
      return false;
    }
    throw error;
  }
  if (sourceEntries.length !== destinationEntries.length) {
    return false;
  }
  const destinationNames = new Set(destinationEntries.map((entry) => entry.name));
  for (const entry of sourceEntries) {
    if (!destinationNames.has(entry.name)) {
      return false;
    }
    const childSource = join(source, entry.name);
    const childDestination = join(destination, entry.name);
    const [sourceKind, destinationKind] = await Promise.all([entryKind(childSource), entryKind(childDestination)]);
    if (!(await entriesEqual(childSource, childDestination, sourceKind, destinationKind))) {
      return false;
    }
  }
  return true;
}

async function filesEqual(source: string, destination: string): Promise<boolean> {
  try {
    const [sourceContent, destinationContent] = await Promise.all([readFile(source), readFile(destination)]);
    return sourceContent.equals(destinationContent);
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) {
      return false;
    }
    throw error;
  }
}

async function removeSource(source: string, kind: EntryKind): Promise<void> {
  if (kind === 'directory') {
    await rmdir(source);
    return;
  }
  await unlink(source);
}

async function removeTree(path: string): Promise<void> {
  const kind = await entryKind(path);
  if (kind === 'missing') {
    return;
  }
  if (kind === 'directory') {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      await removeTree(join(path, entry.name));
    }
    await rmdir(path);
    return;
  }
  if (kind === 'file' || kind === 'symlink') {
    await unlink(path);
    return;
  }
  throw new Error(`Cannot remove unsupported filesystem entry: ${path}`);
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
      try {
        await writeFile(join(candidate, LEGACY_MIGRATION_MARKER), LEGACY_MIGRATION_MARKER_CONTENT, {
          encoding: 'utf8',
          flag: 'wx',
        });
      } catch (error: unknown) {
        await rm(candidate, { recursive: true, force: true });
        throw error;
      }
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

async function writeIncompleteMigrationReport(
  root: string,
  legacyRoot: string,
  remaining: readonly string[],
  reason?: unknown,
): Promise<string> {
  const details =
    remaining.length > 0
      ? remaining.map((name) => `- \`${join(legacyRoot, name)}\``)
      : ['- Inspect the legacy root directly.'];
  const report = [
    '# Legacy migration incomplete',
    '',
    `The app could not finish migrating \`${legacyRoot}\`. The legacy root remains the source of truth for these entries:`,
    '',
    ...details,
    ...(reason ? ['', `Migration error: ${errorMessage(reason)}`] : []),
    '',
  ].join('\n');

  let attempt = 1;
  while (true) {
    const name = attempt === 1 ? 'LEGACY-MIGRATION-INCOMPLETE.md' : `LEGACY-MIGRATION-INCOMPLETE (${attempt}).md`;
    const path = join(root, name);
    try {
      await writeFile(path, report, { encoding: 'utf8', flag: 'wx' });
      return path;
    } catch (error: unknown) {
      if (hasCode(error, 'EEXIST')) {
        attempt += 1;
        continue;
      }
      throw error;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
