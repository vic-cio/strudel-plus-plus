import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FSWatcher } from 'chokidar';
import { watchBeats } from './watcher';
import type { BeatChange } from '../shared/ipc';

/**
 * The watcher is the live-coding link: a harness edit only becomes sound if
 * these events arrive. The ignore rule must skip dot-entries inside the root
 * while still watching a root that itself lives under a dot-directory — a
 * worktree or hidden folder would otherwise go deaf with no error at all.
 */
describe('watchBeats', () => {
  let root: string;
  let watcher: FSWatcher | undefined;
  let events: BeatChange[];

  async function settle(ms = 900): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  beforeEach(() => {
    events = [];
  });

  afterEach(async () => {
    await watcher?.close();
    watcher = undefined;
    await rm(root, { recursive: true, force: true });
  });

  async function watch(at: string): Promise<void> {
    watcher = watchBeats(at, (change) => events.push(change));
    // The watcher needs a moment before the writes it must see.
    await settle(400);
  }

  it('reports a write under a dot-prefixed sessions root', async () => {
    // The dot in the folder name is the point: filtering on absolute path
    // parts used to swallow the whole tree and silence the app.
    root = await mkdtemp(join(tmpdir(), '.watch-deaf-'));
    await mkdir(join(root, 'nested'), { recursive: true });
    await writeFile(join(root, 'nested', '808ing.js'), '// one\n');
    await watch(root);

    await writeFile(join(root, 'nested', '808ing.js'), '// two\n');
    await settle();

    expect(events).toContainEqual({ name: 'nested/808ing.js', event: 'change' });
  });

  it('reports a write under an ordinary sessions root', async () => {
    root = await mkdtemp(join(tmpdir(), 'watch-ok-'));
    await writeFile(join(root, '808ing.js'), '// a\n');
    await watch(root);

    await writeFile(join(root, '808ing.js'), '// b\n');
    await settle();

    expect(events).toContainEqual({ name: '808ing.js', event: 'change' });
  });

  it('keeps ignoring dot-entries inside the root', async () => {
    root = await mkdtemp(join(tmpdir(), 'watch-ok-'));
    await watch(root);

    // Session state and the live snapshot are dotfiles by contract; writing
    // them must not reach the renderer as beat changes.
    await writeFile(join(root, '.session.json'), '{}\n');
    await writeFile(join(root, '.strudel-live.json'), '{}\n');
    await mkdir(join(root, '.claude'), { recursive: true });
    await writeFile(join(root, '.claude', 'settings.json'), '{}\n');
    await settle();

    expect(events).toEqual([]);
  });
});
