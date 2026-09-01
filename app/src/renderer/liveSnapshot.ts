import { analysers, getAnalyzerData, getAudioContext } from '@strudel/webaudio';
import { masterAnalyser } from './installTap';
import { summariseBands, summariseLevel, type Bands, type Level } from '../shared/levels';
import { desktop } from './desktop';

/** Written into the beats folder so a harness can read it with no IPC of its own. */
export const SNAPSHOT_FILE = '.strudel-live.json';

export type ChannelReport = Level & Bands;

declare const __BUILD_TIME__: string;

export type LiveSnapshot = {
  /** When this app was built. A snapshot missing fields means an older build. */
  appBuilt: string;
  beat: string | undefined;
  unsavedEdits: boolean;
  playing: boolean;
  cps: number;
  updated: string;
  buffer: string;
  audio: { master?: ChannelReport; channels: Record<string, ChannelReport> };
};

function read(analyser: AnalyserNode): ChannelReport {
  const time = new Float32Array(analyser.fftSize);
  const frequency = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatTimeDomainData(time);
  analyser.getFloatFrequencyData(frequency);
  const round = (value: number) => Math.round(value * 10) / 10;
  const level = summariseLevel(time);
  const bands = summariseBands(frequency, getAudioContext().sampleRate);
  return {
    rms: Math.round(level.rms * 1000) / 1000,
    peak: Math.round(level.peak * 1000) / 1000,
    low: round(bands.low),
    mid: round(bands.mid),
    high: round(bands.high),
  };
}

/**
 * Per-channel meters come from `.analyze("name")` in the pattern, which is the
 * only thing that creates a named analyser. Master is always there.
 */
export function readAudio(): LiveSnapshot['audio'] {
  const channels: Record<string, ChannelReport> = {};
  try {
    for (const [id, analyser] of Object.entries(analysers as Record<string, AnalyserNode>)) {
      if (analyser) {
        // Keep superdough's own buffers filled, since draw shares them.
        getAnalyzerData('time', id);
        channels[id] = read(analyser);
      }
    }
    const bus = masterAnalyser();
    return { ...(bus ? { master: read(bus) } : {}), channels };
  } catch {
    // No audio context yet, or the engine is mid-reset.
    return { channels };
  }
}

export const APP_BUILT = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'unknown';

export function writeSnapshot(snapshot: LiveSnapshot): void {
  void desktop.beats.write(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2)).catch(() => {
    // The snapshot is a convenience. Losing one is not worth surfacing.
  });
}
