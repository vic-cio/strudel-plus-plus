import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';

describe('SettingsPage', () => {
  it('renders settings controls', () => {
    render(<SettingsPage onBack={() => {}} />);
    expect(screen.getByText('Settings')).toBeDefined();
    expect(screen.getByText('Recording')).toBeDefined();
    expect(screen.getByText('Close behavior')).toBeDefined();
  });
});
