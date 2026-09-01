import { relative, sep } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { BEAT_EXTENSION } from './beats';
import type { BeatChange } from '../shared/ipc';

/**
 * Watch the beats folder and report writes.
 *
 * `awaitWriteFinish` matters more than it looks: an agent writing a file often
 * truncates then writes, and without the settle window the renderer sees an
 * empty file and replaces a working pattern with nothing.
 */
export function watchBeats(root: string, onChange: (change: BeatChange) => void): FSWatcher {
  // Dot-directories are skipped only *inside* the watched root. The check has
  // to look at the path relative to the root: filtering on absolute parts
  // would also swallow a root that itself lives under a dot-directory (a
  // worktree or a hidden folder), and the app would go deaf with no error.
  const ignoreInsideRoot = (path: string) => {
    const rel = relative(root, path);
    if (rel === '') {
      return false; // The root itself is never ignored.
    }
    if (rel.startsWith('..') || isAbsoluteRel(rel)) {
      return false; // Outside the root; not ours to judge.
    }
    return rel.split(sep).some((part) => part.startsWith('.'));
  };
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: ignoreInsideRoot,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 },
  });

  const report = (event: BeatChange['event']) => (path: string) => {
    if (!path.endsWith(BEAT_EXTENSION)) {
      return;
    }
    onChange({ name: relative(root, path).split(sep).join('/'), event });
  };

  watcher.on('add', report('add')).on('change', report('change')).on('unlink', report('unlink'));
  return watcher;
}

/** A relative path is absolute when its first segment is a root or drive. */
function isAbsoluteRel(rel: string): boolean {
  return rel.startsWith('/') || /^[A-Za-z]:/.test(rel);
}
