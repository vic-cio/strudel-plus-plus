import { describe, expect, it } from 'vitest';
import { normalizeBeatName } from './beatName';

describe('normalizeBeatName', () => {
  it('adds the extension when it is missing', () => {
    expect(normalizeBeatName('breakbeat')).toBe('breakbeat.js');
  });

  it('leaves an existing extension alone', () => {
    expect(normalizeBeatName('breakbeat.js')).toBe('breakbeat.js');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeBeatName('  live set  ')).toBe('live set.js');
  });

  it('keeps a folder in the name', () => {
    expect(normalizeBeatName('drums/breakbeat')).toBe('drums/breakbeat.js');
  });

  it('rejects an empty name', () => {
    expect(() => normalizeBeatName('   ')).toThrow(/name/i);
  });

  it('rejects a name that climbs out of the beats folder', () => {
    expect(() => normalizeBeatName('../escaped')).toThrow(/outside/i);
  });

  it('rejects an absolute path', () => {
    expect(() => normalizeBeatName('/tmp/evil')).toThrow(/outside/i);
  });
});
