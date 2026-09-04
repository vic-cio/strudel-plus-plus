export type RecordingMode = 'audio' | 'video' | 'mp4';

export type RecordingSettings = {
  mode: RecordingMode;
};

export type RecordingIntent = {
  mode: RecordingMode;
  source: string;
  includeMasterAudio: boolean;
  mimeType: string;
  extension: string;
};

export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = { mode: 'audio' };

export const RECORDING_MODES: readonly { mode: RecordingMode; label: string }[] = [
  { mode: 'audio', label: 'audio (webm)' },
  { mode: 'video', label: 'video (webm)' },
  { mode: 'mp4', label: 'MP4 video' },
];

export function recordingSource(lastSuccessfulBuffer: string | undefined): string | undefined {
  const source = lastSuccessfulBuffer?.trim();
  return source || undefined;
}

export function recordingIntent(mode: RecordingMode, source: string): RecordingIntent {
  switch (mode) {
    case 'audio':
      return { mode, source, includeMasterAudio: true, mimeType: 'audio/webm;codecs=opus', extension: 'webm' };
    case 'video':
      return { mode, source, includeMasterAudio: true, mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' };
    case 'mp4':
      return { mode, source, includeMasterAudio: true, mimeType: 'video/mp4', extension: 'mp4' };
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function recordingFailureMessage(error: unknown): string {
  return `Recording failed: ${error instanceof Error ? error.message : String(error)}`;
}
