import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionStore } from './sessions';
import { DEFAULT_SESSION_BEATS, DEFAULT_SESSION_NAME, DEFAULT_SESSION_STATE } from './defaultSession';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'default-session-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('seedDefaultSession', () => {
  it('seeds the "we cook" session with its three beats on a fresh root', async () => {
    const store = createSessionStore(root);
    const sessions = await store.list();
    expect(sessions.map((session) => session.name)).toEqual([DEFAULT_SESSION_NAME]);
    expect(sessions[0]?.beats).toBe(Object.keys(DEFAULT_SESSION_BEATS).length);
    for (const [name, content] of Object.entries(DEFAULT_SESSION_BEATS)) {
      await expect(readFile(join(root, DEFAULT_SESSION_NAME, name), 'utf8')).resolves.toBe(content);
    }
  });

  it('round-trips the snapshot state, minus the volatile usedAt', async () => {
    const store = createSessionStore(root);
    await store.list();
    const state = await store.getState(DEFAULT_SESSION_NAME);
    expect(state).toEqual(DEFAULT_SESSION_STATE);
  });

  it('stamps its own usedAt instead of the staged snapshot value', async () => {
    const before = Date.now();
    const store = createSessionStore(root);
    const [session] = await store.list();
    expect(session?.usedAt).toBeGreaterThanOrEqual(before);
  });

  it('never touches a root that already has a session', async () => {
    await mkdir(join(root, 'my-own-set'));
    await writeFile(join(root, 'my-own-set', 'jam.js'), '// mine');
    const store = createSessionStore(root);
    const sessions = await store.list();
    expect(sessions.map((session) => session.name)).toEqual(['my-own-set']);
    await expect(readdir(root)).resolves.not.toContain(DEFAULT_SESSION_NAME);
  });

  it('is idempotent across repeated listings', async () => {
    const store = createSessionStore(root);
    await store.list();
    const sessions = await store.list();
    expect(sessions.map((session) => session.name)).toEqual([DEFAULT_SESSION_NAME]);
  });

  it('does not resurrect the default after it is deliberately removed', async () => {
    const store = createSessionStore(root);
    await store.list();
    await store.remove(DEFAULT_SESSION_NAME);

    await expect(store.list()).resolves.toEqual([]);
  });

  it('keeps a legacy default deleted through the store boundary', async () => {
    await mkdir(join(root, DEFAULT_SESSION_NAME));
    await writeFile(join(root, DEFAULT_SESSION_NAME, 'we begin.js'), '// legacy');
    const store = createSessionStore(root);

    await expect(store.list()).resolves.toEqual([expect.objectContaining({ name: DEFAULT_SESSION_NAME, beats: 1 })]);
    await store.remove(DEFAULT_SESSION_NAME);

    await expect(store.list()).resolves.toEqual([]);
  });

  it('serializes first listing with default deletion', async () => {
    const store = createSessionStore(root);
    await Promise.all([store.list(), store.remove(DEFAULT_SESSION_NAME)]);

    await expect(store.list()).resolves.toEqual([]);
  });

  it('refuses to remove root-owned files or hidden entries', async () => {
    await writeFile(join(root, 'AGENTS.md'), 'keep');
    await writeFile(join(root, '.default-session-deleted'), 'keep');
    await writeFile(join(root, 'notes.txt'), 'keep');
    const store = createSessionStore(root);

    await expect(store.remove('AGENTS.md')).rejects.toThrow(/visible session directory/i);
    await expect(store.remove('.default-session-deleted')).rejects.toThrow(/visible session directory/i);
    await expect(store.remove('notes.txt')).rejects.toThrow(/visible session directory/i);
    await expect(readFile(join(root, 'AGENTS.md'), 'utf8')).resolves.toBe('keep');
    await expect(readFile(join(root, '.default-session-deleted'), 'utf8')).resolves.toBe('keep');
    await expect(readFile(join(root, 'notes.txt'), 'utf8')).resolves.toBe('keep');
  });
});
