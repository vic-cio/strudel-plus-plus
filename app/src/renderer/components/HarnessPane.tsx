import { useCallback, useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { desktop } from '../desktop';
import type { HarnessDef } from '../../shared/harness';

type Props = {
  harnesses: HarnessDef[];
  active: string;
  onPick: (id: string) => void;
  beat: string | undefined;
};

/** Resolve once the element is actually laid out with a non-zero width. */
function waitForWidth(element: HTMLElement): Promise<void> {
  if (element.getBoundingClientRect().width > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const observer = new ResizeObserver(() => {
      if (element.getBoundingClientRect().width > 0) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(element);
  });
}

const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

/** Terminal colours are read from the CSS theme, so the pane matches the app. */
function themeFromCss(): Record<string, string> {
  const css = getComputedStyle(document.body);
  const read = (name: string) => css.getPropertyValue(name).trim();
  const ink = read('--ink');
  const soft = read('--ink-soft');
  const rust = read('--rust');
  const olive = read('--olive');
  const gold = read('--gold');
  return {
    background: read('--ground'),
    foreground: ink,
    cursor: gold,
    cursorAccent: read('--ground'),
    selectionBackground: read('--ground-raised'),
    black: read('--ground-sunk'),
    red: rust,
    green: olive,
    yellow: gold,
    blue: soft,
    magenta: rust,
    cyan: olive,
    white: ink,
    // A TUI paints most of its chrome in the bright range, so these have to stay
    // legible rather than fade. The dim end is only for genuinely dim text.
    brightBlack: read('--ink-faint'),
    brightRed: rust,
    brightGreen: olive,
    brightYellow: gold,
    brightBlue: read('--line-strong'),
    brightMagenta: rust,
    brightCyan: olive,
    brightWhite: ink,
  };
}

export function HarnessPane({ harnesses, active, onPick, beat }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal>(undefined);
  const fit = useRef<FitAddon>(undefined);
  const started = useRef(false);
  const opened = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  const focus = useCallback(() => term.current?.focus(), []);

  /** A failed start has to land in the pane: a swallowed rejection reads as an
   * empty terminal with no explanation, and the picker error surface is not
   * even mounted for the first, automatic start. */
  const showStartFailure = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    started.current = false;
    term.current?.writeln(`\r\n${DIM}[harness] ${message}${RESET}`);
  }, []);

  useEffect(() => {
    if (!mount.current || term.current) {
      return;
    }
    const terminal = new Terminal({
      fontFamily: getComputedStyle(document.body).fontFamily,
      fontSize: 11,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 10000,
      theme: themeFromCss(),
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    term.current = terminal;
    fit.current = fitAddon;

    terminal.onData((data) => desktop.harness.write(data));
    const offData = desktop.harness.onData((data) => terminal.write(data));
    const offExit = desktop.harness.onExit((code) => {
      started.current = false;
      terminal.writeln(`\r\n${DIM}[exited ${code}]${RESET}`);
    });

    const resize = () => {
      if (!started.current) {
        return;
      }
      fitAddon.fit();
      // A refresh after every fit. xterm sizes its render layers from the
      // element and does not always repaint the rows it already holds when
      // that size changes, which leaves a terminal full of text drawing
      // nothing at all.
      terminal.refresh(0, terminal.rows - 1);
      desktop.harness.resize(terminal.cols, terminal.rows);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount.current);

    // Open only once the element has a size and the fonts have settled. The
    // column count comes from the glyph width, so measuring before either is
    // true gets the wrong answer, and xterm keeps whatever it measured at open.
    // The harness has to wait for the same moment: a TUI reads the terminal
    // size at launch and lays its first frame out from it, so a resize that
    // arrives afterwards leaves it drawing at eighty columns.
    let cancelled = false;
    void document.fonts.ready.then(async () => {
      const element = mount.current;
      if (cancelled || !element) {
        return;
      }
      await waitForWidth(element);
      if (cancelled) {
        return;
      }
      terminal.open(element);
      fitAddon.fit();
      terminal.refresh(0, terminal.rows - 1);
      opened.current = true;
      started.current = true;
      desktop.harness.start(activeRef.current, terminal.cols, terminal.rows).catch(showStartFailure);
      terminal.focus();
    });

    return () => {
      cancelled = true;
      observer.disconnect();
      offData();
      offExit();
      terminal.dispose();
      opened.current = false;
      started.current = false;
      term.current = undefined;
    };
    // `active` is deliberately not a dependency. This effect builds the
    // terminal once; the effect below switches which harness runs inside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const terminal = term.current;
    if (!terminal || !opened.current) {
      return;
    }
    started.current = true;
    terminal.reset();
    fit.current?.fit();
    desktop.harness.start(active, terminal.cols, terminal.rows).catch(showStartFailure);
    terminal.focus();
    // showStartFailure is a stable callback; the effect re-runs only on a
    // harness switch.
  }, [active, showStartFailure]);

  return (
    <section className="pane">
      <header className="pane-title">
        <span>[ harness ]</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {beat && (
            <span className="beat-name" style={{ color: 'var(--ink-faint)', textTransform: 'none' }}>
              {beat}
            </span>
          )}
          <select className="harness-pick" value={active} onChange={(event) => onPick(event.target.value)}>
            {harnesses.map((harness) => (
              <option key={harness.id} value={harness.id}>
                {harness.label}
              </option>
            ))}
          </select>
        </span>
      </header>
      {/* Clicking anywhere in the pane puts the caret in the terminal. */}
      <div className="term-pad" onMouseDown={focus}>
        <div className="term" ref={mount} />
      </div>
    </section>
  );
}
