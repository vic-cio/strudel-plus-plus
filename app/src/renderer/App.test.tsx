// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { App } from './App';
import type { Settings } from '../shared/settings';

// Minimal in-memory localStorage for the jsdom environment that does not provide it.
if (typeof (globalThis as any).localStorage === 'undefined') {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store[k] !== undefined ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k in store) delete store[k];
    },
  };
  if ((globalThis as any).window) {
    (globalThis as any).window.localStorage = (globalThis as any).localStorage;
  }
}

/**
 * The App talks to the desktop bridge, so the whole bridge is faked here. The
 * tests watch `sessions.setState` calls: the persisted beat pointer must
 * follow the EDIT buffer at the moment it moves, because a harness reads that
 * pointer from .session.json and edits exactly what it names.
 */
const { desktop, setStateMock, changeHandler, repl, codeChange, sessionState } = vi.hoisted(() => {
  type WrittenState = { beat?: string | null; cpsByBeat?: Record<string, number>; dock?: unknown };
  const setStateMock = vi.fn(async (_session: string, _state: WrittenState) => {});
  // The watcher handler is captured so tests can play harness: write to disk,
  // the app learns of it through this callback, exactly as in production.
  const changeHandler: {
    current: ((change: { name: string; event: 'add' | 'change' | 'unlink' }) => Promise<void>) | undefined;
  } = {
    current: undefined,
  };
  // A stateful fake of the editor hook: the REPL's error only clears when the
  // app tells it to, so the fake must remember the error between renders.
  const repl = {
    state: { started: false, error: undefined as Error | undefined },
    clearError: vi.fn(() => {
      repl.state = { started: repl.state.started, error: undefined };
    }),
    setCode: vi.fn(),
    toggle: vi.fn(),
    evaluate: vi.fn(),
    reevaluate: vi.fn(),
    getCode: vi.fn((): string | undefined => undefined),
    tokenAt: vi.fn((): { text: string; offset: number } | undefined => undefined),
    containerRef: { current: null },
    cps: 0.5,
    changeCps: vi.fn(),
    releaseCps: vi.fn(),
  };
  const codeChange: { current: ((code: string) => void) | undefined } = { current: undefined };
  type MockSessionState = {
    beat?: string | null;
    dock?: { split?: boolean; panes?: { tabs?: string[]; active?: string }[] };
  };
  const sessionState = vi.fn(async (): Promise<MockSessionState> => ({ beat: 'we begin.js' }));
  const openSessionResult = async (name: string) => {
    const state = await sessionState();
    const beats = [
      { name: '808ing.js', modifiedAt: 1 },
      { name: 'we begin.js', modifiedAt: 2 },
    ];
    const beat = state.beat && beats.some((item) => item.name === state.beat) ? state.beat : beats[0]?.name;
    return {
      name,
      folder: `/sessions-root/${name}`,
      harness: 'shell',
      state,
      beats,
      beat,
      content: beat ? `// ${beat}` : undefined,
    };
  };
  const desktop = {
    settings: {
      load: vi.fn(async () => ({ version: 1 }) as Settings),
      save: vi.fn(async () => {}),
      update: vi.fn(async (partial: Partial<Settings>) => ({ version: 1, ...partial }) as Settings),
    },
    close: {
      check: vi.fn(async () => ({ dirty: false })),
      reportDirty: vi.fn(),
    },
    recording: {
      save: vi.fn(async (_data: Uint8Array, _suggestedName: string) => '/sessions-root/strudel-take.webm'),
    },
    sessions: {
      root: vi.fn(async () => '/sessions-root'),
      rootStatus: vi.fn(async () => ({ state: 'ok', path: '/sessions-root' })),
      chooseRoot: vi.fn(async () => ({ state: 'ok', path: '/sessions-root' })),
      list: vi.fn(async () => [{ name: 'we cook', beats: 2, usedAt: 1 }]),
      active: vi.fn(async () => 'we cook'),
      create: vi.fn(openSessionResult),
      remove: vi.fn(async () => {}),
      open: vi.fn(openSessionResult),
      state: sessionState,
      setState: setStateMock,
    },
    library: {
      list: vi.fn(async () => [{ name: 'we begin.js', session: 'we cook' }]),
      read: vi.fn(async (name: string) => `// bundled ${name}`),
    },
    beats: {
      root: vi.fn(async () => '/sessions-root/we cook'),
      list: vi.fn(async (): Promise<string[]> => []),
      listInfo: vi.fn(async () => [
        { name: '808ing.js', modifiedAt: 1 },
        { name: 'we begin.js', modifiedAt: 2 },
      ]),
      read: vi.fn(async (name: string) => `// ${name}`),
      write: vi.fn(async () => {}),
      writeIn: vi.fn(async () => {}),
      create: vi.fn(async () => {}),
      rename: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      onChange: vi.fn((handler: (change: { name: string; event: 'add' | 'change' | 'unlink' }) => Promise<void>) => {
        changeHandler.current = handler;
        return () => {};
      }),
    },
    osc: { send: vi.fn() },
    midi: { send: vi.fn(), ports: vi.fn(async () => []) },
    harness: {
      list: vi.fn(async () => []),
      start: vi.fn(async () => {}),
      write: vi.fn(),
      resize: vi.fn(),
      onData: vi.fn(() => () => {}),
      onExit: vi.fn(() => () => {}),
    },
  };
  return { desktop, setStateMock, changeHandler, repl, codeChange, sessionState };
});

vi.mock('./desktop', () => ({ desktop }));

vi.mock('./useStrudel', () => ({
  useStrudel: (onCodeChange: (code: string) => void) => {
    codeChange.current = onCodeChange;
    return repl;
  },
}));

vi.mock('./liveSnapshot', () => ({
  APP_BUILT: 'test',
  readAudio: vi.fn(() => ({ channels: {} })),
  writeSnapshot: vi.fn(),
}));

// Rendering the harness pane needs two browser globals jsdom does not have.
// The observer never fires here, so the terminal stays unopened — fine: the
// pane's presence in the DOM is what the test below pins.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
window.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
if (!document.fonts) {
  Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve() } });
}
// jsdom also ships no pointer capture; the pane grips call it on pointerdown.
window.HTMLElement.prototype.setPointerCapture ??= () => {};

afterEach(() => {
  cleanup();
});

// The dock's EQ mounts a canvas in every App test; jsdom without the canvas
// package logs a noisy "not implemented" for getContext, and the EQ guards
// null anyway. One file-wide stub keeps the output clean.
let canvasContext: MockInstance<typeof HTMLCanvasElement.prototype.getContext>;
beforeEach(() => {
  canvasContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  canvasContext.mockRestore();
});

