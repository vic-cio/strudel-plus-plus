import { describe, expect, it } from 'vitest';
import { createBundledLibrary } from './bundledLibrary';
import { DEFAULT_SESSION_BEATS, DEFAULT_SESSION_NAME } from './defaultSession';

describe('bundled library', () => {
  it('lists every bundled beat under the bundled session name', async () => {
    const entries = await createBundledLibrary().list();
    expect(entries.map((entry) => entry.name).sort()).toEqual(Object.keys(DEFAULT_SESSION_BEATS).sort());
    expect(entries.every((entry) => entry.session === DEFAULT_SESSION_NAME)).toBe(true);
  });

  it('reads back the exact bundled content for every listed beat', async () => {
    const library = createBundledLibrary();
    for (const entry of await library.list()) {
      await expect(library.read(entry.name)).resolves.toBe(DEFAULT_SESSION_BEATS[entry.name]);
    }
  });

  it('rejects unknown content', async () => {
    await expect(createBundledLibrary().read('missing.js')).rejects.toThrow(/not found/i);
  });
});
