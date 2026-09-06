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
  floating?: FloatingPanel[];
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
  | { type: 'FLOAT_PANEL'; instanceId: InstanceId; geometry?: Partial<Geometry> }
  | { type: 'CLOSE_FLOATING'; instanceId: InstanceId }
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
      nextPanes[action.paneIndex] = {
        tabs,
        active: pane.active === action.instanceId ? (tabs[0] ?? undefined) : (pane.active ?? undefined),
      } as DockPaneState;
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
    case 'SET_GEOMETRY': {
      const floating = state.floating ? [...state.floating] : [];
      const index = floating.findIndex((f) => f.instanceId === action.instanceId);
      if (index >= 0) {
        const panel = floating[index];
        if (!panel) return { ...state, floating };
        floating[index] = {
          instanceId: action.instanceId,
          geometry: {
            ...panel.geometry,
            ...action.geometry,
          },
        };
      } else {
        floating.push({
          instanceId: action.instanceId,
          geometry: {
            x: typeof action.geometry?.x === 'number' ? action.geometry.x : 20,
            y: typeof action.geometry?.y === 'number' ? action.geometry.y : 20,
            width:
              typeof action.geometry?.width === 'number' && action.geometry.width > 0 ? action.geometry.width : 320,
            height:
              typeof action.geometry?.height === 'number' && action.geometry.height > 0 ? action.geometry.height : 180,
            zIndex: typeof action.geometry?.zIndex === 'number' ? action.geometry.zIndex : 1,
          },
        });
      }
      return { ...state, floating };
    }
    case 'MOVE_PANEL': {
      const floating = state.floating ? [...state.floating] : [];
      const index = floating.findIndex((f) => f.instanceId === action.instanceId);
      if (index >= 0) {
        const panel = floating[index];
        if (!panel) return { ...state, floating };
        const geo = panel.geometry;
        floating[index] = {
          instanceId: action.instanceId,
          geometry: {
            ...geo,
            x: geo.x + (action.delta?.x ?? 0),
            y: geo.y + (action.delta?.y ?? 0),
          },
        };
      }
      return { ...state, floating };
    }
    case 'FLOAT_PANEL': {
      const floating = state.floating ? [...state.floating] : [];
      if (floating.some((f) => f.instanceId === action.instanceId)) {
        return { ...state, floating };
      }
      floating.push({
        instanceId: action.instanceId,
        geometry: {
          x: typeof action.geometry?.x === 'number' ? action.geometry.x : 20,
          y: typeof action.geometry?.y === 'number' ? action.geometry.y : 20,
          width: typeof action.geometry?.width === 'number' && action.geometry.width > 0 ? action.geometry.width : 320,
          height:
            typeof action.geometry?.height === 'number' && action.geometry.height > 0 ? action.geometry.height : 180,
          zIndex: typeof action.geometry?.zIndex === 'number' ? action.geometry.zIndex : 1,
        },
      });
      return { ...state, floating };
    }
    case 'CLOSE_FLOATING': {
      const floating = (state.floating ?? []).filter((f) => f.instanceId !== action.instanceId);
      if (floating.length > 0) {
        return { ...state, floating };
      }
      const { floating: _, ...rest } = state as DockState & { floating?: FloatingPanel[] };
      return rest as DockState;
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
