import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createSessionRootSetting } from './sessionRootPointer';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function config(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'root-pointer-config-'));
  roots.push(dir);
  return dir;
}

describe('session root pointer', () => {
  it('persists only a pointer and never changes the selected folder', async () => {
    const dir = await config();
    const selected = await mkdtemp(join(tmpdir(), 'root-pointer-selected-'));
    roots.push(selected);
    await writeFile(join(selected, 'keep.txt'), 'mine');
    const setting = createSessionRootSetting(dir);

    await setting.save(selected);

    await expect(readFile(join(selected, 'keep.txt'), 'utf8')).resolves.toBe('mine');
    await expect(setting.load()).resolves.toEqual({ state: 'ok', path: selected });
    await expect(readFile(join(dir, '.strudel-sessions-root'), 'utf8')).resolves.toBe(`${selected}\n`);
  });

  it('reports no pointer as unconfigured rather than an error', async () => {
    await expect(createSessionRootSetting(await config()).load()).resolves.toEqual({ state: 'unconfigured' });
  });

  it('reports an empty pointer as unconfigured rather than an error', async () => {
    const dir = await config();
    await writeFile(join(dir, '.strudel-sessions-root'), '\n');
    await expect(createSessionRootSetting(dir).load()).resolves.toEqual({ state: 'unconfigured' });
  });

  it('reports a missing root and a file root as invalid without throwing', async () => {
    const dir = await config();
    const target = join(dir, 'not-a-folder');
    await writeFile(join(dir, '.strudel-sessions-root'), `${target}\n`);
    await expect(createSessionRootSetting(dir).load()).resolves.toMatchObject({
      state: 'invalid',
      path: target,
      error: expect.stringMatching(/ENOENT/),
    });

    await writeFile(target, 'x');
    await expect(createSessionRootSetting(dir).load()).resolves.toMatchObject({
      state: 'invalid',
      path: target,
      error: expect.stringMatching(/not a directory/i),
    });
  });

  it('rejects saving a non-directory before changing the pointer', async () => {
    const dir = await config();
    const file = join(dir, 'file');
    await writeFile(file, 'x');
    const setting = createSessionRootSetting(dir);
    await expect(setting.save(file)).rejects.toThrow(/directory/i);
    await expect(readFile(join(dir, '.strudel-sessions-root'), 'utf8')).rejects.toThrow();
  });
});
