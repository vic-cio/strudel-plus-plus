export type Level = { rms: number; peak: number };
export type Bands = { low: number; mid: number; high: number };

/** Crossovers in Hz. Roughly kick, body, and air. */
const LOW_TOP = 250;
const MID_TOP = 4000;

const SILENCE_DB = -140;

/** Overall loudness of a time-domain frame, in the same 0..1 scale as gain. */
export function summariseLevel(timeDomain: Float32Array): Level {
  let sumOfSquares = 0;
  let peak = 0;
  for (const sample of timeDomain) {
    sumOfSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const rms = timeDomain.length ? Math.sqrt(sumOfSquares / timeDomain.length) : 0;
  return { rms, peak };
}

/**
 * Where the energy sits, in dB per band.
 *
 * The analyser hands back dB per bin, so the bins are converted to power,
 * averaged within a band, and converted back. Averaging the dB values directly
 * would let one quiet bin drag a loud band down.
 */
export function summariseBands(spectrumDb: Float32Array, sampleRate: number): Bands {
  const binHz = sampleRate / 2 / spectrumDb.length;
  const power = { low: 0, mid: 0, high: 0 };
  const counts = { low: 0, mid: 0, high: 0 };

  spectrumDb.forEach((db, index) => {
    const hz = (index + 0.5) * binHz;
    const band = hz < LOW_TOP ? 'low' : hz < MID_TOP ? 'mid' : 'high';
    power[band] += 10 ** (db / 10);
    counts[band] += 1;
  });

  const toDb = (band: keyof Bands) => {
    if (!counts[band]) {
      return SILENCE_DB;
    }
    const mean = power[band] / counts[band];
    return mean > 0 ? Math.max(SILENCE_DB, 10 * Math.log10(mean)) : SILENCE_DB;
  };

  return { low: toDb('low'), mid: toDb('mid'), high: toDb('high') };
}
