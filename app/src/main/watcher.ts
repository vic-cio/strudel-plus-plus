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
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (path: string) => path.split(sep).some((part) => part.startsWith('.')),
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
