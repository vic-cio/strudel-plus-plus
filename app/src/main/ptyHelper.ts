import { chmodSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * node-pty runs harness commands through a helper binary it posix_spawns
 * first (see node-pty's pty.cc: on macOS the child argv is
 * [spawn-helper, cwd, file, ...args]). The 1.1.0 npm tarball ships that
 * helper without the executable bit, so posix_spawn fails with EACCES and
 * node-pty throws the misleading "posix_spawnp failed." no matter what
 * PATH the app has. Upstream fixed the tarball mode in 1.2.0 betas only,
 * so the bit is repaired here instead: at install time (scripts/ensure-pty-helper.mjs)
 * and again at launch, because a packaged app carries its own copy.
 */

/** The path node-pty loaded itself from is inside the asar in a packaged app,
 * but the helper lives in the unpacked copy next to it. */
export function unpackedResourcePath(path: string): string {
  return path.replace('app.asar', 'app.asar.unpacked').replace('node_modules.asar', 'node_modules.asar.unpacked');
}

/** Same search order as node-pty's loadNativeModule: build, then prebuilds. */
function ptyHelperCandidates(nodePtyRoot: string, platform: string, arch: string): string[] {
  const dirs = [
    join(nodePtyRoot, 'build', 'Release'),
    join(nodePtyRoot, 'build', 'Debug'),
    join(nodePtyRoot, 'prebuilds', `${platform}-${arch}`),
  ];
  return dirs.map((dir) => unpackedResourcePath(join(dir, 'spawn-helper')));
}

export function findPtyHelper(
  nodePtyRoot: string,
  platform: string = process.platform,
  arch: string = process.arch,
  exists: (candidate: string) => boolean = existsSync,
): string | undefined {
  return ptyHelperCandidates(nodePtyRoot, platform, arch).find(exists);
}

/**
 * Give the helper back its executable bit. Idempotent and best effort: a
 * missing helper or a read-only bundle is reported, not raised, because the
 * per-harness error at start time names the real problem.
 */
export function ensureExecutable(
  path: string,
  stat: (path: string) => { mode: number } = statSync,
  chmod: (path: string, mode: number) => void = chmodSync,
): boolean {
  try {
    // Owner execute is what posix_spawn needs; group/other stay as they are.
    if ((stat(path).mode & 0o100) !== 0) {
      return true;
    }
    chmod(path, 0o755);
    return true;
  } catch {
    return false;
  }
}

/** Where the installed node-pty lives, asar path included. */
export function findNodePtyRoot(
  createModuleRequire: (url: URL | string) => NodeRequire,
  from: URL | string,
): string | undefined {
  try {
    return createModuleRequire(from)
      .resolve('node-pty/package.json')
      .replace(/package\.json$/, '');
  } catch {
    return undefined;
  }
}

/**
 * Repair the helper bit for this process's node-pty. Safe to call on every
 * launch; returns false when the helper could not be found or made runnable,
 * in which case starting a harness surfaces a named error in the pane.
 */
export function ensurePtyHelper(
  createModuleRequire: (url: URL | string) => NodeRequire = createRequire,
  from: URL | string = import.meta.url,
  log: (message: string) => void = console.error,
): boolean {
  const root = findNodePtyRoot(createModuleRequire, from);
  if (!root) {
    log('[pty] node-pty not found; harnesses cannot start');
    return false;
  }
  const helper = findPtyHelper(root);
  if (!helper) {
    log('[pty] node-pty spawn-helper not found under ' + root);
    return false;
  }
  const ok = ensureExecutable(helper);
  if (!ok) {
    log(`[pty] could not make ${helper} executable; harness start will fail until it is writable`);
  }
  return ok;
}
