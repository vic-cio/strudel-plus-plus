import { useCallback, useEffect, useState } from 'react';
import { desktop } from './desktop';
import { RECORDING_MODES, type RecordingMode } from '../shared/recording';
import type { BeatSwitchTiming, Settings } from '../shared/settings';
import type { SessionRootStatus } from '../shared/ipc';

/**
 * The Settings page, as a full-viewport overlay on the live app.
 *
 * It is rendered ON TOP of the mounted app (never instead of it): the editor,
 * the playing scheduler, and the plugin state all keep living underneath, so
 * a round trip through Settings cannot cost the buffer, the beat selection,
 * or the sound. Only its own controls talk to the settings store — every
 * change saves instantly through the typed settings IPC and is reported to
 * the app through onSettingsChange so live surfaces (the record button, the
 * latency dropdown, the close guard) follow immediately.
 */

type Category = 'recording' | 'latency' | 'close' | 'sessions';

const CATEGORIES: readonly { id: Category; label: string }[] = [
  { id: 'recording', label: 'recording' },
  { id: 'latency', label: 'audio switch latency' },
  { id: 'close', label: 'close behavior' },
  { id: 'sessions', label: 'sessions folder' },
];

const LATENCY_CHOICES: readonly { value: BeatSwitchTiming; label: string }[] = [
  { value: 'immediate', label: 'immediate' },
  { value: 'next-half-bar', label: 'next half-bar' },
  { value: 'next-bar', label: 'next bar' },
  { value: 'manual', label: 'manual' },
];

const CLOSE_CHOICES: readonly { value: NonNullable<Settings['closeBehavior']>; label: string; note: string }[] = [
  { value: 'ask', label: 'ask', note: 'Closing with unsaved beats asks: save all, discard, or stay.' },
  { value: 'auto-save', label: 'auto-save', note: 'Every unsaved beat is written before the window closes.' },
  { value: 'discard', label: 'discard', note: 'The window closes at once; unsaved edits are lost.' },
];

