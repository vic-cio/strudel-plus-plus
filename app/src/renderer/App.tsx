import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ConflictBar } from './components/ConflictBar';
import { FileTree } from './components/FileTree';
import { Grip } from './components/Grip';
import { HarnessPane } from './components/HarnessPane';
import { PluginDock } from './components/PluginDock';
import { SessionPicker, type SessionSummary } from './components/SessionPicker';
import { StatusBar } from './components/StatusBar';
import { TempoBox } from './components/TempoBox';
import { desktop } from './desktop';
import { listPlugins } from './plugins';
import { APP_BUILT, readAudio, writeSnapshot } from './liveSnapshot';
import { onRendererError } from './reportErrors';
import { useStrudel } from './useStrudel';
import { normalizeBeatName } from '../shared/beatName';
import { DEFAULT_BEAT_SORT, moveBeat, sortBeats, type BeatSortMode, type BeatSummary } from '../shared/beatSorting';
import { nextCloneName } from '../shared/cloneName';
import { handoffClonedBeat } from '../shared/cloneHandoff';
import { STARTER_BEAT } from '../shared/starterBeat';
import { resolveDiskChange } from '../shared/sync';
import { clampCps, hasCodedTempo } from '../shared/tempo';
import { normalizeDockState, type DockState } from '../shared/dockState';
import type { BeatChange } from '../shared/ipc';
import type { HarnessDef } from '../shared/harness';

/** Pane widths survive a restart. A layout you set once should stay set. */
function usePaneWidth(key: string, fallback: number) {
  const [width, setWidth] = useState(() => {
    try {
      return Number(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, String(width));
    } catch {
      // A private window or blocked site data. The layout just will not persist.
    }
  }, [key, width]);
  return [width, setWidth] as const;
}

/** Dock height bounds. The floor keeps the tab strip plus a sliver of body
 *  visible; the ceiling is computed from the live window height so a tall
 *  dock can never starve the editor and harness rows above it. */
const DOCK_MIN = 56;
const DOCK_DEFAULT = 104;
/** Titlebar 34 + dock grip 5 + status bar 22, plus the least room the panes
 *  row keeps for the editor and the harness. */
const DOCK_CHROME = 34 + 5 + 22 + 160;

const dockMaxFor = (windowHeight: number) => Math.max(DOCK_MIN, windowHeight - DOCK_CHROME);

function sameOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

