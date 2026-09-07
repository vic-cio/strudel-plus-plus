import type { DockPaneState, DockState, FloatingPanel } from './dockReducer';

export type DockPaneBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type DockDropTarget = {
  paneIndex: number;
  side: 'left' | 'right';
  autoSplit: boolean;
};

/** Resolve a pointer to the pane it is actually over, not merely the dock. */
export function resolveDockDropTarget(args: {
  x: number;
  y: number;
  panes: readonly DockPaneBounds[];
}): DockDropTarget | undefined {
  const paneIndex = args.panes.findIndex(
    (pane) => args.x >= pane.left && args.x <= pane.right && args.y >= pane.top && args.y <= pane.bottom,
  );
  if (paneIndex < 0) return undefined;
  const pane = args.panes[paneIndex];
  if (!pane) return undefined;
  // The half is dock-relative, not pane-relative: with two 500px panes the
  // overall midpoint is 500, so x=250 reads left and x=750 reads right.
  // Pane-relative midpoints would flip both boundary halves.
  const dockLeft = Math.min(...args.panes.map((candidate) => candidate.left));
  const dockRight = Math.max(...args.panes.map((candidate) => candidate.right));
  const side = args.x <= dockLeft + (dockRight - dockLeft) / 2 ? 'left' : 'right';
  return {
    paneIndex,
    side,
    autoSplit: args.panes.length === 1,
  };
}

/** Remove one floating panel and put it in the precise pane under the pointer. */
export function splitDockForTarget(state: DockState, target: DockDropTarget): DockState {
  if (!target.autoSplit || (state.panes ?? []).length !== 1) return state;
  const existing = state.panes?.[0] ?? { tabs: [] };
  const empty: DockPaneState = { tabs: [] };
  return target.side === 'left'
    ? { ...state, split: true, panes: [empty, existing] }
    : { ...state, split: true, panes: [existing, empty] };
}

export function dropFloatingPanel(state: DockState, instanceId: string, target: DockDropTarget): DockState {
  const floating = (state.floating ?? []).filter((panel) => panel.instanceId !== instanceId);
  if (floating.length === (state.floating ?? []).length) return state;

  const sourcePanes = state.panes ?? [{ tabs: [] }];
  const panes = sourcePanes.map((pane) => removeInstance(pane, instanceId));
  if (target.autoSplit && panes.length === 1) {
    const existing = panes[0] ?? { tabs: [] };
    const dropped = { tabs: [instanceId], active: instanceId };
    const nextPanes = target.side === 'left' ? [dropped, existing] : [existing, dropped];
    return withFloating({ ...state, split: true, panes: nextPanes }, floating);
  }

  const paneIndex = Math.min(Math.max(target.paneIndex, 0), panes.length - 1);
  const pane = panes[paneIndex] ?? { tabs: [] };
  panes[paneIndex] = { tabs: [...(pane.tabs ?? []), instanceId], active: instanceId };
  return withFloating({ ...state, panes }, floating);
}

function removeInstance(pane: DockPaneState, instanceId: string): DockPaneState {
  const tabs = (pane.tabs ?? []).filter((tab) => tab !== instanceId);
  const active = pane.active === instanceId ? tabs[0] : pane.active;
  return active === undefined ? { tabs } : { tabs, active };
}

function withFloating(state: DockState, floating: FloatingPanel[]): DockState {
  if (floating.length > 0) return { ...state, floating };
  const { floating: _, ...withoutFloating } = state;
  return withoutFloating;
}
