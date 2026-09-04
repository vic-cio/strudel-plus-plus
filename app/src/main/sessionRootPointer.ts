import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { SessionRootStatus } from '../shared/ipc';

export type SessionRootSetting = {
  load(): Promise<SessionRootStatus>;
  save(path: string): Promise<void>;
};

const POINTER_FILE = '.strudel-sessions-root';

function errorCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e ? (e as { code?: string }).code : undefined;
}

export function createSessionRootSetting(configDir: string): SessionRootSetting {
  const pointerPath = join(configDir, POINTER_FILE);

  return {
    async load(): Promise<SessionRootStatus> {
      let trimmed: string;
      try {
        trimmed = (await readFile(pointerPath, 'utf8')).replace(/\r?\n$/, '');
      } catch (e: unknown) {
        // No pointer yet is the fresh-install state, not a failure to report.
        if (errorCode(e) === 'ENOENT') return { state: 'unconfigured' };
        const code = errorCode(e);
        return {
          state: 'invalid',
          path: pointerPath,
          error: code ? `Cannot read pointer (${code})` : 'Pointer unreadable',
        };
      }
      if (trimmed === '') return { state: 'unconfigured' };
      const path = resolve(trimmed);
      try {
        const info = await stat(path);
        if (!info.isDirectory()) return { state: 'invalid', path, error: 'Configured root is not a directory' };
        return { state: 'ok', path };
      } catch (e: unknown) {
        const code = errorCode(e);
        return { state: 'invalid', path, error: code ? `Root unavailable (${code})` : 'Root unavailable' };
      }
    },
    async save(path: string): Promise<void> {
      const resolved = resolve(path);
      const info = await stat(resolved);
      if (!info.isDirectory()) throw new Error('Session root must be a directory');
      await mkdir(configDir, { recursive: true });
      // This is intentionally a pointer-only operation.
      await writeFile(pointerPath, resolved + '\n', 'utf8');
    },
  };
}
