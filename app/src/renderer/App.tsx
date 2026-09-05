import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ConflictBar } from './components/ConflictBar';
import { FileTree, type FileTreeDraft, type FileTreeDraftAction } from './components/FileTree';
import { Grip } from './components/Grip';
import { HarnessPane } from './components/HarnessPane';
import { PluginDock } from './components/PluginDock';
import { SessionPicker, type SessionSummary } from './components/SessionPicker';
import { StatusBar } from './components/StatusBar';
import { TempoBox } from './components/TempoBox';
import { desktop } from './desktop';
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
import type { BeatChange, SessionRootStatus } from '../shared/ipc';
import type { HarnessDef } from '../shared/harness';
import {
  DEFAULT_RECORDING_SETTINGS,
  RECORDING_MODES,
  recordingFailureMessage,
  recordingSource,
  type RecordingMode,
} from '../shared/recording';
import { startRecording, type RecordingCapture } from './recording';

function isRecordingMode(value: string | null): value is RecordingMode {
  return RECORDING_MODES.some((item) => item.mode === value);
}

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
  const [rootStatus, setRootStatus] = useState<SessionRootStatus>();
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
  const [cpsByBeat, setCpsByBeat] = useState<Record<string, number>>({});
  const [draftState, setDraftState] = useState<DraftState>({});
  // Plugin dock layout: which devices are open, how the dock is split, and
  // each device's own faders. Session-scoped like the tempo map — switching
  // beats must not close the mixer.
  const [dock, setDock] = useState<DockState>({ split: false, panes: [{ tabs: [] }] });
  const [recordingMode, setRecordingMode] = useState<RecordingMode>(() => {
    try {
      const value = localStorage.getItem('recording.mode');
      return isRecordingMode(value) ? value : DEFAULT_RECORDING_SETTINGS.mode;
    } catch {
      return DEFAULT_RECORDING_SETTINGS.mode;
    }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [recording, setRecording] = useState(false);
  const [savingTake, setSavingTake] = useState(false);

  const bufferRef = useRef('');
  const openRef = useRef<string>(undefined);
  const draftStateRef = useRef<DraftState>({});
  const pendingRenameRef = useRef<{ from: string; to: string } | undefined>(undefined);
  const beatActivationRef = useRef(0);
  const diskChangeVersionRef = useRef(new Map<string, number>());
  const lastSuccessfulBufferRef = useRef<string | undefined>(undefined);
  const recordingRef = useRef<RecordingCapture | undefined>(undefined);
  const savingTakeRef = useRef(false);
  const beatsRef = useRef<BeatSummary[]>([]);
  const beatSortRef = useRef<BeatSortMode>(DEFAULT_BEAT_SORT);
  const manualBeatOrderRef = useRef<string[]>([]);
  const treeDraftRef = useRef<FileTreeDraft | undefined>(undefined);
  const pickingRef = useRef(picking);
  const sessionRef = useRef<string>(undefined);
  openRef.current = open;
  pickingRef.current = picking;
  treeDraftRef.current = treeDraft;
  sessionRef.current = session;

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

  const onSuccessfulEval = useCallback((code: string) => {
    lastSuccessfulBufferRef.current = code;
  }, []);
  const { containerRef, state, setCode, getCode, clearError, toggle, cps, changeCps, releaseCps, reevaluate } =
    useStrudel(onCodeChange, onSuccessfulEval);

  const changeRecordingMode = useCallback((mode: RecordingMode) => {
    setRecordingMode(mode);
    try {
      localStorage.setItem('recording.mode', mode);
    } catch {
      // Settings remain usable for this run when storage is unavailable.
    }
  }, []);

  const record = useCallback(async () => {
    if (savingTakeRef.current) {
      return;
    }
    const capture = recordingRef.current;
    if (capture) {
      recordingRef.current = undefined;
      savingTakeRef.current = true;
      setSavingTake(true);
      setRecording(false);
      try {
        const blob = await capture.stop();
        await desktop.recording.save(
          new Uint8Array(await blob.arrayBuffer()),
          `${open?.replace(/\.js$/, '') ?? 'take'}.${capture.extension}`,
        );
      } catch (error) {
        setBeatError(recordingFailureMessage(error));
      } finally {
        savingTakeRef.current = false;
        setSavingTake(false);
      }
      return;
    }
    const source = recordingSource(lastSuccessfulBufferRef.current);
    if (!source) {
      setBeatError('Recording failed: evaluate a full buffer before recording.');
      return;
    }
    try {
      recordingRef.current = startRecording(recordingMode, source);
      setRecording(true);
      setBeatError(undefined);
    } catch (error) {
      recordingRef.current = undefined;
      setBeatError(recordingFailureMessage(error));
    }
  }, [open, recordingMode]);
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
      lastSuccessfulBufferRef.current = undefined;
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
      // The settings surfaces are optional extras: a failure to load them must
      // not take the session list and the harness down with it.
      await desktop.sessions
        .rootStatus()
        .then(setRootStatus)
        .catch(() => setRootStatus(undefined));
      // Bundled read-only library removed; future library is a separate
      // wiki-like sound-sample reference, not a session/beat collection.
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
              listPlugins().map((plugin) => plugin.id),
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
          // Re-evaluating swaps the pattern in place. The scheduler keeps counting,
          // so the new beat lands on the next cycle boundary and the bar holds.
          reevaluate();
        }),
      ),
    [activate, attempt, captureCurrentDraft, queueSessionOperation, reevaluate],
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

  // Electron runs beforeunload when a BrowserWindow is closed. Returning a
  // warning here keeps all renderer-only drafts alive until the user chooses
  // whether to stay; restarting the app creates a fresh, empty DraftState.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      captureCurrentDraft();
      if (!hasDirtyDrafts(draftStateRef.current)) {
        return;
      }
      event.preventDefault();
      event.returnValue = 'Unsaved beats will be lost.';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [captureCurrentDraft]);

  const showSessionPicker = useCallback(() => {
    captureCurrentDraft();
    setPicking(true);
  }, [captureCurrentDraft]);

  const cancelSessionPicker = useCallback(() => {
    setCode(bufferRef.current);
    setPicking(false);
  }, [setCode]);

  // The main process re-roots itself on a successful choice, so the picker
  // must re-read the root and the session list it now serves.
  const chooseRoot = useCallback(() => {
    void (async () => {
      try {
        const status = await desktop.sessions.chooseRoot();
        setRootStatus(status);
        setRoot(await desktop.sessions.root());
        setSessions(await desktop.sessions.list());
      } catch (error) {
        setBeatError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, []);

  const readLibraryBeat = useCallback((name: string) => Promise.reject(new Error('Library removed')), []);

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
      if (pickingRef.current || event.defaultPrevented || event.isComposing) {
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
  }, [beginTreeDraft, save, toggle]);

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
        onRemove={removeSession}
        onCancel={session ? cancelSessionPicker : undefined}
        rootStatus={rootStatus}
        onChooseRoot={session ? undefined : chooseRoot}
        library={[]}
        readLibraryBeat={readLibraryBeat}
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
        <button className="collapse" onClick={showSessionPicker} title="Switch session">
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
            onClick={() => void record()}
            disabled={!open || savingTake}
            title={recording ? 'Stop recording' : 'Record'}
          >
            {recording ? '■ stop rec' : `● record [${recordingMode}]`}
          </button>
          <button className="collapse" onClick={() => setShowSettings((shown) => !shown)} title="Recording settings">
            [ settings ]
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

      <PluginDock
        dock={dock}
        onChange={setDock}
        playing={state.started}
        scope={open === undefined ? {} : { beat: open }}
      />

      <StatusBar
        root={root}
        beat={open}
        dirty={dirty}
        playing={state.started}
        cps={cps}
        harness={harness}
        error={state.error?.message}
        recordingMode={recordingMode}
      />
      {showSettings && (
        <div className="settings-popover" role="dialog" aria-label="Recording settings">
          <b>recording form</b>
          <label>
            Record button produces
            <select
              value={recordingMode}
              onChange={(event) => {
                const value = event.target.value;
                if (isRecordingMode(value)) changeRecordingMode(value);
              }}
            >
              {RECORDING_MODES.map((item) => (
                <option key={item.mode} value={item.mode}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => setShowSettings(false)}>close</button>
        </div>
      )}
    </div>
  );
}