beforeEach(() => {
  setStateMock.mockClear();
  desktop.sessions.list.mockResolvedValue([{ name: 'we cook', beats: 2, usedAt: 1 }]);
  desktop.sessions.open.mockClear();
  desktop.beats.listInfo.mockResolvedValue([
    { name: '808ing.js', modifiedAt: 1 },
    { name: 'we begin.js', modifiedAt: 2 },
  ]);
  sessionState.mockResolvedValue({ beat: 'we begin.js' });
  desktop.beats.read.mockClear();
  desktop.beats.read.mockImplementation(async (name: string) => `// ${name}`);
  desktop.beats.remove.mockClear();
  changeHandler.current = undefined;
  codeChange.current = undefined;
  repl.state = { started: false, error: undefined };
  repl.clearError.mockClear();
  repl.getCode.mockReset();
  repl.getCode.mockReturnValue(undefined);
  repl.tokenAt.mockReset();
  repl.tokenAt.mockReturnValue(undefined);
  repl.setCode.mockClear();
  repl.toggle.mockClear();
  repl.reevaluate.mockClear();
});

/** The beat pointers persisted so far, in order (beat-pointer writes only). */
function persistedBeats(): (string | null)[] {
  return setStateMock.mock.calls
    .map((call) => call[1])
    .filter((state) => state && 'beat' in state)
    .map((state) => state.beat as string | null);
}

