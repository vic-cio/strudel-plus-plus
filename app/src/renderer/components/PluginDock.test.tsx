// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginDock } from './PluginDock';
import { registerPlugin } from '../plugins';
import type { DockState } from '../../shared/dockState';
import type { FunctionPluginInstance } from '../plugins';

// The renamed TRIM device lazy-loads the live audio engine when its panel
// mounts; a resolved stub keeps these dock tests hermetic. The adapter seam
// itself is covered by gainAudio's own tests.
vi.mock('@strudel/webaudio', () => ({
  getAudioContext: () => ({ currentTime: 0 }),
  getSuperdoughAudioController: () => undefined,
}));

// Extra plugins so the dock has a menu to offer and tabs to juggle. The EQ
// registers itself when the dock imports the plugin index.
registerPlugin({
  id: 'mixer',
  label: 'MIXER',
  kind: 'functional',
  scope: 'session',
  mount: () => <div className="mixer-body">mixer controls</div>,
});
registerPlugin({
  id: 'scope',
  label: 'SCOPE',
  kind: 'visual',
  scope: 'session',
  mount: () => <div className="scope-body">scope trace</div>,
});
registerPlugin({
  id: 'knob',
  label: 'KNOB',
  kind: 'functional',
  scope: 'session',
  mount: ({ state, onState }) => (
    <button className="knob-turn" onClick={() => onState({ ...(state as object), turned: true })}>
      turn
    </button>
  ),
});

