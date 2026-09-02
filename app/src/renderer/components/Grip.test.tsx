// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Grip } from './Grip';

// jsdom 30 ships PointerEvent but not pointer capture, and the grip captures
// the pointer on pointerdown — the missing method is stubbed for drags.
beforeEach(() => {
  window.HTMLElement.prototype.setPointerCapture ??= () => {};
});
afterEach(() => {
  cleanup();
});

/** Drag along one axis: down at `from`, move to `to`, release. fireEvent
 *  wraps each dispatch in act, so each move sees the committed drag state. */
function drag(grip: Element, axis: 'x' | 'y', from: number, to: number) {
  const key = axis === 'y' ? 'clientY' : 'clientX';
  fireEvent.pointerDown(grip, { pointerId: 1, [key]: from });
  fireEvent.pointerMove(grip, { pointerId: 1, [key]: to });
  fireEvent.pointerUp(grip, { pointerId: 1 });
}

describe('Grip separator semantics', () => {
  it('is a focusable vertical separator with value bounds by default', () => {
    render(<Grip size={210} onChange={vi.fn()} side="left" min={210} max={560} />);
    const grip = screen.getByRole('separator');
    expect(grip.getAttribute('aria-orientation')).toBe('vertical');
    expect(grip.tabIndex).toBe(0);
    expect(grip.getAttribute('aria-valuemin')).toBe('210');
    expect(grip.getAttribute('aria-valuemax')).toBe('560');
    expect(grip.getAttribute('aria-valuenow')).toBe('210');
    expect(grip.className).toBe('grip');
  });

  it('runs horizontal between stacked rows and carries its label', () => {
    render(
      <Grip
        orientation="horizontal"
        size={104}
        onChange={vi.fn()}
        side="below"
        min={56}
        max={540}
        label="Resize plugin dock"
      />,
    );
    const grip = screen.getByRole('separator', { name: 'Resize plugin dock' });
    expect(grip.getAttribute('aria-orientation')).toBe('horizontal');
    expect(grip.className).toBe('grip grip-h');
  });
});

describe('Grip dragging', () => {
  it('grows a pane below the grip when dragged upward', () => {
    const onChange = vi.fn();
    render(<Grip orientation="horizontal" size={104} onChange={onChange} side="below" min={56} max={540} />);
    drag(screen.getByRole('separator'), 'y', 400, 300);
    expect(onChange).toHaveBeenLastCalledWith(204);
  });

  it('shrinks a pane below the grip when dragged downward', () => {
    const onChange = vi.fn();
    render(<Grip orientation="horizontal" size={104} onChange={onChange} side="below" min={56} max={540} />);
    drag(screen.getByRole('separator'), 'y', 400, 440);
    expect(onChange).toHaveBeenLastCalledWith(64);
  });

  it('grows a pane above the grip when dragged downward', () => {
    const onChange = vi.fn();
    render(<Grip orientation="horizontal" size={200} onChange={onChange} side="above" min={56} max={540} />);
    drag(screen.getByRole('separator'), 'y', 400, 480);
    expect(onChange).toHaveBeenLastCalledWith(280);
  });

  it('grows a left pane when dragged right and a right pane when dragged left', () => {
    const left = vi.fn();
    render(<Grip size={300} onChange={left} side="left" min={210} max={560} />);
    drag(screen.getByRole('separator'), 'x', 400, 450);
    expect(left).toHaveBeenLastCalledWith(350);

    cleanup();
    const right = vi.fn();
    render(<Grip size={300} onChange={right} side="right" min={260} max={1000} />);
    drag(screen.getByRole('separator'), 'x', 400, 350);
    expect(right).toHaveBeenLastCalledWith(350);
  });

  it('clamps a horizontal drag at both ends', () => {
    const onChange = vi.fn();
    render(<Grip orientation="horizontal" size={104} onChange={onChange} side="below" min={56} max={540} />);
    drag(screen.getByRole('separator'), 'y', 400, -10000);
    expect(onChange).toHaveBeenLastCalledWith(540);

    cleanup();
    const down = vi.fn();
    render(<Grip orientation="horizontal" size={104} onChange={down} side="below" min={56} max={540} />);
    drag(screen.getByRole('separator'), 'y', 400, 10000);
    expect(down).toHaveBeenLastCalledWith(56);
  });

  it('marks the body while a drag is held and clears it on release', () => {
    const onChange = vi.fn();
    render(<Grip orientation="horizontal" size={104} onChange={onChange} side="below" />);
    const grip = screen.getByRole('separator');
    fireEvent.pointerDown(grip, { pointerId: 1, clientY: 400 });
    expect(document.body.dataset.resizing).toBe('true');
    expect(document.body.dataset.resizeAxis).toBe('row');
    fireEvent.pointerUp(grip, { pointerId: 1 });
    expect(document.body.dataset.resizing).toBe('false');
    expect(document.body.dataset.resizeAxis).toBeUndefined();
  });

  it('resets to the remembered size on double-click', () => {
    const onChange = vi.fn();
    render(
      <Grip orientation="horizontal" size={300} onChange={onChange} side="below" min={56} max={540} resetTo={104} />,
    );
    fireEvent.dblClick(screen.getByRole('separator'));
    expect(onChange).toHaveBeenLastCalledWith(104);
  });
});

describe('Grip keyboard operation', () => {
  /** A grip wired to real state, so consecutive key presses compound. */
  function LiveGrip(props: Omit<Parameters<typeof Grip>[0], 'onChange'>) {
    const [size, setSize] = useState(props.size);
    return <Grip {...props} size={size} onChange={setSize} />;
  }

  it('grows the dock with ArrowUp and shrinks it with ArrowDown', async () => {
    const user = userEvent.setup();
    render(<LiveGrip orientation="horizontal" size={104} side="below" min={56} max={540} />);
    const grip = screen.getByRole('separator');
    grip.focus();
    await user.keyboard('{ArrowUp}');
    expect(grip.getAttribute('aria-valuenow')).toBe('120');
    await user.keyboard('{ArrowDown}');
    expect(grip.getAttribute('aria-valuenow')).toBe('104');
  });

  it('jumps to the bounds with Home and End', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Grip orientation="horizontal" size={104} onChange={onChange} side="below" min={56} max={540} />);
    screen.getByRole('separator').focus();
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith(540);
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith(56);
  });

  it('moves a vertical grip with the left and right arrows', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Grip size={300} onChange={onChange} side="left" min={210} max={560} />);
    screen.getByRole('separator').focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(316);
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(284);
  });
});
