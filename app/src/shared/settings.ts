export const SETTINGS_VERSION = 1;

export type BeatSwitchTiming = 'immediate' | 'next-bar' | 'next-half-bar' | 'manual';

export type Settings = {
  version: number;
  sessionsRoot?: string | undefined;
  beatSwitchTiming?: BeatSwitchTiming | undefined;
  recordConfig?: { enabled: boolean; outputPath?: string | undefined } | undefined;
  closeBehavior?: 'ask' | 'auto-save' | 'discard' | undefined;
};

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  beatSwitchTiming: 'next-bar',
  closeBehavior: 'ask',
  recordConfig: { enabled: false },
};
