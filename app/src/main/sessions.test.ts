import { mkdir, mkdtemp, readlink, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionStore } from './sessions';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sessions-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('createSessionStore', () => {
  it('lists a folder as a session', async () => {
    await mkdir(join(root, 'dub-experiments'));
    const [session] = await createSessionStore(root).list();
    expect(session?.name).toBe('dub-experiments');
  });

  it('ignores loose files and dotfiles beside the sessions', async () => {
    // AGENTS.md and .claude live at this level and are not sessions.
    await mkdir(join(root, 'live-set'));
    await mkdir(join(root, '.claude'));
    await writeFile(join(root, 'AGENTS.md'), '');
    const sessions = await createSessionStore(root).list();
    expect(sessions.map((session) => session.name)).toEqual(['live-set']);
  });

  it('counts the beats in each session', async () => {
    await mkdir(join(root, 'set'));
    await writeFile(join(root, 'set', 'one.js'), '');
    await writeFile(join(root, 'set', 'two.js'), '');
    await writeFile(join(root, 'set', 'notes.txt'), '');
    const [session] = await createSessionStore(root).list();
    expect(session?.beats).toBe(2);
  });

  it('puts the most recently used session first', async () => {
    const store = createSessionStore(root);
    await store.create('older');
    await store.create('newer');
    await store.touch('older');
    const sessions = await store.list();
    expect(sessions.map((session) => session.name)).toEqual(['older', 'newer']);
  });

  it('creates a session with a starter beat, so it is never empty', async () => {
    const store = createSessionStore(root);
    await store.create('fresh');
    const [session] = await store.list();
    expect(session?.beats).toBe(1);
  });

  it('refuses to create a session that already exists', async () => {
    const store = createSessionStore(root);
    await store.create('taken');
    await expect(store.create('taken')).rejects.toThrow(/already exists/i);
  });

  it('rejects a session name that climbs out of the folder', async () => {
    await expect(createSessionStore(root).create('../escaped')).rejects.toThrow(/outside/i);
  });

  it('remembers the beat and tempo a session was left on', async () => {
    const store = createSessionStore(root);
    await store.create('set');
    await writeFile(join(root, 'set', 'intro.js'), '');
    await writeFile(join(root, 'set', 'outro.js'), '');
    const firstBeat = { beat: 'intro.js', cpsByBeat: { 'intro.js': 0.62 } };
    await store.setState('set', firstBeat);
    const secondBeat = { beat: 'outro.js', cpsByBeat: { 'outro.js': 0.78 } };
    await store.setState('set', secondBeat);
    await expect(store.getState('set')).resolves.toEqual({
      beat: 'outro.js',
      cpsByBeat: { 'intro.js': 0.62, 'outro.js': 0.78 },
    });
  });

  it('remembers the sidebar sort mode and manual beat order', async () => {
    const store = createSessionStore(root);
    await store.create('set');
    await writeFile(join(root, 'set', 'intro.js'), '');
    await writeFile(join(root, 'set', 'advanced.js'), '');
    await store.setState('set', {
      beatSort: 'manual',
      manualBeatOrder: ['intro.js', 'advanced.js'],
    });

    await expect(store.getState('set')).resolves.toMatchObject({
      beatSort: 'manual',
      manualBeatOrder: ['intro.js', 'advanced.js'],
    });
  });

  it('reports no state for a session never left', async () => {
    const store = createSessionStore(root);
    await store.create('set');
    await expect(store.getState('set')).resolves.toEqual({});
  });

  it('survives state that has been corrupted on disk', async () => {
    const store = createSessionStore(root);
    await store.create('set');
    await writeFile(join(root, 'set', '.session.json'), 'not json');
    await expect(store.getState('set')).resolves.toEqual({});
  });

  it('drops remembered tempo for beats that no longer exist when loaded', async () => {
    // Clones get deleted and harnesses rename files; a tempo for a beat that
    // is gone must not survive the load.
    const store = createSessionStore(root);
    await store.create('set');
    await writeFile(join(root, 'set', 'alive.js'), '');
    await store.setState('set', { cpsByBeat: { 'alive.js': 0.6, 'we begin-2.js': 0.75 } });
    await expect(store.getState('set')).resolves.toEqual({ cpsByBeat: { 'alive.js': 0.6 } });
  });

  it('drops manual beat order entries for beats that no longer exist when loaded', async () => {
    const store = createSessionStore(root);
    await store.create('set');
    await writeFile(join(root, 'set', 'alive.js'), '');
    await store.setState('set', { manualBeatOrder: ['alive.js', 'we begin-2.js'] });
    await expect(store.getState('set')).resolves.toEqual({ manualBeatOrder: ['alive.js'] });
  });

  it('drops per-beat state for deleted beats when state is written', async () => {
    // The file itself must be cleaned, so a harness reading .session.json
    // never sees leftovers the app has not written again yet.
    const store = createSessionStore(root);
    await store.create('set');
    await writeFile(join(root, 'set', 'alive.js'), '');
    await store.setState('set', { cpsByBeat: { 'alive.js': 0.6, 'we begin-2.js': 0.75 } });
    await store.setState('set', {});
    await expect(store.getState('set')).resolves.toEqual({ cpsByBeat: { 'alive.js': 0.6 } });
    const onDisk = JSON.parse(await readFile(join(root, 'set', '.session.json'), 'utf8')) as {
      cpsByBeat?: Record<string, number>;
    };
    expect(onDisk.cpsByBeat).toEqual({ 'alive.js': 0.6 });
  });

  it('finds beats in subfolders when pruning, like the beat store does', async () => {
    const store = createSessionStore(root);
    await store.create('set');
    await mkdir(join(root, 'set', 'drums'));
    await writeFile(join(root, 'set', 'drums', 'intro.js'), '');
    await store.setState('set', { cpsByBeat: { 'drums/intro.js': 0.5, 'gone.js': 0.9 } });
    await expect(store.getState('set')).resolves.toEqual({ cpsByBeat: { 'drums/intro.js': 0.5 } });
  });

  it('keeps an explicit null beat, recording that nothing is open', async () => {
    const store = createSessionStore(root);
    await store.create('set');
    await store.setState('set', { beat: 'intro.js' });
    await store.setState('set', { beat: null });
    await expect(store.getState('set')).resolves.toEqual({ beat: null });
    const onDisk = JSON.parse(await readFile(join(root, 'set', '.session.json'), 'utf8')) as { beat?: string | null };
    expect(onDisk.beat).toBeNull();
  });

  it('remembers the plugin dock with the session', async () => {
    const store = createSessionStore(root);
    await store.create('set');
    const dock = { split: true, panes: [{ tabs: ['eq'], active: 'eq' }, { tabs: [] }] };
    await store.setState('set', { dock });
    await expect(store.getState('set')).resolves.toEqual({ dock });
  });

  it('keeps the dock while beats switch under it', async () => {
    // Plugins are live gear: switching beats must not close a device or
    // forget where its faders were, so the prune that trims per-beat state
    // must leave the dock alone.
    const store = createSessionStore(root);
    await store.create('set');
    await writeFile(join(root, 'set', 'intro.js'), '');
    const dock = { panes: [{ tabs: ['eq'], active: 'eq' }], pluginState: { eq: { gain: 0.75 } } };
    await store.setState('set', { dock });
    await store.setState('set', { beat: 'intro.js', cpsByBeat: { 'intro.js': 0.6 } });
    await store.setState('set', { beat: null });
    await expect(store.getState('set')).resolves.toEqual({
      beat: null,
      cpsByBeat: { 'intro.js': 0.6 },
      dock,
    });
  });

  it('drops a dock that is not shaped like one', async () => {
    // A hand-edited or half-written file must not feed the renderer garbage
    // it would then render.
    const store = createSessionStore(root);
    await store.create('set');
    await writeFile(join(root, 'set', '.session.json'), JSON.stringify({ dock: 'wide open' }), 'utf8');
    await expect(store.getState('set')).resolves.toEqual({});
  });
});

