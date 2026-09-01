import { join } from 'node:path';

/**
 * Look a command up the way a shell would.
 *
 * Worth doing before spawning, because node-pty reports a missing command as a
 * silent exit 1, identical to a harness that started and immediately crashed.
 */
export function findOnPath(command: string, path: string, exists: (candidate: string) => boolean): string | undefined {
  if (command.includes('/')) {
    return exists(command) ? command : undefined;
  }
  for (const directory of path.split(':')) {
    if (!directory) {
      continue;
    }
    const candidate = join(directory, command);
    if (exists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}
