import { useEffect, useRef, useState } from 'react';
import type { SessionRootStatus } from '../../shared/ipc';

export type SessionSummary = { name: string; beats: number; usedAt: number };

type Props = {
  sessions: SessionSummary[];
  root: string;
  error: string | undefined;
  onOpen: (name: string) => void;
  onCreate: (name: string) => void;
  onRemove: (name: string) => void;
  onCancel: (() => void) | undefined;
  rootStatus?: SessionRootStatus | undefined;
  onChooseRoot?: (() => void) | undefined;
  library?: { name: string; session: string }[];
  readLibraryBeat?: ((name: string) => Promise<string>) | undefined;
};

function when(usedAt: number): string {
  if (!usedAt) {
    return 'never opened';
  }
  const minutes = Math.round((Date.now() - usedAt) / 60000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/**
 * Shown at boot, and again from the sidebar when switching sets.
 *
 * The most recent session is selected on arrival and enter takes it, so the
 * common case is one keypress between launching and playing.
 */
export function SessionPicker({
  sessions,
  root,
  error,
  onOpen,
  onCreate,
  onRemove,
  onCancel,
  rootStatus,
  onChooseRoot,
  library = [],
  readLibraryBeat,
}: Props) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState(0);
  const [preview, setPreview] = useState<{ name: string; content: string }>();
  const input = useRef<HTMLInputElement>(null);

  // Bundled beats are readable but never editable: the preview is the whole
  // exposure, and a second click closes it.
  function showLibraryBeat(beatName: string): void {
    if (preview?.name === beatName || !readLibraryBeat) {
      setPreview(undefined);
      return;
    }
    void readLibraryBeat(beatName).then(
      (content) => setPreview({ name: beatName, content }),
      () => setPreview(undefined),
    );
  }

  useEffect(() => {
    if (naming) {
      input.current?.focus();
    }
  }, [naming]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (naming) {
        return;
      }
      if (event.key === 'ArrowDown') {
        setSelected((at) => Math.min(sessions.length - 1, at + 1));
      } else if (event.key === 'ArrowUp') {
        setSelected((at) => Math.max(0, at - 1));
      } else if (event.key === 'Enter' && sessions[selected]) {
        onOpen(sessions[selected].name);
      } else if (event.key === 'Escape' && onCancel) {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [naming, onCancel, onOpen, selected, sessions]);

  return (
    <div className="picker">
      {/* The window has no title bar of its own, so the picker supplies the
          drag strip and the room the traffic lights need. */}
      <div className="picker-drag" />

      <div className="picker-panel">
        <header className="picker-head">
          <span className="picker-mark">strudel++</span>
          <span className="picker-sub">choose a session</span>
        </header>

        <div className="picker-list">
          {sessions.length === 0 && !naming && <p className="tree-empty">no sessions yet, start one below</p>}
          {sessions.map((session, index) => (
            <div key={session.name} className="picker-row">
              <button
                className="picker-item"
                aria-current={index === selected}
                onMouseEnter={() => setSelected(index)}
                onClick={() => onOpen(session.name)}
              >
                <span className="picker-name">{session.name}</span>
                <span className="picker-meta">
                  {session.beats} {session.beats === 1 ? 'beat' : 'beats'} · {when(session.usedAt)}
                </span>
              </button>
              <button
                className="picker-delete"
                aria-label={`Delete session ${session.name}`}
                title={`Delete ${session.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (window.confirm(`Delete session "${session.name}"?`)) {
                    onRemove(session.name);
                  }
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {library.length > 0 && (
          <section aria-label="Bundled library" className="picker-library">
            <p className="picker-sub">bundled library · read-only</p>
            {library.map((beat) => (
              <button className="picker-meta" key={beat.name} onClick={() => showLibraryBeat(beat.name)}>
                {beat.name}
              </button>
            ))}
            {preview && (
              <pre aria-label={`Bundled beat ${preview.name}`} className="picker-preview">
                {preview.content}
              </pre>
            )}
          </section>
        )}

        {error && <p className="tree-error">{error}</p>}
        {rootStatus?.state === 'invalid' && (
          <p className="tree-error">Session folder unavailable: {rootStatus.error}</p>
        )}

        <footer className="picker-foot">
          {naming ? (
            <input
              ref={input}
              className="tree-input"
              value={name}
              placeholder="session name"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && name.trim()) {
                  onCreate(name.trim());
                } else if (event.key === 'Escape') {
                  setNaming(false);
                  setName('');
                }
              }}
            />
          ) : (
            <>
              <button onClick={() => setNaming(true)}>+ new session</button>
              {onCancel && <button onClick={onCancel}>cancel</button>}
              <span className="picker-hint">↑↓ choose · ⏎ open</span>
            </>
          )}
        </footer>
      </div>

      <div className="picker-root-row">
        <p className="picker-root" title={root}>
          {root}
        </p>
        {onChooseRoot && <button onClick={onChooseRoot}>settings: choose sessions folder</button>}
      </div>
    </div>
  );
}
