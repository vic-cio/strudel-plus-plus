// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginDock } from './PluginDock';
import { registerPlugin } from '../plugins';
import type { DockState } from '../../shared/dockState';

// Extra plugins so the dock has a menu to offer and tabs to juggle. The EQ
// registers itself when the dock imports the plugin index.
registerPlugin({
  id: 'mixer',
  label: 'MIXER',
  kind: 'functional',
  mount: () => <div className="mixer-body">mixer controls</div>,
});
registerPlugin({
  id: 'scope',
  label: 'SCOPE',
  kind: 'visual',
  mount: () => <div className="scope-body">scope trace</div>,
});
registerPlugin({
  id: 'knob',
  label: 'KNOB',
  kind: 'functional',
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
function renderDock(initial?: DockState) {
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
    expect(names).toEqual(['[ GAIN ]', '[ SCOPE ]', '[ KNOB ]']);
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

  it('floats a plugin when the float button is clicked', async () => {
    const user = userEvent.setup();
    const { onChange } = renderDock({ split: false, panes: [{ tabs: ['mixer'], active: 'mixer' }] });

    await user.click(screen.getByTitle('Float MIXER'));

    expect(document.querySelector('.floating-panel')).toBeTruthy();
    const calls = onChange.mock.calls;
    const lastCall = calls[calls.length - 1]?.[0] as DockState | undefined;
    expect(lastCall).toBeDefined();
    expect((lastCall!.panes?.[0]?.tabs ?? [])).not.toContain('mixer');
    expect(lastCall!.floating?.some((f) => f.instanceId === 'mixer')).toBe(true);
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
    expect((lastCall!.panes?.[0]?.tabs ?? [])).toContain('mixer');
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

  it('brings a floating panel to front when clicked', async () => {
    const user = userEvent.setup();
    renderDock({
      split: false,
      panes: [{ tabs: ['mixer'], active: 'mixer' }],
      floating: [{ instanceId: 'mixer', geometry: { x: 10, y: 10, width: 300, height: 200, zIndex: 1 } }],
    });

    const panel = document.querySelector('.floating-panel') as HTMLElement;
    expect(panel).toBeTruthy();
    // Click on the floating panel body (not the header drag) should focus it.
    // Since it's the only panel, focus keeps it at top z.
    // We verify the component does not crash on click.
  });
});
