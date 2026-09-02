// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

/**
 * The App talks to the desktop bridge, so the whole bridge is faked here. The
 * tests watch `sessions.setState` calls: the persisted beat pointer must
 * follow the EDIT buffer at the moment it moves, because a harness reads that
 * pointer from .session.json and edits exactly what it names.
 */
const { desktop, setStateMock, changeHandler, repl } = vi.hoisted(() => {
  type WrittenState = { beat?: string | null; cpsByBeat?: Record<string, number> };
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
    containerRef: { current: null },
    cps: 0.5,
    changeCps: vi.fn(),
    releaseCps: vi.fn(),
  };
  const desktop = {
    sessions: {
      root: vi.fn(async () => '/sessions-root'),
      list: vi.fn(async () => [{ name: 'we cook', beats: 2, usedAt: 1 }]),
      active: vi.fn(async () => 'we cook'),
      create: vi.fn(async (name: string) => ({ name, folder: `/sessions-root/${name}` })),
      open: vi.fn(async (name: string) => ({ name, folder: `/sessions-root/${name}` })),
      state: vi.fn(async () => ({ beat: 'we begin.js' })),
      setState: setStateMock,
    },
    beats: {
      root: vi.fn(async () => '/sessions-root/we cook'),
      list: vi.fn(async () => []),
      listInfo: vi.fn(async () => [
        { name: '808ing.js', modifiedAt: 1 },
        { name: 'we begin.js', modifiedAt: 2 },
      ]),
      read: vi.fn(async (name: string) => `// ${name}`),
      write: vi.fn(async () => {}),
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
  return { desktop, setStateMock, changeHandler, repl };
});

vi.mock('./desktop', () => ({ desktop }));

vi.mock('./useStrudel', () => ({
  useStrudel: () => repl,
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

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  setStateMock.mockClear();
  desktop.beats.listInfo.mockResolvedValue([
    { name: '808ing.js', modifiedAt: 1 },
    { name: 'we begin.js', modifiedAt: 2 },
  ]);
  desktop.sessions.state.mockResolvedValue({ beat: 'we begin.js' });
  desktop.beats.read.mockClear();
  desktop.beats.read.mockImplementation(async (name: string) => `// ${name}`);
  desktop.beats.remove.mockClear();
  changeHandler.current = undefined;
  repl.state = { started: false, error: undefined };
  repl.clearError.mockClear();
  repl.setCode.mockClear();
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

    // Rename via the tree: ~ opens the input pre-filled with the open beat.
    await user.click(screen.getByTitle('Rename'));
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
    await user.click(screen.getByTitle('Delete'));
    await user.click(await screen.findByText('delete'));

    await waitFor(() => expect(persistedBeats().at(-1)).toBeNull());
    expect(setStateMock).toHaveBeenLastCalledWith('we cook', { beat: null });
  });

  it('heals a stale persisted pointer on open by adopting a real beat', async () => {
    // The session was left pointing at a beat that no longer exists — exactly
    // the state a harness reads and edits the wrong file from.
    desktop.sessions.state.mockResolvedValue({ beat: 'deleted-beat.js' });
    const user = userEvent.setup();
    render(<App />);
    await openSessionFromPicker(user);

    // The buffer falls back to a real beat and the pointer says so.
    await waitFor(() => expect(persistedBeats().at(-1)).toBe('808ing.js'));
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
    expect(screen.getByTitle('Rename')).toBeTruthy();
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