type Props = {
  onBack: () => void;
  /** The app re-reads its live surfaces (record mode, latency, close guard) from each saved change. */
  onSettingsChange?: (next: Settings) => void;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SettingsPage({ onBack, onSettingsChange }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rootStatus, setRootStatus] = useState<SessionRootStatus | undefined>(undefined);
  const [root, setRoot] = useState('');
  const [category, setCategory] = useState<Category>('recording');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [sessionsError, setSessionsError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      try {
        const [loaded, status, resolvedRoot] = await Promise.all([
          desktop.settings.load(),
          desktop.sessions.rootStatus(),
          desktop.sessions.root(),
        ]);
        setSettings(loaded);
        setRootStatus(status);
        setRoot(resolvedRoot);
        setSaved(true);
      } catch (loadError) {
        setError(messageOf(loadError));
      }
    })();
  }, []);

  // Escape leaves Settings, the same way it leaves the session picker.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  const update = useCallback(
    async (partial: Partial<Settings>) => {
      const current = settings;
      if (!current) {
        return;
      }
      try {
        const next = await desktop.settings.update(partial);
        setSettings(next);
        setSaved(true);
        setError(undefined);
        onSettingsChange?.(next);
      } catch (saveError) {
        // A settings write that fails must say so here: the status bar this
        // app normally uses for failures is underneath this overlay.
        setError(messageOf(saveError));
      }
    },
    [settings, onSettingsChange],
  );

  /** The pointer's own state decides what to show; the resolved root names the default. */
  const rootLabel =
    rootStatus === undefined
      ? root || '…'
      : rootStatus.state === 'ok'
        ? rootStatus.path
        : rootStatus.state === 'invalid'
          ? rootStatus.path
          : `${root || 'the default location'} (default)`;

  const chooseRoot = useCallback(async () => {
    setSessionsError(undefined);
    try {
      const status = await desktop.sessions.chooseRoot();
      setRootStatus(status);
      setRoot(await desktop.sessions.root());
      setSaved(true);
    } catch (chooseError) {
      // Re-rooting is only offered while no session is open; the main
      // process refuses otherwise. The refusal is a real answer, so it is
      // shown instead of the button silently doing nothing.
      setSessionsError(messageOf(chooseError));
    }
  }, []);

  return (
    <div className="settings-overlay" role="dialog" aria-label="Settings">
      {/* The overlay covers the app's titlebar, so it carries its own drag strip. */}
      <div className="settings-drag" />
      <div className="settings-panel">
        <header className="settings-head">
          <span className="settings-mark">settings</span>
          <span className="settings-sub">changes save instantly</span>
          <button className="settings-back" onClick={onBack} title="Back to the app (Escape)">
            [&lt;] back
          </button>
        </header>
        <div className="settings-content">
          <nav className="settings-side" aria-label="Settings categories">
            {CATEGORIES.map((entry) => (
              <button
                key={entry.id}
                className="settings-cat"
                aria-current={category === entry.id || undefined}
                onClick={() => setCategory(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>
          <div className="settings-body">
            {settings === null ? (
              <p className="settings-empty">loading settings…</p>
            ) : (
              <>
                {category === 'recording' && (
                  <section className="settings-section" aria-label="Recording">
                    <h3>recording</h3>
                    <label className="settings-row">
                      <span className="settings-label">record button action</span>
                      <select
                        aria-label="Record button action"
                        value={settings.recordConfig?.mode ?? 'audio'}
                        onChange={(event) =>
                          void update({
                            recordConfig: {
                              enabled: settings.recordConfig?.enabled ?? false,
                              ...settings.recordConfig,
                              mode: event.target.value as RecordingMode,
                            },
                          })
                        }
                      >
                        {RECORDING_MODES.map((mode) => (
                          <option key={mode.mode} value={mode.mode}>
                            {mode.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="settings-note">
                      The record control in the titlebar takes the master mix live; MP4 adds a title card.
                    </p>
                    <label className="settings-row">
                      <span className="settings-label">ask where to save each recording</span>
                      <input
                        type="checkbox"
                        aria-label="Ask where to save each recording"
                        checked={settings.recordConfig?.askWhereToSave === true}
                        onChange={(event) =>
                          void update({
                            recordConfig: {
                              enabled: settings.recordConfig?.enabled ?? false,
                              ...settings.recordConfig,
                              askWhereToSave: event.target.checked,
                            },
                          })
                        }
                      />
                    </label>
                    <p className="settings-note">
                      Off saves automatically into recordings inside the sessions folder. On shows the save dialog.
                    </p>
                  </section>
                )}

                {category === 'latency' && (
                  <section className="settings-section" aria-label="Audio switch latency">
                    <h3>audio switch latency</h3>
                    <label className="settings-row">
                      <span className="settings-label">beat switch timing</span>
                      <select
                        aria-label="Beat switch timing"
                        value={settings.beatSwitchTiming ?? 'next-bar'}
                        onChange={(event) => void update({ beatSwitchTiming: event.target.value as BeatSwitchTiming })}
                      >
                        {LATENCY_CHOICES.map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="settings-note">
                      When a beat is switched while playing, its evaluation waits for this boundary. The same choice
                      sits in the beats sidebar and follows this one.
                    </p>
                  </section>
                )}

                {category === 'close' && (
                  <section className="settings-section" aria-label="Close behavior">
                    <h3>close behavior</h3>
                    <label className="settings-row">
                      <span className="settings-label">on close</span>
                      <select
                        aria-label="On close"
                        value={settings.closeBehavior ?? 'ask'}
                        onChange={(event) =>
                          void update({
                            closeBehavior: event.target.value as NonNullable<Settings['closeBehavior']>,
                          })
                        }
                      >
                        {CLOSE_CHOICES.map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="settings-note">
                      {CLOSE_CHOICES.find((choice) => choice.value === (settings.closeBehavior ?? 'ask'))?.note}
                    </p>
                  </section>
                )}

                {category === 'sessions' && (
                  <section className="settings-section" aria-label="Sessions folder">
                    <h3>sessions folder</h3>
                    <p className="settings-note">
                      Each session is one folder under this root. The pointer itself never moves unless it is changed
                      here.
                    </p>
                    <div className="settings-row">
                      <span className="settings-label">sessions root</span>
                      <span className="settings-path" title={rootLabel}>
                        {rootLabel}
                      </span>
                    </div>
                    {rootStatus?.state === 'invalid' && (
                      <p className="settings-error" role="alert">
                        {rootStatus.error}
                      </p>
                    )}
                    <div className="settings-row">
                      <button onClick={() => void chooseRoot()}>change...</button>
                      <span className="settings-hint">offered while no session is open</span>
                    </div>
                    {sessionsError !== undefined && (
                      <p className="settings-error" role="alert">
                        {sessionsError}
                      </p>
                    )}
                  </section>
                )}
              </>
            )}
          </div>
        </div>
        <footer className="settings-foot">
          {error !== undefined ? (
            <span className="settings-error" role="alert">
              {error}
            </span>
          ) : (
            <span className="settings-hint">Escape goes back</span>
          )}
          <span className={saved ? 'settings-saved' : 'settings-pending'}>{saved ? 'saved' : '…'}</span>
        </footer>
      </div>
    </div>
  );
}
