import { useCallback, useEffect, useRef, useState } from 'react';
import { evalScope, silence } from '@strudel/core';
import { clampCps } from '../shared/tempo';
import { getDrawContext } from '@strudel/draw';
import { StrudelMirror, activateTheme, settings as themeSettings, themes } from '@strudel/codemirror';
import { transpiler } from '@strudel/transpiler';
import { getAudioContextCurrentTime, initAudioOnFirstClick, webaudioOutput } from '@strudel/webaudio';
import { clearInterval, setInterval } from 'worker-timers';
import { prebake } from './prebake.mjs';
import { deadeyeSettings, deadeyeTheme } from './deadeyeTheme.mjs';

// Strudel resolves themes by name from its own registry, so register before any
// editor exists. Otherwise the editor comes up in the dark default.
themes.deadeye = deadeyeTheme;
themeSettings.deadeye = deadeyeSettings;

/** Everything a pattern can call, matching the upstream Strudel REPL loader. */
function loadModules() {
  return evalScope(
    import('@strudel/core'),
    import('@strudel/draw'),
    import('@strudel/edo'),
    import('@strudel/tonal'),
    import('@strudel/mini'),
    import('@strudel/xen'),
    import('@strudel/webaudio'),
    import('@strudel/codemirror'),
    import('@strudel/hydra'),
    import('@strudel/soundfonts'),
    import('@strudel/tidal'),
    import('@strudel/motion'),
    import('@strudel/mondo'),
    import('@strudel/dough'),
    // MIDI and OSC both go through the main process rather than through
    // @strudel/midi's Web MIDI and @strudel/osc's websocket server. Neither
    // works in a desktop shell. The bridges replace them in the scope.
    import('./midiBridge.mjs'),
    import('./oscBridge.mjs'),
  );
}

// Started once, at module load, exactly as the website does. Both take seconds,
// and the editor should be usable while they run.
const audioReady = initAudioOnFirstClick();
const modulesReady = loadModules();
const soundsReady = prebake();

export type ReplState = {
  started: boolean;
  error?: Error;
};

