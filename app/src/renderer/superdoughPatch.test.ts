import { beforeEach, describe, expect, it } from 'vitest';
import { getAudioContext, setAudioContext, waveformN } from 'superdough';

/**
 * Pins the `patches/superdough@1.3.0.patch` fix. `getOscillator` in superdough
 * builds a custom waveform whenever a pattern sets `n`/`partials` to anything
 * truthy, including a fraction between 0 and 1 (e.g. a continuous pattern
 * landing on 0.5): `new Float32Array(0.5)` truncates to length 0, which
 * `waveformN` used to hand `createPeriodicWave` as a 1-length real/imag pair —
 * the browser rejects anything under 2, throwing mid-note and (until the EQ
 * loop's own fix) freezing the spectrum along with it. If this ever starts
 * failing, `pnpm patch superdough@1.3.0` was dropped or superdough shipped its
 * own fix and the patch (and this test) can go.
 */
class FakeOscillator {
  type: string | undefined;
  wave: unknown;
  setPeriodicWave(wave: unknown) {
    this.wave = wave;
  }
}

class FakeAudioContext {
  createOscillator() {
    return new FakeOscillator();
  }
  createPeriodicWave(real: Float32Array, imag: Float32Array) {
    if (real.length < 2 || imag.length < 2) {
      throw new DOMException(
        `Failed to execute 'createPeriodicWave' on 'BaseAudioContext': The length of the real array provided (${real.length}) is less than 2.`,
      );
    }
    return { real, imag };
  }
}

describe('superdough waveformN (patched)', () => {
  beforeEach(() => {
    setAudioContext(new FakeAudioContext() as unknown as AudioContext);
  });

  it('falls back to a plain oscillator instead of throwing when partials truncate to zero', () => {
    // A fractional n/partials between 0 and 1 is the failure case: truthy, so
    // the caller's `!partials` guard lets it through, but Float32Array(0.5)
    // has length 0.
    const osc = waveformN(0.5, undefined, 'sawtooth') as unknown as FakeOscillator;
    expect(osc.type).toBe('sawtooth');
    expect(osc.wave).toBeUndefined();
  });

  it('maps a zero-partial "user" wave to triangle rather than an invalid oscillator type', () => {
    const osc = waveformN(0.9, undefined, 'user') as unknown as FakeOscillator;
    expect(osc.type).toBe('triangle');
  });

  it('still builds a real periodic wave for a normal partial count', () => {
    const osc = waveformN(3, undefined, 'sawtooth') as unknown as FakeOscillator;
    expect(osc.type).toBeUndefined();
    expect(osc.wave).toBeDefined();
  });

  it('keeps the audio context reachable afterwards', () => {
    expect(getAudioContext()).toBeInstanceOf(FakeAudioContext);
  });
});
