import { useEffect, useRef } from 'react';
import { masterAnalyser } from '../installTap';
import { registerPlugin } from './registry';
import type { PluginProps } from './registry';

const BAR_COUNT = 48;
const MIN_HZ = 40;
const MAX_HZ = 16000;
/** Peak caps fall this fraction of the pane height per frame. */
const PEAK_FALL = 0.012;
/** Bytes below this read as silence; the analyser's floor is far below audible. */
const SILENT_BYTE = 2;

type Color = { olive: string; gold: string; line: string };

/** Theme colors, read once per loop. A missing custom property falls back to
 * the same values theme.css defines, so the bars never draw in default black. */
function readColors(): Color {
  const css = getComputedStyle(document.body);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    olive: read('--olive', '#adb56d'),
    gold: read('--gold', '#e0a83c'),
    line: read('--line', '#6b4a33'),
  };
}

/** CSS-pixel size applied to the backing store at device resolution. */
function syncBackingStore(canvas: HTMLCanvasElement): { width: number; height: number } | undefined {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height };
}

/**
 * Which analyser bins each bar covers, on a log frequency axis — a spectrum on
 * a linear axis spends most of its width on the hiss and squeezes every kick
 * into the first few pixels.
 */
function barRanges(binCount: number, sampleRate: number): { lo: number; hi: number }[] {
  const binHz = sampleRate / 2 / binCount;
  const ranges: { lo: number; hi: number }[] = [];
  for (let index = 0; index < BAR_COUNT; index += 1) {
    const low = MIN_HZ * (MAX_HZ / MIN_HZ) ** (index / BAR_COUNT);
    const high = MIN_HZ * (MAX_HZ / MIN_HZ) ** ((index + 1) / BAR_COUNT);
    const lo = Math.max(0, Math.floor(low / binHz));
    const hi = Math.min(binCount, Math.max(lo + 1, Math.ceil(high / binHz)));
    ranges.push({ lo, hi });
  }
  return ranges;
}

function drawFrame(canvas: HTMLCanvasElement, peaks: Float32Array): void {
  const ctx = canvas.getContext('2d');
  // jsdom and privacy-hardened contexts hand back null; an idle frame is
  // better than a crash either way.
  if (!ctx) {
    return;
  }
  const size = syncBackingStore(canvas);
  if (!size) {
    return;
  }
  const colors = readColors();
  ctx.clearRect(0, 0, size.width, size.height);

  const analyser = masterAnalyser();
  if (analyser) {
    const bins = analyser.frequencyBinCount;
    const bytes = new Uint8Array(bins);
    analyser.getByteFrequencyData(bytes);
    const ranges = barRanges(bins, analyser.context.sampleRate);
    const step = size.width / BAR_COUNT;
    const barWidth = Math.max(1, step - 2);
    for (let index = 0; index < BAR_COUNT; index += 1) {
      const range = ranges[index];
      if (!range) {
        continue;
      }
      let value = 0;
      for (let bin = range.lo; bin < range.hi; bin += 1) {
        value = Math.max(value, bytes[bin] ?? 0);
      }
      const level = value <= SILENT_BYTE ? 0 : (value / 255) ** 1.25;
      const height = level * (size.height - 2);
      const x = index * step + 1;
      ctx.fillStyle = colors.olive;
      if (height > 0) {
        ctx.fillRect(x, size.height - height, barWidth, height);
      }
      // A slow-falling gold cap marks where the band just was, so a hi-hat
      // reads as an event rather than a flicker.
      peaks[index] = Math.max(level, (peaks[index] ?? 0) - PEAK_FALL);
      const capHeight = (peaks[index] ?? 0) * (size.height - 2);
      if (capHeight > 0) {
        ctx.fillStyle = colors.gold;
        ctx.fillRect(x, size.height - capHeight - 2, barWidth, 2);
      }
    }
  }

  ctx.fillStyle = colors.line;
  ctx.fillRect(0, size.height - 1, size.width, 1);
}

/**
 * The live spectrum.
 *
 * One requestAnimationFrame loop while audio runs, fed by the master tap's
 * analyser — the same tap the snapshot meters read, so the bars agree with
 * what reaches the speakers. Stopped audio stops the loop; the pane falls
 * back to an idle mark instead of freezing the last bars mid-air.
 */
export function EqSpectrum({ playing }: PluginProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    if (!playing) {
      drawFrame(canvas, new Float32Array(BAR_COUNT));
      return;
    }
    const peaks = new Float32Array(BAR_COUNT);
    let raf = requestAnimationFrame(function frame() {
      drawFrame(canvas, peaks);
      raf = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <div className="eq">
      <canvas className="eq-canvas" ref={canvasRef} />
      {!playing && <span className="eq-idle">[ no signal ]</span>}
    </div>
  );
}

registerPlugin({ id: 'eq', label: 'EQ', kind: 'visual', mount: EqSpectrum });