describe('shared harness files', () => {
  it('links shared AGENTS.md into a new session', async () => {
    await writeFile(join(root, 'AGENTS.md'), '# session instructions');
    const store = createSessionStore(root);
    await store.create('set');
    await expect(readlink(join(root, 'set', 'AGENTS.md'))).resolves.toBe('../AGENTS.md');
  });

  it('adds shared AGENTS.md when an existing session is opened', async () => {
    const store = createSessionStore(root);
    await store.create('set');
    await writeFile(join(root, 'AGENTS.md'), '# session instructions');
    await store.touch('set');
    await expect(readlink(join(root, 'set', 'AGENTS.md'))).resolves.toBe('../AGENTS.md');
  });

  it('links the shared .claude folder into a new session', async () => {
    // The harness runs inside the session, and slash commands are looked up in
    // its working directory, not up the tree the way AGENTS.md is. A link keeps
    // one copy of the commands while making them reachable from every session.
    await mkdir(join(root, '.claude'));
    const store = createSessionStore(root);
    await store.create('set');
    await expect(readlink(join(root, 'set', '.claude'))).resolves.toBe('../.claude');
  });

  it('links a session made before the shared folder existed', async () => {
    const store = createSessionStore(root);
    await store.create('set');
    await mkdir(join(root, '.claude'));
    await store.touch('set');
    await expect(readlink(join(root, 'set', '.claude'))).resolves.toBe('../.claude');
  });

  it('leaves a session alone when there is nothing to share', async () => {
    const store = createSessionStore(root);
    await store.create('set');
    await expect(readlink(join(root, 'set', '.claude'))).rejects.toThrow();
  });

  it('links shared agent skills into a new session', async () => {
    await mkdir(join(root, '.agents', 'skills', 'strudel-live'), { recursive: true });
    const store = createSessionStore(root);
    await store.create('set');
    await expect(readlink(join(root, 'set', '.agents'))).resolves.toBe('../.agents');
  });

  it('adds shared agent skills when an existing session is opened', async () => {
    const store = createSessionStore(root);
    await store.create('set');
    await mkdir(join(root, '.agents', 'skills', 'strudel-live'), { recursive: true });
    await store.touch('set');
    await expect(readlink(join(root, 'set', '.agents'))).resolves.toBe('../.agents');
  });

  it('does not disturb a .claude folder the session owns itself', async () => {
    const store = createSessionStore(root);
    await store.create('set');
    await mkdir(join(root, 'set', '.claude'));
    await mkdir(join(root, '.claude'));
    await store.touch('set');
    await expect(readlink(join(root, 'set', '.claude'))).rejects.toThrow();
  });
});
