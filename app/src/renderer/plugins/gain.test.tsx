// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GainControl } from './gain';

const { parameter, resolveController } = vi.hoisted(() => ({
  parameter: {
    value: 1,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
  },
  resolveController: vi.fn((): unknown => ({ output: { destinationGain: { gain: parameter } } })),
}));

vi.mock('@strudel/webaudio', () => ({
  getAudioContext: () => ({ currentTime: 4 }),
  getSuperdoughAudioController: resolveController,
}));

afterEach(() => {
  cleanup();
  resolveController.mockClear();
  resolveController.mockImplementation(() => ({ output: { destinationGain: { gain: parameter } } }));
  parameter.value = 1;
  parameter.cancelScheduledValues.mockClear();
  parameter.setValueAtTime.mockClear();
});

describe('GainControl', () => {
  it('synchronizes the knob with the effective live audio value', async () => {
    const onState = vi.fn();
    render(<GainControl state={{ value: 0.4 }} onState={onState} playing={true} />);

    const input = screen.getByRole('slider', { name: 'Gain' });
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('gain control did not render a range input');
    }
    await waitFor(() => expect(input.value).toBe('0.4'));
    expect(parameter.setValueAtTime).toHaveBeenCalledWith(0.4, 4);

    fireEvent.change(input, { target: { value: '0.65' } });

    await waitFor(() => expect(onState).toHaveBeenLastCalledWith({ value: 0.65 }));
    expect(parameter.setValueAtTime).toHaveBeenLastCalledWith(0.65, 4);
    expect(input.value).toBe('0.65');
    expect(screen.getByText('0.65')).toBeTruthy();
  });

  it('shows a user-visible failure when live audio cannot accept a control', async () => {
    resolveController.mockReturnValue(undefined);
    render(<GainControl state={undefined} onState={vi.fn()} playing={true} />);

    expect((await screen.findByRole('alert')).textContent).toBe('[ gain unavailable: live audio output is not ready ]');
    const input = screen.getByRole('slider', { name: 'Gain' });
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('gain control did not render a range input');
    }
    expect(input.disabled).toBe(false);
  });

  it('recovers once the live output becomes available again', async () => {
    const onState = vi.fn();
    resolveController.mockReturnValue(undefined);
    render(<GainControl state={undefined} onState={onState} playing={true} />);

    await screen.findByRole('alert');
    const input = screen.getByRole('slider', { name: 'Gain' });
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('gain control did not render a range input');
    }

    resolveController.mockReturnValue({ output: { destinationGain: { gain: parameter } } });
    fireEvent.change(input, { target: { value: '0.25' } });

    await waitFor(() => expect(onState).toHaveBeenLastCalledWith({ value: 0.25 }));
    expect(parameter.setValueAtTime).toHaveBeenLastCalledWith(0.25, 4);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
