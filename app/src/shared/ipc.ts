/** Channel names shared by the main process and the preload bridge. */
export const CH = {
  sessionsRoot: 'sessions:root',
  sessionsRootStatus: 'sessions:rootStatus',
  sessionsChooseRoot: 'sessions:chooseRoot',
  sessionsList: 'sessions:list',
  sessionsCreate: 'sessions:create',
  sessionsRemove: 'sessions:remove',
  sessionsOpen: 'sessions:open',
  sessionsActive: 'sessions:active',
  sessionsState: 'sessions:state',
  sessionsSetState: 'sessions:setState',
  beatsRoot: 'beats:root',
  beatsList: 'beats:list',
  beatsInfo: 'beats:info',
  beatsRead: 'beats:read',
  beatsWrite: 'beats:write',
  beatsCreate: 'beats:create',
  beatsRename: 'beats:rename',
  beatsRemove: 'beats:remove',
  beatsChanged: 'beats:changed',
  libraryList: 'library:list',
  libraryRead: 'library:read',
  harnessList: 'harness:list',
  ptyStart: 'pty:start',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  oscSend: 'osc:send',
  midiSend: 'midi:send',
  midiPorts: 'midi:ports',
} as const;

/**
 * One configured-root state, so the main-process gate and the picker message
 * both switch on the same thing.
 */
export type SessionRootStatus =
  | { state: 'unconfigured' }
  | { state: 'ok'; path: string }
  | { state: 'invalid'; path: string; error: string };

export type BeatChange = {
  /** Path relative to the beats root, using forward slashes. */
  name: string;
  event: 'add' | 'change' | 'unlink';
};
