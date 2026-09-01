import { describe, expect, it } from 'vitest';
import { summariseBands, summariseLevel } from './levels';

const SAMPLE_RATE = 48000;

/** A frequency-domain frame in dBFS, one bin per entry. */
function spectrum(fill: (hz: number) => number, bins = 512) {
  const binHz = SAMPLE_RATE / 2 / bins;
  return Float32Array.from({ length: bins }, (_, i) => fill((i + 0.5) * binHz));
}

describe('summariseLevel', () => {
  it('reports silence as zero', () => {
    expect(summariseLevel(new Float32Array(128))).toEqual({ rms: 0, peak: 0 });
  });

  it('measures the peak of a time-domain frame', () => {
    expect(summariseLevel(Float32Array.from([0, 0.5, -0.8, 0.2])).peak).toBeCloseTo(0.8, 5);
  });

  it('measures RMS, not average', () => {
    // Full-scale square wave: every sample is 1 away from zero.
    expect(summariseLevel(Float32Array.from([1, -1, 1, -1])).rms).toBeCloseTo(1, 5);
  });

  it('reads a half-scale square wave as half', () => {
    expect(summariseLevel(Float32Array.from([0.5, -0.5, 0.5, -0.5])).rms).toBeCloseTo(0.5, 5);
  });
});

describe('summariseBands', () => {
  it('puts energy in the low band when the signal is low', () => {
    const bands = summariseBands(
      spectrum((hz) => (hz < 200 ? -10 : -100)),
      SAMPLE_RATE,
    );
    expect(bands.low).toBeGreaterThan(bands.mid);
    expect(bands.low).toBeGreaterThan(bands.high);
  });

  it('puts energy in the high band when the signal is high', () => {
    const bands = summariseBands(
      spectrum((hz) => (hz > 6000 ? -10 : -100)),
      SAMPLE_RATE,
    );
    expect(bands.high).toBeGreaterThan(bands.low);
    expect(bands.high).toBeGreaterThan(bands.mid);
  });

  it('puts energy in the mid band for a vocal-range signal', () => {
    const bands = summariseBands(
      spectrum((hz) => (hz > 500 && hz < 2000 ? -10 : -100)),
      SAMPLE_RATE,
    );
    expect(bands.mid).toBeGreaterThan(bands.low);
    expect(bands.mid).toBeGreaterThan(bands.high);
  });

  it('reports every band near silence for a silent frame', () => {
    const bands = summariseBands(
      spectrum(() => -140),
      SAMPLE_RATE,
    );
    for (const value of Object.values(bands)) {
      expect(value).toBeLessThan(-90);
    }
  });

  it('reports in dB, so a loud frame stays negative but close to zero', () => {
    const bands = summariseBands(
      spectrum(() => -3),
      SAMPLE_RATE,
    );
    expect(bands.low).toBeLessThanOrEqual(0);
    expect(bands.low).toBeGreaterThan(-10);
  });
});