async function openSessionFromPicker(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByText('we cook');
  await user.click(screen.getByText('we cook'));
  await waitFor(() => expect(screen.getAllByText('we begin').length).toBeGreaterThan(0));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('App harness pane under pattern errors', () => {
  it('keeps the harness pane mounted while a giant mini-parse error is shown', async () => {
    // The mini parse error's message runs for hundreds of characters (the
    // full token list it expected). That message is the one input that used
    // to shove the fixed-width harness pane out of the window: the status
    // bar slot refused to wrap and inflated the app's grid column. The pane
    // must stay in the UI — and in the DOM — with the error showing.
    const giantError =
      '[mini] parse error at line 4: Expected "!", "(", "*", ",", "..", "/", ":", "<", ">", "?", "[", "{", ' +
      '[@_], a letter, a number, "-", "#", ".", "^", "_", or whitespace but "\'" found.';
    desktop.harness.list.mockResolvedValue([{ id: 'shell', label: 'shell' }] as never);
    const view = render(<App />);
    const user = userEvent.setup();
    await openSessionFromPicker(user);

    // The error arrives while playing (a watcher apply, say). Adopting on
    // open cleared anything stale, so set it now — as a re-evaluation would.
    repl.state = { started: true, error: new Error(giantError) };
    view.rerender(<App />);

    // The status bar shows the whole failure (title) with the text truncated
    // by CSS, and the harness pane is still right there beside the editor.
    expect(screen.getByTitle(giantError)).toBeTruthy();
    expect(screen.getByText('[ harness ]')).toBeTruthy();
    expect(document.querySelector('.term')).not.toBeNull();
  });
});

describe('App session state', () => {
  it('persists the focused beat when the EDIT buffer moves to another beat', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    // The buffer shows the restored beat, and the state write on open agrees.
    await waitFor(() => expect(persistedBeats().at(-1)).toBe('we begin.js'));

    // Focus 808ing in the tree: the pointer must follow immediately, not on
    // some later render that may never come.
    await user.click(screen.getByRole('button', { name: '808ing.js' }));

    await waitFor(() => expect(persistedBeats().at(-1)).toBe('808ing.js'));
    expect(setStateMock).toHaveBeenCalledWith('we cook', { beat: '808ing.js' });
  });

  it('persists the pointer under the new name when the open beat is renamed', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    await waitFor(() => expect(persistedBeats().at(-1)).toBe('we begin.js'));

    // Rename via the row context menu; it opens the input pre-filled with the open beat.
    fireEvent.contextMenu(screen.getByRole('button', { name: 'we begin.js' }));
    await user.click(screen.getByRole('menuitem', { name: 'rename' }));
    const input = await screen.findByDisplayValue('we begin');
    await user.clear(input);
    await user.type(input, 'day one{Enter}');

    await waitFor(() => expect(persistedBeats().at(-1)).toBe('day one.js'));
  });

  it('clears the pointer when the session is left with no beats', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    await waitFor(() => expect(persistedBeats().at(-1)).toBe('we begin.js'));

    // Both beats go away; the app must not leave a beat name that no longer
    // resolves on disk.
    desktop.beats.listInfo.mockResolvedValue([]);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'we begin.js' }));
    await user.click(screen.getByRole('menuitem', { name: 'delete' }));
    await user.click(await screen.findByText('delete'));

    await waitFor(() => expect(persistedBeats().at(-1)).toBeNull());
    expect(setStateMock).toHaveBeenLastCalledWith('we cook', { beat: null });
  });

  it('heals a stale persisted pointer on open by adopting a real beat', async () => {
    // The session was left pointing at a beat that no longer exists — exactly
    // the state a harness reads and edits the wrong file from.
    sessionState.mockResolvedValue({ beat: 'deleted-beat.js' });
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    // The buffer falls back to a real beat and the pointer says so.
    await waitFor(() => expect(persistedBeats().at(-1)).toBe('808ing.js'));
  });

  it('opens the session and reports only the beat that failed to load', async () => {
    desktop.sessions.list.mockResolvedValue([
      { name: 'we cook', beats: 2, usedAt: 2 },
      { name: 'other session', beats: 2, usedAt: 1 },
    ]);
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    await user.click(screen.getByTitle('Switch session'));
    desktop.beats.read.mockRejectedValueOnce(new Error('beat load failed'));
    await user.click(screen.getByText('other session'));

    expect(await screen.findByText(/Could not load 808ing\.js/)).toBeTruthy();
    expect(desktop.sessions.open).toHaveBeenLastCalledWith('other session');
    expect(screen.getByTitle('Switch session').textContent).toContain('other session');
    expect(screen.getByRole('button', { name: 'we begin.js' })).toBeTruthy();
  });

  it('still persists tempo and sort state next to the beat pointer', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    await user.click(screen.getByTitle('Slower'));

    await waitFor(() => {
      const maps = setStateMock.mock.calls.filter((call) => 'cpsByBeat' in call[1]);
      expect(maps.length).toBeGreaterThan(0);
    });
  });

  it('commits a session from the atomic open payload', async () => {
    desktop.beats.read.mockRejectedValue(new Error('mutable store read raced'));
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    expect(screen.getByTitle('Switch session').textContent).toContain('we cook');
    expect(persistedBeats().at(-1)).toBe('we begin.js');
  });

  it('clones the focused beat from the titlebar action', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    desktop.beats.list.mockResolvedValue(['we begin.js', '808ing.js']);
    desktop.beats.create.mockClear();

    await user.click(screen.getByRole('button', { name: 'clone' }));

    await waitFor(() => expect(desktop.beats.create).toHaveBeenCalledWith('we begin-2.js', '// we begin.js'));
  });

  it('clones a non-focused row from disk', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    desktop.beats.list.mockResolvedValue(['we begin.js', '808ing.js']);
    desktop.beats.read.mockClear();
    desktop.beats.create.mockClear();

    fireEvent.contextMenu(screen.getByRole('button', { name: '808ing.js' }));
    await user.click(screen.getByRole('menuitem', { name: 'clone' }));

    await waitFor(() => expect(desktop.beats.create).toHaveBeenCalledWith('808ing-2.js', '// 808ing.js'));
    expect(desktop.beats.read).toHaveBeenCalledWith('808ing.js');
  });

  it('clones the focused row with its current unsaved buffer from the context menu', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    await act(async () => {
      codeChange.current?.('// focused unsaved buffer');
    });
    desktop.beats.list.mockResolvedValue(['we begin.js', '808ing.js']);
    desktop.beats.create.mockClear();

    fireEvent.contextMenu(screen.getByRole('button', { name: 'we begin.js' }));
    await user.click(screen.getByRole('menuitem', { name: 'clone' }));

    await waitFor(() =>
      expect(desktop.beats.create).toHaveBeenCalledWith('we begin-2.js', '// focused unsaved buffer'),
    );
  });

  it('keeps the beat shortcuts working when the sidebar is collapsed', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    await user.click(screen.getByTitle('Hide beats'));
    fireEvent.keyDown(window, { key: 'F2' });
    expect(await screen.findByDisplayValue('we begin')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    await user.click(screen.getByTitle('Hide beats'));
    fireEvent.keyDown(window, { key: 'Backspace', metaKey: true });
    expect(await screen.findByText('delete we begin?')).toBeTruthy();
  });

  it('does not run beat shortcuts while the session picker is open', async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'n', metaKey: true });

    expect(screen.queryByPlaceholderText('name')).toBeNull();
    expect(screen.queryByPlaceholderText('session name')).toBeNull();
  });

  it('deletes the default session from the session picker', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('we cook');
    desktop.sessions.list.mockResolvedValueOnce([]);

    await user.click(screen.getByRole('button', { name: 'Delete session we cook' }));

    await waitFor(() => expect(desktop.sessions.remove).toHaveBeenCalledWith('we cook'));
    expect(confirm).toHaveBeenCalledWith('Delete session "we cook"?');
    confirm.mockRestore();
  });

  it('finishes a clone before switching the session', async () => {
    const user = userEvent.setup();
    desktop.sessions.list.mockResolvedValue([
      { name: 'we cook', beats: 2, usedAt: 1 },
      { name: 'other session', beats: 1, usedAt: 2 },
    ]);
    render(<App />);
    await openSessionFromPicker(user);
    desktop.sessions.open.mockClear();
    desktop.beats.create.mockClear();

    let listStarted!: () => void;
    let releaseList!: (beats: string[]) => void;
    const started = new Promise<void>((resolve) => {
      listStarted = resolve;
    });
    const listed = new Promise<string[]>((resolve) => {
      releaseList = resolve;
    });
    desktop.beats.list.mockImplementationOnce(async () => {
      listStarted();
      return listed;
    });

    await user.click(screen.getByRole('button', { name: 'clone' }));
    await started;
    await user.click(screen.getByTitle('Switch session'));
    await user.click(screen.getByText('other session'));
    expect(desktop.sessions.open).not.toHaveBeenCalled();

    releaseList(['we begin.js', '808ing.js']);
    await waitFor(() => expect(desktop.sessions.open).toHaveBeenCalledWith('other session'));
    expect(desktop.beats.create).toHaveBeenCalledWith('we begin-2.js', '// we begin.js');
  });

  it('keeps inactive-row rename and delete from moving the active pointer', async () => {
    const user = userEvent.setup();
    desktop.beats.rename.mockClear();
    desktop.beats.remove.mockClear();
    desktop.beats.listInfo.mockImplementation(async () => [
      { name: desktop.beats.rename.mock.calls.length > 0 ? 'drums.js' : '808ing.js', modifiedAt: 1 },
      { name: 'we begin.js', modifiedAt: 2 },
    ]);
    render(<App />);
    await openSessionFromPicker(user);
    await waitFor(() => expect(persistedBeats().at(-1)).toBe('we begin.js'));

    fireEvent.contextMenu(screen.getByRole('button', { name: '808ing.js' }));
    await user.click(screen.getByRole('menuitem', { name: 'rename' }));
    await user.clear(screen.getByPlaceholderText('name'));
    await user.type(screen.getByPlaceholderText('name'), 'drums{Enter}');
    await waitFor(() => expect(desktop.beats.rename).toHaveBeenCalledWith('808ing.js', 'drums.js'));
    expect(persistedBeats().at(-1)).toBe('we begin.js');

    fireEvent.contextMenu(screen.getByRole('button', { name: 'drums.js' }));
    await user.click(screen.getByRole('menuitem', { name: 'delete' }));
    await user.click(screen.getByText('delete'));
    await waitFor(() => expect(desktop.beats.remove).toHaveBeenCalledWith('drums.js'));
    expect(persistedBeats().at(-1)).toBe('we begin.js');
  });

  it('moves away if an inactive row becomes open while it is being deleted', async () => {
    const user = userEvent.setup();
    let listedBeats = [
      { name: '808ing.js', modifiedAt: 1 },
      { name: 'we begin.js', modifiedAt: 2 },
    ];
    desktop.beats.listInfo.mockImplementation(async () => listedBeats);
    let removalStarted!: () => void;
    let releaseRemoval!: () => void;
    const started = new Promise<void>((resolve) => {
      removalStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseRemoval = resolve;
    });
    desktop.beats.remove.mockImplementationOnce(async () => {
      removalStarted();
      await released;
      listedBeats = [{ name: 'we begin.js', modifiedAt: 2 }];
    });
    render(<App />);
    await openSessionFromPicker(user);

    fireEvent.contextMenu(screen.getByRole('button', { name: '808ing.js' }));
    await user.click(screen.getByRole('menuitem', { name: 'delete' }));
    await user.click(screen.getByText('delete'));
    await started;
    await user.click(screen.getByRole('button', { name: '808ing.js' }));

    releaseRemoval();
    await waitFor(() => expect(persistedBeats().at(-1)).toBe('we begin.js'));
  });

  it('does not adopt an inactive beat after its deletion wins the open race', async () => {
    const user = userEvent.setup();
    let listedBeats = [
      { name: '808ing.js', modifiedAt: 1 },
      { name: 'we begin.js', modifiedAt: 2 },
    ];
    desktop.beats.listInfo.mockImplementation(async () => listedBeats);
    let removalStarted!: () => void;
    let releaseRemoval!: () => void;
    const started = new Promise<void>((resolve) => {
      removalStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseRemoval = resolve;
    });
    desktop.beats.remove.mockImplementationOnce(async () => {
      removalStarted();
      await released;
      listedBeats = [{ name: 'we begin.js', modifiedAt: 2 }];
    });
    render(<App />);
    await openSessionFromPicker(user);

    let readStarted!: () => void;
    let releaseRead!: () => void;
    const readBegan = new Promise<void>((resolve) => {
      readStarted = resolve;
    });
    const readReleased = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    desktop.beats.read.mockImplementation(async (name: string) => {
      if (name === '808ing.js') {
        readStarted();
        await readReleased;
      }
      return `// ${name}`;
    });

    fireEvent.contextMenu(screen.getByRole('button', { name: '808ing.js' }));
    await user.click(screen.getByRole('menuitem', { name: 'delete' }));
    await user.click(screen.getByText('delete'));
    await started;
    await user.click(screen.getByRole('button', { name: '808ing.js' }));
    releaseRemoval();
    await readBegan;
    releaseRead();

    await waitFor(() => expect(persistedBeats().at(-1)).toBe('we begin.js'));
  });
});

