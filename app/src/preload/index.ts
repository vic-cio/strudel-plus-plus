import { contextBridge, ipcRenderer } from 'electron';
import { CH, type BeatChange, type SessionRootStatus } from '../shared/ipc';
import type { HarnessDef } from '../shared/harness';
import type { BeatSummary } from '../shared/beatSorting';
import type { SessionOpenResult, SessionState } from '../shared/session';

/**
 * The whole surface the renderer gets. Nothing here takes a path the renderer
 * did not first receive from `beats.list`, and the main process re-checks every
 * one of them against the beats root anyway.
 */
const api = {
  sessions: {
    root: (): Promise<string> => ipcRenderer.invoke(CH.sessionsRoot),
    rootStatus: (): Promise<SessionRootStatus> => ipcRenderer.invoke(CH.sessionsRootStatus),
    chooseRoot: (): Promise<SessionRootStatus> => ipcRenderer.invoke(CH.sessionsChooseRoot),
    list: (): Promise<{ name: string; beats: number; usedAt: number }[]> => ipcRenderer.invoke(CH.sessionsList),
    active: (): Promise<string> => ipcRenderer.invoke(CH.sessionsActive),
    create: (name: string): Promise<SessionOpenResult> => ipcRenderer.invoke(CH.sessionsCreate, name),
    remove: (name: string): Promise<void> => ipcRenderer.invoke(CH.sessionsRemove, name),
    open: (name: string): Promise<SessionOpenResult> => ipcRenderer.invoke(CH.sessionsOpen, name),
    state: (name: string): Promise<SessionState> => ipcRenderer.invoke(CH.sessionsState, name),
    setState: (name: string, state: SessionState): Promise<void> =>
      ipcRenderer.invoke(CH.sessionsSetState, name, state),
  },
  beats: {
    root: (): Promise<string> => ipcRenderer.invoke(CH.beatsRoot),
    list: (): Promise<string[]> => ipcRenderer.invoke(CH.beatsList),
    listInfo: (): Promise<BeatSummary[]> => ipcRenderer.invoke(CH.beatsInfo),
    read: (name: string): Promise<string> => ipcRenderer.invoke(CH.beatsRead, name),
    write: (name: string, content: string): Promise<void> => ipcRenderer.invoke(CH.beatsWrite, name, content),
    create: (name: string, content: string): Promise<void> => ipcRenderer.invoke(CH.beatsCreate, name, content),
    rename: (from: string, to: string): Promise<void> => ipcRenderer.invoke(CH.beatsRename, from, to),
    remove: (name: string): Promise<void> => ipcRenderer.invoke(CH.beatsRemove, name),
    onChange: (handler: (change: BeatChange) => void) => {
      const listener = (_event: unknown, change: BeatChange) => handler(change);
      ipcRenderer.on(CH.beatsChanged, listener);
      return () => {
        ipcRenderer.off(CH.beatsChanged, listener);
      };
    },
  },
  library: {
    list: (): Promise<{ name: string; session: string }[]> => ipcRenderer.invoke(CH.libraryList),
    read: (name: string): Promise<string> => ipcRenderer.invoke(CH.libraryRead, name),
  },
  osc: {
    send: (message: { address: string; args: (string | number)[]; timestamp?: number }) =>
      ipcRenderer.send(CH.oscSend, message),
  },
  midi: {
    send: (messages: { port: string; message: number[]; offset: number }[]) => ipcRenderer.send(CH.midiSend, messages),
    ports: (): Promise<string[]> => ipcRenderer.invoke(CH.midiPorts),
  },
  close: {
    check: (): Promise<{ dirty: boolean }> => ipcRenderer.invoke(CH.closeCheck),
  },
  recording: {
    save: (data: Uint8Array, suggestedName: string): Promise<string | undefined> =>
      ipcRenderer.invoke(CH.recordingSave, data, suggestedName),
  },
  harness: {
    list: (): Promise<HarnessDef[]> => ipcRenderer.invoke(CH.harnessList),
    start: (id: string, cols: number, rows: number): Promise<void> => ipcRenderer.invoke(CH.ptyStart, id, cols, rows),
    write: (data: string) => ipcRenderer.send(CH.ptyWrite, data),
    resize: (cols: number, rows: number) => ipcRenderer.send(CH.ptyResize, cols, rows),
    onData: (handler: (data: string) => void) => {
      const listener = (_event: unknown, data: string) => handler(data);
      ipcRenderer.on(CH.ptyData, listener);
      return () => {
        ipcRenderer.off(CH.ptyData, listener);
      };
    },
    onExit: (handler: (code: number) => void) => {
      const listener = (_event: unknown, code: number) => handler(code);
      ipcRenderer.on(CH.ptyExit, listener);
      return () => {
        ipcRenderer.off(CH.ptyExit, listener);
      };
    },
  },
};

export type DesktopApi = typeof api;

contextBridge.exposeInMainWorld('desktop', api);
