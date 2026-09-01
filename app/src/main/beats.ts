import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { BEAT_EXTENSION } from '../shared/beatName';
import type { BeatSummary } from '../shared/beatSorting';

export type BeatStore = {
  list(): Promise<string[]>;
  listInfo(): Promise<BeatSummary[]>;
  read(name: string): Promise<string>;
  write(name: string, content: string): Promise<void>;
  create(name: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(name: string): Promise<void>;
};

export { BEAT_EXTENSION };

/**
 * File access for the beats folder.
 *
 * Every path comes from the renderer or from a harness, so none of them are
 * trusted. `locate` is the only way to turn a name into a real path.
 */
export function createBeatStore(root: string): BeatStore {
  const base = resolve(root);

  function locate(name: string): string {
    const full = resolve(base, name);
    if (full !== base && !full.startsWith(base + sep)) {
      throw new Error(`Path is outside the beats folder: ${name}`);
    }
    return full;
  }

  async function taken(full: string): Promise<boolean> {
    try {
      await access(full);
      return true;
    } catch {
      return false;
    }
  }

  async function walk(dir: string, found: BeatSummary[]): Promise<BeatSummary[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, found);
      } else if (entry.name.endsWith(BEAT_EXTENSION)) {
        const details = await stat(full);
        found.push({
          name: relative(base, full).split(sep).join('/'),
          modifiedAt: details.mtimeMs,
        });
      }
    }
    return found;
  }

  return {
    async list() {
      const found = await this.listInfo();
      return found.map((beat) => beat.name).sort();
    },

    async listInfo() {
      const found = await walk(base, []);
      return found.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    },

    async read(name) {
      return readFile(locate(name), 'utf8');
    },

    async create(name, content) {
      const full = locate(name);
      if (await taken(full)) {
        throw new Error(`${name} already exists.`);
      }
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, content, 'utf8');
    },

    async write(name, content) {
      const full = locate(name);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, content, 'utf8');
    },

    async rename(from, to) {
      const target = locate(to);
      const source = locate(from);
      // There is no undo, so a typo must not be able to replace another beat.
      if (target !== source && (await taken(target))) {
        throw new Error(`${to} already exists.`);
      }
      await mkdir(dirname(target), { recursive: true });
      await rename(source, target);
    },

    async remove(name) {
      await rm(locate(name), { force: true });
    },
  };
}
