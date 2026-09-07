import { useEffect } from 'react';

/** One beat that could not be saved on the way out the door. */
export type CloseFailure = {
  /** The `session/beat` key the coordinator reported. */
  beat: string;
  conflict?: boolean | undefined;
  error?: string | undefined;
};

type Props = {
  /** Dirty beats as `session / beat.js` labels, so the stakes are named. */
  dirty: ReadonlyArray<string>;
  failures: ReadonlyArray<CloseFailure>;
  /** A save-all is in flight; the choices wait for it to settle. */
  busy: boolean;
  onSaveAll: () => void;
  onDiscard: () => void;
  onCancel: () => void;
};

/**
 * The close decision, as the app's own dialog.
 *
 * The window's beforeunload is only the interception seam; what the user
 * actually sees and answers is this panel. Save all writes every dirty draft
 * (and reports any that could not be written instead of closing over them),
 * Discard lets the close through and the renderer-only drafts die with it,
 * Cancel keeps everything exactly as it was.
 */
export function CloseDialog({ dirty, failures, busy, onSaveAll, onDiscard, onCancel }: Props) {
  // Escape is the keyboard spelling of "stay", matching the platform's
  // close dialogs. It must not fire while a save-all is settling.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !busy) {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="close-backdrop" role="dialog" aria-label="Unsaved beats">
      <div className="close-dialog">
        <header className="close-head">unsaved beats</header>
        <div className="close-body">
          <p>
            {dirty.length === 1
              ? 'This beat has edits that are not on disk.'
              : `${dirty.length} beats have edits that are not on disk.`}
          </p>
          <ul className="close-list">
            {dirty.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
          {failures.length > 0 && (
            <div className="close-failures" role="alert">
              <span className="close-failures-title">not saved:</span>
              <ul className="close-list">
                {failures.map((failure) => (
                  <li key={failure.beat} className="close-failure">
                    {failure.beat}
                    <span className="reason">
                      {' '}
                      {failure.conflict ? 'changed on disk while you were editing — resolve it first' : failure.error}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {busy && <p className="close-busy">saving before close…</p>}
        </div>
        <footer className="close-actions">
          <button onClick={onSaveAll} disabled={busy}>
            save all
          </button>
          <button onClick={onDiscard} disabled={busy}>
            discard
          </button>
          <span className="close-spacer" />
          <button onClick={onCancel} disabled={busy}>
            cancel
          </button>
        </footer>
      </div>
    </div>
  );
}
