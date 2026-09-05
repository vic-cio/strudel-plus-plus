/**
 * Pure reducer for plugin dock state and draggable floating-panel geometry.
 *
 * Instance-keyed: plugin references use stable instance IDs (`instanceId`)
 * rather than definition ids (`pluginId`), so a plugin definition can be
 * renamed or rebuilt without losing per-instance state.
 */

export type InstanceId = string;

export type DockPaneState = {
  tabs?: InstanceId[];
  active?: InstanceId;
};

export type DockState = {
  split?: boolean;
  panes?: DockPaneState[];
  pluginState?: Record<InstanceId, unknown>;
};

export type Geometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
};

export type FloatingPanel = {
  instanceId: InstanceId;
  geometry: Geometry;
};

export type DockAction =
  | { type: 'SET_DOCK'; dock: DockState }
  | { type: 'ADD_TAB'; paneIndex: number; instanceId: InstanceId }
  | { type: 'REMOVE_TAB'; paneIndex: number; instanceId: InstanceId }
  | { type: 'SET_ACTIVE'; paneIndex: number; instanceId: InstanceId }
  | { type: 'SET_SPLIT'; split: boolean }
  | { type: 'SET_PLUGIN_STATE'; instanceId: InstanceId; state: unknown }
  | { type: 'SET_GEOMETRY'; instanceId: InstanceId; geometry: Partial<Geometry> }
  | { type: 'MOVE_PANEL'; instanceId: InstanceId; delta: { x?: number; y?: number } }
  | { type: 'MIGRATE_DEFINITION_KEYED'; mapping: Record<string, InstanceId> };

export function dockReducer(state: DockState, action: DockAction): DockState {
  switch (action.type) {
    case 'SET_DOCK':
      return action.dock;
    case 'ADD_TAB': {
      const pane = state.panes?.[action.paneIndex] ?? { tabs: [] };
      const tabs = pane.tabs ?? [];
      if (!tabs.includes(action.instanceId)) {
        tabs.push(action.instanceId);
      }
      const nextPanes = [...(state.panes ?? [{ tabs: [] }])];
      nextPanes[action.paneIndex] = { ...pane, tabs, active: action.instanceId } as DockPaneState;
      return { ...state, panes: nextPanes as DockPaneState[] };
    }
    case 'REMOVE_TAB': {
      const pane = state.panes?.[action.paneIndex] ?? { tabs: [] };
      const tabs = (pane.tabs ?? []).filter((id) => id !== action.instanceId);
      const nextPanes = [...(state.panes ?? [{ tabs: [] }])];
      nextPanes[action.paneIndex] = { tabs, active: pane.active === action.instanceId ? (tabs[0] ?? undefined) : (pane.active ?? undefined) } as DockPaneState;
      return { ...state, panes: nextPanes as DockPaneState[] };
    }
    case 'SET_ACTIVE': {
      const pane = state.panes?.[action.paneIndex] ?? { tabs: [] };
      const nextPanes = [...(state.panes ?? [{ tabs: [] }])];
      nextPanes[action.paneIndex] = { ...pane, active: action.instanceId ?? undefined } as DockPaneState;
      return { ...state, panes: nextPanes as DockPaneState[] };
    }
    case 'SET_SPLIT':
      return { ...state, split: action.split };
    case 'SET_PLUGIN_STATE':
      return { ...state, pluginState: { ...state.pluginState, [action.instanceId]: action.state } };
    case 'SET_GEOMETRY':
    case 'MOVE_PANEL': {
      // Geometry handled separately; dock reducer ignores geometry actions (caller merges).
      return state;
    }
    case 'MIGRATE_DEFINITION_KEYED': {
      const nextPluginState: Record<string, unknown> = {};
      for (const [oldKey, newId] of Object.entries(action.mapping)) {
        if (state.pluginState && oldKey in state.pluginState) {
          nextPluginState[newId] = state.pluginState[oldKey];
        }
      }
      return { ...state, pluginState: nextPluginState };
    }
    default:
      return state;
  }
}
