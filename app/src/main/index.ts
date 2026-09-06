import { createReadStream, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import { createBeatStore } from './beats';
import { augmentPath, loginShellPath } from './env';
import { ensurePtyHelper } from './ptyHelper';
import { createMidiOut, type MidiMessage } from './midi';
import { createOscSender, type OscMessage } from './oscSender';
import { createSessionStore } from './sessions';
import { resolveSessionsRoot } from './sessionsRoot';
import { createPtyHost } from './pty';
import { watchBeats } from './watcher';
import { createSessionRootSetting } from './sessionRootPointer';
import type { FSWatcher } from 'chokidar';
import { CH } from '../shared/ipc';
import type { HarnessConfig, HarnessDef } from '../shared/harness';
import type { SessionOpenResult, SessionState } from '../shared/session';
import { writeRecording } from './recordingExport';

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

  const rootSetting = createSessionRootSetting(app.getPath('userData'));
  const configuredRoot = await rootSetting.load();
  // The pointer names the folder; the app never moves what lives there.
  let root = configuredRoot.state === 'ok' ? configuredRoot.path : await resolveSessionsRoot();
  let sessions = createSessionStore(root);
  // Library removed: future sample reference will be a separate wiki,
  // not a session/beat collection. The editable default session (`we cook`)
  // remains the only bundled session.

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
  // Close veto / save-all coordinator contract: the renderer reports
  // unpolled dirty drafts; the main process may veto quit or trigger
  // batch writes without switching active session state.
  let closeDirty = false;
  ipcMain.handle(CH.closeCheck, async () => {
    return { dirty: closeDirty };
  });
  ipcMain.on(CH.dirtyState, (_event, dirty: boolean) => {
    closeDirty = dirty;
  });

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
  ipcMain.handle(CH.recordingSave, async (_event, data: Uint8Array, suggestedName: string) => {
    const chosen = await dialog.showSaveDialog(window, { defaultPath: suggestedName });
    if (chosen.canceled || !chosen.filePath) {
      return undefined;
    }
    await writeRecording(chosen.filePath, data);
    return chosen.filePath;
  });

  async function openSession(name: string): Promise<SessionOpenResult> {
    if (!(await sessions.has(name))) {
      throw new Error(`Cannot open missing session: ${name}`);
    }
    const folder = join(root, name);
    const nextStore = createBeatStore(folder);
    const nextState = await sessions.getState(name);
    const nextBeats = await nextStore.listInfo();
    const nextBeat =
      nextState.beat && nextBeats.some((beat) => beat.name === nextState.beat) ? nextState.beat : nextBeats[0]?.name;
    const nextContent = nextBeat ? await nextStore.read(nextBeat) : undefined;
    const previousBeatsRoot = config.beatsRoot;
    const previousActive = active;
    const previousStore = store;
    const previousWatcher = watcher;
    const previousSession = session;
    const previousHarness = lastHarness;
    let harnessRestarted = false;
    let nextWatcher: FSWatcher | undefined;
    try {
      config.beatsRoot = folder;
      harnessRestarted = true;
      const harness = restartHarness();
      await sessions.touch(name);
      nextWatcher = watchBeats(folder, (change) => window.webContents.send(CH.beatsChanged, change));
      await previousWatcher?.close();
      active = name;
      store = nextStore;
      watcher = nextWatcher;
      return {
        name,
        folder,
        harness,
        state: nextState,
        beats: nextBeats,
        beat: nextBeat,
        content: nextContent,
      };
    } catch (error) {
      config.beatsRoot = previousBeatsRoot;
      active = previousActive;
      store = previousStore;
      watcher = previousWatcher;
      if (nextWatcher) {
        await nextWatcher.close().catch(() => undefined);
      }
      if (harnessRestarted && previousHarness) {
        lastHarness = previousHarness;
        try {
          restartHarness();
        } catch {
          session = undefined;
        }
      } else {
        session = previousSession;
      }
      throw error;
    }
  }

  ipcMain.handle(CH.sessionsRoot, () => root);
  ipcMain.handle(CH.sessionsRootStatus, async () => await rootSetting.load());
  // Re-rooting is only offered while no session is open, so the beat store,
  // watcher and harness are not yet bound to a folder under the old root and
  // the new root takes effect without a restart.
  ipcMain.handle(CH.sessionsChooseRoot, async () => {
    if (active) throw new Error('Close the current session before changing the sessions folder');
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || result.filePaths[0] === undefined) return rootSetting.load();
    await rootSetting.save(result.filePaths[0]);
    const status = await rootSetting.load();
    if (status.state === 'ok') {
      root = status.path;
      sessions = createSessionStore(root);
      store = createBeatStore(root);
      config.beatsRoot = root;
    }
    return status;
  });
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
  ipcMain.handle(CH.libraryList, () => Promise.resolve([]));
  ipcMain.handle(CH.libraryRead, () =>
    Promise.reject(new Error('Library removed: future sample reference is a separate wiki')),
  );

  let server: Server | undefined;
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer) {
    await window.loadURL(devServer);
  } else {
    const served = await serveRenderer(join(import.meta.dirname, '../renderer'));
    server = served.server;
    await window.loadURL(served.url);
  }

  // Close protection: veto quit when dirty drafts exist. The renderer
  // responds through closeCheck; in a full implementation this would
  // block quit and trigger save-all or show a confirmation dialog.
  app.on('before-quit', async (event) => {
    if (closeDirty) {
      event.preventDefault();
      window.webContents.send(CH.saveAllTrigger);
    }
  });

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
