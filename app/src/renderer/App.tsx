import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { CloseDialog, type CloseFailure } from './components/CloseDialog';
import { ConflictBar } from './components/ConflictBar';
import { EditorContextMenu, type EditorMenuState } from './components/EditorContextMenu';
import { FileTree, type FileTreeDraft, type FileTreeDraftAction } from './components/FileTree';
import { Grip } from './components/Grip';
import { HarnessPane } from './components/HarnessPane';
import { PluginDock } from './components/PluginDock';
import { RecordControl, type RecordEvent } from './components/RecordControl';
import { SessionPicker, type SessionSummary } from './components/SessionPicker';
import { StatusBar } from './components/StatusBar';
import { TempoBox } from './components/TempoBox';
import { SettingsPage } from './SettingsPage';
import { desktop } from './desktop';
import { collectUnpolledDrafts, saveAllDrafts } from './closeCoordinator';
import {
  acceptDisk,
  activateBeat as restoreBeat,
  hasDirtyDrafts,
  isBeatDirty,
  markConflict,
  observeDisk,
  recordDraft,
  removeBeat,
  renameBeat,
  saveBeat,
  seedBeat,
  type DraftState,
} from './draftState';
import {
  applyFunctionPluginValue,
  createFunctionPluginInstance,
  getPlugin,
  listFunctionPlugins,
  listSessionPlugins,
  resolveFunctionPluginTarget,
  type FunctionPluginInstance,
  type FunctionPluginTarget,
} from './plugins';
import { APP_BUILT, readAudio, writeSnapshot } from './liveSnapshot';
import { onRendererError } from './reportErrors';
import { useStrudel } from './useStrudel';
import { normalizeBeatName } from '../shared/beatName';
import { DEFAULT_BEAT_SORT, moveBeat, sortBeats, type BeatSortMode, type BeatSummary } from '../shared/beatSorting';
import { DEFAULT_SETTINGS, type BeatSwitchTiming, type Settings } from '../shared/settings';
import { recordingFailureMessage, type RecordingMode } from '../shared/recording';
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
  const [beatError, setBeatError] = useState<string>();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<string>();
  const [picking, setPicking] = useState(true);
  const [buffer, setBuffer] = useState('');
  const [treeDraft, setTreeDraft] = useState<FileTreeDraft>();
  const [treeWidth, setTreeWidth] = usePaneWidth('pane.tree', 210);
  const [termWidth, setTermWidth] = usePaneWidth('pane.term', 460);
  const [treeOpen, setTreeOpen] = usePaneWidth('pane.treeOpen', 1);
  const [termOpen, setTermOpen] = usePaneWidth('pane.termOpen', 1);
  // Dock height: same restart-surviving preference as the pane widths. The
  // clamp is applied against the live window height, not a fixed guess.
  const [dockHeight, setDockHeight] = usePaneWidth('pane.dock', DOCK_DEFAULT);
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight);

  // The close decision, as the app's own dialog. `closeAsk` holds the panel
  // state (a failed save-all keeps it open with the failures listed);
  // `closeSaving` is the busy flag while writes are in flight.
  const [closeAsk, setCloseAsk] = useState<{ failures: CloseFailure[] } | undefined>(undefined);
  const [closeSaving, setCloseSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [cpsByBeat, setCpsByBeat] = useState<Record<string, number>>({});
  const [draftState, setDraftState] = useState<DraftState>({});
  // Plugin dock layout: which devices are open, how the dock is split, and
  // each device's own faders. Session-scoped like the tempo map — switching
  // beats must not close the mixer.
  const [dock, setDock] = useState<DockState>({ split: false, panes: [{ tabs: [] }] });
  // The app-level overlay every floating plugin panel lives in: one
  // coordinate space spanning the whole app surface (beats sidebar, editor,
  // harness, dock), so panels drag across panes instead of being clamped
  // inside the editor viewport.
  const [appOverlay, setAppOverlay] = useState<HTMLDivElement | null>(null);
  const [editorViewport, setEditorViewport] = useState<HTMLDivElement | null>(null);
  const [editorMenu, setEditorMenu] = useState<{
    menu: EditorMenuState;
    target?: FunctionPluginTarget;
  }>();
  const [functionPlugins, setFunctionPlugins] = useState<FunctionPluginInstance[]>([]);
  const [beatSwitchTiming, setBeatSwitchTiming] = useState<BeatSwitchTiming>(
    DEFAULT_SETTINGS.beatSwitchTiming as BeatSwitchTiming,
  );
  const [recordMode, setRecordMode] = useState<RecordingMode>('audio');
  const [closeBehavior, setCloseBehavior] = useState(DEFAULT_SETTINGS.closeBehavior);

  useEffect(() => {
    desktop.settings.load().then((s) => {
      if (s.beatSwitchTiming) setBeatSwitchTiming(s.beatSwitchTiming);
      if (s.recordConfig?.mode) setRecordMode(s.recordConfig.mode);
      if (s.closeBehavior) setCloseBehavior(s.closeBehavior);
    });
  }, []);

  const bufferRef = useRef('');
  const openRef = useRef<string>(undefined);
  const draftStateRef = useRef<DraftState>({});
  const functionPluginsRef = useRef<FunctionPluginInstance[]>([]);
  const pendingRenameRef = useRef<{ from: string; to: string } | undefined>(undefined);
  const beatActivationRef = useRef(0);
  const diskChangeVersionRef = useRef(new Map<string, number>());
  const beatsRef = useRef<BeatSummary[]>([]);
  const beatSortRef = useRef<BeatSortMode>(DEFAULT_BEAT_SORT);
  const manualBeatOrderRef = useRef<string[]>([]);
  const treeDraftRef = useRef<FileTreeDraft | undefined>(undefined);
  const pickingRef = useRef(picking);
  const sessionRef = useRef<string>(undefined);
  // Close lifecycle: once the user's choice has let a close through, the
  // interception must stand down for that close (window.close() re-enters
  // beforeunload); `closeBusyRef` keeps a second close attempt from starting
  // a second save-all while one is already settling.
  const closeConfirmedRef = useRef(false);
  const closeBusyRef = useRef(false);
  const closeBehaviorRef = useRef(closeBehavior);
  openRef.current = open;
  pickingRef.current = picking;
  treeDraftRef.current = treeDraft;
  sessionRef.current = session;
  closeBehaviorRef.current = closeBehavior;

  /** Settings saved from the Settings page, applied to every live surface at once. */
  const applySettings = useCallback((next: Settings) => {
    if (next.beatSwitchTiming) {
      setBeatSwitchTiming(next.beatSwitchTiming);
    }
    if (next.recordConfig?.mode) {
      setRecordMode(next.recordConfig.mode);
    }
    if (next.closeBehavior) {
      setCloseBehavior(next.closeBehavior);
    }
  }, []);

  const updateTreeDraft = useCallback((next: FileTreeDraft | undefined) => {
    treeDraftRef.current = next;
    setTreeDraft(next);
  }, []);

  const beginTreeDraft = useCallback(
    (next: FileTreeDraftAction) => {
      setTreeOpen(1);
      setBeatError(undefined);
      switch (next.kind) {
        case 'create':
          updateTreeDraft({ kind: 'create', value: '' });
          return;
        case 'rename':
          updateTreeDraft({ kind: 'rename', from: next.from, value: next.from.replace(/\.js$/, '') });
          return;
        case 'confirm-delete':
          updateTreeDraft(next);
          return;
        default: {
          const _exhaustive: never = next;
          return _exhaustive;
        }
      }
    },
    [setTreeOpen, updateTreeDraft],
  );

  const updateDraftState = useCallback((next: DraftState) => {
    if (next === draftStateRef.current) {
      return;
    }
    draftStateRef.current = next;
    setDraftState(next);
  }, []);

  const onCodeChange = useCallback(
    (code: string) => {
      bufferRef.current = code;
      setBuffer(code);
      const sessionName = sessionRef.current;
      const beatName = openRef.current;
      if (sessionName && beatName) {
        updateDraftState(recordDraft(draftStateRef.current, sessionName, beatName, code));
      }
    },
    [updateDraftState],
  );

  const {
    containerRef,
    state,
    playbackSource,
    setPlaybackSource,
    setCode,
    getCode,
    tokenAt,
    clearError,
    toggle,
    cps,
    changeCps,
    releaseCps,
    reevaluate,
  } = useStrudel(onCodeChange);
  const sessionOperationTail = useRef<Promise<void>>(Promise.resolve());
  const queueSessionOperation = useCallback((operation: () => Promise<void>): Promise<void> => {
    const current = sessionOperationTail.current.then(operation, operation);
    sessionOperationTail.current = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }, []);

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
  const dirtyByBeat: Record<string, boolean> = {};
  for (const beat of beats) {
    dirtyByBeat[beat.name] = session !== undefined && isBeatDirty(draftState, session, beat.name);
  }
  const dirty = Boolean(session && open && isBeatDirty(draftState, session, open));
  const conflict = session && open ? draftState[session]?.conflicts[open] : undefined;
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

  const showBeat = useCallback(
    (name: string, content: string) => {
      beatActivationRef.current += 1;
      if (openRef.current !== name) {
        functionPluginsRef.current = [];
        setFunctionPlugins([]);
      }
      setEditorMenu(undefined);
      bufferRef.current = content;
      setBuffer(content);
      openRef.current = name;
      setOpen(name);
      setCode(content);
      // The previous beat's parse failure says nothing about this one. A
      // stale "[mini] parse error" that survives an adopt reads as if the
      // new beat is broken too.
      clearError();
      applyBeatTempo(name, content);
      persistBeat(name);
    },
    [applyBeatTempo, clearError, persistBeat, setCode],
  );

  /** Activate a beat without losing its renderer-only draft. */
  const activate = useCallback(
    (name: string, diskContent: string) => {
      const sessionName = sessionRef.current;
      if (!sessionName) {
        return;
      }
      const result = restoreBeat(draftStateRef.current, sessionName, name, diskContent);
      updateDraftState(result.state);
      showBeat(name, result.content);
    },
    [showBeat, updateDraftState],
  );

  /** Explicitly adopt content, discarding only this beat's draft. */
  const adopt = useCallback(
    (name: string, content: string) => {
      const sessionName = sessionRef.current;
      if (!sessionName) {
        return;
      }
      updateDraftState(acceptDisk(draftStateRef.current, sessionName, name, content));
      showBeat(name, content);
    },
    [showBeat, updateDraftState],
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

  const applyBeatList = useCallback((list: BeatSummary[]) => {
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

  const refresh = useCallback(async () => applyBeatList(await desktop.beats.listInfo()), [applyBeatList]);

  useEffect(() => {
    void (async () => {
      setRoot(await desktop.sessions.root());
      setSessions(await desktop.sessions.list());
      const available = await desktop.harness.list();
      setHarnesses(available);
      setHarness(available[0]?.id ?? 'shell');
    })();
  }, []);

  /** Capture the last editor value before an action moves focus elsewhere. */
  const captureCurrentDraft = useCallback((): string | undefined => {
    const sessionName = sessionRef.current;
    const beatName = openRef.current;
    if (!sessionName || !beatName) {
      return undefined;
    }
    const content = getCode() ?? bufferRef.current;
    bufferRef.current = content;
    setBuffer(content);
    updateDraftState(recordDraft(draftStateRef.current, sessionName, beatName, content));
    return content;
  }, [getCode, updateDraftState]);

  /** Open a session: point the app at its folder and restore where it was left. */
  const openSession = useCallback(
    (name: string, make = false) => {
      beatActivationRef.current += 1;
      functionPluginsRef.current = [];
      setFunctionPlugins([]);
      setEditorMenu(undefined);
      captureCurrentDraft();
      const previousSession = sessionRef.current;
      let mainSessionOpened = false;
      return queueSessionOperation(() =>
        attempt(async () => {
          try {
            const opened = await (make ? desktop.sessions.create(name) : desktop.sessions.open(name));
            mainSessionOpened = true;
            const saved = opened.state;
            const list = opened.beats;
            applyBeatList(list);
            // Read beats independently. A harness can delete or temporarily
            // lock one file between listInfo and read; that beat should not make
            // the whole session unopenable. Successful reads still reconcile
            // their baselines, while failed reads remain visible as an error.
            const restoredSort = saved.beatSort ?? DEFAULT_BEAT_SORT;
            const restoredManualOrder = saved.manualBeatOrder ?? [];
            const restoredCps = saved.cpsByBeat ?? {};
            const restoredDock = normalizeDockState(
              saved.dock,
              listSessionPlugins().map((plugin) => plugin.id),
            );
            const preferredBeat = opened.beat;
            const reads = await Promise.allSettled(
              list.map(async (item) => {
                if (item.name === opened.beat && opened.content !== undefined) {
                  return { name: item.name, content: opened.content };
                }
                return { name: item.name, content: await desktop.beats.read(item.name) };
              }),
            );
            const contents = reads.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
            const failedReads = reads.flatMap((result, index) =>
              result.status === 'rejected'
                ? [{ name: list[index]?.name ?? 'unknown beat', reason: result.reason }]
                : [],
            );
            const beat =
              (preferredBeat && contents.some((item) => item.name === preferredBeat) ? preferredBeat : undefined) ??
              contents[0]?.name;
            const contentByBeat = new Map(contents.map((item) => [item.name, item.content]));
            const content = beat ? contentByBeat.get(beat) : undefined;

            let latestSessions: SessionSummary[] | undefined;
            try {
              latestSessions = await desktop.sessions.list();
            } catch {
              // Keep the list the picker already had.
            }

            let nextDraftState = draftStateRef.current;
            for (const item of contents) {
              const current = nextDraftState[name];
              const savedContent = current?.saved[item.name];
              const draftContent = current?.drafts[item.name];
              if (savedContent === undefined) {
                nextDraftState = seedBeat(nextDraftState, name, item.name, item.content);
                continue;
              }
              const decision = resolveDiskChange({
                diskContent: item.content,
                bufferContent: draftContent ?? savedContent,
                lastSavedContent: savedContent,
              });
              if (decision.kind === 'noop') {
                nextDraftState = observeDisk(nextDraftState, name, item.name, item.content);
              } else if (decision.kind === 'apply') {
                nextDraftState = acceptDisk(nextDraftState, name, item.name, decision.content);
              } else {
                nextDraftState = markConflict(nextDraftState, name, item.name, decision.diskContent);
              }
            }

            // From here the open is synchronous: the app flips to the new session
            // in one render with no await in between. The previous code set a
            // hydration flag across awaits, and a failure in that window blocked
            // session-state writes for the rest of the run, freezing the
            // persisted beat on whatever an earlier open had written.
            beatSortRef.current = restoredSort;
            manualBeatOrderRef.current = restoredManualOrder;
            cpsByBeatRef.current = restoredCps;
            setBeatSort(restoredSort);
            setManualBeatOrder(restoredManualOrder);
            setCpsByBeat(restoredCps);
            setDock(restoredDock);
            setSession(name);
            sessionRef.current = name;
            updateDraftState(nextDraftState);
            updateTreeDraft(undefined);
            setPicking(false);
            if (latestSessions) {
              setSessions(latestSessions);
            }

            if (failedReads.length > 0) {
              setBeatError(
                `Could not load ${failedReads.map(({ name }) => name).join(', ')}. The rest of the session is available.`,
              );
            }

            if (beat && content !== undefined) {
              activate(beat, content);
            } else {
              setOpen(undefined);
              openRef.current = undefined;
              bufferRef.current = '';
              setBuffer('');
              setCode('');
              clearError();
              // Nothing is open; say so, rather than leaving a beat name behind
              // that no longer resolves to a file on disk.
              persistBeat(null);
            }
          } catch (error) {
            if (mainSessionOpened && previousSession !== undefined) {
              await desktop.sessions.open(previousSession);
            }
            throw error;
          }
        }),
      );
    },
    [
      activate,
      applyBeatList,
      attempt,
      captureCurrentDraft,
      clearError,
      persistBeat,
      queueSessionOperation,
      setCode,
      updateDraftState,
      updateTreeDraft,
    ],
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
    (name: string) =>
      queueSessionOperation(() =>
        attempt(async () => {
          const activation = beatActivationRef.current + 1;
          beatActivationRef.current = activation;
          captureCurrentDraft();
          const content = await desktop.beats.read(name);
          if (activation !== beatActivationRef.current || !beatsRef.current.some((beat) => beat.name === name)) {
            return;
          }
          activate(name, content);
          // Scheduling: respect the latency setting against the live transport.
          if (beatSwitchTiming === 'manual') {
            // Manual: user must trigger evaluation explicitly; do not auto-reevaluate.
            return;
          }
          if (beatSwitchTiming === 'immediate') {
            reevaluate();
            return;
          }
          // Next half-bar / next bar: delay adoption against the live transport
          // cycle (based on current cps) so the switch lands on a boundary.
          const cycleMs = cps > 0 ? 1000 / cps : 500;
          const delayMs = beatSwitchTiming === 'next-half-bar' ? Math.round(cycleMs / 2) : Math.round(cycleMs);
          const timer = window.setTimeout(() => {
            reevaluate();
          }, delayMs);
          // Clean up a superseded timer so only the latest adoption fires.
          const prevTimer = (window as unknown as Record<string, unknown>).__strudelLatencyTimer as number | undefined;
          if (prevTimer !== undefined) {
            window.clearTimeout(prevTimer);
          }
          (window as unknown as Record<string, unknown>).__strudelLatencyTimer = timer;
        }),
      ),
    [activate, attempt, captureCurrentDraft, queueSessionOperation, reevaluate, beatSwitchTiming],
  );

  /** Clone a beat and move to the copy, without interrupting the sound. */
  const cloneBeat = useCallback(
    (requestedName?: string) =>
      queueSessionOperation(() =>
        attempt(async () => {
          const source = requestedName ?? openRef.current;
          if (!source) {
            return;
          }
          captureCurrentDraft();
          // The focused row has the live editor buffer; inactive rows must be
          // cloned from disk rather than accidentally from the open beat.
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
      ),
    [adopt, attempt, captureCurrentDraft, queueSessionOperation, reevaluate, refresh, state.started],
  );

  const save = useCallback(async () => {
    return queueSessionOperation(async () => {
      const sessionName = sessionRef.current;
      const beatName = openRef.current;
      if (!sessionName || !beatName) {
        return;
      }
      const content = captureCurrentDraft();
      if (content === undefined) {
        return;
      }
      await desktop.beats.write(beatName, content);
      if (sessionRef.current !== sessionName || openRef.current !== beatName) {
        updateDraftState(saveBeat(draftStateRef.current, sessionName, beatName, content));
        return;
      }
      const latestContent = getCode() ?? bufferRef.current;
      if (latestContent !== content) {
        bufferRef.current = latestContent;
        setBuffer(latestContent);
        updateDraftState(recordDraft(draftStateRef.current, sessionName, beatName, latestContent));
        return;
      }
      updateDraftState(saveBeat(draftStateRef.current, sessionName, beatName, content));
      setBuffer(content);
    });
  }, [captureCurrentDraft, getCode, queueSessionOperation, updateDraftState]);

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
      const version = (diskChangeVersionRef.current.get(change.name) ?? 0) + 1;
      diskChangeVersionRef.current.set(change.name, version);
      const isCurrent = () => diskChangeVersionRef.current.get(change.name) === version;
      void refresh();
      const sessionName = sessionRef.current;
      if (!sessionName) {
        return;
      }

      if (change.event === 'unlink') {
        if (pendingRenameRef.current?.from === change.name) {
          return;
        }
        if (isBeatDirty(draftStateRef.current, sessionName, change.name)) {
          return;
        }
        updateDraftState(removeBeat(draftStateRef.current, sessionName, change.name));
        if (change.name === openRef.current) {
          openRef.current = undefined;
          setOpen(undefined);
          bufferRef.current = '';
          setBuffer('');
          setCode('');
          clearError();
          persistBeat(null);
        }
        return;
      }

      if (change.name === openRef.current) {
        captureCurrentDraft();
      }
      let diskContent: string;
      try {
        diskContent = await desktop.beats.read(change.name);
      } catch (error) {
        if (!isCurrent()) {
          return;
        }
        throw error;
      }
      if (!isCurrent()) {
        return;
      }
      const current = draftStateRef.current[sessionName];
      const savedContent = current?.saved[change.name];
      const draftContent = current?.drafts[change.name];
      if (savedContent === undefined) {
        updateDraftState(seedBeat(draftStateRef.current, sessionName, change.name, diskContent));
        return;
      }
      const decision = resolveDiskChange({
        diskContent,
        bufferContent: draftContent ?? savedContent,
        lastSavedContent: savedContent,
      });
      if (decision.kind === 'noop') {
        updateDraftState(observeDisk(draftStateRef.current, sessionName, change.name, diskContent));
        return;
      }
      if (decision.kind === 'apply') {
        updateDraftState(acceptDisk(draftStateRef.current, sessionName, change.name, decision.content));
        if (change.name !== openRef.current) {
          return;
        }
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
      updateDraftState(markConflict(draftStateRef.current, sessionName, change.name, decision.diskContent));
    },
    [captureCurrentDraft, clearError, persistBeat, reevaluate, refresh, setCode, updateDraftState],
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
    void save();
  }, [save]);

  const removeSession = useCallback(
    (name: string) => {
      void attempt(async () => {
        await desktop.sessions.remove(name);
        setSessions(await desktop.sessions.list());
      });
    },
    [attempt],
  );

  const create = useCallback(
    (raw: string) =>
      queueSessionOperation(() =>
        attempt(async () => {
          captureCurrentDraft();
          const file = normalizeBeatName(raw);
          await desktop.beats.create(file, STARTER_BEAT);
          await refresh();
          adopt(file, STARTER_BEAT);
        }),
      ),
    [adopt, attempt, captureCurrentDraft, queueSessionOperation, refresh],
  );

  const rename = useCallback(
    (from: string, raw: string) => {
      beatActivationRef.current += 1;
      captureCurrentDraft();
      return queueSessionOperation(() =>
        attempt(async () => {
          const file = normalizeBeatName(raw);
          const currentOrder = sortBeats(beatsRef.current, 'manual', manualBeatOrderRef.current).map(
            (beat) => beat.name,
          );
          const pendingRename = { from, to: file };
          pendingRenameRef.current = pendingRename;
          try {
            await desktop.beats.rename(from, file);
            const sessionName = sessionRef.current;
            if (sessionName) {
              updateDraftState(renameBeat(draftStateRef.current, sessionName, from, file));
            }
            const renamedOrder = currentOrder.map((name) => (name === from ? file : name));
            manualBeatOrderRef.current = renamedOrder;
            setManualBeatOrder(renamedOrder);
            await refresh();
            if (from === openRef.current) {
              setOpen(file);
              openRef.current = file;
              persistBeat(file);
            }
          } finally {
            if (pendingRenameRef.current === pendingRename) {
              pendingRenameRef.current = undefined;
            }
          }
        }),
      );
    },
    [attempt, captureCurrentDraft, persistBeat, queueSessionOperation, refresh, updateDraftState],
  );

  const remove = useCallback(
    (name: string) => {
      beatActivationRef.current += 1;
      captureCurrentDraft();
      return queueSessionOperation(() =>
        attempt(async () => {
          await desktop.beats.remove(name);
          const sessionName = sessionRef.current;
          if (sessionName) {
            updateDraftState(removeBeat(draftStateRef.current, sessionName, name));
          }
          const list = await refresh();
          if (name !== openRef.current) {
            return;
          }
          const next = list[0]?.name;
          if (next) {
            activate(next, await desktop.beats.read(next));
          } else {
            setOpen(undefined);
            openRef.current = undefined;
            bufferRef.current = '';
            setBuffer('');
            setCode('');
            clearError();
            persistBeat(null);
          }
        }),
      );
    },
    [
      activate,
      attempt,
      captureCurrentDraft,
      clearError,
      persistBeat,
      queueSessionOperation,
      refresh,
      setCode,
      updateDraftState,
    ],
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
        unsavedEdits: dirty,
        playing: state.started,
        cps,
        updated: new Date().toISOString(),
        buffer: bufferRef.current,
        audio: readAudio(),
      });
    publish();
    const timer = window.setInterval(publish, state.started ? 500 : 2000);
    return () => window.clearInterval(timer);
  }, [state.started, cps, buffer, draftState, dirty, open]);

  // Closing is the renderer's decision, because only the renderer can see
  // its drafts. The window's beforeunload is just the interception seam: the
  // product dialog (or the silent auto-save) is what the user actually meets.
  //
  //   clean        → the close passes untouched.
  //   discard      → the close passes; renderer-only drafts die with it.
  //   auto-save    → hold the close, write every dirty draft (any session),
  //                  then let it through — or keep the app open with the
  //                  failures listed if any write could not land.
  //   ask          → hold the close and show Save all / Discard / Cancel.
  //
  // Once a choice has let the close through, closeConfirmedRef stands the
  // interception down so window.close()'s own beforeunload passes — a
  // preventDefault loop there is exactly the "close button does nothing"
  // failure this flow replaces.
  const closeAfterSaveAll = useCallback(async () => {
    closeBusyRef.current = true;
    setCloseSaving(true);
    try {
      const sessionName = sessionRef.current;
      const result = await saveAllDrafts(draftStateRef.current, sessionName, openRef.current);
      const failures: CloseFailure[] = Object.entries(result)
        .filter(([, outcome]) => !outcome.saved)
        .map(([beat, outcome]) => ({ beat, conflict: outcome.conflict === true, error: outcome.error }));
      if (failures.length === 0) {
        // Every draft is on disk. Mark them saved (so staying open — a close
        // can still be vetoed elsewhere — shows clean state), then let it through.
        for (const [key, outcome] of Object.entries(result)) {
          if (!outcome.saved) {
            continue;
          }
          const slash = key.indexOf('/');
          const session = key.slice(0, slash);
          const beat = key.slice(slash + 1);
          const content = draftStateRef.current[session]?.drafts[beat];
          if (content !== undefined) {
            updateDraftState(saveBeat(draftStateRef.current, session, beat, content));
          }
        }
        closeConfirmedRef.current = true;
        desktop.close.reportDirty(false);
        window.close();
        return;
      }
      // A draft that could not be saved — a conflict, a refused write — must
      // not be closed over. The dialog stays open with the reasons listed.
      setCloseAsk({ failures });
      setBeatError(`Close stopped: could not save ${failures.map((failure) => failure.beat).join(', ')}.`);
    } finally {
      closeBusyRef.current = false;
      setCloseSaving(false);
    }
  }, [updateDraftState]);

  const closeSaveAll = useCallback(() => void closeAfterSaveAll(), [closeAfterSaveAll]);

  const closeDiscard = useCallback(() => {
    closeConfirmedRef.current = true;
    desktop.close.reportDirty(false);
    window.close();
  }, []);

  const closeCancel = useCallback(() => {
    setCloseAsk(undefined);
  }, []);

  // The titlebar record control. The take's blob is handled HERE: the
  // control's own stop await and this export share one underlying recorder
  // stop (see recording.ts), so the complete event stays a signal, not a
  // file path. A failed take — no master mix, a dead recorder, a refused
  // export — lands in the tree error surface via setBeatError, like every
  // other non-pattern failure.
  const onRecordEvent = useCallback((event: RecordEvent) => {
    if (event.kind === 'fail') {
      setBeatError(event.message);
      return;
    }
    if (event.kind !== 'stop') {
      return;
    }
    const { capture } = event;
    void capture.stop().then(
      async (blob) => {
        try {
          const data = new Uint8Array(await blob.arrayBuffer());
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const name = (openRef.current ?? 'take').replace(/\.js$/, '');
          const saved = await desktop.recording.save(data, `strudel-${name}-${stamp}.${capture.extension}`);
          if (saved === undefined) {
            return; // The save dialog was declined; the take is dropped by choice.
          }
        } catch (error) {
          setBeatError(recordingFailureMessage(error));
        }
      },
      (error: unknown) => {
        setBeatError(recordingFailureMessage(error));
      },
    );
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (closeConfirmedRef.current) {
        return; // The user's choice already let this close through.
      }
      if (closeBusyRef.current) {
        // A save-all for this close is already settling; hold, never restart.
        event.preventDefault();
        return;
      }
      captureCurrentDraft();
      if (!hasDirtyDrafts(draftStateRef.current)) {
        return; // Nothing is at stake; the close passes.
      }
      if (closeBehaviorRef.current === 'discard') {
        closeConfirmedRef.current = true;
        desktop.close.reportDirty(false);
        return; // Unsaved edits are deliberately dropped with the renderer.
      }
      event.preventDefault();
      if (closeBehaviorRef.current === 'auto-save') {
        void closeAfterSaveAll();
        return;
      }
      setCloseAsk({ failures: [] });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [captureCurrentDraft, closeAfterSaveAll]);

  // The main process's close:check answers from what the renderer reports;
  // dirty drafts are exactly what it is asked about.
  useEffect(() => {
    try {
      desktop.close.reportDirty(hasDirtyDrafts(draftState));
    } catch {
      // The bridge can be gone while the app is still usable; the close
      // decision never depended on this report.
    }
  }, [draftState]);

  const showSessionPicker = useCallback(() => {
    captureCurrentDraft();
    setPicking(true);
  }, [captureCurrentDraft]);

  const cancelSessionPicker = useCallback(() => {
    setCode(bufferRef.current);
    setPicking(false);
  }, [setCode]);

  useEffect(() => {
    // FileTree is unmounted when the sidebar is collapsed. Its naming/delete
    // draft therefore belongs in App, and stale targets must be retired when
    // the current beat list changes.
    const current = treeDraftRef.current;
    if (
      current &&
      current.kind !== 'create' &&
      !beats.some((beat) => beat.name === (current.kind === 'rename' ? current.from : current.name))
    ) {
      updateTreeDraft(undefined);
    }
  }, [beats, updateTreeDraft]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (pickingRef.current || showSettings || event.defaultPrevented || event.isComposing) {
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (treeDraftRef.current) {
        return;
      }
      if (event.metaKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        beginTreeDraft({ kind: 'create' });
        return;
      }
      if (event.key === 'F2' && openRef.current) {
        event.preventDefault();
        beginTreeDraft({ kind: 'rename', from: openRef.current });
        return;
      }
      if (event.metaKey && event.key === 'Backspace' && openRef.current) {
        event.preventDefault();
        beginTreeDraft({ kind: 'confirm-delete', name: openRef.current });
        return;
      }
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
  }, [beginTreeDraft, save, showSettings, toggle]);

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

  const openEditorMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const token = tokenAt({ x: event.clientX, y: event.clientY });
      const source = getCode() ?? bufferRef.current;
      const target = token ? resolveFunctionPluginTarget(source, token.offset, listFunctionPlugins()) : undefined;
      const bounds = event.currentTarget.getBoundingClientRect();
      const menu: EditorMenuState = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        // The raw client point too: a spawned floating panel is born in the
        // app overlay's coordinate space, not the editor viewport's.
        clientX: event.clientX,
        clientY: event.clientY,
      };
      if (target) menu.functionName = target.functionName;
      setEditorMenu(target ? { menu, target } : { menu });
    },
    [getCode, tokenAt],
  );

  const spawnFloatingPlugin = useCallback(
    (functionName: string) => {
      const currentMenu = editorMenu;
      const beat = openRef.current;
      if (!currentMenu?.target || currentMenu.target.functionName !== functionName || !beat || !appOverlay) return;
      // The panel is born in the overlay's coordinate space, at the point the
      // context menu was raised — translated from the click's client position.
      const overlayBounds = appOverlay.getBoundingClientRect();
      const instance = createFunctionPluginInstance({
        beat,
        target: currentMenu.target,
        x: (currentMenu.menu.clientX ?? currentMenu.menu.x) - overlayBounds.left,
        y: (currentMenu.menu.clientY ?? currentMenu.menu.y) - overlayBounds.top,
        viewport: { width: appOverlay.offsetWidth, height: appOverlay.offsetHeight },
      });
      const next = functionPluginsRef.current.filter((candidate) => candidate.instanceId !== instance.instanceId);
      next.push(instance);
      functionPluginsRef.current = next;
      setFunctionPlugins(next);
    },
    [appOverlay, editorMenu],
  );

  const changeFunctionPluginValue = useCallback(
    (instanceId: string, value: number) => {
      const instance = functionPluginsRef.current.find((candidate) => candidate.instanceId === instanceId);
      const definition = instance ? getPlugin(instance.pluginId) : undefined;
      if (!instance || definition?.scope !== 'function' || instance.beat !== openRef.current) return;
      const source = getCode() ?? bufferRef.current;
      let changed: ReturnType<typeof applyFunctionPluginValue>;
      try {
        changed = applyFunctionPluginValue({ source, definition, instance, value });
      } catch (error) {
        setBeatError(error instanceof Error ? error.message : String(error));
        return;
      }
      const next = functionPluginsRef.current.map((candidate) =>
        candidate.instanceId === instanceId ? changed.instance : candidate,
      );
      functionPluginsRef.current = next;
      setFunctionPlugins(next);
      setCode(changed.source);
      onCodeChange(changed.source);
      reevaluate();
    },
    [getCode, onCodeChange, reevaluate, setCode],
  );

  const changeFunctionPlugins = useCallback((next: FunctionPluginInstance[]) => {
    functionPluginsRef.current = next;
    setFunctionPlugins(next);
  }, []);

  // Settings is an overlay, never a replacement: the app underneath keeps
  // its editor, selection, and sound, so leaving Settings cannot reseed the
  // buffer (the "// loading" regression) or stop the music.
  const settingsOverlay = showSettings ? (
    <SettingsPage onBack={() => setShowSettings(false)} onSettingsChange={applySettings} />
  ) : null;

  // Labels for the close dialog, computed at render from the same draft
  // state the guard checked, so the panel names exactly what is at stake.
  const closeDirtyLabels: string[] = [];
  if (closeAsk !== undefined) {
    for (const [session, beats] of Object.entries(collectUnpolledDrafts(draftState))) {
      for (const beat of beats) {
        closeDirtyLabels.push(`${session} / ${beat}`);
      }
    }
  }

  if (picking) {
    return (
      <SessionPicker
        sessions={sessions}
        root={root}
        error={beatError}
        onOpen={(name) => void openSession(name)}
        onCreate={(name) => void openSession(name, true)}
        onRemove={removeSession}
        onCancel={session ? cancelSessionPicker : undefined}
      />
    );
  }

  return (
    <>
      <div className="app" style={{ '--dock-h': `${dockH}px` } as CSSProperties}>
        <header className="titlebar">
          <button
            className="collapse"
            onClick={() => setTreeOpen(treeOpen ? 0 : 1)}
            title={treeOpen ? 'Hide beats' : 'Show beats'}
          >
            {treeOpen ? '[<]' : '[>]'}
          </button>
          <button className="collapse" onClick={showSessionPicker} title="Switch session">
            {session ?? 'sessions'}
          </button>
          <span className="beat">
            <b>{open?.replace(/\.js$/, '') ?? 'no beat'}</b>
            {dirty ? ' *' : ''}
            {playbackSource && playbackSource !== open ? ` (playing: ${playbackSource.replace(/\.js$/, '')})` : ''}
          </span>
          <span className="transport">
            <button onClick={toggle}>{state.started ? '■ stop' : '▶ play'}</button>
            <RecordControl
              mode={recordMode}
              source={playbackSource ?? open ?? 'strudel++'}
              masterAvailable={state.started}
              onEvent={onRecordEvent}
            />
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
              onClick={() => {
                setEditorMenu(undefined);
                setShowSettings((v) => !v);
              }}
              title="Settings"
            >
              ⚙
            </button>
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
              dirtyByBeat={dirtyByBeat}
              error={beatError}
              onOpen={(name) => void openBeat(name)}
              onCreate={(name) => void create(name)}
              onRename={(from, to) => void rename(from, to)}
              onRemove={(name) => void remove(name)}
              onClone={(name) => void cloneBeat(name)}
              draft={treeDraft}
              onBeginDraft={beginTreeDraft}
              onChangeDraft={updateTreeDraft}
              onCancelDraft={() => updateTreeDraft(undefined)}
              sortMode={beatSort}
              manualOrder={manualBeatOrder}
              onSortChange={changeSort}
              onReorder={reorder}
              onDismissError={() => setBeatError(undefined)}
              latency={beatSwitchTiming}
              onLatencyChange={(value) => {
                const timing = value as BeatSwitchTiming;
                setBeatSwitchTiming(timing);
                // The Settings page shows the same choice from the persisted
                // settings; keep the two from drifting apart by saving this too.
                void desktop.settings.update({ beatSwitchTiming: timing }).catch((error: unknown) => {
                  setBeatError(error instanceof Error ? error.message : String(error));
                });
              }}
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
            <div className="pane-body editor-viewport" ref={setEditorViewport}>
              <div className="editor" ref={containerRef} onContextMenu={openEditorMenu} />
              {editorMenu !== undefined && (
                <EditorContextMenu
                  menu={editorMenu.menu}
                  playing={state.started}
                  onToggle={toggle}
                  onSpawn={spawnFloatingPlugin}
                  onDismiss={() => setEditorMenu(undefined)}
                />
              )}
            </div>
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

          {harnesses.length > 0 && (
            <HarnessPane harnesses={harnesses} active={harness} onPick={setHarness} beat={open} />
          )}
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

        <PluginDock
          dock={dock}
          onChange={setDock}
          playing={state.started}
          floatingRoot={appOverlay}
          functionPlugins={{
            instances: functionPlugins,
            onChange: changeFunctionPlugins,
            onValue: changeFunctionPluginValue,
          }}
        />

        <StatusBar
          root={root}
          beat={open}
          dirty={dirty}
          playing={state.started}
          cps={cps}
          harness={harness}
          error={state.error?.message}
          recordingMode={recordMode}
        />

        {/* Floating plugin panels render here via portal: one absolutely
          positioned layer over the whole app. It never intercepts the pointer
          itself (pointer-events: none); only the panels inside it do. */}
        <div className="app-overlay" ref={setAppOverlay} />
      </div>
      {settingsOverlay}
      {closeAsk !== undefined && (
        <CloseDialog
          dirty={closeDirtyLabels}
          failures={closeAsk.failures}
          busy={closeSaving}
          onSaveAll={closeSaveAll}
          onDiscard={closeDiscard}
          onCancel={closeCancel}
        />
      )}
    </>
  );
}
