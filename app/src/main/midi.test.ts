import { describe, expect, it } from 'vitest';
import { pickPort } from './midi';

const PORTS = ['IAC Driver Bus 1', 'Launchpad Pro MK3', 'Scarlett 18i8 MIDI'];

describe('pickPort', () => {
  it('matches a port by a fragment of its name', () => {
    expect(pickPort(PORTS, 'Launchpad')).toBe(1);
  });

  it('ignores case, because nobody types a device name exactly', () => {
    expect(pickPort(PORTS, 'launchpad pro')).toBe(1);
  });

  it('defaults to the IAC bus, which is what a DAW listens on', () => {
    expect(pickPort(PORTS, 'IAC')).toBe(0);
  });

  it('takes the first match when a fragment matches several ports', () => {
    expect(pickPort(['MIDI A', 'MIDI B'], 'MIDI')).toBe(0);
  });

  it('falls back to the first port when the request matches nothing', () => {
    // Silence is a worse answer than the wrong port: the pattern is playing and
    // the person can hear which device answered.
    expect(pickPort(PORTS, 'nonexistent')).toBe(0);
  });

  it('reports no port when none exist at all', () => {
    expect(pickPort([], 'IAC')).toBeUndefined();
  });
});
