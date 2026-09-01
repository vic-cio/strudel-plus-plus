import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const PATH_START = '__strudel_path_start__';
export const PATH_END = '__strudel_path_end__';

/** Recover the path from a login shell's stdout, banners and all. */
/**
 * The script the login shell runs to hand back its PATH.
 *
 * The braces are not decoration. A marker that begins with an underscore,
 * written straight after $PATH, is read as part of the variable name.
 */
export function pathScript(): string {
  return `printf %s "${PATH_START}\${PATH}${PATH_END}"`;
}

export function extractPath(stdout: string): string | undefined {
  const from = stdout.indexOf(PATH_START);
  const to = stdout.indexOf(PATH_END);
  if (from === -1 || to === -1 || to < from) {
    return undefined;
  }
  const path = stdout.slice(from + PATH_START.length, to).trim();
  return path || undefined;
}

/**
 * Read PATH from a login shell.
 *
 * Electron launched from Finder inherits a bare environment, so `claude`, `pi`
 * and `codex` in ~/.local/bin are invisible to it. The shell knows where they
 * are, so ask the shell. It has to be an interactive shell, because that is
 * where people put their PATH edits, which is also why the answer arrives
 * wrapped in whatever their shell prints on the way in and out.
 */
export async function loginShellPath(): Promise<string> {
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    const { stdout } = await run(shell, ['-lic', pathScript()], { timeout: 5000 });
    return extractPath(stdout) ?? process.env.PATH ?? '';
  } catch {
    return process.env.PATH ?? '';
  }
}

/** Install locations a GUI process never inherits but CLIs actually land in. */
export function wellKnownBinDirs(home: string): string[] {
  return [
    join(home, '.local/bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    join(home, 'bin'),
  ];
}

/**
 * Widen a resolved PATH with the well-known install locations.
 *
 * The login shell usually answers, but its profile can fail, hang, or simply
 * not add these yet. Anything already present keeps its place; the well-known
 * directories are appended rather than prepended so the user's own ordering
 * still wins.
 */
export function augmentPath(path: string, extra: string[] = wellKnownBinDirs(homedir())): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const dir of [...path.split(':'), ...extra]) {
    if (!dir || seen.has(dir)) {
      continue;
    }
    seen.add(dir);
    kept.push(dir);
  }
  return kept.join(':');
}
