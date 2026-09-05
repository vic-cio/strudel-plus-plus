// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecordControl } from './RecordControl';

describe('RecordControl', () => {
  let onEvent = vi.fn();

  beforeEach(() => {
    onEvent = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails visibly when master stream is missing', () => {
    render(<RecordControl mode="audio" source="beat" masterAvailable={false} onEvent={onEvent} />);
    fireEvent.click(screen.getAllByText('● record audio')[0]);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'fail' }));
  });

  it('emits start, stop, complete, and fail events for wiring', async () => {
    render(<RecordControl mode="audio" source="beat" masterAvailable={true} onEvent={onEvent} />);
    fireEvent.click(screen.getAllByText('● record audio')[0]);
    await waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'start', mode: 'audio' })),
    );
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    await waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'stop' })));
  });

  it('shows timer state while recording', async () => {
    render(<RecordControl mode="audio" source="beat" masterAvailable={true} onEvent={onEvent} />);
    fireEvent.click(screen.getAllByText('● record audio')[0]);
    await waitFor(() => expect(screen.getByText(/stop/)).toBeDefined());
  });
});
