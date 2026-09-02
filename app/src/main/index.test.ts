import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CH } from '../shared/ipc';

const handlers = new Map<string, (...args: any[]) => unknown>();
const listeners = new Map<string, (...args: any[]) => unknown>();

const ptyStart = vi.fn();
const ptyKill = vi.fn();

const beatStoreFactory = vi.fn(() => ({
  list: vi.fn(async () => []),
  listInfo: vi.fn(async () => []),
  read: vi.fn(),
  write: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
}));

const sessionsTouch = vi.fn(async () => undefined);
const sessionsHas = vi.fn(async () => true);
const sessionsRemove = vi.fn(async () => undefined);
const watcherClose = vi.fn(async () => undefined);
const watchBeatsMock = vi.fn(() => ({ close: watcherClose }));

vi.mock('electron', () => {
  class BrowserWindow {
    webContents = {
      session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() },
      on: vi.fn(),
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      capturePage: vi.fn(async () => ({ toPNG: () => Buffer.from('') })),
      getMediaSourceId: vi.fn(() => 'x'),
    };
    once = vi.fn();
    show = vi.fn();
    loadURL = vi.fn(async () => undefined);
  }
  return {
    app: {
      whenReady: vi.fn(async () => undefined),
      getAppPath: vi.fn(() => process.cwd()),
      on: vi.fn(),
      quit: vi.fn(),
    },
    BrowserWindow,
    ipcMain: {
      handle: vi.fn((channel: string, fn: (...args: any[]) => unknown) => handlers.set(channel, fn)),
      on: vi.fn((channel: string, fn: (...args: any[]) => unknown) => listeners.set(channel, fn)),
    },
    shell: { openExternal: vi.fn() },
  };
});

vi.mock('./beats', () => ({ createBeatStore: beatStoreFactory }));
vi.mock('./env', () => ({ augmentPath: (p: string) => p, loginShellPath: vi.fn(async () => '/usr/bin') }));
vi.mock('./ptyHelper', () => ({ ensurePtyHelper: vi.fn() }));
vi.mock('./midi', () => ({ createMidiOut: () => ({ ports: vi.fn(), send: vi.fn(), close: vi.fn() }) }));
vi.mock('./oscSender', () => ({ createOscSender: () => ({ send: vi.fn(), close: vi.fn() }) }));
vi.mock('./sessions', () => ({
  createSessionStore: () => ({
    list: vi.fn(async () => []),
    has: sessionsHas,
    create: vi.fn(async () => undefined),
    remove: sessionsRemove,
    touch: sessionsTouch,
    getState: vi.fn(async () => ({})),
    setState: vi.fn(async () => undefined),
  }),
}));
vi.mock('./pty', () => ({ createPtyHost: () => ({ start: ptyStart, kill: ptyKill }) }));
vi.mock('./watcher', () => ({ watchBeats: watchBeatsMock }));

