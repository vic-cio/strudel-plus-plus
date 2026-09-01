import { describe, expect, it, vi } from 'vitest';
import { createPtyHost } from './pty';
import type { HarnessConfig } from '../shared/harness';

const config: HarnessConfig = {
  beatsRoot: '/beats',
  harnesses: [{ id: 'claude', label: 'claude', command: 'claude' }],
};

const handlers = { onData: () => {}, onExit: () => {} };

/** These tests spawn a fake, so the command never has to exist on disk. */
const onPath = () => true;
const size = { cols: 80, rows: 24 };

/** A pty that records calls and can be made to die the way a real one does. */
function fakePty() {
  let exit: ((event: { exitCode: number }) => void) | undefined;
  let dead = false;
  const pty = {
    write: vi.fn(() => {
      if (dead) throw new Error('ioctl(2) failed, EBADF');
    }),
    resize: vi.fn(() => {
      if (dead) throw new Error('ioctl(2) failed, EBADF');
    }),
    kill: vi.fn(() => {
      dead = true;
      exit?.({ exitCode: 1 });
    }),
    onData: vi.fn(),
    onExit: vi.fn((handler: (event: { exitCode: number }) => void) => {
      exit = handler;
    }),
  };
  return {
    pty,
    /** The harness quits on its own, as claude does when it fails to start. */
    die() {
      dead = true;
      exit?.({ exitCode: 1 });
    },
  };
}

describe('createPtyHost', () => {
  it('forwards a resize to a live pty', () => {
    const { pty } = fakePty();
    const host = createPtyHost('/usr/bin', () => pty as never, onPath);
    const session = host.start('claude', size, config, handlers);
    session?.resize(100, 40);
    expect(pty.resize).toHaveBeenCalledWith(100, 40);
  });

  it('does not throw when the harness has already exited', () => {
    // The pane's ResizeObserver fires on any layout change, including the one
    // caused by writing "[exited 1]" into the terminal. Resizing a closed pty
    // raises EBADF, and an uncaught throw here takes down the whole main
    // process behind a modal that blocks every other IPC call.
    const { pty, die } = fakePty();
    const host = createPtyHost('/usr/bin', () => pty as never, onPath);
    const session = host.start('claude', size, config, handlers);
    die();
    expect(() => session?.resize(100, 40)).not.toThrow();
    expect(pty.resize).not.toHaveBeenCalled();
  });

  it('does not throw when writing to a harness that has exited', () => {
    const { pty, die } = fakePty();
    const host = createPtyHost('/usr/bin', () => pty as never, onPath);
    const session = host.start('claude', size, config, handlers);
    die();
    expect(() => session?.write('hello')).not.toThrow();
  });

  it('does not throw when killing a harness that has already exited', () => {
    const { pty, die } = fakePty();
    const host = createPtyHost('/usr/bin', () => pty as never, onPath);
    host.start('claude', size, config, handlers);
    die();
    expect(() => host.kill()).not.toThrow();
  });

  it('survives a pty that throws even though it looks alive', () => {
    // A pty can die between the liveness check and the call, so the guard
    // cannot be a check alone.
    const pty = {
      write: vi.fn(),
      resize: vi.fn(() => {
        throw new Error('ioctl(2) failed, EBADF');
      }),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
    };
    const host = createPtyHost('/usr/bin', () => pty as never, onPath);
    const session = host.start('claude', size, config, handlers);
    expect(() => session?.resize(100, 40)).not.toThrow();
  });

  it('starts a fresh pty after the previous one exited, even for the same id', () => {
    // The no-op guard is for a harness that is still running. Once it has
    // exited, picking it again has to actually restart it.
    const first = fakePty();
    const second = fakePty();
    const ptys = [first.pty, second.pty];
    const host = createPtyHost('/usr/bin', () => ptys.shift() as never, onPath);
    host.start('claude', size, config, handlers);
    first.die();
    host.start('claude', size, config, handlers);
    expect(ptys).toHaveLength(0);
  });

  it('always replaces a live pty when a harness starts', () => {
    const first = fakePty();
    const second = fakePty();
    const ptys = [first.pty, second.pty];
    const host = createPtyHost('/usr/bin', () => ptys.shift() as never, onPath);

    host.start('claude', size, config, handlers);
    host.start('claude', size, config, handlers);

    expect(first.pty.kill).toHaveBeenCalledOnce();
    expect(ptys).toHaveLength(0);
  });

  it('does not report the exit of a replaced pty', () => {
    const first = fakePty();
    const second = fakePty();
    const ptys = [first.pty, second.pty];
    const exits: number[] = [];
    const host = createPtyHost('/usr/bin', () => ptys.shift() as never, onPath);

    host.start('claude', size, config, { onData: () => {}, onExit: (code) => exits.push(code) });
    host.start('claude', size, config, { onData: () => {}, onExit: (code) => exits.push(code) });

    expect(exits).toEqual([]);
    second.die();
    expect(exits).toEqual([1]);
  });
});
