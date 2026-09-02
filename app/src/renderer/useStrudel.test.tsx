// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStrudel } from './useStrudel';

const { mirrors, FakeMirror } = vi.hoisted(() => {
  const mirrors: FakeMirror[] = [];

  class FakeMirror {
    readonly repl = {
      scheduler: { cps: 0.5 },
      setCps: vi.fn(),
    };

    code: string;

    /** Tests point these at implementations that reject, to prove the hook
     * catches what playback evaluation throws asynchronously. */
    evaluateImpl: () => Promise<void> = () => Promise.resolve();
    toggleImpl: () => Promise<void> = () => Promise.resolve();

    constructor(options: { root: HTMLElement; initialCode: string }) {
      this.code = options.initialCode;
      mirrors.push(this);
      const editor = document.createElement('div');
      editor.className = 'cm-editor';
      options.root.append(editor);
    }

    setTheme(): void {}

    setFontFamily(): void {}

    setCode(code: string): void {
      this.code = code;
    }

    evaluate(): Promise<void> {
      return this.evaluateImpl();
    }

    toggle(): Promise<void> {
      return this.toggleImpl();
    }

    stop(): Promise<void> {
      return Promise.resolve();
    }

    clear(): void {}
  }

  return { mirrors, FakeMirror };
});

vi.mock('@strudel/core', () => ({ evalScope: vi.fn(() => Promise.resolve()), silence: {} }));
vi.mock('@strudel/draw', () => ({ getDrawContext: vi.fn(() => ({})) }));
vi.mock('@strudel/edo', () => ({}));
vi.mock('@strudel/tonal', () => ({}));
vi.mock('@strudel/mini', () => ({}));
vi.mock('@strudel/xen', () => ({}));
vi.mock('@strudel/hydra', () => ({}));
vi.mock('@strudel/soundfonts', () => ({}));
vi.mock('@strudel/tidal', () => ({}));
vi.mock('@strudel/motion', () => ({}));
vi.mock('@strudel/mondo', () => ({}));
vi.mock('@strudel/dough', () => ({}));
vi.mock('@strudel/codemirror', () => ({
  StrudelMirror: FakeMirror,
  activateTheme: vi.fn(),
  settings: {},
  themes: {},
}));
vi.mock('@strudel/transpiler', () => ({ transpiler: {} }));
vi.mock('@strudel/webaudio', () => ({
  getAudioContextCurrentTime: vi.fn(() => 0),
  initAudioOnFirstClick: vi.fn(() => Promise.resolve()),
  webaudioOutput: {},
}));
vi.mock('worker-timers', () => ({
  clearInterval: vi.fn(),
  setInterval: vi.fn(),
}));
vi.mock('./prebake.mjs', () => ({ prebake: vi.fn(() => Promise.resolve()) }));
vi.mock('./deadeyeTheme.mjs', () => ({ deadeyeSettings: {}, deadeyeTheme: {} }));
vi.mock('./midiBridge.mjs', () => ({}));
vi.mock('./oscBridge.mjs', () => ({}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  mirrors.length = 0;
});

/** Renders the editor plus buttons that drive the hook's wrappers, and shows
 * the error surface: the assertions read the status-bar-facing state. */
function Harness({ showEditor }: { showEditor: boolean }) {
  const { containerRef, state, evaluate, toggle, clearError } = useStrudel(vi.fn());
  return (
    <>
      {showEditor ? <div data-testid="editor-host" ref={containerRef} /> : null}
      <output data-testid="repl-error">{state.error?.message ?? ''}</output>
      <button onClick={() => evaluate()}>evaluate</button>
      <button onClick={() => toggle()}>toggle</button>
      <button onClick={() => clearError()}>clear</button>
    </>
  );
}

/** The scheduler logs through this DOM event; dispatch it as upstream does. */
function logPlaybackError(message: string, type?: string): void {
  act(() => {
    document.dispatchEvent(new CustomEvent('strudel.log', { detail: { message, type } }));
  });
}

describe('useStrudel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('mounts the editor when its host appears after the session picker', () => {
    const view = render(<Harness showEditor={false} />);

    expect(mirrors).toHaveLength(0);

    view.rerender(<Harness showEditor />);

    expect(mirrors).toHaveLength(1);
    expect(screen.getByTestId('editor-host').querySelector('.cm-editor')).not.toBeNull();
  });

  it('lands a rejected evaluate in the error surface instead of an unhandled rejection', async () => {
    vi.useRealTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (event: Event): void => {
      unhandled.push((event as PromiseRejectionEvent).reason);
    };
    window.addEventListener('unhandledrejection', onUnhandled);

    const user = userEvent.setup();
    render(<Harness showEditor />);
    mirrors[0]!.evaluateImpl = () => Promise.reject(new Error('[mini] parse error escaped'));

    await user.click(screen.getByRole('button', { name: 'evaluate' }));
    // A rejection fires its unhandledrejection fallout on a later tick; give
    // it the chance so the assertion means something.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.getByTestId('repl-error').textContent).toBe('[mini] parse error escaped');
    expect(unhandled).toEqual([]);
    window.removeEventListener('unhandledrejection', onUnhandled);
  });

  it('lands a rejected toggle in the error surface the same way', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    render(<Harness showEditor />);
    mirrors[0]!.toggleImpl = () => Promise.reject(new Error('scheduler exploded'));

    await user.click(screen.getByRole('button', { name: 'toggle' }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.getByTestId('repl-error').textContent).toBe('scheduler exploded');
  });

  it('surfaces a scheduler error logged during playback, deduped per message', async () => {
    vi.useRealTimers();
    render(<Harness showEditor />);

    // A pattern that throws while the scheduler queries it re-fires the same
    // message every cycle. The status bar must show it once, not churn.
    logPlaybackError('[cyclist] error: [mini] parse error at line 4: Expected a letter');
    expect(screen.getByTestId('repl-error').textContent).toBe('[mini] parse error at line 4: Expected a letter');

    logPlaybackError('[cyclist] error: [mini] parse error at line 4: Expected a letter');
    expect(screen.getByTestId('repl-error').textContent).toBe('[mini] parse error at line 4: Expected a letter');

    // A different message replaces the shown one.
    logPlaybackError('[getTrigger] error: not a note: "~~~"');
    expect(screen.getByTestId('repl-error').textContent).toBe('not a note: "~~~"');

    // And clearError (an adopt, say) drops it like any other REPL error.
    await act(() => screen.getByRole('button', { name: 'clear' }).click());
    expect(screen.getByTestId('repl-error').textContent).toBe('');
  });

  it('does not double-surface evaluation errors: their log entries carry type "error"', () => {
    vi.useRealTimers();
    render(<Harness showEditor />);

    // Eval failures reach the status bar through the editor's own error state
    // (onUpdateState). The logger also announces them with type "error"; that
    // entry must be ignored here or the surface would flicker twice.
    logPlaybackError('[eval] error: [mini] parse error at line 2: nope', 'error');
    expect(screen.getByTestId('repl-error').textContent).toBe('');

    // Anything else the logger says is not a pattern failure either.
    logPlaybackError('[eval] code updated');
    logPlaybackError('skip query: too late');
    expect(screen.getByTestId('repl-error').textContent).toBe('');
  });
});
