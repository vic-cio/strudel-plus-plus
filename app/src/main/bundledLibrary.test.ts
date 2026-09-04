import { describe, expect, it } from 'vitest';
import { createBundledLibrary } from './bundledLibrary';

describe('bundled library', () => {
  it('lists and reads bundled examples without exposing a write operation', async () => {
    const library = createBundledLibrary();
    const entries = await library.list();
    expect(entries.length).toBeGreaterThan(0);
    expect(await library.read(entries[0]!.name)).toContain('');
    expect(library).not.toHaveProperty('write');
  });

  it('rejects unknown content', async () => {
    await expect(createBundledLibrary().read('missing.js')).rejects.toThrow(/not found/i);
  });
});
