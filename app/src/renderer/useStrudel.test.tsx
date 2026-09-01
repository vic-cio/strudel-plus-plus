// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
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
      return Promise.resolve();
    }

    toggle(): Promise<void> {
      return Promise.resolve();
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

function Harness({ showEditor }: { showEditor: boolean }) {
  const { containerRef } = useStrudel(vi.fn());
  return showEditor ? <div data-testid="editor-host" ref={containerRef} /> : null;
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
});
