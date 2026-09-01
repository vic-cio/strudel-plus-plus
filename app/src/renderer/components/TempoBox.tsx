import { useEffect, useState } from 'react';
import { bpmFromCps, cpsFromBpm, parseBpm } from '../../shared/tempo';

type Props = {
  cps: number;
  onChange: (cps: number) => void;
  coded?: boolean;
};

/**
 * Type a tempo in bpm.
 *
 * It follows the running tempo while you are not typing, so it reads the truth
 * when the beat's own setcps is driving, and stops following the moment you
 * focus it so it cannot rewrite what you are halfway through typing.
 */
export function TempoBox({ cps, onChange, coded = false }: Props) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (coded) {
      setEditing(false);
    }
    if (!editing || coded) {
      setText(String(Math.round(bpmFromCps(cps) * 10) / 10));
    }
  }, [coded, cps, editing]);

  function commit() {
    setEditing(false);
    const bpm = parseBpm(text);
    if (bpm === undefined) {
      setText(String(Math.round(bpmFromCps(cps) * 10) / 10));
      return;
    }
    onChange(cpsFromBpm(bpm));
  }

  return (
    <span className={`tempo ${coded ? 'tempo-coded' : ''}`}>
      <input
        className="tempo-box"
        value={text}
        aria-label="Tempo in bpm"
        disabled={coded}
        title={coded ? 'Tempo is set by this beat' : undefined}
        onFocus={(event) => {
          setEditing(true);
          event.currentTarget.select();
        }}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setEditing(false);
            event.currentTarget.blur();
          }
        }}
      />
      <span className="tempo-unit">bpm</span>
    </span>
  );
}
