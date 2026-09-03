import { constants, type Dirent } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
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
export const LEGACY_MIGRATION_TRANSACTION_MARKER = '.strudel-migration-transaction.json';
export const LEGACY_MIGRATION_LOCK = '.strudel-migration.lock';
export const LEGACY_MIGRATION_SOURCE_CLAIM_PREFIX = '.strudel-migration-source.';

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
type MoveResult = 'moved' | 'collision' | 'changed' | 'missing';
type CopyResult = 'copied' | 'changed' | 'missing';

type EntrySnapshot =
  | { kind: 'missing' }
  | { kind: 'file'; content: Buffer }
  | { kind: 'symlink'; target: string }
  | { kind: 'directory'; children: ReadonlyMap<string, EntrySnapshot> };

type MigrationTransaction = {
  source: string;
  stage: string;
};

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

  if (rootKind === 'missing') {
    await mkdir(root, { recursive: true });
  }

  await withMigrationLock(root, async () => {
    await migrateLegacyRootsWhileLocked(root, legacyRoots);
  });
}

async function migrateLegacyRootsWhileLocked(root: string, legacyRoots: readonly string[]): Promise<void> {
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
    await recoverStaleTransactionsWithReport(root);
    return;
  }
  await recoverStaleTransactionsWithReport(root);

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

type MigrationLock = {
  pid: number;
  token: string;
};

async function withMigrationLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = join(root, LEGACY_MIGRATION_LOCK);
  const lock: MigrationLock = {
    pid: process.pid,
    token: `${process.pid}:${Date.now()}:${Math.random()}`,
  };
  const contents = JSON.stringify(lock);
  let acquired = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await writeFile(lockPath, contents, { encoding: 'utf8', flag: 'wx' });
      acquired = true;
      break;
    } catch (error: unknown) {
      if (!hasCode(error, 'EEXIST')) {
        throw error;
      }
      let owner: MigrationLock;
      try {
        const parsed: unknown = JSON.parse(await readFile(lockPath, 'utf8'));
        if (
          !isRecord(parsed) ||
          typeof parsed.pid !== 'number' ||
          !Number.isInteger(parsed.pid) ||
          typeof parsed.token !== 'string'
        ) {
          throw new Error('invalid lock contents');
        }
        owner = { pid: parsed.pid, token: parsed.token };
      } catch (readError: unknown) {
        if (hasCode(readError, 'ENOENT')) {
          continue;
        }
        throw new Error(`Cannot inspect migration lock ${lockPath}: ${errorMessage(readError)}`);
      }
      if (isProcessAlive(owner.pid)) {
        throw new Error(`Sessions root migration is already in progress: ${lockPath}`);
      }
      try {
        await unlink(lockPath);
      } catch (unlinkError: unknown) {
        if (!hasCode(unlinkError, 'ENOENT')) {
          throw unlinkError;
        }
      }
    }
  }

  if (!acquired) {
    throw new Error(`Could not acquire sessions root migration lock: ${lockPath}`);
  }

  try {
    return await operation();
  } finally {
    try {
      const current = await readFile(lockPath, 'utf8');
      if (current === contents) {
        await unlink(lockPath);
      }
    } catch (error: unknown) {
      if (!hasCode(error, 'ENOENT')) {
        throw error;
      }
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return !hasCode(error, 'ESRCH');
  }
}

async function migrateLegacyRoot(root: string, legacyRoot: string, conflicts: MigrationConflict[]): Promise<string[]> {
  await recoverSourceClaims(legacyRoot);
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

    if (isSharedEntry(entry)) {
      await migrateSharedEntry(context, entry.name);
      continue;
    }

    const destination = join(context.root, entry.name);
    const result = await moveEntry(source, destination);
    if (result === 'moved' || result === 'missing') {
      continue;
    }
    if (result === 'changed') {
      throw new Error(`Source changed during migration: ${source}`);
    }

    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      await moveSessionWithUniqueName(context, source, entry.name);
      continue;
    }

    await archiveConflict(context, source, entry.name);
  }
}

