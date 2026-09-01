// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TempoBox } from './TempoBox';

describe('TempoBox', () => {
  it('fades and disables itself when the beat owns its tempo', () => {
    const props = { cps: 0.5, onChange: vi.fn(), coded: true };

    render(<TempoBox {...props} />);

    const input = screen.getByRole('textbox', { name: 'Tempo in bpm' });
    expect(input).toHaveProperty('disabled', true);
    expect(document.querySelector('.tempo-coded')).not.toBeNull();
  });
});