describe('App beat drafts', () => {
  async function editCurrentBeat(content: string): Promise<void> {
    await act(async () => {
      codeChange.current?.(content);
    });
  }

  it('keeps an unsaved draft and its dirty dot when switching beats', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    await editCurrentBeat('// draft for we begin');

    const first = screen.getByRole('button', { name: 'we begin.js' });
    await waitFor(() => expect(first.getAttribute('data-dirty')).toBe('true'));

    await user.click(screen.getByRole('button', { name: '808ing.js' }));
    await waitFor(() => expect(persistedBeats().at(-1)).toBe('808ing.js'));
    expect(first.getAttribute('data-dirty')).toBe('true');
    expect(screen.getByRole('button', { name: '808ing.js' }).getAttribute('data-dirty')).toBeNull();

    await user.click(first);
    await waitFor(() => expect(repl.setCode).toHaveBeenLastCalledWith('// draft for we begin'));
  });

  it('Cmd+S writes only the focused draft and clears only that dirty state', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    await editCurrentBeat('// draft for we begin');
    await user.click(screen.getByRole('button', { name: '808ing.js' }));
    await editCurrentBeat('// draft for 808ing');
    desktop.beats.write.mockClear();

    fireEvent.keyDown(window, { key: 's', metaKey: true });

    await waitFor(() => expect(desktop.beats.write).toHaveBeenCalledWith('808ing.js', '// draft for 808ing'));
    expect(screen.getByRole('button', { name: '808ing.js' }).getAttribute('data-dirty')).toBeNull();
    expect(screen.getByRole('button', { name: 'we begin.js' }).getAttribute('data-dirty')).toBe('true');
  });

  it('Cmd+S captures the current editor value before writing', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    repl.getCode.mockReturnValue('// latest editor code');
    desktop.beats.write.mockClear();

    fireEvent.keyDown(window, { key: 's', metaKey: true });

    await waitFor(() => expect(desktop.beats.write).toHaveBeenCalledWith('we begin.js', '// latest editor code'));
  });

  it('Cmd+S clears an older polled draft when saving newer editor content', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    await editCurrentBeat('// older polled draft');
    repl.getCode.mockReturnValue('// latest editor code');
    desktop.beats.write.mockClear();

    fireEvent.keyDown(window, { key: 's', metaKey: true });

    await waitFor(() => expect(desktop.beats.write).toHaveBeenCalledWith('we begin.js', '// latest editor code'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'we begin.js' }).getAttribute('data-dirty')).toBeNull(),
    );
  });

  it('preserves a newer edit made while a save is in flight', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    let editorContent = '// draft A';
    repl.getCode.mockImplementation(() => editorContent);
    await editCurrentBeat(editorContent);
    const write = deferred<void>();
    desktop.beats.write.mockImplementationOnce(() => write.promise);

    fireEvent.keyDown(window, { key: 's', metaKey: true });
    await waitFor(() => expect(desktop.beats.write).toHaveBeenCalledWith('we begin.js', '// draft A'));

    editorContent = '// draft B';
    await editCurrentBeat(editorContent);
    await act(async () => {
      write.resolve();
      await write.promise;
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'we begin.js' }).getAttribute('data-dirty')).toBe('true'),
    );
  });

  it('keeps the latest beat selected when disk reads resolve out of order', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    repl.setCode.mockClear();
    const beatB = deferred<string>();
    const beatC = deferred<string>();
    desktop.beats.read.mockImplementation((name: string) => {
      if (name === '808ing.js') {
        return beatB.promise;
      }
      if (name === 'we begin.js') {
        return beatC.promise;
      }
      return Promise.resolve(`// ${name}`);
    });

    await user.click(screen.getByRole('button', { name: '808ing.js' }));
    await user.click(screen.getByRole('button', { name: 'we begin.js' }));
    await act(async () => {
      beatC.resolve('// latest beat');
      await beatC.promise;
    });
    await act(async () => {
      beatB.resolve('// stale beat');
      await beatB.promise;
    });

    expect(screen.getByRole('button', { name: 'we begin.js' }).getAttribute('aria-current')).toBe('true');
    expect(repl.setCode).toHaveBeenLastCalledWith('// latest beat');
  });

  it('warns on close when an inactive beat still has a dirty draft', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    await editCurrentBeat('// draft for we begin');
    await user.click(screen.getByRole('button', { name: '808ing.js' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'we begin.js' }).getAttribute('data-dirty')).toBe('true'),
    );
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('captures an unpolled edit before the close guard checks drafts', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    repl.getCode.mockReturnValue('// unpolled editor code');

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('captures the editor before switching sessions', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    repl.getCode.mockReturnValue('// unpolled before session switch');

    await user.click(screen.getByTitle('Switch session'));
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps a dirty inactive draft when its disk file is unlinked', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    await editCurrentBeat('// draft for we begin');
    await user.click(screen.getByRole('button', { name: '808ing.js' }));

    await waitFor(() => expect(changeHandler.current).toBeDefined());
    await changeHandler.current!({ name: 'we begin.js', event: 'unlink' });

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps the newest watcher conflict when reads resolve out of order', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    await editCurrentBeat('// draft for we begin');
    await user.click(screen.getByRole('button', { name: '808ing.js' }));

    const staleRead = deferred<string>();
    const latestRead = deferred<string>();
    let watcherReads = 0;
    desktop.beats.read.mockImplementation((name: string) => {
      if (name !== 'we begin.js') {
        return Promise.resolve(`// ${name}`);
      }
      watcherReads += 1;
      return watcherReads === 1 ? staleRead.promise : latestRead.promise;
    });
    const first = changeHandler.current!({ name: 'we begin.js', event: 'change' });
    const second = changeHandler.current!({ name: 'we begin.js', event: 'change' });
    await waitFor(() => expect(watcherReads).toBe(2));

    await act(async () => {
      latestRead.resolve('// disk D');
      await second;
    });
    await act(async () => {
      staleRead.resolve('// disk C');
      await first;
    });

    desktop.beats.read.mockResolvedValue('// disk D');
    await user.click(screen.getByRole('button', { name: 'we begin.js' }));
    await user.click(screen.getByRole('button', { name: 'take theirs' }));

    expect(repl.setCode).toHaveBeenLastCalledWith('// disk D');
  });

  it('preserves a dirty draft when an app rename emits its unlink first', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    await editCurrentBeat('// draft for we begin');
    fireEvent.contextMenu(screen.getByRole('button', { name: 'we begin.js' }));
    await user.click(screen.getByRole('menuitem', { name: 'rename' }));
    const input = await screen.findByDisplayValue('we begin');
    desktop.beats.listInfo.mockResolvedValue([
      { name: 'day one.js', modifiedAt: 2 },
      { name: '808ing.js', modifiedAt: 1 },
    ]);
    desktop.beats.rename.mockImplementationOnce(async () => {
      await changeHandler.current?.({ name: 'we begin.js', event: 'unlink' });
    });

    await user.clear(input);
    await user.type(input, 'day one{Enter}');

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('starts with no drafts after the renderer is restarted', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    await editCurrentBeat('// draft discarded on restart');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'we begin.js' }).getAttribute('data-dirty')).toBe('true'),
    );

    cleanup();
    render(<App />);
    await openSessionFromPicker(user);

    expect(screen.getByRole('button', { name: 'we begin.js' }).getAttribute('data-dirty')).toBeNull();
  });
});

