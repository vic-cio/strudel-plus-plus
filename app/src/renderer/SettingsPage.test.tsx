/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  (window as any).desktop = {
    settings: {
      load: vi.fn().mockResolvedValue({
        recordConfig: { enabled: false, mode: 'audio' },
        beatSwitchTiming: 'next-bar',
        closeBehavior: 'ask',
        sessionsRoot: null,
      }),
      update: vi.fn().mockResolvedValue({
        recordConfig: { enabled: false, mode: 'audio' },
        beatSwitchTiming: 'next-bar',
        closeBehavior: 'ask',
        sessionsRoot: null,
      }),
    },
    sessions: {
      chooseRoot: vi.fn(),
    },
  };
});
import { render, screen, waitFor } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';

describe('SettingsPage', () => {
  it('renders settings controls', async () => {
    render(<SettingsPage onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Settings')).toBeDefined());
    expect(screen.getByText('Recording')).toBeDefined();
    expect(screen.getByText('Close behavior')).toBeDefined();
  });
});