export function App() {
  const [root, setRoot] = useState('');
  const [beats, setBeats] = useState<BeatSummary[]>([]);
  const [beatSort, setBeatSort] = useState<BeatSortMode>(DEFAULT_BEAT_SORT);
  const [manualBeatOrder, setManualBeatOrder] = useState<string[]>([]);
  const [open, setOpen] = useState<string>();
  const [harnesses, setHarnesses] = useState<HarnessDef[]>([]);
  const [harness, setHarness] = useState('shell');
  const [conflict, setConflict] = useState<string>();
  const [beatError, setBeatError] = useState<string>();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<string>();
  const [picking, setPicking] = useState(true);
  const [buffer, setBuffer] = useState('');
  const [treeWidth, setTreeWidth] = usePaneWidth('pane.tree', 210);
  const [termWidth, setTermWidth] = usePaneWidth('pane.term', 460);
  const [treeOpen, setTreeOpen] = usePaneWidth('pane.treeOpen', 1);
  const [termOpen, setTermOpen] = usePaneWidth('pane.termOpen', 1);
  // Dock height: same restart-surviving preference as the pane widths. The
  // clamp is applied against the live window height, not a fixed guess.
  const [dockHeight, setDockHeight] = usePaneWidth('pane.dock', DOCK_DEFAULT);
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight);
  const [cpsByBeat, setCpsByBeat] = useState<Record<string, number>>({});
  // Plugin dock layout: which devices are open, how the dock is split, and
  // each device's own faders. Session-scoped like the tempo map — switching
  // beats must not close the mixer.
  const [dock, setDock] = useState<DockState>({ split: false, panes: [{ tabs: [] }] });

  // The last content this app wrote to disk. Everything the sync rule decides
  // hangs off it, so it is a ref: it must be current inside the watcher
  // callback, not one render behind.
  const savedRef = useRef('');
  const bufferRef = useRef('');
  const openRef = useRef<string>(undefined);
  const beatsRef = useRef<BeatSummary[]>([]);
  const beatSortRef = useRef<BeatSortMode>(DEFAULT_BEAT_SORT);
  const manualBeatOrderRef = useRef<string[]>([]);
  openRef.current = open;

  const onCodeChange = useCallback((code: string) => {
    bufferRef.current = code;
    setBuffer(code);
  }, []);

  const { containerRef, state, setCode, clearError, toggle, cps, changeCps, releaseCps, reevaluate } =
    useStrudel(onCodeChange);
  const sessionRef = useRef<string>(undefined);
  sessionRef.current = session;

  /**
   * The EDIT buffer's beat changed — record it now, at the event.
   *
   * The pointer must mirror the buffer the moment it moves, so the events
   * that move the buffer call this directly instead of leaving the write to
   * a render effect: a render can be skipped (same-state bailouts) or run
   * while the open beat still belongs to the previous session, and either
   * one leaves .session.json pointing at a beat the human stopped looking
   * at long ago — exactly what a harness then reads and edits. An explicit
   * null records that nothing is open.
   */
  const persistBeat = useCallback((name: string | null) => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    void desktop.sessions.setState(session, { beat: name });
  }, []);
  const cpsRef = useRef(cps);
  cpsRef.current = cps;
  const cpsByBeatRef = useRef(cpsByBeat);
  cpsByBeatRef.current = cpsByBeat;
  const dirty = Boolean(open) && buffer !== savedRef.current;
  const codedTempo = hasCodedTempo(buffer);

  const applyBeatTempo = useCallback(
    (name: string, content: string) => {
      if (hasCodedTempo(content)) {
        releaseCps();
        return;
      }
      const remembered = cpsByBeatRef.current[name] ?? cpsRef.current;
      if (cpsByBeatRef.current[name] === undefined) {
        const next = { ...cpsByBeatRef.current, [name]: remembered };
        cpsByBeatRef.current = next;
        setCpsByBeat(next);
      }
      changeCps(remembered);
    },
    [changeCps, releaseCps],
  );

  const adopt = useCallback(
    (name: string, content: string) => {
      savedRef.current = content;
      bufferRef.current = content;
      setBuffer(content);
      setOpen(name);
      setCode(content);
      setConflict(undefined);
      // The previous beat's parse failure says nothing about this one. A
      // stale "[mini] parse error" that survives an adopt reads as if the
      // new beat is broken too.
      clearError();
      applyBeatTempo(name, content);
      persistBeat(name);
    },
    [applyBeatTempo, clearError, persistBeat, setCode],
  );

  /** Report what went wrong instead of dropping it on the floor. */
  const attempt = useCallback(async (action: () => Promise<void>) => {
    try {
      setBeatError(undefined);
      await action();
    } catch (error) {
      setBeatError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const refresh = useCallback(async () => {
    const list = await desktop.beats.listInfo();
    beatsRef.current = list;
    setBeats(list);
    if (beatSortRef.current === 'manual') {
      const completeOrder = sortBeats(list, 'manual', manualBeatOrderRef.current).map((beat) => beat.name);
      if (!sameOrder(completeOrder, manualBeatOrderRef.current)) {
        manualBeatOrderRef.current = completeOrder;
        setManualBeatOrder(completeOrder);
      }
    }
    return list;
  }, []);

  useEffect(() => {
    void (async () => {
      setRoot(await desktop.sessions.root());
      setSessions(await desktop.sessions.list());
      const available = await desktop.harness.list();
      setHarnesses(available);
      setHarness(available[0]?.id ?? 'shell');
    })();
  }, []);

  /** Open a session: point the app at its folder and restore where it was left. */
  const openSession = useCallback(
    (name: string, make = false) =>
      attempt(async () => {
        await (make ? desktop.sessions.create(name) : desktop.sessions.open(name));
        const saved = await desktop.sessions.state(name);
        const list = await refresh();
        // Resolve everything the open needs — including the restored beat's
        // content — before touching any state. A failure up to here leaves
        // the previous session exactly as it was, with the picker showing
        // what went wrong.
        const restoredSort = saved.beatSort ?? DEFAULT_BEAT_SORT;
        const restoredManualOrder = saved.manualBeatOrder ?? [];
        const restoredCps = saved.cpsByBeat ?? {};
        const restoredDock = normalizeDockState(
          saved.dock,
          listPlugins().map((plugin) => plugin.id),
        );
        const beat = saved.beat && list.some((item) => item.name === saved.beat) ? saved.beat : list[0]?.name;
        const content = beat ? await desktop.beats.read(beat) : undefined;

        // From here the open is synchronous: the app flips to the new session
        // in one render with no await in between. The previous code set a
        // hydration flag across awaits, and a failure in that window blocked
        // session-state writes for the rest of the run — freezing the
        // persisted beat on whatever an earlier open had written, which the
        // harness then read and edited. No await, no window.
        beatSortRef.current = restoredSort;
        manualBeatOrderRef.current = restoredManualOrder;
        cpsByBeatRef.current = restoredCps;
        setBeatSort(restoredSort);
        setManualBeatOrder(restoredManualOrder);
        setCpsByBeat(restoredCps);
        setDock(restoredDock);
        setSession(name);
        sessionRef.current = name;
        setPicking(false);
        // The picker's recency counts are cosmetic; a failure refreshing
        // them must not undo the open.
        try {
          setSessions(await desktop.sessions.list());
        } catch {
          // Keep the list the picker already had.
        }

        if (beat && content !== undefined) {
          adopt(beat, content);
        } else {
          setOpen(undefined);
          openRef.current = undefined;
          // Nothing is open; say so, rather than leaving a beat name behind
          // that no longer resolves to a file on disk.
          persistBeat(null);
        }
      }),
    [adopt, attempt, persistBeat, refresh],
  );

  // Remember tempo, sort, and the plugin dock with the session, so reopening
  // restores them. The beat pointer is deliberately not written here: it is
  // persisted by the events that move the buffer (adopt, rename, remove),
  // because a render scheduled by a tempo or sort change must never write a
  // beat that belongs to another moment.
  useEffect(() => {
    if (!sessionRef.current) {
      return;
    }
    void desktop.sessions.setState(sessionRef.current, {
      cpsByBeat,
      beatSort,
      manualBeatOrder,
      dock,
    });
  }, [cpsByBeat, beatSort, manualBeatOrder, dock]);

  const changeSort = useCallback((mode: BeatSortMode) => {
    if (mode === 'manual') {
      const completeOrder = sortBeats(beatsRef.current, 'manual', manualBeatOrderRef.current).map((beat) => beat.name);
      manualBeatOrderRef.current = completeOrder;
      setManualBeatOrder(completeOrder);
    }
    beatSortRef.current = mode;
    setBeatSort(mode);
  }, []);

  const reorder = useCallback((from: string, to: string, position: 'before' | 'after' = 'before') => {
    const currentOrder = sortBeats(beatsRef.current, 'manual', manualBeatOrderRef.current).map((beat) => beat.name);
    const nextOrder = moveBeat({ order: currentOrder, from, to, position });
    manualBeatOrderRef.current = nextOrder;
    setManualBeatOrder(nextOrder);
  }, []);

  const changeTempo = useCallback(
    (next: number) => {
      if (codedTempo) {
        return;
      }
      const clamped = clampCps(next);
      changeCps(clamped);
      if (!openRef.current) {
        return;
      }
      const nextByBeat = { ...cpsByBeatRef.current, [openRef.current]: clamped };
      cpsByBeatRef.current = nextByBeat;
      setCpsByBeat(nextByBeat);
    },
    [changeCps, codedTempo],
  );

  const previousCodedTempo = useRef(false);
  useEffect(() => {
    if (open && previousCodedTempo.current && !codedTempo) {
      changeCps(cpsByBeatRef.current[open] ?? cpsRef.current);
    } else if (codedTempo && !previousCodedTempo.current) {
      releaseCps();
    }
    previousCodedTempo.current = codedTempo;
  }, [codedTempo, changeCps, open, releaseCps]);

  const openBeat = useCallback(
    async (name: string) => {
      adopt(name, await desktop.beats.read(name));
      // Re-evaluating swaps the pattern in place. The scheduler keeps counting,
      // so the new beat lands on the next cycle boundary and the bar holds.
      reevaluate();
    },
    [adopt, reevaluate],
  );

  /** Clone a beat and move to the copy, without interrupting the sound. */
  const cloneBeat = useCallback(
    (requestedName?: string) =>
      attempt(async () => {
        const source = requestedName ?? openRef.current;
        if (!source) {
          return;
        }
        // The draft map is a later task. Until it exists, the focused row is
        // the only row with live in-memory content; every other row is cloned
        // from disk explicitly rather than accidentally from the open buffer.
        const content = source === openRef.current ? bufferRef.current : await desktop.beats.read(source);
        const name = nextCloneName(source, await desktop.beats.list());
        await desktop.beats.create(name, content);
        await refresh();
        // The code is unchanged. When audio is already active, reevaluation
        // hands the scheduler over to the clone without restarting the sound.
        handoffClonedBeat({
          playing: state.started,
          activate: () => adopt(name, content),
          reevaluate,
        });
      }),
    [adopt, attempt, reevaluate, refresh, state.started],
  );

  const save = useCallback(async () => {
    if (!openRef.current) {
      return;
    }
    const content = bufferRef.current;
    await desktop.beats.write(openRef.current, content);
    savedRef.current = content;
    setBuffer(content);
  }, []);

  // Global renderer failures (an effect that threw, an IPC that rejected) are
  // already logged to the main process; surfacing them here keeps a failure a
  // person can act on from being invisible in a desktop shell.
  useEffect(() => {
    return onRendererError((message) => setBeatError(message));
  }, []);

  // Disk changes. The rule in shared/sync.ts decides; this only carries it out.
  // The whole handler is guarded: a beat file an agent wrote can be anything,
  // and a throw here would die as an unhandled rejection — invisible unless a
  // terminal happens to be watching — instead of landing in the error surface.
  const applyDiskChange = useCallback(
    async (change: BeatChange) => {
      void refresh();
      if (change.name !== openRef.current || change.event === 'unlink') {
        return;
      }
      const diskContent = await desktop.beats.read(change.name);
      const decision = resolveDiskChange({
        diskContent,
        bufferContent: bufferRef.current,
        lastSavedContent: savedRef.current,
      });
      if (decision.kind === 'noop') {
        savedRef.current = diskContent;
        return;
      }
      if (decision.kind === 'apply') {
        savedRef.current = decision.content;
        bufferRef.current = decision.content;
        setBuffer(decision.content);
        // A pattern that fails to parse must surface in the status bar (the
        // editor's own error state) and never take the app down; setCode and
        // reevaluate are no more trusted than the pattern itself.
        try {
          setCode(decision.content);
          // While playing the re-evaluation below refreshes the REPL's error
          // state on its own; stopped, nothing ever would, so drop any stale
          // accusation from the previous content here.
          clearError();
          reevaluate();
        } catch (error) {
          setBeatError(error instanceof Error ? error.message : String(error));
        }
        return;
      }
      setConflict(decision.diskContent);
    },
    [clearError, reevaluate, refresh, setCode],
  );

  useEffect(() => {
    return desktop.beats.onChange(async (change) => {
      try {
        await applyDiskChange(change);
      } catch (error) {
        setBeatError(error instanceof Error ? error.message : String(error));
      }
    });
  }, [applyDiskChange]);

  const takeTheirs = useCallback(() => {
    if (conflict === undefined || !openRef.current) {
      return;
    }
    adopt(openRef.current, conflict);
    reevaluate();
  }, [adopt, conflict, reevaluate]);

  const keepMine = useCallback(() => {
    setConflict(undefined);
    void save();
  }, [save]);

  const create = useCallback(
    (raw: string) =>
      attempt(async () => {
        const file = normalizeBeatName(raw);
        await desktop.beats.create(file, STARTER_BEAT);
        await refresh();
        adopt(file, STARTER_BEAT);
      }),
    [adopt, attempt, refresh],
  );

  const rename = useCallback(
    (from: string, raw: string) =>
      attempt(async () => {
        const file = normalizeBeatName(raw);
        const currentOrder = sortBeats(beatsRef.current, 'manual', manualBeatOrderRef.current).map((beat) => beat.name);
        await desktop.beats.rename(from, file);
        const renamedOrder = currentOrder.map((name) => (name === from ? file : name));
        manualBeatOrderRef.current = renamedOrder;
        setManualBeatOrder(renamedOrder);
        await refresh();
        if (from === openRef.current) {
          setOpen(file);
          openRef.current = file;
          persistBeat(file);
        }
      }),
    [attempt, persistBeat, refresh],
  );

  const remove = useCallback(
    (name: string) =>
      attempt(async () => {
        const wasOpen = name === openRef.current;
        await desktop.beats.remove(name);
        const list = await refresh();
        if (!wasOpen) {
          return;
        }
        const next = list[0]?.name;
        if (next) {
          adopt(next, await desktop.beats.read(next));
        } else {
          setOpen(undefined);
          openRef.current = undefined;
          persistBeat(null);
        }
      }),
    [adopt, attempt, persistBeat, refresh],
  );

  // The snapshot is how a harness sees the live buffer and the meters. The
  // file on disk only holds the last save, so without this the agent reasons
  // about older code than is on screen. Faster while playing, because that is
  // when the meters mean anything.
  useEffect(() => {
    const publish = () =>
      writeSnapshot({
        appBuilt: APP_BUILT,
        beat: openRef.current,
        unsavedEdits: bufferRef.current !== savedRef.current,
        playing: state.started,
        cps,
        updated: new Date().toISOString(),
        buffer: bufferRef.current,
        audio: readAudio(),
      });
    publish();
    const timer = window.setInterval(publish, state.started ? 500 : 2000);
    return () => window.clearInterval(timer);
  }, [state.started, cps, buffer, open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === 's') {
        event.preventDefault();
        void save();
      }
      if (event.ctrlKey && event.key === '.') {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, toggle]);

  // The dock clamp follows the Electron window as it is resized.
  useEffect(() => {
    const onResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // A stored height that no longer fits the current window is clamped at
  // view time; the stored preference itself is left alone, so enlarging the
  // window brings the captain's chosen height back.
  const dockMax = dockMaxFor(windowHeight);
  const dockH = Math.min(Math.max(dockHeight, DOCK_MIN), dockMax);
  const onDockHeightChange = useCallback(
    (next: number) => {
      if (next !== dockH) {
        setDockHeight(next);
      }
    },
    [dockH, setDockHeight],
  );

  if (picking) {
    return (
      <SessionPicker
        sessions={sessions}
        root={root}
        error={beatError}
        onOpen={(name) => void openSession(name)}
        onCreate={(name) => void openSession(name, true)}
        onCancel={session ? () => setPicking(false) : undefined}
      />
    );
  }

  return (
    <div className="app" style={{ '--dock-h': `${dockH}px` } as CSSProperties}>
      <header className="titlebar">
        <button
          className="collapse"
          onClick={() => setTreeOpen(treeOpen ? 0 : 1)}
          title={treeOpen ? 'Hide beats' : 'Show beats'}
        >
          {treeOpen ? '[<]' : '[>]'}
        </button>
        <button className="collapse" onClick={() => setPicking(true)} title="Switch session">
          {session ?? 'sessions'}
        </button>
        <span className="beat">
          <b>{open?.replace(/\.js$/, '') ?? 'no beat'}</b>
          {dirty ? ' *' : ''}
        </span>
        <span className="transport">
          <button onClick={toggle}>{state.started ? '■ stop' : '▶ play'}</button>
          <button onClick={() => void save()} disabled={!dirty}>
            save
          </button>
          <button onClick={() => void cloneBeat()} disabled={!open} title="Clone this beat and switch to it">
            clone
          </button>
          <button onClick={() => changeTempo(cps - 0.05)} title="Slower" disabled={codedTempo}>
            −
          </button>
          <TempoBox cps={cps} coded={codedTempo} onChange={changeTempo} />
          <button onClick={() => changeTempo(cps + 0.05)} title="Faster" disabled={codedTempo}>
            +
          </button>
        </span>
        <span className="transport right">
          <button
            className="collapse"
            onClick={() => setTermOpen(termOpen ? 0 : 1)}
            title={termOpen ? 'Hide harness' : 'Show harness'}
          >
            {termOpen ? '[>]' : '[<]'}
          </button>
        </span>
      </header>

      <div
        className="panes"
        style={
          {
            '--tree-w': treeOpen ? `${treeWidth}px` : '0px',
            '--grip-w': treeOpen ? '5px' : '0px',
            '--term-w': termOpen ? `${termWidth}px` : '0px',
            '--term-grip-w': termOpen ? '5px' : '0px',
          } as CSSProperties
        }
      >
        {treeOpen ? (
          <FileTree
            beats={beats}
            open={open}
            dirty={dirty}
            error={beatError}
            onOpen={(name) => void openBeat(name)}
            onCreate={(name) => void create(name)}
            onRename={(from, to) => void rename(from, to)}
            onRemove={(name) => void remove(name)}
            onClone={(name) => void cloneBeat(name)}
            sortMode={beatSort}
            manualOrder={manualBeatOrder}
            onSortChange={changeSort}
            onReorder={reorder}
            onDismissError={() => setBeatError(undefined)}
          />
        ) : (
          <div />
        )}

        {/* 210px is where the pane header stops fitting its own title. */}
        <Grip
          size={treeWidth}
          onChange={setTreeWidth}
          side="left"
          min={210}
          max={560}
          resetTo={210}
          label="Resize beats pane"
        />

        <section className="pane">
          <header className="pane-title">
            <span>[ edit ]</span>
            <span style={{ textTransform: 'none', color: 'var(--ink-faint)' }}>⌘S save · ⌃. play</span>
          </header>
          {conflict !== undefined && <ConflictBar onTakeTheirs={takeTheirs} onKeepMine={keepMine} />}
          <div className="pane-body editor" ref={containerRef} />
        </section>

        <Grip
          size={termWidth}
          onChange={setTermWidth}
          side="right"
          min={260}
          max={1000}
          resetTo={460}
          label="Resize harness pane"
        />

        {harnesses.length > 0 && <HarnessPane harnesses={harnesses} active={harness} onPick={setHarness} beat={open} />}
      </div>

      {/* The dock's height is the grid's --dock-h row; this grip drags it. */}
      <Grip
        orientation="horizontal"
        size={dockH}
        onChange={onDockHeightChange}
        side="below"
        min={DOCK_MIN}
        max={dockMax}
        resetTo={DOCK_DEFAULT}
        label="Resize plugin dock"
      />

      <PluginDock dock={dock} onChange={setDock} playing={state.started} />

      <StatusBar
        root={root}
        beat={open}
        dirty={dirty}
        playing={state.started}
        cps={cps}
        harness={harness}
        error={state.error?.message}
      />
    </div>
  );
}