describe('App plugin dock', () => {
  it('keeps the dock open across a beat switch and persists it with the session', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    await user.click(screen.getByTitle('Add device'));
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '[ EQ ]' }));
    expect(screen.getByRole('button', { name: '[ EQ ]' })).toBeTruthy();

    // Plugins are live gear: switching beats must not close the EQ.
    await user.click(screen.getByRole('button', { name: '808ing.js' }));
    expect(screen.getByRole('button', { name: '[ EQ ]' })).toBeTruthy();

    await waitFor(() => {
      const writes = setStateMock.mock.calls.filter((call) => 'dock' in call[1]);
      expect(writes.at(-1)?.[1].dock).toEqual({ split: false, panes: [{ tabs: ['eq'], active: 'eq' }] });
    });
  });

  it('restores the split dock the session was left in', async () => {
    sessionState.mockResolvedValue({
      beat: 'we begin.js',
      dock: { split: true, panes: [{ tabs: ['eq'], active: 'eq' }, { tabs: [] }] },
    });
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    expect(document.querySelectorAll('.dock-pane')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '[ EQ ]' })).toBeTruthy();
    expect(screen.getAllByTitle('Merge back to one pane')).toHaveLength(2);
  });

  it('forgets dock tabs for plugins that no longer exist', async () => {
    sessionState.mockResolvedValue({
      beat: 'we begin.js',
      dock: { split: false, panes: [{ tabs: ['ghost'] }] },
    });
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    expect(screen.getByText('[ no device ]')).toBeTruthy();
    expect(screen.queryByText('[ GHOST ]')).toBeNull();
  });
});

describe('editor context menu', () => {
  it('starts stopped playback and spawns the supported function plugin', async () => {
    const code = 's("bd").gain(0.25)';
    repl.getCode.mockReturnValue(code);
    repl.tokenAt.mockReturnValue({ text: 'gain', offset: code.indexOf('gain') + 1 });
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    fireEvent.contextMenu(document.querySelector('.editor')!, { clientX: 120, clientY: 90 });
    const menu = screen.getByRole('menu', { name: 'Editor actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Start music' })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: 'Stop music' })).toBeNull();
    await user.click(within(menu).getByRole('menuitem', { name: 'Start music' }));
    expect(repl.toggle).toHaveBeenCalledOnce();

    fireEvent.contextMenu(document.querySelector('.editor')!, { clientX: 120, clientY: 90 });
    await user.click(screen.getByRole('menuitem', { name: 'Spawn floating gain plugin' }));
    expect(document.querySelector('.app-overlay > .function-floating-panel')).toBeTruthy();

    fireEvent.change(screen.getByRole('slider', { name: 'Function gain' }), { target: { value: '0.75' } });
    expect(repl.setCode).toHaveBeenLastCalledWith('s("bd").gain(0.75)');
    expect(repl.reevaluate).toHaveBeenCalled();

    await waitFor(() => {
      const writes = setStateMock.mock.calls.filter((call) => 'dock' in call[1]);
      expect(writes.at(-1)?.[1].dock).toEqual({ split: false, panes: [{ tabs: [] }] });
    });

    await user.click(screen.getByRole('button', { name: '808ing.js' }));
    expect(document.querySelector('.function-floating-panel')).toBeNull();
  });

  it('offers only Stop music while playback is running', async () => {
    repl.state = { started: true, error: undefined };
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    fireEvent.contextMenu(document.querySelector('.editor')!);
    const menu = screen.getByRole('menu', { name: 'Editor actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Stop music' })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: 'Start music' })).toBeNull();
    await user.click(within(menu).getByRole('menuitem', { name: 'Stop music' }));
    expect(repl.toggle).toHaveBeenCalledOnce();
  });

  it('does not offer a plugin for an unsupported token and dismisses on Escape', async () => {
    repl.tokenAt.mockReturnValue({ text: 'sometimes', offset: 1 });
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    fireEvent.contextMenu(document.querySelector('.editor')!);
    const menu = screen.getByRole('menu', { name: 'Editor actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Start music' })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: /Spawn floating/ })).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Editor actions' })).toBeNull();

    const editor = document.querySelector('.editor');
    expect(editor).not.toBeNull();
    if (!editor) return;
    fireEvent.contextMenu(editor);
    expect(screen.getByRole('menu', { name: 'Editor actions' })).toBeTruthy();
    expect(fireEvent.pointerDown(editor)).toBe(true);
    expect(screen.queryByRole('menu', { name: 'Editor actions' })).toBeNull();
  });
});

