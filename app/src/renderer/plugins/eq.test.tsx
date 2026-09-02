// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EqSpectrum } from './eq';
import { masterAnalyser } from '../installTap';

vi.mock('../installTap', () => ({ masterAnalyser: vi.fn(() => undefined) }));

const masterAnalyserMock = vi.mocked(masterAnalyser);

/** A requestAnimationFrame loop that only advances when a test pumps it. */
const queued: FrameRequestCallback[] = [];
let nextId = 0;

beforeEach(() => {
  queued.length = 0;
  nextId = 0;
  masterAnalyserMock.mockReset();
  masterAnalyserMock.mockReturnValue(undefined);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      queued.push(callback);
      return ++nextId;
    }),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 480,
    height: 80,
    top: 0,
    left: 0,
    bottom: 80,
    right: 480,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Run every queued frame, then whatever those frames queued. */
function runFrames(count: number): void {
  for (let index = 0; index < count; index += 1) {
    const batch = queued.splice(0);
    for (const callback of batch) {
      callback(performance.now());
    }
  }
}

/** A 2d context that records what the plugin drew. */
function stubContext() {
  const ctx = { fillStyle: '', clearRect: vi.fn(), fillRect: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  return ctx;
}

/** An analyser stand-in with a fixed spectrum. */
function fakeAnalyser(bytes: number[]): AnalyserNode {
  return {
    frequencyBinCount: bytes.length,
    context: { sampleRate: 48000 },
    getByteFrequencyData: (target: Uint8Array) => {
      bytes.forEach((value, index) => {
        target[index] = value;
      });
    },
  } as unknown as AnalyserNode;
}

const baseProps = { state: undefined, onState: vi.fn() };

describe('EqSpectrum', () => {
  it('idles without a loop while audio is stopped', () => {
    // No analyser, no 2d context, no frames: stopped audio must leave the
    // pane idle rather than spinning rAF against silence.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<EqSpectrum {...baseProps} playing={false} />);

    expect(screen.getByText('[ no signal ]')).toBeTruthy();
    runFrames(3);
    expect(queued).toHaveLength(0);
  });

  it('draws bars from the master tap while playing', () => {
    const ctx = stubContext();
    masterAnalyserMock.mockReturnValue(fakeAnalyser([220, 180, 140, 90, 60, 40, 20, 4]));
    render(<EqSpectrum {...baseProps} playing={true} />);

    runFrames(1);
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();
    // The theme colors are the fallbacks here; the last fill is the baseline.
    expect(ctx.fillStyle).toBe('#6b4a33');
    // The loop re-arms itself for the next frame.
    expect(queued).toHaveLength(1);
  });

  it('keeps the pane alive when no analyser exists yet', () => {
    // Before any node has connected to the destination there is no tap; the
    // pane still draws its baseline and keeps its loop instead of crashing.
    const ctx = stubContext();
    render(<EqSpectrum {...baseProps} playing={true} />);

    runFrames(1);
    expect(ctx.fillRect).toHaveBeenCalledTimes(1); // baseline only
    expect(queued).toHaveLength(1);
  });

  it('stops the loop when it unmounts', () => {
    stubContext();
    const { unmount } = render(<EqSpectrum {...baseProps} playing={true} />);

    runFrames(1);
    const lastId = nextId;
    unmount();
    expect(vi.mocked(cancelAnimationFrame)).toHaveBeenCalledWith(lastId);
  });

  it('wakes and idles as playback toggles', () => {
    stubContext();
    const { rerender } = render(<EqSpectrum {...baseProps} playing={false} />);
    runFrames(1);
    expect(queued).toHaveLength(0);

    rerender(<EqSpectrum {...baseProps} playing={true} />);
    runFrames(1);
    expect(queued).toHaveLength(1);

    rerender(<EqSpectrum {...baseProps} playing={false} />);
    runFrames(1);
    expect(vi.mocked(cancelAnimationFrame)).toHaveBeenCalled();
    expect(screen.getByText('[ no signal ]')).toBeTruthy();
  });
});
