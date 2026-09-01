import { useCallback, useEffect, useRef, useState } from 'react';

type Props = {
  /** Current width of the pane this grip resizes, in pixels. */
  width: number;
  onChange: (width: number) => void;
  /** Which side of the grip the pane sits on. */
  side: 'left' | 'right';
  min?: number;
  max?: number;
};

/**
 * A drag handle between two panes.
 *
 * The pointer is captured on the grip for the whole drag, so the terminal and
 * the editor never swallow the move events when the cursor crosses them.
 */
export function Grip({ width, onChange, side, min = 140, max = 900 }: Props) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef({ x: 0, width: 0 });

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      origin.current = { x: event.clientX, width };
      setDragging(true);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) {
        return;
      }
      const travel = event.clientX - origin.current.x;
      const next = origin.current.width + (side === 'left' ? travel : -travel);
      onChange(Math.round(Math.max(min, Math.min(max, next))));
    },
    [dragging, max, min, onChange, side],
  );

  const stop = useCallback(() => setDragging(false), []);

  useEffect(() => {
    document.body.dataset.resizing = String(dragging);
  }, [dragging]);

  return (
    <div
      className="grip"
      data-dragging={dragging}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={() => onChange(side === 'left' ? 210 : 460)}
    />
  );
}
