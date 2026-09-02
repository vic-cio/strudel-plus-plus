import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSessionsRoot, legacySessionsRoots, resolveSessionsRoot } from './sessionsRoot';

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'sessions-root-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('default session roots', () => {
  it('uses Music/strudel++ as the canonical root', () => {
    expect(defaultSessionsRoot('/captain')).toBe('/captain/Music/strudel++');
  });

  it('keeps both previously shipped roots in the migration list', () => {
    expect(legacySessionsRoots('/captain')).toEqual([
      '/captain/Music/Strudel',
      '/captain/Documents/Programming/strudel/my-sessions',
    ]);
  });

  it('uses an explicit root without trying to migrate defaults', async () => {
    const configured = join(home, 'custom-sessions');
    const legacy = join(home, 'Music', 'Strudel');
    await mkdir(join(legacy, 'old-set'), { recursive: true });

    await expect(resolveSessionsRoot({ envRoot: configured, home })).resolves.toBe(configured);
    await expect(stat(legacy)).resolves.toBeTruthy();
  });
});

describe('legacy session migration', () => {
  it('moves Music/Strudel sessions and preserves the active harness snapshot', async () => {
    const legacy = join(home, 'Music', 'Strudel');
    const session = join(legacy, 'captain-set');
    await mkdir(session, { recursive: true });
    await writeFile(join(session, 'intro.js'), 'sound = "bd"');
    await writeFile(join(session, '.strudel-live.json'), '{"beat":"intro.js"}\n');

    const root = await resolveSessionsRoot({ home });
    expect(root).toBe(defaultSessionsRoot(home));
    await expect(readFile(join(root, 'captain-set', 'intro.js'), 'utf8')).resolves.toBe('sound = "bd"');
    await expect(readFile(join(root, 'captain-set', '.strudel-live.json'), 'utf8')).resolves.toBe(
      '{"beat":"intro.js"}\n',
    );
    await expect(stat(legacy)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('merges both legacy roots and preserves colliding sessions under a visible name', async () => {
    const legacyRoots = legacySessionsRoots(home);
    const musicLegacy = legacyRoots[0];
    const developmentLegacy = legacyRoots[1];
    if (!musicLegacy || !developmentLegacy) {
      throw new Error('expected two legacy roots');
    }
    await mkdir(join(musicLegacy, 'same-name'), { recursive: true });
    await writeFile(join(musicLegacy, 'same-name', 'music.js'), 'music');
    await mkdir(join(developmentLegacy, 'same-name'), { recursive: true });
    await writeFile(join(developmentLegacy, 'same-name', 'development.js'), 'development');

    const root = await resolveSessionsRoot({ home });
    const sessions = await readdir(root);
    expect(sessions).toContain('same-name');
    expect(sessions).toContain('same-name (legacy)');
    await expect(readFile(join(root, 'same-name', 'music.js'), 'utf8')).resolves.toBe('music');
    await expect(readFile(join(root, 'same-name (legacy)', 'development.js'), 'utf8')).resolves.toBe('development');
    await expect(stat(musicLegacy)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(developmentLegacy)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not overwrite an existing canonical session', async () => {
    const root = defaultSessionsRoot(home);
    const legacy = join(home, 'Music', 'Strudel');
    await mkdir(join(root, 'set'), { recursive: true });
    await writeFile(join(root, 'set', 'current.js'), 'current');
    await mkdir(join(legacy, 'set'), { recursive: true });
    await writeFile(join(legacy, 'set', 'old.js'), 'old');

    await resolveSessionsRoot({ home });

    await expect(readFile(join(root, 'set', 'current.js'), 'utf8')).resolves.toBe('current');
    await expect(readFile(join(root, 'set (legacy)', 'old.js'), 'utf8')).resolves.toBe('old');
  });

  it('is idempotent across repeated startup resolution', async () => {
    const legacy = join(home, 'Music', 'Strudel');
    await mkdir(join(legacy, 'set'), { recursive: true });
    await writeFile(join(legacy, 'set', 'intro.js'), 'intro');

    const firstRoot = await resolveSessionsRoot({ home });
    const firstEntries = await readdir(firstRoot);
    const secondRoot = await resolveSessionsRoot({ home });
    const secondEntries = await readdir(secondRoot);

    expect(secondRoot).toBe(firstRoot);
    expect(secondEntries).toEqual(firstEntries);
    await expect(stat(legacy)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
