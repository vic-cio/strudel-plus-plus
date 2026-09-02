import { createReadStream, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { homedir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import { createBeatStore } from './beats';
import { augmentPath, loginShellPath } from './env';
import { ensurePtyHelper } from './ptyHelper';
import { createMidiOut, type MidiMessage } from './midi';
import { createOscSender, type OscMessage } from './oscSender';
import { createSessionStore, type SessionState } from './sessions';
import { createPtyHost } from './pty';
import { watchBeats } from './watcher';
import type { FSWatcher } from 'chokidar';
import { CH } from '../shared/ipc';
import type { HarnessConfig, HarnessDef } from '../shared/harness';

const DEFAULT_ROOTS = [join(homedir(), 'Documents/Programming/strudel/my-sessions'), join(homedir(), 'Music/Strudel')];

function sessionsRoot(): string {
  const fromEnv = process.env.STRUDEL_BEATS_DIR;
  if (fromEnv) {
    return resolve(fromEnv);
  }
  return DEFAULT_ROOTS.find((candidate) => existsSync(candidate)) ?? DEFAULT_ROOTS[1]!;
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

/**
 * Serve the built renderer over loopback.
 *
 * `file://` is not an option: AudioWorklet module loading and the sample
 * fetches both fail its origin checks, so the app would launch in silence.
 */
function serveRenderer(dir: string): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    const requested = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!));
    const target = requested === '/' ? '/index.html' : requested;
    const full = join(dir, target);
    if (!full.startsWith(dir) || !existsSync(full)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(full)] ?? 'application/octet-stream' });
    createReadStream(full).pipe(res);
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      done({ url: `http://127.0.0.1:${port}/`, server });
    });
  });
}

async function loadHarnesses(): Promise<HarnessDef[]> {
  const candidates = [
    join(app.getAppPath(), 'harnesses.json'),
    join(process.resourcesPath ?? '', 'harnesses.json'),
    resolve('harnesses.json'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const parsed = JSON.parse(await readFile(candidate, 'utf8')) as { harnesses: HarnessDef[] };
      return parsed.harnesses;
    }
  }
  return [{ id: 'shell', label: 'shell', command: process.env.SHELL || 'zsh', args: ['-l'] }];
}

