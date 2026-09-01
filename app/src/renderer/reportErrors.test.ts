// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRendererError, reportErrors } from './reportErrors';

/**
 * Global renderer failures must be visible twice: on the console (the main
 * process forwards it to the log) and to subscribers (App shows it in the
 * error surface). A desktop window with no devtools is otherwise silent.
 */
describe('reportErrors', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    reportErrors();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('hands unhandled rejections to subscribers', async () => {
    const seen: string[] = [];
    cleanup = onRendererError((message) => seen.push(message));

    const rejection = new Error('boom in an effect');
    const event = new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.resolve(),
      reason: rejection,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('boom in an effect');
  });

  it('hands uncaught errors to subscribers', () => {
    const seen: string[] = [];
    cleanup = onRendererError((message) => seen.push(message));

    const failure = new Error('boom in a callback');
    window.dispatchEvent(new ErrorEvent('error', { error: failure }));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('boom in a callback');
  });

  it('keeps working when a subscriber itself throws', () => {
    const seen: string[] = [];
    cleanup = onRendererError(() => {
      throw new Error('the error surface is broken too');
    });
    const second = vi.fn();
    cleanup = onRendererError(second);

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('original failure') }));

    expect(second).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
  });
});
