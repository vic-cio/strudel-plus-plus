import { describe, expect, it } from 'vitest';
import { recordingFailureMessage } from './recording';

describe('recording errors', () => {
  it('gives failures a user-facing recording label', () => {
    expect(recordingFailureMessage(new Error('codec missing'))).toBe('Recording failed: codec missing');
  });
});
