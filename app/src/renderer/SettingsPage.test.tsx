/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import type { Settings } from '../shared/settings';
import type { SessionRootStatus } from '../shared/ipc';

const { desktop, onBack, onSettingsChange } = vi.hoisted(() => ({
  desktop: {
    settings: {
      load: vi.fn(
        async () =>
          ({
            version: 1,
            recordConfig: { enabled: false, mode: 'audio' },
            beatSwitchTiming: 'next-bar',
            closeBehavior: 'ask',
          }) as Settings,
      ),
      update: vi.fn(async (partial: Partial<Settings>) => ({ version: 1, ...partial }) as Settings),
    },
    sessions: {
      root: vi.fn(async () => '/sessions-root'),
      rootStatus: vi.fn(async () => ({ state: 'ok', path: '/sessions-root/configured' }) as SessionRootStatus),
      chooseRoot: vi.fn(async () => ({ state: 'ok', path: '/sessions-root/configured' }) as SessionRootStatus),
    },
  },
  onBack: vi.fn(),
  onSettingsChange: vi.fn(),
}));

vi.mock('./desktop', () => ({ desktop }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function page() {
  const view = render(<SettingsPage onBack={onBack} onSettingsChange={onSettingsChange} />);
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy());
  return view;
}

describe('SettingsPage', () => {
  beforeEach(() => {
    desktop.settings.load.mockResolvedValue({
      version: 1,
      recordConfig: { enabled: false, mode: 'audio' },
      beatSwitchTiming: 'next-bar',
      closeBehavior: 'ask',
    });
    desktop.sessions.rootStatus.mockResolvedValue({ state: 'ok', path: '/sessions-root/configured' });
    desktop.sessions.root.mockResolvedValue('/sessions-root');
  });

  it('offers the four categories in the sidebar and opens the recording section', async () => {
    await page();
    for (const label of ['recording', 'audio switch latency', 'close behavior', 'sessions folder']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    // The recording section is the default landing spot and shows its control.
    expect(screen.getByLabelText('Record button action')).toBeTruthy();
  });

  it('shows each section from its sidebar category', async () => {
    await page();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'audio switch latency' }));
    expect(screen.getByLabelText('Beat switch timing')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'close behavior' }));
    expect(screen.getByLabelText('On close')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'sessions folder' }));
    expect(screen.getByText('sessions root')).toBeTruthy();
  });

  it('round-trips a recording mode change through the settings store and the app', async () => {
    await page();
    fireEvent.change(screen.getByLabelText('Record button action'), { target: { value: 'mp4' } });

    await waitFor(() => expect(desktop.settings.update).toHaveBeenCalled());
    expect(desktop.settings.update).toHaveBeenCalledWith({
      recordConfig: expect.objectContaining({ mode: 'mp4' }),
    });
    // The app needs the change live (the titlebar record button follows it),
    // so the saved settings are handed back, not just persisted.
    await waitFor(() =>
      expect(onSettingsChange).toHaveBeenCalledWith(
        expect.objectContaining({
          recordConfig: expect.objectContaining({ mode: 'mp4' }),
        }),
      ),
    );
  });

  it('persists latency and close behavior choices with their persisted values shown', async () => {
    await page();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'audio switch latency' }));
    expect((screen.getByLabelText('Beat switch timing') as HTMLSelectElement).value).toBe('next-bar');
    fireEvent.change(screen.getByLabelText('Beat switch timing'), { target: { value: 'manual' } });
    await waitFor(() => expect(desktop.settings.update).toHaveBeenCalledWith({ beatSwitchTiming: 'manual' }));

    await user.click(screen.getByRole('button', { name: 'close behavior' }));
    expect((screen.getByLabelText('On close') as HTMLSelectElement).value).toBe('ask');
    fireEvent.change(screen.getByLabelText('On close'), { target: { value: 'auto-save' } });
    await waitFor(() => expect(desktop.settings.update).toHaveBeenCalledWith({ closeBehavior: 'auto-save' }));
  });

  it('shows the sessions-root pointer from its own status, not a guess', async () => {
    await page();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'sessions folder' }));

    expect(screen.getByTitle('/sessions-root/configured').textContent).toBe('/sessions-root/configured');

    // The default-location case names the resolved root instead, on a fresh page.
    cleanup();
    desktop.sessions.rootStatus.mockResolvedValue({ state: 'unconfigured' });
    await page();
    await user.click(screen.getByRole('button', { name: 'sessions folder' }));
    expect(screen.getByTitle(/\/sessions-root/).textContent).toContain('(default)');
  });

  it('surfaces a refused folder change instead of the button doing nothing', async () => {
    desktop.sessions.chooseRoot.mockRejectedValueOnce(
      new Error('Close the current session before changing the sessions folder'),
    );
    await page();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'sessions folder' }));

    await user.click(screen.getByRole('button', { name: 'change...' }));

    expect(await screen.findByText('Close the current session before changing the sessions folder')).toBeTruthy();
  });

  it('goes back through the button and Escape', async () => {
    await page();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /back/ }));
    expect(onBack).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(2);
  });
});
