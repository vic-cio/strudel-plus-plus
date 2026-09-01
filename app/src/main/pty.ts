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

      // Say so rather than spawning something that will fail or exit in
      // silence. The resolved absolute path is also what gets spawned, so the
      // start does not depend on how node-pty's helper resolves a bare name
      // or on whatever PATH this process happened to inherit.
      const resolved = findOnPath(command, shellPath, exists);
      if (!resolved) {
        throw new Error(
          `Harness "${id}" could not start: command "${command}" is not on PATH ` +
            `(searched: ${shellPath.split(':').filter(Boolean).join(' ')}). ` +
            `Install "${command}", or edit harnesses.json to give an absolute path.`,
        );
      }

      let pty: IPty;
      try {
        pty = spawnPty(resolved, args, {
          name: 'xterm-256color',
          cols: size.cols,
          rows: size.rows,
          cwd,
          env: { ...process.env, PATH: shellPath, TERM: 'xterm-256color' } as Record<string, string>,
        });
      } catch (error) {
        // A raw spawn error (for instance node-pty's "posix_spawnp failed.")
        // says nothing about which harness died or what to do about it.
        const cause = error instanceof Error ? error.message : String(error);
        throw new Error(`Harness "${id}" failed to start (command "${command}"): ${cause}`);
      }
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
