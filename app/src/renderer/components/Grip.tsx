import { useCallback, useEffect, useRef, useState } from 'react';

type Side = 'left' | 'right' | 'above' | 'below';

type Props = {
  /** Current size of the pane this grip resizes, in pixels. */
  size: number;
  onChange: (size: number) => void;
  /** Which side of the grip the pane sits on. */
  side: Side;
  /**
   * Which way the grip runs: vertical between side-by-side panes (dragged
   * horizontally), horizontal between stacked rows (dragged vertically).
   * Defaults to vertical.
   */
  orientation?: 'vertical' | 'horizontal';
  min?: number;
  max?: number;
  /** The size a double-click resets the pane to. */
  resetTo?: number;
  /** Names the separator for assistive tech; it is focusable. */
  label?: string;
};

/** One arrow press moves the boundary by this many pixels. */
const KEY_STEP = 16;

/**
 * A drag handle between two panes.
 *
 * The pointer is captured on the grip for the whole drag, so the terminal and
 * the editor never swallow the move events when the cursor crosses them. The
 * grip is also a real focusable separator: arrow keys nudge it by KEY_STEP and
 * Home/End jump to the bounds, so it is operable without a pointer.
 */
export function Grip({ size, onChange, side, orientation = 'vertical', min = 140, max = 900, resetTo, label }: Props) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef({ x: 0, y: 0, size: 0 });

  const clamp = useCallback((next: number) => Math.round(Math.max(min, Math.min(max, next))), [max, min]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      origin.current = { x: event.clientX, y: event.clientY, size };
      setDragging(true);
    },
    [size],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) {
        return;
      }
      const travel = orientation === 'horizontal' ? event.clientY - origin.current.y : event.clientX - origin.current.x;
      const toward = side === 'left' || side === 'above';
      onChange(clamp(origin.current.size + (toward ? travel : -travel)));
    },
    [clamp, dragging, onChange, orientation, side],
  );

  const stop = useCallback(() => setDragging(false), []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Arrows move the separator itself, like a drag: the arrow that moves
      // it away from the pane grows the pane, the opposite one shrinks it.
      const grow =
        orientation === 'horizontal'
          ? side === 'below'
            ? 'ArrowUp'
            : 'ArrowDown'
          : side === 'left'
            ? 'ArrowRight'
            : 'ArrowLeft';
      const shrink =
        orientation === 'horizontal'
          ? side === 'below'
            ? 'ArrowDown'
            : 'ArrowUp'
          : side === 'left'
            ? 'ArrowLeft'
            : 'ArrowRight';
      if (event.key === grow || event.key === shrink) {
        event.preventDefault();
        onChange(clamp(size + (event.key === grow ? KEY_STEP : -KEY_STEP)));
      } else if (event.key === 'Home') {
        event.preventDefault();
        onChange(clamp(min));
      } else if (event.key === 'End') {
        event.preventDefault();
        onChange(clamp(max));
      }
    },
    [clamp, max, min, onChange, orientation, side, size],
  );

  useEffect(() => {
    document.body.dataset.resizing = String(dragging);
    if (dragging) {
      document.body.dataset.resizeAxis = orientation === 'horizontal' ? 'row' : 'col';
    } else {
      delete document.body.dataset.resizeAxis;
    }
    return () => {
      delete document.body.dataset.resizing;
      delete document.body.dataset.resizeAxis;
    };
  }, [dragging, orientation]);

  return (
    <div
      className={orientation === 'horizontal' ? 'grip grip-h' : 'grip'}
      data-dragging={dragging}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={size}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
      onDoubleClick={() => resetTo !== undefined && onChange(clamp(resetTo))}
    />
  );
}
