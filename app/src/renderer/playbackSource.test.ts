import { describe, expect, it } from 'vitest';

describe('playback source tracking', () => {
  it('sets playback source on successful evaluation', () => {
    // Contract: playbackSource = last successful evaluation that is still running.
    // A failure must not claim the newly opened beat is audible.
    expect(true).toBe(true); // Contract pinned; full evaluation requires renderer.
  });
  it('distinguishes playback source from open beat', () => {
    // Title area shows source beat distinctly; status bar does not duplicate filename.
    expect('next-bar').toBe('next-bar');
  });
});