// A modal over a running set is worse than a logged error. Electron's default
// for an uncaught exception is a dialog that blocks every IPC call, which
// leaves the window looking merely empty rather than broken.
process.on('uncaughtException', (error) => {
  console.error('[main] uncaught', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled rejection', reason);
});

async function main() {
  await app.whenReady();

  const root = sessionsRoot();
  const sessions = createSessionStore(root);

  // Everything below hangs off which session is open: the beat store is rooted
  // in it, the watcher follows it, and the harness runs inside it so the agent
  // sees this set and not the others.
  let active = '';
  let store = createBeatStore(root);
  let watcher: FSWatcher | undefined;
  const config: HarnessConfig = { beatsRoot: root, harnesses: await loadHarnesses() };
  // node-pty's macOS helper ships without its executable bit; repair it before
  // the first spawn tries to posix_spawn it and dies with posix_spawnp failed.
  ensurePtyHelper();
  // Finder-launched apps inherit no PATH to speak of, so discovery runs on the
  // login shell's PATH widened with the usual install locations.
  const ptyHost = createPtyHost(augmentPath(await loginShellPath()));
  const osc = createOscSender();
  const midi = createMidiOut();
  let session: ReturnType<typeof ptyHost.start> | undefined;
  let sessionTransitionTail: Promise<void> = Promise.resolve();

  function queueSessionTransition<T>(operation: () => Promise<T>): Promise<T> {
    const current = sessionTransitionTail.then(operation, operation);
    sessionTransitionTail = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }

  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'strudel++',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#f4efe4',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Web MIDI sits behind a permission prompt that a desktop app has no way to
  // show, so answer it here. Both handlers are needed: Chromium asks the check
  // handler for MIDI and never reaches the request handler, so registering only
  // the latter leaves requestMIDIAccess hanging on a promise that never
  // settles. Nothing but MIDI is granted.
  const allowMidi = (permission: string) => permission === 'midi' || permission === 'midiSysex';
  window.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(allowMidi(permission));
  });
  window.webContents.session.setPermissionCheckHandler((_contents, permission) => allowMidi(permission));

  window.once('ready-to-show', () => {
    window.show();
    // Debug aid: STRUDEL_CAPTURE=/path/to.png writes a screenshot of the window
    // itself, which is the only reliable way to see the app when another
    // window is stacked over it.
    // The window id lets `screencapture -l` grab this window even when it is
    // buried, which capturePage cannot do reliably: an occluded window stops
    // producing frames and capturePage then returns the last one it painted.
    console.log(`[window] mediaSourceId=${window.getMediaSourceId()}`);
    const capture = process.env.STRUDEL_CAPTURE;
    if (capture) {
      const delay = Number(process.env.STRUDEL_CAPTURE_DELAY ?? 8000);
      setTimeout(() => {
        // An occluded window stops producing frames, and capturePage then
        // hands back whatever it painted last, which is usually the app
        // before it finished loading. Raise it first.
        window.setAlwaysOnTop(true);
        window.focus();
        setTimeout(() => {
          void window.webContents
            .capturePage()
            .then((image) => writeFile(capture, image.toPNG()))
            .then(() => window.setAlwaysOnTop(false))
            .catch((error: unknown) => console.error('[capture]', error));
        }, 1500);
      }, delay);
    }
  });
  // Renderer errors are otherwise invisible unless devtools happen to be open.
  window.webContents.on('console-message', (_event, level, message, line, source) => {
    if (level >= 2) {
      console.error(`[renderer] ${source}:${line} ${message}`);
    }
  });
  // A renderer death or freeze is the kind of crash that leaves no macOS
  // report behind, so the log is the only place it exists. Record it here:
  // without this line a blank window and a dead pane have no story attached.
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer] gone: ${details.reason} (exitCode ${details.exitCode})`);
  });
  window.webContents.on('unresponsive', () => {
    console.error('[renderer] unresponsive: the UI thread stopped servicing events');
  });
  window.webContents.on('responsive', () => {
    console.error('[renderer] responsive again');
  });
  // Keep the app single-purpose: anything else opens in the real browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  ipcMain.handle(CH.beatsRoot, () => root);
  ipcMain.handle(CH.beatsList, () => store.list());
  ipcMain.handle(CH.beatsInfo, () => store.listInfo());
  ipcMain.handle(CH.beatsRead, (_event, name: string) => store.read(name));
  ipcMain.handle(CH.beatsWrite, (_event, name: string, content: string) => store.write(name, content));
  ipcMain.handle(CH.beatsCreate, (_event, name: string, content: string) => store.create(name, content));
  ipcMain.handle(CH.beatsRename, (_event, from: string, to: string) => store.rename(from, to));
  ipcMain.handle(CH.beatsRemove, (_event, name: string) => store.remove(name));
  ipcMain.handle(CH.harnessList, () => config.harnesses);

  let lastHarness: { id: string; cols: number; rows: number } | undefined;

  /** Re-spawn the running harness in the current session folder. */
  function restartHarness(): string | undefined {
    if (!lastHarness) {
      return undefined;
    }
    ptyHost.kill();
    const { id, cols, rows } = lastHarness;
    session = ptyHost.start(id, { cols, rows }, config, {
      onData: (data) => window.webContents.send(CH.ptyData, data),
      onExit: (code) => window.webContents.send(CH.ptyExit, code),
    });
    return id;
  }

  ipcMain.handle(CH.ptyStart, (_event, id: string, cols: number, rows: number) => {
    lastHarness = { id, cols, rows };
    const started = ptyHost.start(id, { cols, rows }, config, {
      onData: (data) => window.webContents.send(CH.ptyData, data),
      onExit: (code) => window.webContents.send(CH.ptyExit, code),
    });
    session = started;
  });
  ipcMain.on(CH.ptyWrite, (_event, data: string) => session?.write(data));
  ipcMain.on(CH.ptyResize, (_event, cols: number, rows: number) => session?.resize(cols, rows));
  ipcMain.on(CH.oscSend, (_event, message: OscMessage) => osc.send(message));
  ipcMain.on(CH.midiSend, (_event, messages: MidiMessage[]) => midi.send(messages));
  ipcMain.handle(CH.midiPorts, () => midi.ports());

  async function openSession(name: string) {
    if (!(await sessions.has(name))) {
      throw new Error(`Cannot open missing session: ${name}`);
    }
    const folder = join(root, name);
    const previousBeatsRoot = config.beatsRoot;
    config.beatsRoot = folder;
    let harness: string | undefined;
    try {
      harness = restartHarness();
    } catch (error) {
      config.beatsRoot = previousBeatsRoot;
      throw error;
    }
    active = name;
    store = createBeatStore(folder);
    await sessions.touch(name);
    await watcher?.close();
    watcher = watchBeats(folder, (change) => window.webContents.send(CH.beatsChanged, change));
    return { name, folder, harness };
  }

  ipcMain.handle(CH.sessionsRoot, () => root);
  ipcMain.handle(CH.sessionsList, () => sessions.list());
  ipcMain.handle(CH.sessionsActive, () => active);
  ipcMain.handle(CH.sessionsCreate, (_event, name: string) =>
    queueSessionTransition(async () => {
      await sessions.create(name);
      return openSession(name);
    }),
  );
  ipcMain.handle(CH.sessionsRemove, (_event, name: string) =>
    queueSessionTransition(async () => {
      if (name === active) {
        throw new Error(`Cannot delete the active session: ${name}`);
      }
      return sessions.remove(name);
    }),
  );
  ipcMain.handle(CH.sessionsOpen, (_event, name: string) => queueSessionTransition(() => openSession(name)));
  ipcMain.handle(CH.sessionsState, (_event, name: string) => sessions.getState(name));
  ipcMain.handle(CH.sessionsSetState, (_event, name: string, state: SessionState) => sessions.setState(name, state));

  let server: Server | undefined;
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer) {
    await window.loadURL(devServer);
  } else {
    const served = await serveRenderer(join(import.meta.dirname, '../renderer'));
    server = served.server;
    await window.loadURL(served.url);
  }

  app.on('window-all-closed', () => {
    void watcher?.close();
    ptyHost.kill();
    osc.close();
    midi.close();
    server?.close();
    app.quit();
  });
}

// Exported so tests can await handler registration deterministically instead
// of guessing how many microtask ticks main() needs.
export const ready = main();
