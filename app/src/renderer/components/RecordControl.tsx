import { useState, useCallback, useRef } from 'react';
import { startRecording, type RecordingCapture } from '../recording';
import { recordingIntent, type RecordingMode, recordingFailureMessage } from '../../shared/recording';

export type RecordEvent =
  | {
      kind: 'start';
      mode: RecordingMode;
      source: string;
    }
  | {
      kind: 'stop';
      capture: RecordingCapture;
    }
  | {
      kind: 'complete';
      filePath: string | undefined;
    }
  | {
      kind: 'fail';
      message: string;
    };

export type RecordProps = {
  mode: RecordingMode;
  source: string;
  masterAvailable: boolean;
  onEvent: (event: RecordEvent) => void;
};

export function RecordControl({ mode, source, masterAvailable, onEvent }: RecordProps) {
  const [recording, setRecording] = useState(false);
  const [timerSec, setTimerSec] = useState<number | null>(null);
  const captureRef = useRef<RecordingCapture | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (recording) return;
    try {
      if (!masterAvailable) {
        onEvent({ kind: 'fail', message: recordingFailureMessage('No live master audio is available.') });
        return;
      }
      const capture = startRecording(mode, source);
      captureRef.current = capture;
      setRecording(true);
      setTimerSec(0);
      onEvent({ kind: 'start', mode, source });
      timerRef.current = window.setInterval(() => {
        setTimerSec((prev) => (prev === null ? 1 : prev + 1));
      }, 1000);
    } catch (error) {
      onEvent({ kind: 'fail', message: recordingFailureMessage(error) });
    }
  }, [recording, masterAvailable, mode, source, onEvent]);

  const stop = useCallback(async () => {
    if (!recording || !captureRef.current) return;
    setRecording(false);
    clearTimer();
    setTimerSec(null);
    const capture = captureRef.current;
    captureRef.current = null;
    try {
      onEvent({ kind: 'stop', capture });
      const blob = await capture.stop();
      // Atomic export: send to main via props event; test mocks the handler.
      onEvent({ kind: 'complete', filePath: undefined });
    } catch (error) {
      onEvent({ kind: 'fail', message: recordingFailureMessage(error) });
      setRecording(false);
    }
  }, [recording, clearTimer, onEvent]);

  const intent = recordingIntent(mode);
  return (
    <span className="record-control" title={`Record ${mode} (${intent.mimeType})`}>
      <button
        onClick={recording ? stop : start}
        disabled={recording && timerSec === null}
        aria-label={recording ? 'Stop recording' : 'Start recording'}
      >
        {recording ? `■ stop (${timerSec ?? 0}s)` : `● record ${mode}`}
      </button>
    </span>
  );
}