describe('openSession', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    handlers.clear();
    listeners.clear();
    (process.env as Record<string, string>).ELECTRON_RENDERER_URL = 'http://localhost:1/';
    process.env.STRUDEL_BEATS_DIR = '/tmp/strudel-index-test-root';
    ptyStart.mockReset();
    ptyStart.mockReturnValue({ write: vi.fn(), resize: vi.fn(), kill: vi.fn() });
    sessionsHas.mockReset();
    sessionsHas.mockResolvedValue(true);
    sessionsRemove.mockReset();
    vi.resetModules();
    const mod = await import('./index');
    await mod.ready;
  });

  it('rolls back beatsRoot and never adopts the new session when the harness restart fails', async () => {
    const ptyStartHandler = handlers.get(CH.ptyStart)!;
    await ptyStartHandler({}, 'shell', 80, 24);
    expect(ptyStart).toHaveBeenCalledTimes(1);
    const config = ptyStart.mock.calls[0]![2];
    const rootBeforeSwitch = config.beatsRoot;

    ptyStart.mockImplementationOnce(() => {
      throw new Error('Harness "shell" failed to start (command "zsh"): posix_spawnp failed.');
    });

    const sessionsOpenHandler = handlers.get(CH.sessionsOpen)!;
    await expect(sessionsOpenHandler({}, 'new-session')).rejects.toThrow('posix_spawnp failed');

    // The failed restart must not have left the main process pointed at a
    // session the renderer never adopted.
    expect(config.beatsRoot).toBe(rootBeforeSwitch);
    expect(beatStoreFactory).toHaveBeenCalledTimes(1); // only the initial root store, never the new session's
    expect(sessionsTouch).not.toHaveBeenCalled();
    expect(watchBeatsMock).not.toHaveBeenCalled();

    const activeHandler = handlers.get(CH.sessionsActive)!;
    expect(await activeHandler({})).toBe('');
  });

  it('adopts the new session once the harness restart succeeds', async () => {
    const ptyStartHandler = handlers.get(CH.ptyStart)!;
    await ptyStartHandler({}, 'shell', 80, 24);

    const sessionsOpenHandler = handlers.get(CH.sessionsOpen)!;
    const result = await sessionsOpenHandler({}, 'new-session');

    expect(result).toMatchObject({ name: 'new-session' });
    expect(sessionsTouch).toHaveBeenCalledWith('new-session');
    expect(watchBeatsMock).toHaveBeenCalled();

    const activeHandler = handlers.get(CH.sessionsActive)!;
    expect(await activeHandler({})).toBe('new-session');
  });

  it('guards deletion of the active session before reaching the store', async () => {
    const sessionsOpenHandler = handlers.get(CH.sessionsOpen)!;
    await sessionsOpenHandler({}, 'active-session');

    const sessionsRemoveHandler = handlers.get(CH.sessionsRemove)!;
    await expect(sessionsRemoveHandler({}, 'active-session')).rejects.toThrow(/active session/i);
    expect(sessionsRemove).not.toHaveBeenCalled();
  });

  it('deletes an inactive session through the guarded seam', async () => {
    const sessionsOpenHandler = handlers.get(CH.sessionsOpen)!;
    await sessionsOpenHandler({}, 'active-session');

    const sessionsRemoveHandler = handlers.get(CH.sessionsRemove)!;
    await sessionsRemoveHandler({}, 'default-session');

    expect(sessionsRemove).toHaveBeenCalledWith('default-session');
  });

  it('serializes opening a session behind an in-flight deletion of that session', async () => {
    const sessionsOpenHandler = handlers.get(CH.sessionsOpen)!;
    await sessionsOpenHandler({}, 'active-session');
    sessionsRemove.mockClear();
    sessionsTouch.mockClear();

    let removalStarted!: () => void;
    let releaseRemoval!: () => void;
    const started = new Promise<void>((resolve) => {
      removalStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseRemoval = resolve;
    });
    sessionsRemove.mockImplementationOnce(async () => {
      removalStarted();
      await released;
    });

    const sessionsRemovePromise = handlers.get(CH.sessionsRemove)!({}, 'candidate-session');
    await started;
    const sessionsOpenPromise = sessionsOpenHandler({}, 'candidate-session');

    await Promise.resolve();
    expect(sessionsTouch).not.toHaveBeenCalled();

    releaseRemoval();
    await sessionsRemovePromise;
    await sessionsOpenPromise;
    expect(sessionsTouch).toHaveBeenCalledWith('candidate-session');
  });

  it('does not restart the harness when a queued open targets a deleted session', async () => {
    const ptyStartHandler = handlers.get(CH.ptyStart)!;
    await ptyStartHandler({}, 'shell', 80, 24);
    const sessionsOpenHandler = handlers.get(CH.sessionsOpen)!;
    await sessionsOpenHandler({}, 'active-session');
    ptyKill.mockClear();
    sessionsHas.mockClear();
    sessionsTouch.mockClear();

    let removalStarted!: () => void;
    let releaseRemoval!: () => void;
    const started = new Promise<void>((resolve) => {
      removalStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseRemoval = resolve;
    });
    sessionsRemove.mockImplementationOnce(async () => {
      removalStarted();
      await released;
      sessionsHas.mockResolvedValue(false);
    });

    const sessionsRemovePromise = handlers.get(CH.sessionsRemove)!({}, 'candidate-session');
    await started;
    const sessionsOpenPromise = sessionsOpenHandler({}, 'candidate-session');
    releaseRemoval();

    await sessionsRemovePromise;
    await expect(sessionsOpenPromise).rejects.toThrow(/missing session/i);
    expect(ptyKill).not.toHaveBeenCalled();
    expect(sessionsTouch).not.toHaveBeenCalled();
    const activeHandler = handlers.get(CH.sessionsActive)!;
    expect(await activeHandler({})).toBe('active-session');
  });

  it('restores the previous session and harness if opening fails after restart', async () => {
    const ptyStartHandler = handlers.get(CH.ptyStart)!;
    await ptyStartHandler({}, 'shell', 80, 24);
    const sessionsOpenHandler = handlers.get(CH.sessionsOpen)!;
    await sessionsOpenHandler({}, 'active-session');
    const config = ptyStart.mock.calls.at(-1)![2];
    ptyKill.mockClear();
    ptyStart.mockClear();
    sessionsTouch.mockClear();
    sessionsTouch.mockRejectedValueOnce(new Error('cannot touch target'));

    await expect(sessionsOpenHandler({}, 'candidate-session')).rejects.toThrow('cannot touch target');

    expect(config.beatsRoot).toBe('/tmp/strudel-index-test-root/active-session');
    expect(ptyKill).toHaveBeenCalledTimes(2);
    expect(ptyStart).toHaveBeenCalledTimes(2);
    expect(await handlers.get(CH.sessionsActive)!({})).toBe('active-session');
    expect(sessionsTouch).toHaveBeenCalledWith('candidate-session');
  });
});
