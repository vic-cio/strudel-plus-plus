import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, SETTINGS_VERSION, type Settings, type BeatSwitchTiming, type RecordingMode } from '../shared/settings';
import { validateSettings } from './settings';

const SETTINGS_FILE = 'strudel-settings.json';

export function createSettingsStore(configDir: string) {
  const filePath = join(configDir, SETTINGS_FILE);
  const tempPath = join(configDir, '.strudel-settings.tmp');

  async function loadRaw(): Promise<unknown> {
    try {
      const data = await readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (e: unknown) {
      const code = typeof e === 'object' && e !== null && 'code' in e ? (e as { code?: unknown }).code : undefined;
      if (code === 'ENOENT') return null;
      return null;
    }
  }

  return {
    async load(): Promise<Settings> {
      const raw = await loadRaw();
      return validateSettings(raw);
    },
    async save(settings: Settings): Promise<void> {
      await mkdir(configDir, { recursive: true });
      const payload = JSON.stringify(settings, null, 2);
      await writeFile(tempPath, payload, 'utf8');
      await rename(tempPath, filePath);
    },
  };
}
