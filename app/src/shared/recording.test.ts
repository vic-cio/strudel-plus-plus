import { describe, expect, it } from 'vitest';
import { recordingFailureMessage, recordingIntent, recordingSource } from './recording';

describe('recording contract', () => {
  it('trims the evaluated buffer and treats a blank one as no source', () => {
    expect(recordingSource('  evaluated beat  ')).toBe('evaluated beat');
    expect(recordingSource('   ')).toBeUndefined();
    expect(recordingSource(undefined)).toBeUndefined();
  });

  it('pairs each recording form with the extension its container needs', () => {
    expect(recordingIntent('mp4')).toEqual({ mimeType: 'video/mp4', extension: 'mp4' });
    expect(recordingIntent('audio')).toEqual({ mimeType: 'audio/webm;codecs=opus', extension: 'webm' });
  });

  it('gives failures a user-facing recording label', () => {
    expect(recordingFailureMessage(new Error('codec missing'))).toBe('Recording failed: codec missing');
    expect(recordingFailureMessage('codec missing')).toBe('Recording failed: codec missing');
  });
});