function isSharedEntry(entry: Dirent): boolean {
  if (entry.name === 'AGENTS.md') {
    return entry.isFile();
  }
  return (entry.name === '.claude' || entry.name === '.agents') && entry.isDirectory();
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
      if (result === 'changed') {
        throw new Error(`Source changed during migration: ${source}`);
      }
      continue;
    }

    if (sourceKind === 'directory' && destinationKind === 'directory') {
      await mergeDirectory(context, source, destination, name);
      return;
    }
    if (await removeMatchingSource(source, destination, destinationKind)) {
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
      if (result === 'changed') {
        throw new Error(`Source changed during migration: ${sourceChild}`);
      }
      await archiveConflict(context, sourceChild, childRelativePath);
      continue;
    }
    if (sourceKind === 'directory' && destinationKind === 'directory') {
      await mergeDirectory(context, sourceChild, destinationChild, childRelativePath);
      continue;
    }
    if (await removeMatchingSource(sourceChild, destinationChild, destinationKind)) {
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
    if (result === 'changed') {
      throw new Error(`Source changed during migration: ${source}`);
    }
    attempt += 1;
  }
}

async function moveEntry(source: string, destination: string): Promise<MoveResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await moveEntryOnce(source, destination);
    if (result !== 'changed') {
      return result;
    }
  }
  return 'changed';
}

async function moveEntryOnce(source: string, destination: string): Promise<MoveResult> {
  const sourceKind = await entryKind(source);
  if (sourceKind === 'missing') {
    return 'missing';
  }

  if (sourceKind === 'directory') {
    return moveDirectoryEntry(source, destination);
  }

  if (sourceKind === 'file') {
    return moveFileEntry(source, destination);
  }

  if (sourceKind === 'symlink') {
    const expected = await snapshotEntry(source);
    const target = await readlink(source);
    try {
      await symlink(target, destination);
    } catch (error: unknown) {
      if (hasCode(error, 'EEXIST')) {
        return 'collision';
      }
      throw error;
    }
    if (!snapshotsEqual(expected, await snapshotEntry(source))) {
      await removeOwnedEntry(destination, expected);
      return 'changed';
    }
    const sourceResult = await removeSourceAfterVerification(source, expected);
    if (sourceResult === 'changed') {
      await removeOwnedEntry(destination, expected);
      return 'changed';
    }
    return 'moved';
  }

  throw new Error(`Cannot migrate unsupported filesystem entry: ${source}`);
}

async function moveFileEntry(source: string, destination: string): Promise<MoveResult> {
  if ((await entryKind(destination)) !== 'missing') {
    return 'collision';
  }
  const expected = await snapshotEntry(source);
  if (expected.kind === 'missing') {
    return 'missing';
  }
  const stage = await createStageFile(destination);
  try {
    try {
      await copyFile(source, stage);
    } catch (error: unknown) {
      if (hasCode(error, 'ENOENT')) {
        return 'missing';
      }
      throw error;
    }
    const staged = await snapshotEntry(stage);
    if (!snapshotsEqual(expected, await snapshotEntry(source))) {
      return 'changed';
    }
    try {
      await copyFile(stage, destination, constants.COPYFILE_EXCL);
    } catch (error: unknown) {
      if (hasCode(error, 'EEXIST')) {
        return 'collision';
      }
      throw error;
    }
    if (!snapshotsEqual(staged, await snapshotEntry(destination))) {
      await removeOwnedEntry(destination, staged);
      return 'changed';
    }
    if (!snapshotsEqual(expected, await snapshotEntry(source))) {
      await removeOwnedEntry(destination, staged);
      return 'changed';
    }
    const sourceResult = await removeSourceAfterVerification(source, expected);
    if (sourceResult === 'changed') {
      await removeOwnedEntry(destination, staged);
      return 'changed';
    }
    return 'moved';
  } finally {
    await rm(stage, { force: true });
  }
}

