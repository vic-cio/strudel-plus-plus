import { describe, expect, it } from 'vitest';
import { RECORDINGS_DIR, buildRecordingFilename, sanitizeRecordingFilename } from './recordingDestination';

describe('recording destination', () => {
  it('names the recordings folder', () => {
    expect(RECORDINGS_DIR).toBe('recordings');
  });

  it('builds the generated filename from the beat, stamp, and extension', () => {
    expect(buildRecordingFilename('we begin.js', '2026-09-07T00-00-00-000Z', 'webm')).toBe(
      'strudel-we begin-2026-09-07T00-00-00-000Z.webm',
    );
  });

  it('falls back to a take name when no beat is open', () => {
    expect(buildRecordingFilename(undefined, 'stamp', 'mp4')).toBe('strudel-take-stamp.mp4');
    expect(buildRecordingFilename('', 'stamp', 'mp4')).toBe('strudel-take-stamp.mp4');
  });

  it('keeps the container extension the take was started with', () => {
    expect(buildRecordingFilename('beat.js', 's', 'webm')).toMatch(/\.webm$/);
    expect(buildRecordingFilename('beat.js', 's', 'mp4')).toMatch(/\.mp4$/);
  });

  it('strips directories from a suggested filename', () => {
    expect(sanitizeRecordingFilename('../evil.webm')).toBe('evil.webm');
    expect(sanitizeRecordingFilename('a/b/c.webm')).toBe('c.webm');
    expect(sanitizeRecordingFilename('C:\\take.webm')).toBe('take.webm');
  });

  it('rejects empty and dot filenames', () => {
    expect(() => sanitizeRecordingFilename('')).toThrow();
    expect(() => sanitizeRecordingFilename('.')).toThrow();
    expect(() => sanitizeRecordingFilename('..')).toThrow();
  });
});
