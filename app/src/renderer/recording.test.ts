/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';

/**
 * The take's stop is shared: the record control awaits it for its own state
 * and the app-side export awaits the same take to hand the blob to the main
 * process. Both waiters must observe ONE recorder stop — a second
 * MediaRecorder.stop() on an inactive recorder throws, which used to surface
 * as a spurious "recording failed" the moment the export listened too.
 */

const stops = { count: 0 };

class FakeMediaRecorder {
  static isTypeSupported(): boolean {
    return true;
  }
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  started = false;
  constructor(_stream: unknown, _options: { mimeType: string }) {}
  start(): void {
    this.started = true;
  }
  stop(): void {
    stops.count += 1;
    if (stops.count > 1) {
      // The real recorder throws InvalidStateError on the second stop.
      throw new Error('InvalidStateError: recorder already stopped');
    }
    queueMicrotask(() => this.onstop?.());
  }
}

vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
vi.mock('./installTap', () => ({
  masterMediaStream: () => ({ getAudioTracks: () => [] }) as unknown as MediaStream,
}));

const { startRecording } = await import('./recording');

describe('startRecording', () => {
  it('serves every stop waiter from one recorder stop', async () => {
    stops.count = 0;
    const capture = startRecording('audio', 'we begin.js');
    expect(capture.extension).toBe('webm');

    // Two waiters arrive for the same take — the control and the export.
    const [fromControl, fromExport] = await Promise.all([capture.stop(), capture.stop()]);

    expect(stops.count).toBe(1);
    // Not just equal content: the identical blob, from the identical stop.
    expect(fromExport).toBe(fromControl);
  });
});