async function moveDirectoryEntry(source: string, destination: string): Promise<MoveResult> {
  if ((await entryKind(destination)) !== 'missing') {
    return 'collision';
  }
  const expected = await snapshotEntry(source);
  if (expected.kind === 'missing') {
    return 'missing';
  }
  const stage = await createStageDirectory(destination);
  try {
    const copied = await copyDirectoryContents(source, stage);
    if (copied === 'missing') {
      return 'missing';
    }
    if (copied === 'changed') {
      return 'changed';
    }
    if (!snapshotsEqual(expected, await snapshotEntry(source))) {
      return 'changed';
    }
    if (expected.kind !== 'directory') {
      return 'missing';
    }

    const published = await publishStage(stage, destination, source);
    if (published !== 'moved') {
      return published;
    }
    const sourceResult = await removeSourceAfterVerification(source, expected);
    if (sourceResult === 'changed') {
      await rollbackTransaction(destination, stage);
      return 'changed';
    }
    await finalizeTransaction(destination, stage);
    return 'moved';
  } finally {
    if (!(await hasTransactionMarker(destination))) {
      await rm(stage, { recursive: true, force: true });
    }
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

async function createStageFile(destination: string): Promise<string> {
  const parent = dirname(destination);
  const baseName = `.${basename(destination)}.migration-stage`;
  let attempt = 1;
  while (true) {
    const name = attempt === 1 ? baseName : `${baseName}-${attempt}`;
    const stage = join(parent, name);
    try {
      await writeFile(stage, Buffer.alloc(0), { flag: 'wx' });
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
    const expected = await snapshotEntry(source);
    try {
      await copyFile(source, destination, constants.COPYFILE_EXCL);
    } catch (error: unknown) {
      if (hasCode(error, 'EEXIST')) {
        return 'changed';
      }
      throw error;
    }
    if (!snapshotsEqual(expected, await snapshotEntry(source))) {
      return 'changed';
    }
    return (await filesEqual(source, destination)) ? 'copied' : 'changed';
  }
  if (sourceKind === 'symlink') {
    const expected = await snapshotEntry(source);
    const target = await readlink(source);
    try {
      await symlink(target, destination);
      return snapshotsEqual(expected, await snapshotEntry(source)) ? 'copied' : 'changed';
    } catch (error: unknown) {
      if (hasCode(error, 'EEXIST')) {
        return 'changed';
      }
      throw error;
    }
  }
  throw new Error(`Cannot migrate unsupported filesystem entry: ${source}`);
}

async function publishStage(stage: string, destination: string, source: string): Promise<MoveResult> {
  try {
    await mkdir(destination);
  } catch (error: unknown) {
    if (hasCode(error, 'EEXIST')) {
      return 'collision';
    }
    throw error;
  }

  const marker = join(destination, LEGACY_MIGRATION_TRANSACTION_MARKER);
  let transactionStarted = false;
  try {
    await writeFile(marker, JSON.stringify({ source, stage }), { encoding: 'utf8', flag: 'wx' });
    transactionStarted = true;
    const entries = await readdir(stage, { withFileTypes: true });
    if (entries.some((entry) => entry.name === LEGACY_MIGRATION_TRANSACTION_MARKER)) {
      throw new Error(`Cannot migrate an entry named ${LEGACY_MIGRATION_TRANSACTION_MARKER}: ${stage}`);
    }
    for (const entry of entries) {
      const result = await copyEntry(join(stage, entry.name), join(destination, entry.name));
      if (result !== 'copied') {
        await rollbackTransaction(destination, stage);
        return result === 'missing' ? 'changed' : result;
      }
    }
    if (!(await directoriesEqual(stage, destination, LEGACY_MIGRATION_TRANSACTION_MARKER))) {
      await rollbackTransaction(destination, stage);
      return 'changed';
    }
    return 'moved';
  } catch (error: unknown) {
    if (transactionStarted) {
      await rollbackTransaction(destination, stage);
    } else if ((await readDirectoryEntries(destination)).length === 0) {
      await rm(destination, { recursive: true, force: true });
    }
    throw error;
  }
}

async function rollbackTransaction(destination: string, stage: string): Promise<void> {
  if (!(await transactionContainsOnlyStagedContent(destination, stage))) {
    throw new Error(`Could not safely roll back migration transaction: ${destination}`);
  }
  await rm(destination, { recursive: true, force: true });
  await rm(stage, { recursive: true, force: true });
}

async function transactionContainsOnlyStagedContent(destination: string, stage: string): Promise<boolean> {
  const destinationEntries = await readDirectoryEntries(destination);
  for (const entry of destinationEntries) {
    if (entry.name === LEGACY_MIGRATION_TRANSACTION_MARKER) {
      continue;
    }
    const stagedPath = join(stage, entry.name);
    const stagedKind = await entryKind(stagedPath);
    const destinationPath = join(destination, entry.name);
    const destinationKind = await entryKind(destinationPath);
    if (stagedKind === 'missing' || !(await entriesEqual(stagedPath, destinationPath, stagedKind, destinationKind))) {
      return false;
    }
  }
  return true;
}

async function finalizeTransaction(destination: string, stage: string): Promise<void> {
  if (!(await directoriesEqual(stage, destination, LEGACY_MIGRATION_TRANSACTION_MARKER))) {
    throw new Error(`Cannot finalize migration transaction: ${destination}`);
  }
  await unlink(join(destination, LEGACY_MIGRATION_TRANSACTION_MARKER));
  await rm(stage, { recursive: true, force: true });
}

async function hasTransactionMarker(destination: string): Promise<boolean> {
  return (await entryKind(join(destination, LEGACY_MIGRATION_TRANSACTION_MARKER))) !== 'missing';
}

async function recoverStaleTransactionsWithReport(root: string): Promise<void> {
  try {
    await recoverStaleTransactions(root);
  } catch (error: unknown) {
    const recovery = await writeIncompleteMigrationReport(root, root, ['stale migration transaction'], error);
    throw new Error(`Legacy sessions root migration incomplete. See ${relative(root, recovery)}`);
  }
}

async function recoverStaleTransactions(root: string): Promise<void> {
  const artifacts = await findMigrationArtifacts(root);
  const referencedStages = new Set<string>();
  for (const marker of artifacts.markers) {
    const transaction = await readMigrationTransaction(marker);
    const destination = dirname(marker);
    const stage = resolve(transaction.stage);
    if (!isWithin(root, destination) || !isWithin(root, stage)) {
      throw new Error(`Migration transaction is outside the sessions root: ${marker}`);
    }
    referencedStages.add(stage);
    await recoverTransaction(destination, stage, resolve(transaction.source));
  }
  for (const stage of artifacts.stages) {
    if (!referencedStages.has(resolve(stage))) {
      await removeOrphanStage(stage);
    }
  }
}

type MigrationArtifacts = {
  markers: string[];
  stages: string[];
};

async function findMigrationArtifacts(path: string): Promise<MigrationArtifacts> {
  const artifacts: MigrationArtifacts = { markers: [], stages: [] };
  for (const entry of await readDirectoryEntries(path)) {
    const child = join(path, entry.name);
    if (entry.name === LEGACY_MIGRATION_TRANSACTION_MARKER && entry.isFile()) {
      artifacts.markers.push(child);
      continue;
    }
    if (isMigrationStageName(entry.name) && (entry.isFile() || entry.isDirectory())) {
      artifacts.stages.push(child);
      continue;
    }
    if (entry.isDirectory()) {
      const nested = await findMigrationArtifacts(child);
      artifacts.markers.push(...nested.markers);
      artifacts.stages.push(...nested.stages);
    }
  }
  return artifacts;
}

function isMigrationStageName(name: string): boolean {
  return /^\..+\.migration-stage(?:-\d+)?$/.test(name);
}

async function removeOrphanStage(stage: string): Promise<void> {
  const destination = destinationForStage(stage);
  if (!destination) {
    return;
  }
  const stageKind = await entryKind(stage);
  const destinationKind = await entryKind(destination);
  if (stageKind === 'missing' || destinationKind === 'missing') {
    return;
  }
  if (await entriesEqual(stage, destination, stageKind, destinationKind)) {
    await removeTree(stage);
  }
}

function destinationForStage(stage: string): string | undefined {
  const name = basename(stage);
  const match = name.match(/^\.(.+)\.migration-stage(?:-\d+)?$/);
  return match?.[1] ? join(dirname(stage), match[1]) : undefined;
}

async function readMigrationTransaction(marker: string): Promise<MigrationTransaction> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(marker, 'utf8'));
  } catch (error: unknown) {
    throw new Error(`Cannot read migration transaction ${marker}: ${errorMessage(error)}`);
  }
  if (!isRecord(parsed) || typeof parsed.source !== 'string' || typeof parsed.stage !== 'string') {
    throw new Error(`Invalid migration transaction: ${marker}`);
  }
  return { source: parsed.source, stage: parsed.stage };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWithin(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !child.startsWith(sep));
}

