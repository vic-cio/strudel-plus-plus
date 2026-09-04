import { DEFAULT_SETTINGS, SETTINGS_VERSION, type BeatSwitchTiming, type Settings } from '../shared/settings';
export { DEFAULT_SETTINGS, SETTINGS_VERSION, type BeatSwitchTiming, type Settings };

export function validateSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SETTINGS, version: SETTINGS_VERSION };
  }
  const r = raw as Record<string, unknown>;
  const version = typeof r.version === 'number' ? r.version : SETTINGS_VERSION;
  const timing = validateTiming(r.beatSwitchTiming);
  return {
    version,
    sessionsRoot: typeof r.sessionsRoot === 'string' ? r.sessionsRoot : undefined,
    beatSwitchTiming: timing,
    recordConfig: validateRecordConfig(r.recordConfig),
    closeBehavior: (typeof r.closeBehavior === 'string'
      ? (r.closeBehavior as Settings['closeBehavior'])
      : DEFAULT_SETTINGS.closeBehavior) as Settings['closeBehavior'],
  };
}

function validateTiming(value: unknown): BeatSwitchTiming {
  if (value === 'immediate' || value === 'next-bar' || value === 'next-half-bar' || value === 'manual') {
    return value;
  }
  return DEFAULT_SETTINGS.beatSwitchTiming!;
}

function validateRecordConfig(value: unknown): Settings['recordConfig'] {
  if (!value || typeof value !== 'object') return DEFAULT_SETTINGS.recordConfig;
  const r = value as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    outputPath: typeof r.outputPath === 'string' ? r.outputPath : undefined,
  } as Settings['recordConfig'];
}