describe('App harness-edit hardening', () => {
  /** Deliver one watcher event, as the main process would. */
  async function harnessWrites(name: string): Promise<void> {
    await waitFor(() => expect(changeHandler.current).toBeDefined());
    await changeHandler.current!({ name, event: 'change' });
  }

  it('surfaces a failed disk-change apply in the error surface instead of dying', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    await waitFor(() => expect(persistedBeats().at(-1)).toBe('we begin.js'));

    // The beat file the harness wrote cannot be read back (deleted between
    // the watcher event and the read, say). The editor must stay up and say
    // what went wrong, not leave the failure as an unhandled rejection.
    desktop.beats.read.mockRejectedValueOnce(new Error('ENOENT: we begin.js'));
    await harnessWrites('we begin.js');

    expect(await screen.findByText('ENOENT: we begin.js')).toBeTruthy();
    // The app is still alive: the error is dismissible and the tree remains.
    await user.click(screen.getByText('ENOENT: we begin.js'));
    expect(screen.queryByText('ENOENT: we begin.js')).toBeNull();
  });

  it('surfaces an editor failure during an apply, keeping the app alive', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    await waitFor(() => expect(persistedBeats().at(-1)).toBe('we begin.js'));

    repl.setCode.mockImplementationOnce(() => {
      throw new Error('editor exploded');
    });
    // A genuinely new disk content is what makes the sync rule choose apply.
    desktop.beats.read.mockResolvedValueOnce('// we begin.js — harness edit');
    await harnessWrites('we begin.js');

    expect(await screen.findByText('editor exploded')).toBeTruthy();
    // The disk content was still adopted into the buffer before the editor
    // threw: the next attempt works from the new content, not the old.
    fireEvent.contextMenu(screen.getByRole('button', { name: 'we begin.js' }));
    expect(screen.getByRole('menuitem', { name: 'rename' })).toBeTruthy();
  });

  it('clears a stale REPL parse error when a harness write lands while stopped', async () => {
    const user = userEvent.setup();
    repl.state = { started: false, error: new Error('[mini] parse error at line 8: Expected a letter') };
    render(<App />);
    await openSessionFromPicker(user);
    await waitFor(() => expect(persistedBeats().at(-1)).toBe('we begin.js'));

    // The harness rewrote the beat with valid code; stopped playback means no
    // re-evaluation will refresh the REPL's error state, so the app clears it.
    desktop.beats.read.mockResolvedValueOnce('// we begin.js — harness fix');
    await harnessWrites('we begin.js');

    await waitFor(() => expect(screen.queryByText(/parse error/)).toBeNull());
  });

  it('clears a stale REPL parse error when another beat is adopted', async () => {
    const user = userEvent.setup();
    repl.state = { started: false, error: new Error('[mini] parse error at line 8: Expected a letter') };
    render(<App />);
    await openSessionFromPicker(user);
    await waitFor(() => expect(persistedBeats().at(-1)).toBe('we begin.js'));

    // The parse error belonged to a beat that is gone from the buffer. The
    // status bar must not keep accusing the newly adopted beat of it.
    await waitFor(() => expect(screen.queryByText(/parse error/)).toBeNull());
    expect(repl.clearError).toHaveBeenCalled();
  });
});

describe('App dock resize', () => {
  beforeEach(() => {
    localStorage.removeItem('pane.dock');
  });

  /** The --dock-h value the app grid currently sizes the dock row to. */
  function dockH(): string {
    const app = document.querySelector('.app') as HTMLElement | null;
    expect(app).not.toBeNull();
    return app!.style.getPropertyValue('--dock-h');
  }

  it('sits a horizontal separator grip between the panes and the dock', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    const rows = Array.from(document.querySelector('.app')!.children);
    expect(rows[1]?.className).toBe('panes');
    expect(rows[2]?.className).toBe('grip grip-h');
    expect(rows[2]?.getAttribute('role')).toBe('separator');
    expect(rows[2]?.getAttribute('aria-orientation')).toBe('horizontal');
    expect(rows[3]?.className).toBe('dock');
    expect(dockH()).toBe('104px');
  });

  it('resizes the dock by dragging the grip and persists the height', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    const grip = screen.getByRole('separator', { name: 'Resize plugin dock' });
    fireEvent.pointerDown(grip, { pointerId: 1, clientY: 400 });
    fireEvent.pointerMove(grip, { pointerId: 1, clientY: 300 });
    fireEvent.pointerUp(grip, { pointerId: 1 });

    expect(dockH()).toBe('204px');
    expect(localStorage.getItem('pane.dock')).toBe('204');
  });

  it('restores the persisted height on the next launch', async () => {
    localStorage.setItem('pane.dock', '220');
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    expect(dockH()).toBe('220px');
  });

  it('clamps a tall dock against the window height and follows live resizes', async () => {
    // jsdom's default window is 768px tall, so the dock ceiling is 547.
    localStorage.setItem('pane.dock', '900');
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    expect(dockH()).toBe('547px');

    // The window shrinks below the stored height: the dock must follow, not
    // starve the editor and harness rows above it.
    const innerHeight = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(420);
    fireEvent(window, new Event('resize'));
    expect(dockH()).toBe('199px');
    innerHeight.mockRestore();
  });

  it('keeps an out-of-range preference when clamp interactions do not move the dock', async () => {
    localStorage.setItem('pane.dock', '900');
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    const grip = screen.getByRole('separator', { name: 'Resize plugin dock' });
    grip.focus();
    await user.keyboard('{ArrowUp}');
    fireEvent.pointerDown(grip, { pointerId: 1, clientY: 400 });
    fireEvent.pointerMove(grip, { pointerId: 1, clientY: 300 });
    fireEvent.pointerUp(grip, { pointerId: 1 });

    expect(dockH()).toBe('547px');
    expect(localStorage.getItem('pane.dock')).toBe('900');

    cleanup();
    localStorage.setItem('pane.dock', '10');
    render(<App />);
    await openSessionFromPicker(user);

    const lowerGrip = screen.getByRole('separator', { name: 'Resize plugin dock' });
    lowerGrip.focus();
    await user.keyboard('{ArrowDown}');
    fireEvent.pointerDown(lowerGrip, { pointerId: 1, clientY: 400 });
    fireEvent.pointerMove(lowerGrip, { pointerId: 1, clientY: 10000 });
    fireEvent.pointerUp(lowerGrip, { pointerId: 1 });

    expect(dockH()).toBe('56px');
    expect(localStorage.getItem('pane.dock')).toBe('10');
  });

  it('never clamps the dock below its floor', async () => {
    localStorage.setItem('pane.dock', '10');
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    expect(dockH()).toBe('56px');
  });

  it('resizes the dock from the keyboard and persists it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    const grip = screen.getByRole('separator', { name: 'Resize plugin dock' });
    grip.focus();
    await user.keyboard('{ArrowUp}');

    expect(dockH()).toBe('120px');
    expect(localStorage.getItem('pane.dock')).toBe('120');
  });
});

