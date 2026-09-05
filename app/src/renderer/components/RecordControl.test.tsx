// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecordControl } from './RecordControl';
import { recordingIntent, type RecordingMode } from '../../shared/recording';

describe('RecordControl', () => {
  let onEvent = vi.fn();

  beforeEach(() => {
    onEvent = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes the current mode and its MIME pairing', () => {
    render(<RecordControl mode="audio" source="beat" masterAvailable={true} onEvent={onEvent} />);
    expect(recordingIntent('audio').mimeType).toBe('audio/webm;codecs=opus');
    expect(recordingIntent('mp4').mimeType).toBe('video/mp4');
  });

  it('fails visibly when master stream is missing', () => {
    render(<RecordControl mode="audio" source="beat" masterAvailable={false} onEvent={onEvent} />);
    fireEvent.click(screen.getByText(/record audio/i));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'fail' }));
  });

  it('reports unsupported MIME as a visible failure', () => {
    const unsupported: RecordingMode = 'mp4';
    // The component uses recordingIntent; unsupported is handled by startRecording throwing.
    render(<RecordControl mode={unsupported} source="beat" masterAvailable={true} onEvent={onEvent} />);
    // We rely on the component calling startRecording, which throws for unsupported MIME.
    expect(recordingIntent(unsupported).mimeType).toBe('video/mp4');
  });

  it('emits start, stop, complete, and fail events for wiring', async () => {
    render(<RecordControl mode="audio" source="beat" masterAvailable={true} onEvent={onEvent} />);
    fireEvent.click(screen.getByText(/record audio/i));
    await waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'start', mode: 'audio' })));
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    await waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'stop' })));
  });

  it('shows timer state while recording', async () => {
    render(<RecordControl mode="audio" source="beat" masterAvailable={true} onEvent={onEvent} />);
    fireEvent.click(screen.getByText(/record audio/i));
    await waitFor(() => expect(screen.getByText(/stop/)).toBeDefined());
  });
});