async function recoverTransaction(destination: string, stage: string, source: string): Promise<void> {
  if ((await entryKind(stage)) !== 'directory') {
    throw new Error(`Migration transaction stage is missing: ${stage}`);
  }
  if (!(await transactionContainsOnlyStagedContent(destination, stage))) {
    throw new Error(`Could not safely recover migration transaction: ${destination}`);
  }
  if ((await entryKind(source)) === 'missing') {
    if (!(await directoriesEqual(stage, destination, LEGACY_MIGRATION_TRANSACTION_MARKER))) {
      throw new Error(`Migration transaction is incomplete: ${destination}`);
    }
    try {
      await unlink(join(destination, LEGACY_MIGRATION_TRANSACTION_MARKER));
    } catch (error: unknown) {
      if (!hasCode(error, 'ENOENT')) {
        throw error;
      }
    }
    await rm(stage, { recursive: true, force: true });
    return;
  }
  await rm(destination, { recursive: true, force: true });
  await rm(stage, { recursive: true, force: true });
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

async function directoriesEqual(
  source: string,
  destination: string,
  ignoredDestinationName?: string,
): Promise<boolean> {
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
  if (ignoredDestinationName) {
    destinationEntries = destinationEntries.filter((entry) => entry.name !== ignoredDestinationName);
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

async function snapshotEntry(path: string): Promise<EntrySnapshot> {
  const kind = await entryKind(path);
  if (kind === 'missing') {
    return { kind: 'missing' };
  }
  if (kind === 'file') {
    return { kind, content: await readFile(path) };
  }
  if (kind === 'symlink') {
    return { kind, target: await readlink(path) };
  }
  if (kind === 'directory') {
    const children = new Map<string, EntrySnapshot>();
    for (const entry of await readdir(path, { withFileTypes: true })) {
      children.set(entry.name, await snapshotEntry(join(path, entry.name)));
    }
    return { kind, children };
  }
  throw new Error(`Cannot snapshot unsupported filesystem entry: ${path}`);
}

function snapshotsEqual(left: EntrySnapshot, right: EntrySnapshot): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'missing' || right.kind === 'missing') {
    return true;
  }
  if (left.kind === 'file' && right.kind === 'file') {
    return left.content.equals(right.content);
  }
  if (left.kind === 'symlink' && right.kind === 'symlink') {
    return left.target === right.target;
  }
  if (left.kind === 'directory' && right.kind === 'directory') {
    if (left.children.size !== right.children.size) {
      return false;
    }
    for (const [name, child] of left.children) {
      const other = right.children.get(name);
      if (!other || !snapshotsEqual(child, other)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

async function removeOwnedEntry(path: string, expected: EntrySnapshot): Promise<void> {
  if (!snapshotsEqual(expected, await snapshotEntry(path))) {
    throw new Error(`Cannot remove changed migration destination: ${path}`);
  }
  await removeTree(path);
}

async function removeMatchingSource(source: string, destination: string, destinationKind: EntryKind): Promise<boolean> {
  const expected = await snapshotEntry(source);
  if (expected.kind === 'missing') {
    return true;
  }
  if (!snapshotsEqual(expected, await snapshotEntry(source))) {
    throw new Error(`Source changed during migration: ${source}`);
  }
  if (!(await entriesEqual(source, destination, expected.kind, destinationKind))) {
    return false;
  }
  if (!snapshotsEqual(expected, await snapshotEntry(source))) {
    throw new Error(`Source changed during migration: ${source}`);
  }
  const sourceResult = await removeSourceAfterVerification(source, expected);
  if (sourceResult === 'changed') {
    throw new Error(`Source changed during migration: ${source}`);
  }
  return true;
}

async function removeSourceAfterVerification(
  source: string,
  expected: EntrySnapshot,
): Promise<'moved' | 'changed' | 'missing'> {
  const claim = await claimSource(source);
  if (!claim) {
    return 'missing';
  }
  if (!snapshotsEqual(expected, await snapshotEntry(claim))) {
    if ((await entryKind(source)) === 'missing') {
      await rename(claim, source);
    } else {
      throw new Error(`Source changed during migration and was preserved at ${claim}`);
    }
    return 'changed';
  }
  await removeTree(claim);
  return 'moved';
}

async function claimSource(source: string): Promise<string | undefined> {
  if ((await entryKind(source)) === 'missing') {
    return undefined;
  }
  const parent = dirname(source);
  const encodedSourceName = Buffer.from(basename(source), 'utf8').toString('base64url');
  let attempt = 1;
  while (true) {
    const name = `${LEGACY_MIGRATION_SOURCE_CLAIM_PREFIX}${encodedSourceName}~${attempt}`;
    const claim = join(parent, name);
    try {
      await rename(source, claim);
      return claim;
    } catch (error: unknown) {
      if (hasCode(error, 'EEXIST')) {
        attempt += 1;
        continue;
      }
      if (hasCode(error, 'ENOENT') && (await entryKind(source)) === 'missing') {
        return undefined;
      }
      throw error;
    }
  }
}

type SourceClaim = {
  path: string;
  sourceName: string;
};

async function recoverSourceClaims(legacyRoot: string): Promise<void> {
  for (const claim of await findSourceClaims(legacyRoot)) {
    const source = join(dirname(claim.path), claim.sourceName);
    const sourceKind = await entryKind(source);
    if (sourceKind === 'missing') {
      await rename(claim.path, source);
      continue;
    }

    const claimed = await snapshotEntry(claim.path);
    if (snapshotsEqual(claimed, await snapshotEntry(source))) {
      await removeTree(claim.path);
      continue;
    }
    throw new Error(`A previous migration preserved a changed source at ${claim.path}`);
  }
}

async function findSourceClaims(path: string): Promise<SourceClaim[]> {
  const claims: SourceClaim[] = [];
  for (const entry of await readDirectoryEntries(path)) {
    const child = join(path, entry.name);
    const sourceName = sourceNameFromClaim(entry.name);
    if (sourceName && (entry.isDirectory() || entry.isFile() || entry.isSymbolicLink())) {
      claims.push({ path: child, sourceName });
      continue;
    }
    if (entry.isDirectory()) {
      claims.push(...(await findSourceClaims(child)));
    }
  }
  return claims;
}

function sourceNameFromClaim(name: string): string | undefined {
  if (name.startsWith(LEGACY_MIGRATION_SOURCE_CLAIM_PREFIX)) {
    const encoded = name.slice(LEGACY_MIGRATION_SOURCE_CLAIM_PREFIX.length).match(/^([A-Za-z0-9_-]+)~\d+$/)?.[1];
    if (!encoded) {
      return undefined;
    }
    try {
      const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
      return Buffer.from(decoded, 'utf8').toString('base64url') === encoded ? decoded : undefined;
    } catch {
      return undefined;
    }
  }

  const oldClaim = name.match(/^(.*)\.migration-source(?:-\d+)?$/);
  if (!oldClaim?.[1]?.startsWith('.')) {
    return undefined;
  }
  return oldClaim[1].slice(1) || undefined;
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
    if (result === 'changed') {
      throw new Error(`Source changed during migration: ${source}`);
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
