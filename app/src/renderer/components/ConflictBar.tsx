type Props = {
  onTakeTheirs: () => void;
  onKeepMine: () => void;
};

/**
 * Shown when the harness wrote the open beat while it had unsaved edits.
 * The pattern keeps playing untouched until one of these is clicked.
 */
export function ConflictBar({ onTakeTheirs, onKeepMine }: Props) {
  return (
    <div className="conflict">
      <span>
        <b>the harness edited this beat</b> and you have unsaved changes
      </span>
      <button onClick={onTakeTheirs}>take theirs</button>
      <button onClick={onKeepMine}>keep mine</button>
    </div>
  );
}
