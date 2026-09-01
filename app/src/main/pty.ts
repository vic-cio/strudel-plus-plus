import { accessSync, constants } from 'node:fs';
import type { IPty } from 'node-pty';
import { spawn } from 'node-pty';
import { findOnPath } from './which';
import { resolveHarness, type HarnessConfig } from '../shared/harness';

export type PtySession = {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
};

export type PtyHandlers = {
  onData(data: string): void;
  onExit(code: number): void;
};

const isExecutable = (candidate: string) => {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export type SpawnPty = typeof spawn;

/**
 * Anything sent to a pty that has exited raises EBADF, and an uncaught throw in
 * the main process puts up a modal that blocks every other IPC call. A pty can
 * also die between a liveness check and the call itself, so the check alone is
 * not enough.
 */
function ignoreDeadPty(action: () => void) {
  try {
    action();
  } catch {
    // The harness is gone. The pane already says so.
  }
}

/**
 * Run one harness at a time in a real pty.
 *
 * A pty rather than a pipe because these are full-screen TUIs. They ask the
 * terminal for its size and draw accordingly, and a pipe has no size to give.
 */
export function createPtyHost(
  shellPath: string,
  spawnPty: SpawnPty = spawn,
  exists: (candidate: string) => boolean = isExecutable,
) {
  let current: IPty | undefined;
  let currentId: string | undefined;

  function forget() {
    current = undefined;
    currentId = undefined;
  }

  function kill() {
    const pty = current;
    forget();
    if (pty) {
      ignoreDeadPty(() => pty.kill());
    }
  }

  return {
    /** Every start is a fresh helper, so replacing one always terminates its pty. */
    start(
      id: string,
      size: { cols: number; rows: number },
      config: HarnessConfig,
      handlers: PtyHandlers,
    ): PtySession | undefined {
      kill();
      const { command, args, cwd } = resolveHarness(id, config);

      // Say so rather than spawning something that will exit 1 in silence.
      if (!findOnPath(command, shellPath, exists)) {
        handlers.onData(
          `\r\n  ${command} is not on PATH.\r\n` +
            `  Looked in: ${shellPath.split(':').filter(Boolean).join('\r\n             ')}\r\n` +
            `  Edit harnesses.json to point at it, or pick another harness.\r\n`,
        );
        handlers.onExit(127);
        return undefined;
      }

      const pty = spawnPty(command, args, {
        name: 'xterm-256color',
        cols: size.cols,
        rows: size.rows,
        cwd,
        env: { ...process.env, PATH: shellPath, TERM: 'xterm-256color' } as Record<string, string>,
      });
      current = pty;
      currentId = id;

      let alive = true;
      pty.onData(handlers.onData);
      pty.onExit(({ exitCode }) => {
        alive = false;
        // A replacement can be spawned before the old pty delivers its exit
        // event. Only the current helper is allowed to change pane state.
        if (current !== pty) {
          return;
        }
        forget();
        handlers.onExit(exitCode);
      });

      const ifAlive = (action: () => void) => {
        if (alive) {
          ignoreDeadPty(action);
        }
      };

      return {
        write: (data) => ifAlive(() => pty.write(data)),
        resize: (cols, rows) => ifAlive(() => pty.resize(cols, rows)),
        kill: () => ifAlive(() => pty.kill()),
      };
    },
    kill,
  };
}
