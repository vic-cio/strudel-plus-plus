import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { SessionRootStatus } from '../shared/ipc';

export type SessionRootPointer = SessionRootStatus;

export type SessionRootSetting = {
  load(): Promise<SessionRootPointer>;
  save(path: string | null): Promise<void>;
};

const POINTER_FILE = '.strudel-sessions-root';

export async function createSessionRootSetting(configDir: string): Promise<SessionRootSetting> {
  const pointerPath = join(configDir, POINTER_FILE);

  return {
    async load(): Promise<SessionRootPointer> {
      try {
        const raw = await readFile(pointerPath, 'utf8');
        const trimmed = raw.trim();
        if (!trimmed) {
          return { path: null, valid: false, readable: false, isDirectory: false, error: 'Pointer file is empty' };
        }
        const resolved = resolve(trimmed);
        try {
          const info = await stat(resolved);
          if (!info.isDirectory()) {
            return {
              path: resolved,
              valid: true,
              readable: true,
              isDirectory: false,
              error: 'Configured root is not a directory',
            };
          }
          return { path: resolved, valid: true, readable: true, isDirectory: true };
        } catch (e: unknown) {
          const code = typeof e === 'object' && e !== null && 'code' in e ? (e as { code?: string }).code : undefined;
          return {
            path: resolved,
            valid: true,
            readable: false,
            isDirectory: false,
            error: code ? `Root unavailable (${code})` : 'Root unavailable',
          };
        }
      } catch (e: unknown) {
        const code = typeof e === 'object' && e !== null && 'code' in e ? (e as { code?: string }).code : undefined;
        return {
          path: null,
          valid: false,
          readable: false,
          isDirectory: false,
          error: code ? `Cannot read pointer (${code})` : 'Pointer missing or unreadable',
        };
      }
    },
    async save(path: string | null): Promise<void> {
      await mkdir(configDir, { recursive: true });
      if (path === null) {
        await writeFile(pointerPath, '\n', 'utf8');
        return;
      }
      const resolved = resolve(path);
      const info = await stat(resolved);
      if (!info.isDirectory()) throw new Error('Session root must be a directory');
      // This is intentionally a pointer-only operation.
      await writeFile(pointerPath, resolved + '\n', 'utf8');
    },
  };
}