// The recording seam is mocked so a take can complete in jsdom; the control,
// the export path, and the failure surfaces are what these tests exercise.
vi.mock('./recording', () => ({
  startRecording: vi.fn(() => ({
    extension: 'webm',
    stop: async () => new Blob(['take']),
  })),
}));

describe('App settings overlay', () => {
  /** Deliver an editor edit exactly as the polled buffer would. */
  async function editOpenBeat(content: string): Promise<void> {
    await act(async () => {
      codeChange.current?.(content);
    });
  }

  beforeEach(() => {
    desktop.settings.load.mockResolvedValue({ version: 1 });
    desktop.settings.update.mockClear();
  });

  it('preserves the live editor and the dirty marker across a Settings round trip', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    await editOpenBeat('// draft kept through settings');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'we begin.js' }).getAttribute('data-dirty')).toBe('true'),
    );
    repl.setCode.mockClear();

    await user.click(screen.getByTitle('Settings'));

    // The settings page is on top; the app underneath never unmounted, so
    // the editor was never reseeded with "// loading" and the sound kept its
    // scheduler. What was dirty stays dirty.
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    expect(document.querySelector('.editor')).not.toBeNull();
    expect(repl.setCode).not.toHaveBeenCalledWith('// loading');

    await user.click(screen.getByRole('button', { name: /back/ }));

    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    expect(document.querySelector('.editor')).not.toBeNull();
    expect(repl.setCode).not.toHaveBeenCalledWith('// loading');
    expect(screen.getByRole('button', { name: 'we begin.js' }).getAttribute('data-dirty')).toBe('true');
  });

  it('applies a recording mode change to the titlebar record control live', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    expect(screen.getByText('● record audio')).toBeTruthy();

    await user.click(screen.getByTitle('Settings'));
    fireEvent.change(screen.getByLabelText('Record button action'), { target: { value: 'mp4' } });

    await waitFor(() => expect(screen.getByText('● record mp4')).toBeTruthy());
    expect(desktop.settings.update).toHaveBeenCalledWith({
      recordConfig: expect.objectContaining({ mode: 'mp4' }),
    });
  });

  it('persists the sidebar latency choice so Settings and the dropdown agree', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    fireEvent.change(screen.getByRole('combobox', { name: 'Audio switch latency' }), {
      target: { value: 'immediate' },
    });

    await waitFor(() => expect(desktop.settings.update).toHaveBeenCalledWith({ beatSwitchTiming: 'immediate' }));
  });
});