export function useStrudel(onCodeChange: (code: string) => void) {
  const pollRef = useRef<number>(undefined);
  const editorRef = useRef<StrudelMirror>(undefined);
  const pendingCodeRef = useRef<string | undefined>(undefined);
  const [state, setState] = useState<ReplState>({ started: false });
  const [cps, setCps] = useState(0.5);
  // Set once he touches the tempo control, and re-applied after every
  // evaluation from then on. A beat carrying setcps or setcpm would otherwise
  // reset the tempo out from under him on the next eval.
  const chosenCps = useRef<number>(undefined);
  const codeChangeRef = useRef(onCodeChange);
  codeChangeRef.current = onCodeChange;

  const destroyEditor = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editorRef.current = undefined;
    if (pollRef.current !== undefined) {
      window.clearInterval(pollRef.current);
      pollRef.current = undefined;
    }
    void editor.stop();
    editor.clear();
    setState({ started: false });
  }, []);

  const containerRef = useCallback(
    (container: HTMLDivElement | null) => {
      if (!container || editorRef.current) {
        if (!container) {
          destroyEditor();
        }
        return;
      }
      const editor = new StrudelMirror({
        defaultOutput: webaudioOutput,
        getTime: getAudioContextCurrentTime,
        setInterval,
        clearInterval,
        transpiler,
        autodraw: false,
        root: container,
        initialCode: '// loading',
        pattern: silence,
        drawTime: [-2, 2],
        drawContext: getDrawContext(),
        prebake: async () => {
          await Promise.all([modulesReady, soundsReady]);
        },
        beforeEval: () => audioReady,
        onUpdateState: (next: ReplState) => setState({ ...next }),
        afterEval: () => {
          if (chosenCps.current !== undefined) {
            editor.repl.setCps(chosenCps.current);
          }
        },
      });
      editor.setTheme('deadeye');
      activateTheme('deadeye');
      editor.reconfigureExtension('isTabIndentationEnabled', true);
      editor.setFontFamily(getComputedStyle(document.body).fontFamily);
      editorRef.current = editor;
      if (pendingCodeRef.current !== undefined) {
        editor.setCode(pendingCodeRef.current);
        pendingCodeRef.current = undefined;
      }
      // StrudelMirror mirrors every keystroke onto `.code`, but gives no callback
      // for it, so the buffer is polled. 120ms is below the threshold where the
      // dirty marker feels laggy and far above the cost of a string compare.
      let last = editor.code ?? '';
      pollRef.current = window.setInterval(() => {
        const code = editor.code ?? '';
        if (code !== last) {
          last = code;
          codeChangeRef.current(code);
        }
        // Read the tempo back rather than trusting our own copy, so the box tells
        // the truth when the beat's own setcps is the one driving.
        const running = editor.repl.scheduler?.cps;
        if (typeof running === 'number' && running > 0) {
          setCps((shown) => (Math.abs(shown - running) < 1e-6 ? shown : running));
        }
      }, 120);
    },
    [destroyEditor],
  );

  useEffect(() => destroyEditor, [destroyEditor]);

  const setCode = useCallback((code: string) => {
    const editor = editorRef.current;
    if (editor) {
      editor.setCode(code);
      return;
    }
    pendingCodeRef.current = code;
  }, []);

  /** Read the editor synchronously when an action moves focus to another beat. */
  const getCode = useCallback(() => editorRef.current?.code, []);

  /** Drop a stale REPL error. The editor only clears its error on the next
   * evaluation, so adopting another beat while stopped would otherwise keep
   * showing the previous beat's parse failure as if it were this one's. */
  const clearError = useCallback(() => {
    setState((prev) => (prev.error === undefined ? prev : { started: prev.started }));
  }, []);

  /** Land a failure in the status bar error surface. Upstream catches
   * evaluation errors into its own state and reports them through
   * onUpdateState; this is for the ones that try to escape that net. */
  const report = useCallback((error: unknown) => {
    const resolved = error instanceof Error ? error : new Error(String(error));
    setState((prev) => (prev.error?.message === resolved.message ? prev : { started: prev.started, error: resolved }));
  }, []);

  /** Playback evaluation is asynchronous: a rejected promise here would die
   * as an unhandled rejection nobody sees. Every pattern failure must land
   * ONLY in the status bar error surface, so the wrappers catch what upstream
   * let through and report it like any other pattern error. */
  const toggle = useCallback(() => {
    void editorRef.current?.toggle().catch(report);
  }, [report]);

  const evaluate = useCallback(() => {
    void editorRef.current?.evaluate().catch(report);
  }, [report]);

  /** Re-run the pattern in place, so a change lands on the next cycle. */
  const reevaluate = useCallback(() => {
    if (state.started) {
      void editorRef.current?.evaluate().catch(report);
    }
  }, [report, state.started]);

  // Playback scheduling runs on timers this hook does not own. A pattern that
  // throws while being queried or triggered (a cycle after it evaluated fine)
  // is caught by the upstream scheduler, which logs it to the strudel.log
  // DOM event and moves on — so playback survives, but on a desktop shell the
  // failure would otherwise be invisible. Surface those errors here, deduped:
  // a broken pattern re-fires the same message on every cycle.
  useEffect(() => {
    const onLog = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; type?: string }>).detail;
      if (!detail || detail.type === 'error') {
        return; // Eval failures already surface through the editor's own state.
      }
      const match = /^\[(cyclist|getTrigger)\] error: (.+)$/.exec(detail.message ?? '');
      if (match) {
        report(new Error(match[2]!));
      }
    };
    document.addEventListener('strudel.log', onLog);
    return () => document.removeEventListener('strudel.log', onLog);
  }, [report]);

  /** Taking the tempo by hand, which then survives re-evaluation. */
  const changeCps = useCallback((next: number) => {
    const clamped = clampCps(next);
    chosenCps.current = clamped;
    setCps(clamped);
    editorRef.current?.repl.setCps(clamped);
  }, []);

  /** Hand the tempo back to whatever the beat asks for. */
  const releaseCps = useCallback(() => {
    chosenCps.current = undefined;
  }, []);

  return {
    containerRef,
    state,
    setCode,
    getCode,
    clearError,
    toggle,
    evaluate,
    reevaluate,
    cps,
    changeCps,
    releaseCps,
  };
}
