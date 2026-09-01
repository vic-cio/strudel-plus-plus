import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBeatStore } from './beats';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'beats-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('createBeatStore', () => {
  it('lists only .js files, as paths relative to the root, sorted', async () => {
    await mkdir(join(root, 'drums'), { recursive: true });
    await writeFile(join(root, 'drums', 'break.js'), '');
    await writeFile(join(root, 'scratch.js'), '');
    await writeFile(join(root, 'README.md'), '');
    await writeFile(join(root, 'notes.txt'), '');

    await expect(createBeatStore(root).list()).resolves.toEqual(['drums/break.js', 'scratch.js']);
  });

  it('reads a beat by its relative path', async () => {
    await writeFile(join(root, 'scratch.js'), 's("bd")');
    await expect(createBeatStore(root).read('scratch.js')).resolves.toBe('s("bd")');
  });

  it('creates missing parent folders on write', async () => {
    await createBeatStore(root).write('live/set-1.js', 's("hh*8")');
    await expect(readFile(join(root, 'live', 'set-1.js'), 'utf8')).resolves.toBe('s("hh*8")');
  });

  it('rejects a path that climbs out of the root', async () => {
    await expect(createBeatStore(root).read('../../etc/passwd')).rejects.toThrow(/outside the beats folder/i);
  });

  it('rejects an absolute path', async () => {
    await expect(createBeatStore(root).read('/etc/passwd')).rejects.toThrow(/outside the beats folder/i);
  });

  it('rejects a write that climbs out of the root', async () => {
    await expect(createBeatStore(root).write('../escaped.js', 'x')).rejects.toThrow(/outside the beats folder/i);
  });

  it('renames a beat', async () => {
    const store = createBeatStore(root);
    await store.write('old.js', 's("bd")');
    await store.rename('old.js', 'new.js');
    await expect(store.list()).resolves.toEqual(['new.js']);
    await expect(store.read('new.js')).resolves.toBe('s("bd")');
  });

  it('removes a beat', async () => {
    const store = createBeatStore(root);
    await store.write('doomed.js', '');
    await store.remove('doomed.js');
    await expect(store.list()).resolves.toEqual([]);
  });
});

describe('beat store safety', () => {
  it('refuses to rename onto a beat that already exists', async () => {
    // Renaming is a two-second decision and the old name is often still on
    // screen. Silently replacing the other beat loses work with no undo.
    const store = createBeatStore(root);
    await store.write('keeper.js', 'the good one');
    await store.write('other.js', 'the other one');

    await expect(store.rename('other.js', 'keeper.js')).rejects.toThrow(/already exists/i);
    await expect(store.read('keeper.js')).resolves.toBe('the good one');
  });

  it('renames onto a name that is free', async () => {
    const store = createBeatStore(root);
    await store.write('old.js', 'x');
    await expect(store.rename('old.js', 'new.js')).resolves.toBeUndefined();
  });

  it('refuses to create a beat over one that already exists', async () => {
    const store = createBeatStore(root);
    await store.write('taken.js', 'mine');
    await expect(store.create('taken.js', 'starter')).rejects.toThrow(/already exists/i);
    await expect(store.read('taken.js')).resolves.toBe('mine');
  });

  it('creates a beat when the name is free', async () => {
    const store = createBeatStore(root);
    await store.create('fresh.js', 'starter');
    await expect(store.read('fresh.js')).resolves.toBe('starter');
  });
});
