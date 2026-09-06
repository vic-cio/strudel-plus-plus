import { useState, useEffect, useCallback } from 'react';
import { desktop } from './desktop';
import type { Settings, BeatSwitchTiming, RecordingMode } from '../shared/settings';

export function SettingsPage({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    desktop.settings.load().then((s) => {
      setSettings(s);
      setSaved(true);
    });
  }, []);

  const update = useCallback(
    async (partial: Partial<Settings>) => {
      if (!settings) return;
      const next = await desktop.settings.update(partial);
      setSettings(next);
      setSaved(true);
    },
    [settings],
  );

  if (!settings) {
    return (
      <div className="pane-body">
        <p>Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="pane-body settings-page">
      <h2>Settings</h2>
      <section>
        <h3>Recording</h3>
        <label>
          Record button action
          <select
            value={settings.recordConfig?.mode ?? 'audio'}
            onChange={(e) =>
              update({ recordConfig: { ...settings.recordConfig, mode: e.target.value as RecordingMode } })
            }
          >
            <option value="audio">Audio</option>
            <option value="mp4">MP4 video</option>
          </select>
        </label>
      </section>
      <section>
        <h3>Audio switch latency</h3>
        <label>
          Timing
          <select
            value={settings.beatSwitchTiming ?? 'next-bar'}
            onChange={(e) => update({ beatSwitchTiming: e.target.value as BeatSwitchTiming })}
          >
            <option value="immediate">Immediate</option>
            <option value="next-half-bar">Next half-bar</option>
            <option value="next-bar">Next bar</option>
            <option value="manual">Manual</option>
          </select>
        </label>
      </section>
      <section>
        <h3>Close behavior</h3>
        <label>
          On close
          <select
            value={settings.closeBehavior ?? 'ask'}
            onChange={(e) => update({ closeBehavior: e.target.value as Settings['closeBehavior'] })}
          >
            <option value="ask">Ask</option>
            <option value="auto-save">Auto-save</option>
            <option value="discard">Discard</option>
          </select>
        </label>
      </section>
      <section>
        <h3>Sessions folder</h3>
        <label>
          Sessions root
          <span>{settings.sessionsRoot ?? '(default)'}</span>
          <button
            onClick={async () => {
              const status = await desktop.sessions.chooseRoot();
              const updated = await desktop.settings.load();
              setSettings(updated);
              setSaved(true);
            }}
          >
            Change...
          </button>
        </label>
      </section>
      <div className="settings-footer">
        <button onClick={onBack}>Back</button>
        <span className={saved ? 'settings-saved' : ''}>{saved ? 'Saved' : 'Unsaved'}</span>
      </div>
    </div>
  );
}