describe('App close protection', () => {
  let closeSpy: MockInstance<typeof window.close>;

  beforeEach(() => {
    closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});
    desktop.settings.load.mockResolvedValue({ version: 1 });
    desktop.beats.write.mockClear();
    desktop.beats.writeIn.mockClear();
    desktop.close.reportDirty.mockClear();
    repl.setCode.mockClear();
  });

  afterEach(() => {
    closeSpy.mockRestore();
  });

  /** The window's close attempt, exactly as Electron delivers it, run
   *  through act so the close-decision state it schedules is flushed. */
  async function attemptClose(): Promise<BeforeUnloadEvent> {
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    await act(async () => {
      window.dispatchEvent(event);
    });
    return event;
  }

  /** Deliver an editor edit exactly as the polled buffer would. */
  async function editOpenBeat(content: string): Promise<void> {
    await act(async () => {
      codeChange.current?.(content);
    });
  }

  async function dirtyDraft(user: ReturnType<typeof userEvent.setup>, content: string): Promise<void> {
    await openSessionFromPicker(user);
    await editOpenBeat(content);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'we begin.js' }).getAttribute('data-dirty')).toBe('true'),
    );
  }

  it('asks with save all, discard, and cancel when drafts are dirty', async () => {
    const user = userEvent.setup();
    render(<App />);
    await dirtyDraft(user, '// draft at stake');

    const event = await attemptClose();

    expect(event.defaultPrevented).toBe(true);
    const dialog = screen.getByRole('dialog', { name: 'Unsaved beats' });
    expect(within(dialog).getByRole('button', { name: 'save all' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'discard' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'cancel' })).toBeTruthy();
    // The stakes are named, not counted.
    expect(within(dialog).getByText('we cook / we begin.js')).toBeTruthy();
  });

  it('cancel keeps everything open and still guarded', async () => {
    const user = userEvent.setup();
    render(<App />);
    await dirtyDraft(user, '// draft stays');
    await attemptClose();
    await user.click(screen.getByRole('button', { name: 'cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Unsaved beats' })).toBeNull();
    expect(closeSpy).not.toHaveBeenCalled();

    // The guard itself is undimmed: closing again still asks.
    const again = await attemptClose();
    expect(again.defaultPrevented).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Unsaved beats' })).toBeTruthy();
  });

  it('discard lets the close through, and the second beforeunload passes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await dirtyDraft(user, '// draft dropped by choice');
    await attemptClose();
    await user.click(screen.getByRole('button', { name: 'discard' }));

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(desktop.close.reportDirty).toHaveBeenCalledWith(false);

    // window.close() re-enters beforeunload; the confirmed choice must stand
    // down, or the close button would still do nothing.
    const again = await attemptClose();
    expect(again.defaultPrevented).toBe(false);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('save all writes every dirty draft of the session and lets the close through', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    await editOpenBeat('// draft one');
    await user.click(screen.getByRole('button', { name: '808ing.js' }));
    await editOpenBeat('// draft two');

    await attemptClose();
    await user.click(screen.getByRole('button', { name: 'save all' }));

    await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1));
    expect(desktop.beats.write).toHaveBeenCalledWith('we begin.js', '// draft one');
    expect(desktop.beats.write).toHaveBeenCalledWith('808ing.js', '// draft two');
    expect(desktop.close.reportDirty).toHaveBeenCalledWith(false);

    const again = await attemptClose();
    expect(again.defaultPrevented).toBe(false);
  });

  it('a failed write keeps the app open with the failure visible', async () => {
    const user = userEvent.setup();
    render(<App />);
    await dirtyDraft(user, '// draft that cannot land');
    desktop.beats.write.mockRejectedValueOnce(new Error('disk full'));

    await attemptClose();
    await user.click(screen.getByRole('button', { name: 'save all' }));

    expect(await screen.findByText('disk full')).toBeTruthy();
    expect(screen.getByText('not saved:')).toBeTruthy();
    expect(closeSpy).not.toHaveBeenCalled();
    // The dialog stays up with the reasons, ready to retry or cancel.
    expect(screen.getByRole('dialog', { name: 'Unsaved beats' })).toBeTruthy();
  });

  it('a conflict is reported and never overwritten on the way out', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    await editOpenBeat('// draft for we begin');
    await user.click(screen.getByRole('button', { name: '808ing.js' }));

    // The harness rewrites the dirty beat on disk; the sync rule marks a
    // conflict instead of adopting or dropping either side.
    desktop.beats.read.mockResolvedValueOnce('// harness edit');
    await waitFor(() => expect(changeHandler.current).toBeDefined());
    await changeHandler.current!({ name: 'we begin.js', event: 'change' });

    await attemptClose();
    await user.click(screen.getByRole('button', { name: 'save all' }));

    expect(await screen.findByText(/changed on disk while you were editing/)).toBeTruthy();
    expect(desktop.beats.write).not.toHaveBeenCalledWith('we begin.js', expect.anything());
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('auto-save writes safely and closes without asking', async () => {
    desktop.settings.load.mockResolvedValue({ version: 1, closeBehavior: 'auto-save' });
    const user = userEvent.setup();
    render(<App />);
    await dirtyDraft(user, '// auto-saved on close');

    const event = await attemptClose();

    // The close is held while the writes land, but no dialog interrupts.
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1));
    expect(desktop.beats.write).toHaveBeenCalledWith('we begin.js', '// auto-saved on close');
    expect(screen.queryByRole('dialog', { name: 'Unsaved beats' })).toBeNull();

    const again = await attemptClose();
    expect(again.defaultPrevented).toBe(false);
  });

  it('auto-save keeps the app open with the failure visible when a write fails', async () => {
    desktop.settings.load.mockResolvedValue({ version: 1, closeBehavior: 'auto-save' });
    const user = userEvent.setup();
    render(<App />);
    await dirtyDraft(user, '// draft that cannot land');
    desktop.beats.write.mockRejectedValueOnce(new Error('disk full'));

    await attemptClose();

    expect(await screen.findByText('disk full')).toBeTruthy();
    expect(closeSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Unsaved beats' })).toBeTruthy();
  });

  it('discard behavior closes immediately, without a dialog', async () => {
    desktop.settings.load.mockResolvedValue({ version: 1, closeBehavior: 'discard' });
    const user = userEvent.setup();
    render(<App />);
    await dirtyDraft(user, '// deliberately lost');

    const event = await attemptClose();

    // The window closes on its own; the app only stands down.
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Unsaved beats' })).toBeNull();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('a clean app closes with no dialog at all', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    const event = await attemptClose();

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Unsaved beats' })).toBeNull();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("saves another session's leftover draft through the named-session seam", async () => {
    // The draft left in "we cook" when the app moved to "other" must be
    // written into we cook's folder — not into the active session's files.
    desktop.sessions.list.mockResolvedValue([
      { name: 'we cook', beats: 2, usedAt: 2 },
      { name: 'other', beats: 2, usedAt: 1 },
    ]);
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);
    await editOpenBeat('// draft in we cook');

    await user.click(screen.getByTitle('Switch session'));
    await user.click(screen.getByText('other'));
    await waitFor(() => expect(screen.getByTitle('Switch session').textContent).toBe('other'));
    await editOpenBeat('// draft in other');

    await attemptClose();
    const dialog = screen.getByRole('dialog', { name: 'Unsaved beats' });
    expect(within(dialog).getByText('we cook / we begin.js')).toBeTruthy();
    expect(within(dialog).getByText('other / we begin.js')).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'save all' }));

    await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1));
    expect(desktop.beats.writeIn).toHaveBeenCalledWith('we cook', 'we begin.js', '// draft in we cook');
    expect(desktop.beats.write).toHaveBeenCalledWith('we begin.js', '// draft in other');
    expect(desktop.beats.write).not.toHaveBeenCalledWith('we begin.js', '// draft in we cook');
  });
});

describe('App record control', () => {
  beforeEach(() => {
    desktop.settings.load.mockResolvedValue({ version: 1 });
    desktop.recording.save.mockClear();
    repl.setCode.mockClear();
  });

  it('shows one record control in the titlebar, driven by the persisted mode', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    const control = document.querySelector('.titlebar .record-control');
    expect(control).not.toBeNull();
    expect(screen.getByText('● record audio')).toBeTruthy();
    // One control, not one per surface: the status bar shows the mode as
    // text, never a second button.
    expect(document.querySelectorAll('.record-control')).toHaveLength(1);
  });

  it('follows a persisted mp4 mode from the settings store', async () => {
    desktop.settings.load.mockResolvedValue({ version: 1, recordConfig: { enabled: false, mode: 'mp4' } });
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    expect(screen.getByText('● record mp4')).toBeTruthy();
    expect(screen.getByText('rec: mp4')).toBeTruthy();
  });

  it('fails visibly when there is no live master mix to take', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    await user.click(screen.getByRole('button', { name: 'Start recording' }));

    // The failure lands on the app's error surface, spelled out, not a silent
    // no-op button.
    expect(await screen.findByText(/Recording failed/)).toBeTruthy();
    expect(screen.getByText(/No live master audio/)).toBeTruthy();
    // Nothing was recorded and nothing was exported.
    expect(desktop.recording.save).not.toHaveBeenCalled();
  });

  it('records the master mix and exports the take through the save path', async () => {
    const view = render(<App />);
    const user = userEvent.setup();
    await openSessionFromPicker(user);
    // Playback is running: the master tap exists for the take. The state
    // lives in the hook, so the app must re-render to see it.
    repl.state = { started: true, error: undefined };
    view.rerender(<App />);
    await user.click(screen.getByRole('button', { name: 'Start recording' }));

    await user.click(screen.getByRole('button', { name: 'Stop recording' }));

    await waitFor(() => expect(desktop.recording.save).toHaveBeenCalledTimes(1));
    const [data, suggested] = vi.mocked(desktop.recording.save).mock.calls[0]!;
    expect(new TextDecoder().decode(data)).toBe('take');
    expect(suggested).toMatch(/^strudel-we begin-.*\.webm$/);
    // A clean take leaves no failure behind on the error surface.
    expect(screen.queryByText(/Recording failed/)).toBeNull();
  });
});