beforeEach(() => {
  // Keep jsdom's "not implemented" canvas noise out of the run; the EQ's own
  // tests cover the drawing path with a real fake context.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * The dock is controlled: the app owns the state and the dock reports changes.
 * The harness mirrors that, so mutations actually move the rendered panes the
 * way App's setDock does.
 */
function renderDock(initial?: DockState, floatingRoot?: HTMLElement) {
  const onChange = vi.fn();
  function Harness() {
    const [dock, setDock] = useState<DockState>(initial ?? { split: false, panes: [{ tabs: [] }] });
    return (
      <PluginDock
        dock={dock}
        onChange={(next) => {
          onChange(next);
          setDock(next);
        }}
        playing={false}
        floatingRoot={floatingRoot ?? null}
      />
    );
  }
  render(<Harness />);
  return { onChange };
}

describe('PluginDock', () => {
  it('shows an empty single pane with an add affordance', () => {
    renderDock();
    expect(screen.getByText('[ no device ]')).toBeTruthy();
    expect(screen.getByTitle('Add device')).toBeTruthy();
    expect(screen.getByTitle('Split into two panes')).toBeTruthy();
    expect(document.querySelectorAll('.dock-pane')).toHaveLength(1);
  });

  it('opens a plugin from the add menu and reports the change', async () => {
    const user = userEvent.setup();
    const { onChange } = renderDock();

    await user.click(screen.getByTitle('Add device'));
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '[ MIXER ]' }));

    expect(screen.getByRole('button', { name: '[ MIXER ]' })).toBeTruthy();
    expect(screen.getByText('mixer controls')).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith({ split: false, panes: [{ tabs: ['mixer'], active: 'mixer' }] });
  });

  it('lists only plugins that are not open anywhere', async () => {
    const user = userEvent.setup();
    renderDock({
      split: true,
      panes: [
        { tabs: ['eq'], active: 'eq' },
        { tabs: ['mixer'], active: 'mixer' },
      ],
    });

    await user.click(screen.getAllByTitle('Add device')[0]!);

    const names = within(screen.getByRole('menu'))
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(names).toEqual(['[ TRIM ]', '[ SCOPE ]', '[ KNOB ]']);
  });

  it('switches the visible plugin from the tab strip', async () => {
    const user = userEvent.setup();
    const { onChange } = renderDock({ split: false, panes: [{ tabs: ['eq', 'mixer'], active: 'eq' }] });
    expect(screen.getByText('[ no signal ]')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '[ MIXER ]' }));

    expect(screen.getByText('mixer controls')).toBeTruthy();
    expect(screen.queryByText('[ no signal ]')).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith({ split: false, panes: [{ tabs: ['eq', 'mixer'], active: 'mixer' }] });
  });

  it('falls back to the next tab when the shown plugin closes', async () => {
    const user = userEvent.setup();
    const { onChange } = renderDock({ split: false, panes: [{ tabs: ['eq', 'mixer'], active: 'eq' }] });

    await user.click(screen.getByTitle('Close EQ'));

    expect(screen.queryByText('[ no signal ]')).toBeNull();
    expect(screen.getByText('mixer controls')).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith({ split: false, panes: [{ tabs: ['mixer'], active: 'mixer' }] });
  });

  it('returns to an empty pane when the last plugin closes', async () => {
    const user = userEvent.setup();
    renderDock({ split: false, panes: [{ tabs: ['eq'], active: 'eq' }] });

    await user.click(screen.getByTitle('Close EQ'));

    expect(screen.getByText('[ no device ]')).toBeTruthy();
  });

  it('splits into two panes and merges back without closing devices', async () => {
    const user = userEvent.setup();
    const { onChange } = renderDock({ split: false, panes: [{ tabs: ['eq'], active: 'eq' }] });

    await user.click(screen.getByTitle('Split into two panes'));
    expect(document.querySelectorAll('.dock-pane')).toHaveLength(2);
    expect(onChange).toHaveBeenLastCalledWith({ split: true, panes: [{ tabs: ['eq'], active: 'eq' }, { tabs: [] }] });

    const secondPane = document.querySelectorAll('.dock-pane')[1] as HTMLElement;
    await user.click(within(secondPane).getByTitle('Add device'));
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '[ MIXER ]' }));
    await user.click(screen.getAllByTitle('Merge back to one pane')[0]!);

    expect(document.querySelectorAll('.dock-pane')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '[ EQ ]' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '[ MIXER ]' })).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith({ split: false, panes: [{ tabs: ['eq', 'mixer'], active: 'eq' }] });
  });

  it('renders unknown plugin ids as nothing, not as broken tabs', () => {
    renderDock({ split: false, panes: [{ tabs: ['ghost'] }] });
    expect(screen.getByText('[ no device ]')).toBeTruthy();
    expect(screen.queryByText('[ GHOST ]')).toBeNull();
  });

  it('hands each plugin its own persisted slice and writes changes back', async () => {
    const user = userEvent.setup();
    const { onChange } = renderDock({
      split: false,
      panes: [{ tabs: ['knob'], active: 'knob' }],
      pluginState: { knob: { turned: false } },
    });

    await user.click(screen.getByText('turn'));

    expect(onChange).toHaveBeenLastCalledWith({
      split: false,
      panes: [{ tabs: ['knob'], active: 'knob' }],
      pluginState: { knob: { turned: true } },
    });
  });

  it('floats a plugin when its tab is dragged past the movement threshold', () => {
    const overlay = document.createElement('div');
    document.body.append(overlay);
    Object.defineProperties(overlay, {
      offsetWidth: { configurable: true, value: 1000 },
      offsetHeight: { configurable: true, value: 700 },
    });
    const { onChange } = renderDock({ split: false, panes: [{ tabs: ['mixer'], active: 'mixer' }] }, overlay);
    const tab = screen.getByRole('button', { name: '[ MIXER ]' });
    fireEvent.pointerDown(tab, { pointerId: 11, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(tab, { pointerId: 11, clientX: 60, clientY: 70 });
    fireEvent.pointerUp(tab, { pointerId: 11, clientX: 60, clientY: 70 });

    expect(document.querySelector('.floating-panel')).toBeTruthy();
    expect(onChange.mock.lastCall?.[0]).toMatchObject({
      panes: [{ tabs: [] }],
      floating: [{ instanceId: 'mixer' }],
    });
    overlay.remove();
  });

  it('keeps a click on a dock tab as selection instead of starting a drag', async () => {
    const user = userEvent.setup();
    const { onChange } = renderDock({ split: false, panes: [{ tabs: ['eq', 'mixer'], active: 'eq' }] });

    await user.click(screen.getByRole('button', { name: '[ MIXER ]' }));

    expect(screen.getByText('mixer controls')).toBeTruthy();
    expect(document.querySelector('.floating-panel')).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith({
      split: false,
      panes: [{ tabs: ['eq', 'mixer'], active: 'mixer' }],
    });
  });

  it('floats a plugin when the float button is clicked', async () => {
    const user = userEvent.setup();
    const { onChange } = renderDock({ split: false, panes: [{ tabs: ['mixer'], active: 'mixer' }] });

    await user.click(screen.getByTitle('Float MIXER'));

    expect(document.querySelector('.floating-panel')).toBeTruthy();
    const calls = onChange.mock.calls;
    const lastCall = calls[calls.length - 1]?.[0] as DockState | undefined;
    expect(lastCall).toBeDefined();
    expect(lastCall!.panes?.[0]?.tabs ?? []).not.toContain('mixer');
    expect(lastCall!.floating?.some((f) => f.instanceId === 'mixer')).toBe(true);
  });

  it('closes a floating EQ instead of reattaching or cloning it', async () => {
    const user = userEvent.setup();
    const { onChange } = renderDock({
      split: false,
      panes: [{ tabs: [] }],
      floating: [{ instanceId: 'eq', geometry: { x: 30, y: 30, width: 320, height: 180, zIndex: 2 } }],
    });

    await user.click(screen.getByTitle('Close EQ'));

    const lastDock = onChange.mock.lastCall?.[0] as DockState | undefined;
    expect(lastDock?.panes?.[0]?.tabs ?? []).not.toContain('eq');
    expect(lastDock?.floating ?? []).toHaveLength(0);
    expect(screen.queryByText('[ no signal ]')).toBeNull();
  });

  it('closes a floating panel and reattaches it to the first pane', async () => {
    const user = userEvent.setup();
    const { onChange } = renderDock({
      split: false,
      panes: [{ tabs: ['mixer'], active: 'mixer' }],
      floating: [{ instanceId: 'mixer', geometry: { x: 30, y: 30, width: 320, height: 180, zIndex: 2 } }],
    });

    await user.click(screen.getByTitle('Reattach MIXER'));

    const calls = onChange.mock.calls;
    const lastCall = calls[calls.length - 1]?.[0] as DockState | undefined;
    expect(lastCall).toBeDefined();
    expect(lastCall!.panes?.[0]?.tabs ?? []).toContain('mixer');
  });

  it('keeps active plugin control working inside a floating panel', async () => {
    const user = userEvent.setup();
    const { onChange } = renderDock({
      split: false,
      panes: [{ tabs: ['knob'], active: 'knob' }],
      floating: [{ instanceId: 'knob', geometry: { x: 10, y: 10, width: 320, height: 180, zIndex: 1 } }],
      pluginState: { knob: { turned: false } },
    });

    const buttons = screen.getAllByText('turn');
    await user.click(buttons[buttons.length - 1] as HTMLElement);
    const calls = onChange.mock.calls;
    const lastCall = calls[calls.length - 1]?.[0] as DockState | undefined;
    expect(lastCall).toBeDefined();
    expect(lastCall!.pluginState ? lastCall!.pluginState.knob : undefined).toEqual({ turned: true });
  });

  it('moves a floating panel while its header owns the pointer gesture', () => {
    const editorViewport = document.createElement('div');
    document.body.append(editorViewport);
    Object.defineProperties(editorViewport, {
      offsetWidth: { configurable: true, value: 800 },
      offsetHeight: { configurable: true, value: 500 },
    });
    const { onChange } = renderDock(
      {
        split: false,
        panes: [{ tabs: [] }],
        floating: [{ instanceId: 'mixer', geometry: { x: 10, y: 10, width: 120, height: 80, zIndex: 1 } }],
      },
      editorViewport,
    );
    const header = document.querySelector('.floating-header');
    expect(header).not.toBeNull();
    if (!header) return;
    expect(header.parentElement?.parentElement).toBe(editorViewport);
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.assign(header, {
      setPointerCapture,
      hasPointerCapture: () => true,
      releasePointerCapture,
    });

    expect(fireEvent.pointerDown(header, { pointerId: 7, clientX: 20, clientY: 20 })).toBe(false);
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    fireEvent.pointerMove(header, { pointerId: 7, clientX: 70, clientY: 80 });
    fireEvent.pointerUp(header, { pointerId: 7, clientX: 70, clientY: 80 });

    const lastDock = onChange.mock.lastCall?.[0] as DockState | undefined;
    expect(lastDock?.floating?.[0]?.geometry).toMatchObject({ x: 60, y: 70 });
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    editorViewport.remove();
  });

  it('brings a floating panel to front when clicked', async () => {
    const user = userEvent.setup();
    const { onChange } = renderDock({
      split: false,
      panes: [{ tabs: [] }],
      floating: [
        { instanceId: 'mixer', geometry: { x: 10, y: 10, width: 300, height: 200, zIndex: 1 } },
        { instanceId: 'scope', geometry: { x: 20, y: 20, width: 300, height: 200, zIndex: 2 } },
      ],
    });

    const panel = [...document.querySelectorAll<HTMLElement>('.floating-panel')].find((candidate) =>
      candidate.textContent?.includes('MIXER'),
    );
    expect(panel).toBeDefined();
    if (!panel) return;
    await user.click(panel);

    const lastDock = onChange.mock.lastCall?.[0] as DockState | undefined;
    expect(lastDock?.floating?.find((candidate) => candidate.instanceId === 'mixer')?.geometry.zIndex).toBe(3);
  });

  it('drops an exact-function panel into the lower dock without persisting it', () => {
    const initial: FunctionPluginInstance = {
      instanceId: 'function:drums.js:gain:0:13',
      pluginId: 'function-gain',
      beat: 'drums.js',
      functionName: 'gain',
      functionRange: { from: { line: 0, ch: 8 }, to: { line: 0, ch: 12 } },
      range: { from: { line: 0, ch: 13 }, to: { line: 0, ch: 17 } },
      value: 0.25,
      placement: {
        kind: 'floating',
        geometry: { x: 10, y: 10, width: 280, height: 132, zIndex: 100 },
      },
    };
    const onDockChange = vi.fn();
    const onFunctionChange = vi.fn();
    function Harness() {
      const [instances, setInstances] = useState([initial]);
      return (
        <PluginDock
          dock={{ split: false, panes: [{ tabs: [] }] }}
          onChange={onDockChange}
          playing={false}
          functionPlugins={{
            instances,
            onChange: (next) => {
              onFunctionChange(next);
              setInstances(next);
            },
            onValue: vi.fn(),
          }}
        />
      );
    }
    render(<Harness />);
    const dock = screen.getByRole('region', { name: 'plugin dock' });
    // Hit-testing measures the live pane rectangles, so the pane itself is
    // mocked — the section rect is never consulted.
    const pane = dock.querySelector<HTMLElement>('.dock-pane');
    expect(pane).not.toBeNull();
    vi.spyOn(pane!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 100,
      left: 0,
      top: 100,
      right: 800,
      bottom: 240,
      width: 800,
      height: 140,
      toJSON: () => ({}),
    });
    Object.defineProperties(dock, {
      offsetWidth: { configurable: true, value: 800 },
      offsetHeight: { configurable: true, value: 500 },
    });
    const header = document.querySelector('.function-floating-header');
    expect(header).not.toBeNull();

    fireEvent.pointerDown(header!, { pointerId: 9, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(header!, { pointerId: 9, clientX: 60, clientY: 130 });
    expect(dock.querySelector('.dock-pane')?.className).toContain('dock-pane-drop-target');
    fireEvent.pointerUp(header!, { pointerId: 9, clientX: 60, clientY: 130 });
    expect(dock.querySelector('.dock-pane')?.className).not.toContain('dock-pane-drop-target');

    expect(onFunctionChange.mock.lastCall?.[0][0].placement).toEqual({ kind: 'docked' });
    expect(document.querySelector('.function-docked-panel')).toBeTruthy();
    expect(onDockChange).not.toHaveBeenCalled();
  });

  it('drags a floating panel against the app overlay bounds, not a pane', () => {
    const overlay = document.createElement('div');
    document.body.append(overlay);
    Object.defineProperties(overlay, {
      offsetWidth: { configurable: true, value: 1000 },
      offsetHeight: { configurable: true, value: 700 },
    });
    const { onChange } = renderDock(
      {
        split: false,
        panes: [{ tabs: [] }],
        floating: [{ instanceId: 'mixer', geometry: { x: 10, y: 10, width: 120, height: 80, zIndex: 1 } }],
      },
      overlay,
    );
    const panel = document.querySelector('.floating-panel');
    expect(panel).not.toBeNull();
    if (!panel) return;
    // The panel lives in the app-level overlay, the one coordinate space
    // that spans every pane of the app.
    expect(panel.parentElement).toBe(overlay);
    const header = panel.querySelector('.floating-header');
    expect(header).not.toBeNull();
    if (!header) return;

    fireEvent.pointerDown(header, { pointerId: 4, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(header, { pointerId: 4, clientX: 2000, clientY: 2000 });
    fireEvent.pointerUp(header, { pointerId: 4, clientX: 2000, clientY: 2000 });

    // A drag far past the overlay's edge clamps to the overlay's own bounds
    // (1000×700), not to any single pane inside it.
    const lastDock = onChange.mock.lastCall?.[0] as DockState | undefined;
    expect(lastDock?.floating?.[0]?.geometry).toMatchObject({ x: 880, y: 620 });
    overlay.remove();
  });

  it('highlights the dock as a drop target only while a dragged panel hovers it', () => {
    const overlay = document.createElement('div');
    document.body.append(overlay);
    Object.defineProperties(overlay, {
      offsetWidth: { configurable: true, value: 1000 },
      offsetHeight: { configurable: true, value: 700 },
    });
    renderDock(
      {
        split: false,
        panes: [{ tabs: [] }],
        floating: [{ instanceId: 'mixer', geometry: { x: 10, y: 10, width: 120, height: 80, zIndex: 1 } }],
      },
      overlay,
    );
    const dock = screen.getByRole('region', { name: 'plugin dock' });
    // Hit-testing measures the live pane rectangles, so the pane itself is
    // mocked — the section rect is never consulted.
    const pane = dock.querySelector<HTMLElement>('.dock-pane');
    expect(pane).not.toBeNull();
    vi.spyOn(pane!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 500,
      left: 0,
      top: 500,
      right: 1000,
      bottom: 640,
      width: 1000,
      height: 140,
      toJSON: () => ({}),
    });
    const header = document.querySelector('.floating-panel .floating-header');
    expect(header).not.toBeNull();
    if (!header) return;

    fireEvent.pointerDown(header, { pointerId: 5, clientX: 30, clientY: 30 });
    // Over the dock: the hovered pane shows the pale-yellow drop target.
    fireEvent.pointerMove(header, { pointerId: 5, clientX: 200, clientY: 550 });
    expect(dock.querySelector('.dock-pane')?.className).toContain('dock-pane-drop-target');
    // Back out over the editor: the highlight goes away, the panel floats on.
    fireEvent.pointerMove(header, { pointerId: 5, clientX: 200, clientY: 300 });
    expect(dock.querySelector('.dock-pane')?.className).not.toContain('dock-pane-drop-target');
    expect(document.querySelector('.floating-panel')).toBeTruthy();
    overlay.remove();
  });

  it('docks a floating session panel into the hovered right split pane', () => {
    const overlay = document.createElement('div');
    document.body.append(overlay);
    Object.defineProperties(overlay, {
      offsetWidth: { configurable: true, value: 1000 },
      offsetHeight: { configurable: true, value: 700 },
    });
    const { onChange } = renderDock(
      {
        split: true,
        panes: [{ tabs: ['eq'] }, { tabs: ['scope'] }],
        floating: [{ instanceId: 'mixer', geometry: { x: 10, y: 10, width: 120, height: 80, zIndex: 1 } }],
      },
      overlay,
    );
    screen.getByRole('region', { name: 'plugin dock' });
    const panes = [...document.querySelectorAll<HTMLElement>('.dock-pane')];
    for (const [index, pane] of panes.entries()) {
      vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({
        x: index * 500,
        y: 500,
        left: index * 500,
        top: 500,
        right: (index + 1) * 500,
        bottom: 640,
        width: 500,
        height: 140,
        toJSON: () => ({}),
      });
    }
    const header = document.querySelector('.floating-panel .floating-header');
    expect(header).not.toBeNull();
    if (!header) return;

    fireEvent.pointerDown(header, { pointerId: 12, clientX: 30, clientY: 30 });
    fireEvent.pointerMove(header, { pointerId: 12, clientX: 700, clientY: 560 });
    expect(panes[1]?.className).toContain('dock-pane-drop-target');
    expect(panes[0]?.className).not.toContain('dock-pane-drop-target');
    fireEvent.pointerUp(header, { pointerId: 12, clientX: 700, clientY: 560 });

    const lastDock = onChange.mock.lastCall?.[0] as DockState | undefined;
    expect(lastDock?.panes?.[0]?.tabs).toEqual(['eq']);
    expect(lastDock?.panes?.[1]?.tabs).toContain('mixer');
    expect(lastDock?.floating ?? []).toHaveLength(0);
    // No manual dock teardown: the section stays mounted for RTL cleanup,
    // which unmounts it. Removing it here makes cleanup remove a detached
    // node and throws NotFoundError.
    overlay.remove();
  });

  it('auto-splits a full-width dock on the side where a floating panel is dropped', () => {
    const overlay = document.createElement('div');
    document.body.append(overlay);
    Object.defineProperties(overlay, {
      offsetWidth: { configurable: true, value: 1000 },
      offsetHeight: { configurable: true, value: 700 },
    });
    const { onChange } = renderDock(
      {
        split: false,
        panes: [{ tabs: ['eq'], active: 'eq' }],
        floating: [{ instanceId: 'mixer', geometry: { x: 10, y: 10, width: 120, height: 80, zIndex: 1 } }],
      },
      overlay,
    );
    const pane = document.querySelector<HTMLElement>('.dock-pane');
    expect(pane).not.toBeNull();
    if (!pane) return;
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 500,
      left: 0,
      top: 500,
      right: 1000,
      bottom: 640,
      width: 1000,
      height: 140,
      toJSON: () => ({}),
    });
    const header = document.querySelector('.floating-panel .floating-header');
    expect(header).not.toBeNull();
    if (!header) return;

    fireEvent.pointerDown(header, { pointerId: 13, clientX: 30, clientY: 30 });
    fireEvent.pointerMove(header, { pointerId: 13, clientX: 800, clientY: 560 });
    expect(pane.className).toContain('dock-pane-drop-target');
    fireEvent.pointerUp(header, { pointerId: 13, clientX: 800, clientY: 560 });

    const lastDock = onChange.mock.lastCall?.[0] as DockState | undefined;
    expect(lastDock?.split).toBe(true);
    expect(lastDock?.panes?.[0]?.tabs).toEqual(['eq']);
    expect(lastDock?.panes?.[1]?.tabs).toContain('mixer');
    expect(lastDock?.floating ?? []).toHaveLength(0);
    overlay.remove();
  });

  it('docks a floating session panel released over the dock', () => {
    const overlay = document.createElement('div');
    document.body.append(overlay);
    Object.defineProperties(overlay, {
      offsetWidth: { configurable: true, value: 1000 },
      offsetHeight: { configurable: true, value: 700 },
    });
    const { onChange } = renderDock(
      {
        split: false,
        panes: [{ tabs: ['eq'] }],
        floating: [{ instanceId: 'mixer', geometry: { x: 10, y: 10, width: 120, height: 80, zIndex: 1 } }],
      },
      overlay,
    );
    const dock = screen.getByRole('region', { name: 'plugin dock' });
    // Hit-testing measures the live pane rectangles, so the pane itself is
    // mocked — the section rect is never consulted.
    const pane = dock.querySelector<HTMLElement>('.dock-pane');
    expect(pane).not.toBeNull();
    vi.spyOn(pane!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 500,
      left: 0,
      top: 500,
      right: 1000,
      bottom: 640,
      width: 1000,
      height: 140,
      toJSON: () => ({}),
    });
    const header = document.querySelector('.floating-panel .floating-header');
    expect(header).not.toBeNull();
    if (!header) return;

    fireEvent.pointerDown(header, { pointerId: 6, clientX: 30, clientY: 30 });
    fireEvent.pointerMove(header, { pointerId: 6, clientX: 400, clientY: 560 });
    fireEvent.pointerUp(header, { pointerId: 6, clientX: 400, clientY: 560 });

    const lastDock = onChange.mock.lastCall?.[0] as DockState | undefined;
    expect(lastDock?.panes?.[0]?.tabs).toContain('mixer');
    expect(lastDock?.floating ?? []).toHaveLength(0);
    expect(document.querySelector('.floating-panel')).toBeNull();
    expect(dock.className).not.toContain('dock-drop-target');
    overlay.remove();
  });

  it('does not drag or dock from a press on the floating close button', () => {
    const overlay = document.createElement('div');
    document.body.append(overlay);
    Object.defineProperties(overlay, {
      offsetWidth: { configurable: true, value: 1000 },
      offsetHeight: { configurable: true, value: 700 },
    });
    const { onChange } = renderDock(
      {
        split: false,
        panes: [{ tabs: [] }],
        floating: [{ instanceId: 'mixer', geometry: { x: 10, y: 10, width: 120, height: 80, zIndex: 1 } }],
      },
      overlay,
    );
    const header = document.querySelector('.floating-header');
    expect(header).not.toBeNull();
    if (!header) return;
    const close = header.querySelector('button.floating-close');
    expect(close).not.toBeNull();
    if (!close) return;
    const setPointerCapture = vi.fn();
    Object.assign(header, { setPointerCapture, hasPointerCapture: () => true });

    // A press that begins on the close button never becomes a drag gesture:
    // no capture, and a wide pointer travel writes no geometry at all.
    fireEvent.pointerDown(close, { pointerId: 7, clientX: 20, clientY: 20 });
    expect(setPointerCapture).not.toHaveBeenCalled();
    fireEvent.pointerMove(header, { pointerId: 7, clientX: 500, clientY: 500 });
    fireEvent.pointerUp(header, { pointerId: 7, clientX: 500, clientY: 500 });
    expect(onChange).not.toHaveBeenCalled();

    // The click still closes through the shared path, reattaching cleanly.
    fireEvent.click(close);
    const lastDock = onChange.mock.lastCall?.[0] as DockState | undefined;
    expect(lastDock?.panes?.[0]?.tabs).toContain('mixer');
    expect(lastDock?.floating ?? []).toHaveLength(0);
    overlay.remove();
  });

  it('never offers a plugin that is already floating in the add menu', async () => {
    const user = userEvent.setup();
    renderDock({
      split: false,
      panes: [{ tabs: ['eq'] }],
      floating: [{ instanceId: 'mixer', geometry: { x: 10, y: 10, width: 320, height: 180, zIndex: 1 } }],
    });

    await user.click(screen.getByTitle('Add device'));

    const names = within(screen.getByRole('menu'))
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(names).toEqual(['[ TRIM ]', '[ SCOPE ]', '[ KNOB ]']);
  });

  it('closing a floating panel already open in a pane never clones the plugin', async () => {
    const user = userEvent.setup();
    const { onChange } = renderDock({
      split: true,
      panes: [{ tabs: ['eq'] }, { tabs: ['mixer'] }],
      floating: [{ instanceId: 'mixer', geometry: { x: 10, y: 10, width: 320, height: 180, zIndex: 1 } }],
    });

    await user.click(screen.getByTitle('Reattach MIXER'));

    const lastDock = onChange.mock.lastCall?.[0] as DockState | undefined;
    const openPanes = (lastDock?.panes ?? []).filter((pane) => (pane.tabs ?? []).includes('mixer'));
    expect(openPanes).toHaveLength(1);
    expect(lastDock?.panes?.[1]?.tabs).toContain('mixer');
    expect(lastDock?.floating ?? []).toHaveLength(0);
  });

  it('titles a floating function control with its exact call and line', () => {
    const instance: FunctionPluginInstance = {
      instanceId: 'function:drums.js:gain:1:13',
      pluginId: 'function-gain',
      beat: 'drums.js',
      functionName: 'gain',
      functionRange: { from: { line: 1, ch: 8 }, to: { line: 1, ch: 12 } },
      range: { from: { line: 1, ch: 13 }, to: { line: 1, ch: 17 } },
      value: 0.25,
      placement: {
        kind: 'floating',
        geometry: { x: 10, y: 10, width: 280, height: 132, zIndex: 100 },
      },
    };
    function Harness() {
      const [instances, setInstances] = useState([instance]);
      return (
        <PluginDock
          dock={{ split: false, panes: [{ tabs: [] }] }}
          onChange={vi.fn()}
          playing={false}
          functionPlugins={{
            instances,
            onChange: (next) => setInstances(next),
            onValue: vi.fn(),
          }}
        />
      );
    }
    render(<Harness />);

    const header = document.querySelector('.function-floating-header');
    expect(header?.textContent).toContain('[ GAIN · gain @ line 2 ]');
    expect(screen.getByTitle('Close gain @ line 2 control')).toBeTruthy();
  });

  it('titles a docked function tab with its exact call and line', () => {
    const instance: FunctionPluginInstance = {
      instanceId: 'function:drums.js:gain:1:13',
      pluginId: 'function-gain',
      beat: 'drums.js',
      functionName: 'gain',
      functionRange: { from: { line: 1, ch: 8 }, to: { line: 1, ch: 12 } },
      range: { from: { line: 1, ch: 13 }, to: { line: 1, ch: 17 } },
      value: 0.25,
      placement: { kind: 'docked' },
    };
    function Harness() {
      const [instances, setInstances] = useState([instance]);
      return (
        <PluginDock
          dock={{ split: false, panes: [{ tabs: [] }] }}
          onChange={vi.fn()}
          playing={false}
          functionPlugins={{
            instances,
            onChange: (next) => setInstances(next),
            onValue: vi.fn(),
          }}
        />
      );
    }
    render(<Harness />);

    expect(screen.getByRole('button', { name: '[ GAIN · gain @ line 2 ]' })).toBeTruthy();
    expect(screen.getByTitle('Float gain @ line 2 control')).toBeTruthy();
  });

  it('renders the renamed TRIM device under its stable gain id', () => {
    // Sessions remember the device by id ('gain'), so the TRIM rename must
    // stay presentation-only: restored state keeps resolving to the tab.
    renderDock({ split: false, panes: [{ tabs: ['eq', 'gain'], active: 'eq' }] });

    expect(screen.getByRole('button', { name: '[ TRIM ]' })).toBeTruthy();
    expect(screen.getByTitle('Close TRIM')).toBeTruthy();
  });

  it('reattaches a floating TRIM panel through the shared close path', async () => {
    const user = userEvent.setup();
    const { onChange } = renderDock({
      split: false,
      panes: [{ tabs: [] }],
      floating: [{ instanceId: 'gain', geometry: { x: 10, y: 10, width: 320, height: 180, zIndex: 1 } }],
    });

    await user.click(screen.getByTitle('Reattach TRIM'));

    const lastDock = onChange.mock.lastCall?.[0] as DockState | undefined;
    expect(lastDock?.panes?.[0]?.tabs).toEqual(['gain']);
    expect(lastDock?.floating ?? []).toHaveLength(0);
  });
});
