import { describe, expect, it } from 'vitest';
import { recordingIntent, recordingSource } from './recording';

describe('recording contract', () => {
  it('uses the last successful full-buffer evaluation, never the current draft', () => {
    expect(recordingSource('  evaluated beat  ')).toBe('evaluated beat');
    expect(recordingSource('draft only')).toBe('draft only');
    expect(recordingSource('   ')).toBeUndefined();
  });

  it('requires the master mix for every export form, including MP4', () => {
    expect(recordingIntent('mp4', 'beat')).toMatchObject({
      includeMasterAudio: true,
      mimeType: 'video/mp4',
      extension: 'mp4',
    });
  });
});
