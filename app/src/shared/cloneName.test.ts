import { describe, expect, it } from 'vitest';
import { nextCloneName } from './cloneName';

describe('nextCloneName', () => {
  it('adds a number to the first clone', () => {
    expect(nextCloneName('breakbeat.js', ['breakbeat.js'])).toBe('breakbeat-2.js');
  });

  it('skips numbers already taken', () => {
    expect(nextCloneName('breakbeat.js', ['breakbeat.js', 'breakbeat-2.js'])).toBe('breakbeat-3.js');
  });

  it('counts up from an already numbered beat rather than nesting', () => {
    // Cloning breakbeat-2 gives breakbeat-3, not breakbeat-2-2.
    expect(nextCloneName('breakbeat-2.js', ['breakbeat-2.js'])).toBe('breakbeat-3.js');
  });

  it('fills a gap left by a deleted clone', () => {
    expect(nextCloneName('take.js', ['take.js', 'take-3.js'])).toBe('take-2.js');
  });

  it('keeps the clone in the same folder', () => {
    expect(nextCloneName('live/set.js', ['live/set.js'])).toBe('live/set-2.js');
  });

  it('does not treat a hyphenated word as a number', () => {
    expect(nextCloneName('drum-loop.js', ['drum-loop.js'])).toBe('drum-loop-2.js');
  });
});
