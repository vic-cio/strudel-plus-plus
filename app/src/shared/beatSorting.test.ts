import { describe, expect, it } from 'vitest';
import { DEFAULT_BEAT_SORT, moveBeat, sortBeats, type BeatSummary } from './beatSorting';

const beats: BeatSummary[] = [
  { name: 'going crazy.js', modifiedAt: 100 },
  { name: 'advanced.js', modifiedAt: 300 },
  { name: 'intro.js', modifiedAt: 200 },
];

describe('sortBeats', () => {
  it('defaults to chronological order, newest first', () => {
    expect(DEFAULT_BEAT_SORT).toBe('chronological');
    expect(sortBeats(beats).map((beat) => beat.name)).toEqual(['advanced.js', 'intro.js', 'going crazy.js']);
  });

  it('sorts alphabetically by beat name', () => {
    expect(sortBeats(beats, 'alphabetical').map((beat) => beat.name)).toEqual([
      'advanced.js',
      'going crazy.js',
      'intro.js',
    ]);
  });

  it('keeps the saved manual order and appends new beats', () => {
    expect(sortBeats(beats, 'manual', ['intro.js', 'advanced.js']).map((beat) => beat.name)).toEqual([
      'intro.js',
      'advanced.js',
      'going crazy.js',
    ]);
  });
});

describe('moveBeat', () => {
  it('moves a beat before the drop target', () => {
    expect(
      moveBeat({ order: ['advanced.js', 'intro.js', 'going crazy.js'], from: 'going crazy.js', to: 'advanced.js' }),
    ).toEqual(['going crazy.js', 'advanced.js', 'intro.js']);
  });
});
