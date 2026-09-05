import { DEFAULT_SESSION_BEATS, DEFAULT_SESSION_NAME } from './defaultSession';

export type LibraryBeat = { name: string; session: string };

/** Build-time examples are a read-only library, separate from user sessions. */
const BUNDLED_SESSION_NAME = 'bundled library';

export function createBundledLibrary() {
  const beats = Object.entries(DEFAULT_SESSION_BEATS);
  return {
    list: async (): Promise<LibraryBeat[]> => beats.map(([name]) => ({ name, session: BUNDLED_SESSION_NAME })),
    read: async (name: string): Promise<string> => {
      const beat = beats.find(([candidate]) => candidate === name);
      if (!beat) throw new Error(`Bundled library beat not found: ${name}`);
      return beat[1];
    },
  };
}
