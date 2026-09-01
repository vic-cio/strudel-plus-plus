export const BEAT_EXTENSION = '.js';

/**
 * Turn what someone typed into a beat filename.
 *
 * Folders are allowed, because organising beats into `drums/` and `live/` is
 * the obvious thing to want. Anything that climbs out of the beats folder is
 * not: the store rejects those too, but a name is worth checking where it is
 * typed, so the message can say so before anything touches the disk.
 */
export function normalizeBeatName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('A beat needs a name.');
  }
  if (trimmed.startsWith('/') || trimmed.split('/').includes('..')) {
    throw new Error('That name points outside the beats folder.');
  }
  return trimmed.endsWith(BEAT_EXTENSION) ? trimmed : `${trimmed}${BEAT_EXTENSION}`;
}
