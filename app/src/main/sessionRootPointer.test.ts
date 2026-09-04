import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createSessionRootSetting } from './sessionRootPointer';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('session root pointer', () => {
  it('persists only a pointer and never changes the selected folder', async () => {
    const config = await mkdtemp(join(tmpdir(), 'root-pointer-config-'));
    const selected = await mkdtemp(join(tmpdir(), 'root-pointer-selected-'));
    roots.push(config, selected);
    await writeFile(join(selected, 'keep.txt'), 'mine');
    const setting = await createSessionRootSetting(config);

    await setting.save(selected);

    await expect(readFile(join(selected, 'keep.txt'), 'utf8')).resolves.toBe('mine');
    await expect(setting.load()).resolves.toMatchObject({
      path: selected,
      valid: true,
      readable: true,
      isDirectory: true,
    });
    await expect(readFile(join(config, '.strudel-sessions-root'), 'utf8')).resolves.toBe(`${selected}\n`);
  });

  it('reports a missing, invalid, and file root without throwing', async () => {
    const config = await mkdtemp(join(tmpdir(), 'root-pointer-config-'));
    const file = join(config, 'not-a-folder');
    roots.push(config);
    await writeFile(join(config, '.strudel-sessions-root'), `${file}\n`);
    await expect((await createSessionRootSetting(config)).load()).resolves.toMatchObject({
      valid: true,
      readable: false,
    });

    await writeFile(file, 'x');
    await expect((await createSessionRootSetting(config)).load()).resolves.toMatchObject({
      valid: true,
      readable: true,
      isDirectory: false,
    });
  });

  it('rejects saving a non-directory before changing the pointer', async () => {
    const config = await mkdtemp(join(tmpdir(), 'root-pointer-config-'));
    const file = join(config, 'file');
    roots.push(config);
    await writeFile(file, 'x');
    const setting = await createSessionRootSetting(config);
    await expect(setting.save(file)).rejects.toThrow(/directory/i);
    await expect(readFile(join(config, '.strudel-sessions-root'), 'utf8')).rejects.toThrow();
  });
});
