/**
 * Renderer-only beat state.
 *
 * A session owns three maps keyed by beat name. `saved` is the last disk
 * baseline known to the renderer, `drafts` contains only content that differs
 * from that baseline, and `conflicts` holds disk content that arrived while a
 * draft was dirty. Keeping the session boundary here makes it explicit that
 * none of this state belongs in .session.json or .strudel-live.json.
 */
export type DraftSessionState = {
  readonly drafts: Readonly<Record<string, string>>;
  readonly saved: Readonly<Record<string, string>>;
  readonly conflicts: Readonly<Record<string, string>>;
};

export type DraftState = Readonly<Record<string, DraftSessionState>>;

export type BeatActivation = {
  readonly state: DraftState;
  readonly content: string;
};

const EMPTY_SESSION: DraftSessionState = {
  drafts: {},
  saved: {},
  conflicts: {},
};

function sessionFor(state: DraftState, session: string): DraftSessionState {
  return state[session] ?? EMPTY_SESSION;
}

function updateSession(
  state: DraftState,
  session: string,
  update: (current: DraftSessionState) => DraftSessionState,
): DraftState {
  const current = sessionFor(state, session);
  const next = update(current);
  return next === current ? state : { ...state, [session]: next };
}

function removeKey(values: Readonly<Record<string, string>>, key: string): Readonly<Record<string, string>> {
  if (!Object.hasOwn(values, key)) {
    return values;
  }
  const next = { ...values };
  delete next[key];
  return next;
}

function setKey(
  values: Readonly<Record<string, string>>,
  key: string,
  value: string,
): Readonly<Record<string, string>> {
  if (values[key] === value && Object.hasOwn(values, key)) {
    return values;
  }
  return { ...values, [key]: value };
}

/** Return the session state for read-only selectors and renderer consumers. */
export function getDraftSession(state: DraftState, session: string): DraftSessionState {
  return sessionFor(state, session);
}

/** Return the current in-memory content, falling back to the disk read. */
export function draftContent(state: DraftState, session: string, beat: string, diskContent: string): string {
  return sessionFor(state, session).drafts[beat] ?? diskContent;
}

/** Establish or refresh a clean disk baseline without replacing a draft. */
export function seedBeat(state: DraftState, session: string, beat: string, diskContent: string): DraftState {
  return updateSession(state, session, (current) => {
    if (current.drafts[beat] !== undefined) {
      return current;
    }
    const saved = setKey(current.saved, beat, diskContent);
    const conflicts = removeKey(current.conflicts, beat);
    if (saved === current.saved && conflicts === current.conflicts) {
      return current;
    }
    return { drafts: current.drafts, saved, conflicts };
  });
}

/** Record editor content. Matching the baseline removes the dirty entry. */
export function recordDraft(state: DraftState, session: string, beat: string, content: string): DraftState {
  return updateSession(state, session, (current) => {
    // A conflict makes the saved value an intentionally stale baseline. Keep
    // an explicit draft even when the editor happens to return to that text;
    // otherwise activation falls back to the newer disk value and loses the
    // user's local side while the conflict is unresolved.
    const drafts =
      current.saved[beat] === content && current.conflicts[beat] === undefined
        ? removeKey(current.drafts, beat)
        : setKey(current.drafts, beat, content);
    return drafts === current.drafts ? current : { ...current, drafts };
  });
}

/** Restore a beat's draft when present, otherwise adopt the disk content. */
export function activateBeat(state: DraftState, session: string, beat: string, diskContent: string): BeatActivation {
  const current = sessionFor(state, session);
  const draft = current.drafts[beat];
  const hasDraft = draft !== undefined;
  const content = draft ?? diskContent;

  if (hasDraft) {
    return { state, content };
  }

  const next = seedBeat(state, session, beat, diskContent);
  const nextSession = sessionFor(next, session);
  return { state: next, content };
}

/** Mark an explicit save complete for exactly one beat. */
export function saveBeat(state: DraftState, session: string, beat: string, content: string): DraftState {
  return updateSession(state, session, (current) => {
    const draft = current.drafts[beat];
    const drafts = draft === undefined || draft === content ? removeKey(current.drafts, beat) : current.drafts;
    return {
      drafts,
      saved: setKey(current.saved, beat, content),
      conflicts: removeKey(current.conflicts, beat),
    };
  });
}

/** Explicitly accept disk content, discarding only that beat's draft. */
export function acceptDisk(state: DraftState, session: string, beat: string, content: string): DraftState {
  return updateSession(state, session, (current) => ({
    drafts: removeKey(current.drafts, beat),
    saved: setKey(current.saved, beat, content),
    conflicts: removeKey(current.conflicts, beat),
  }));
}

/** Record an inactive or active conflict without changing the live draft. */
export function markConflict(state: DraftState, session: string, beat: string, diskContent: string): DraftState {
  return updateSession(state, session, (current) => ({
    drafts: current.drafts,
    saved: current.saved,
    conflicts: setKey(current.conflicts, beat, diskContent),
  }));
}

/**
 * Observe a watcher no-op. If disk converged on the live draft, that content is
 * now the baseline; a dirty draft is retained when the event was our own save.
 */
export function observeDisk(state: DraftState, session: string, beat: string, diskContent: string): DraftState {
  return updateSession(state, session, (current) => {
    const draft = current.drafts[beat];
    if (draft !== undefined && draft !== diskContent) {
      return current;
    }
    return {
      drafts: removeKey(current.drafts, beat),
      saved: setKey(current.saved, beat, diskContent),
      conflicts: removeKey(current.conflicts, beat),
    };
  });
}

/** Move all renderer state for a beat when its file is renamed. */
export function renameBeat(state: DraftState, session: string, from: string, to: string): DraftState {
  return updateSession(state, session, (current) => {
    const move = (values: Readonly<Record<string, string>>): Readonly<Record<string, string>> => {
      const value = values[from];
      if (value === undefined) {
        return values;
      }
      return setKey(removeKey(values, from), to, value);
    };
    const drafts = move(current.drafts);
    const saved = move(current.saved);
    const conflicts = move(current.conflicts);
    if (drafts === current.drafts && saved === current.saved && conflicts === current.conflicts) {
      return current;
    }
    return { drafts, saved, conflicts };
  });
}

/** Drop all renderer state for a beat after deletion. */
export function removeBeat(state: DraftState, session: string, beat: string): DraftState {
  return updateSession(state, session, (current) => {
    const drafts = removeKey(current.drafts, beat);
    const saved = removeKey(current.saved, beat);
    const conflicts = removeKey(current.conflicts, beat);
    if (drafts === current.drafts && saved === current.saved && conflicts === current.conflicts) {
      return current;
    }
    return { drafts, saved, conflicts };
  });
}

export function isBeatDirty(state: DraftState, session: string, beat: string): boolean {
  const current = sessionFor(state, session);
  const draft = current.drafts[beat];
  return (draft !== undefined && draft !== current.saved[beat]) || current.conflicts[beat] !== undefined;
}

export function dirtyBeats(state: DraftState, session: string): ReadonlySet<string> {
  const current = sessionFor(state, session);
  const beats = new Set([...Object.keys(current.drafts), ...Object.keys(current.conflicts)]);
  return new Set([...beats].filter((beat) => isBeatDirty(state, session, beat)));
}

export function hasDirtyDrafts(state: DraftState): boolean {
  return Object.keys(state).some((session) => dirtyBeats(state, session).size > 0);
}
