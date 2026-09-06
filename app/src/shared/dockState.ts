/**
 * The plugin dock's session-scoped state.
 *
 * Plugins are live gear: they hold across beat switches within a session, so
 * which devices are open, how the dock is split, and each plugin's own
 * fader and knob values are remembered next to the tempo and sort state in
 * `.session.json`. Nothing here is per-beat, so the session store's prune
 * must leave it alone — a channel mixer left open while beats change under
 * it is the whole point.
 */

export type DockPaneState = {
  /** Plugin ids open as tabs in this pane, in tab order. */
  tabs?: string[];
  /** The tab the pane shows; always a member of `tabs` when set. */
  active?: string;
};

import type { FloatingPanel, Geometry } from './dockReducer';

export type DockState = {
  /** Two panes side by side, or one full-width pane. */
  split?: boolean;
  /** One entry per pane; exactly `split ? 2 : 1` entries once normalized. */
  panes?: DockPaneState[];
  /** Per-plugin UI state (faders, knobs), keyed by plugin id. */
  pluginState?: Record<string, unknown>;
  /** Floating panels detached from the dock panes. */
  floating?: FloatingPanel[];
};

/** What normalizeDockState produces: every field present, nothing unknown. */
export type NormalizedDockState = {
  split: boolean;
  panes: DockPaneState[];
  pluginState?: Record<string, unknown>;
  floating?: FloatingPanel[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPane(value: unknown): value is DockPaneState {
  if (!isRecord(value)) {
    return false;
  }
  if (value.tabs !== undefined && !isStringArray(value.tabs)) {
    return false;
  }
  return value.active === undefined || typeof value.active === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Structural guard for dock state read back from `.session.json`. */
export function isDockState(value: unknown): value is DockState {
  if (!isRecord(value)) {
    return false;
  }
  if (value.split !== undefined && typeof value.split !== 'boolean') {
    return false;
  }
  if (value.panes !== undefined && !(Array.isArray(value.panes) && value.panes.every(isPane))) {
    return false;
  }
  if (value.pluginState !== undefined && !isRecord(value.pluginState)) {
    return false;
  }
  if (value.floating !== undefined && !(Array.isArray(value.floating) && value.floating.every(isFloatingPanel))) {
    return false;
  }
  return true;
}

function isFloatingPanel(value: unknown): value is FloatingPanel {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof (value as Record<string, unknown>).instanceId !== 'string') {
    return false;
  }
  const geo = (value as Record<string, unknown>).geometry;
  if (!isRecord(geo)) {
    return false;
  }
  return true;
}

/**
 * Canonicalize dock state against the ids that actually exist.
 *
 * Everything written or rendered goes through this: unknown ids (a plugin
 * removed by a later build, a hand-edited file) drop out, duplicates collapse,
 * `active` always names a tab that is open, and the pane count always matches
 * the split. Collapsing a split loses the second pane's tabs; the dock merges
 * them into the first pane before calling this.
 */
export function normalizeDockState(dock: DockState | undefined, knownIds: readonly string[]): NormalizedDockState {
  const known = new Set(knownIds);
  const split = dock?.split === true;
  const source = dock?.panes ?? [];
  const panes: DockPaneState[] = [];
  for (let index = 0; index < (split ? 2 : 1); index += 1) {
    panes.push(normalizePane(source[index], known));
  }
  const normalized: NormalizedDockState = { split, panes };
  if (dock?.pluginState && Object.keys(dock.pluginState).length > 0) {
    normalized.pluginState = { ...dock.pluginState };
  }
  if (dock?.floating !== undefined) {
    const floating: FloatingPanel[] = [];
    const seen = new Set<string>();
    for (const panel of dock.floating) {
      if (typeof panel?.instanceId === 'string' && known.has(panel.instanceId) && !seen.has(panel.instanceId)) {
        seen.add(panel.instanceId);
        const geo: Geometry = {
          x: typeof panel.geometry?.x === 'number' ? panel.geometry.x : 20,
          y: typeof panel.geometry?.y === 'number' ? panel.geometry.y : 20,
          width: typeof panel.geometry?.width === 'number' && panel.geometry.width > 0 ? panel.geometry.width : 320,
          height: typeof panel.geometry?.height === 'number' && panel.geometry.height > 0 ? panel.geometry.height : 180,
          zIndex: typeof panel.geometry?.zIndex === 'number' ? panel.geometry.zIndex : 1,
        };
        floating.push({ instanceId: panel.instanceId, geometry: geo });
      }
    }
    if (floating.length > 0) {
      normalized.floating = floating;
    }
  }
  return normalized;
}

function normalizePane(pane: DockPaneState | undefined, known: Set<string>): DockPaneState {
  const tabs: string[] = [];
  for (const id of pane?.tabs ?? []) {
    if (known.has(id) && !tabs.includes(id)) {
      tabs.push(id);
    }
  }
  const normalized: DockPaneState = { tabs };
  if (pane?.active && tabs.includes(pane.active)) {
    normalized.active = pane.active;
  } else if (tabs[0] !== undefined) {
    normalized.active = tabs[0];
  }
  return normalized;
}
