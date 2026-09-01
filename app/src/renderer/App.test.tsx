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
const { desktop, setStateMock } = vi.hoisted(() => {
  type WrittenState = { beat?: string | null; cpsByBeat?: Record<string, number> };
  const setStateMock = vi.fn(async (_session: string, _state: WrittenState) => {});
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
      onChange: vi.fn(() => () => {}),
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
  return { desktop, setStateMock };
});

vi.mock('./desktop', () => ({ desktop }));

vi.mock('./useStrudel', () => ({
  useStrudel: () => ({
    containerRef: { current: null },
    state: { started: false, error: undefined },
    setCode: vi.fn(),
    toggle: vi.fn(),
    cps: 0.5,
    changeCps: vi.fn(),
    releaseCps: vi.fn(),
    reevaluate: vi.fn(),
  }),
}));

vi.mock('./liveSnapshot', () => ({
  APP_BUILT: 'test',
  readAudio: vi.fn(() => ({ channels: {} })),
  writeSnapshot: vi.fn(),
}));

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
  desktop.beats.remove.mockClear();
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
