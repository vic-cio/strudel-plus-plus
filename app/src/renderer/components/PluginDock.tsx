import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeDockState, type DockPaneState, type DockState } from '../../shared/dockState';
import { defaultGeometry, clampGeometry, applyDelta, type Geometry } from '../../shared/geometry';
import type { FloatingPanel } from '../../shared/dockReducer';
import { listPlugins } from '../plugins';
import type { ControlContext } from '../plugins';
import type { PluginDef } from '../plugins/registry';

type Props = {
  /** The session's dock state, restored on open and persisted on change. */
  dock: DockState;
  onChange: (next: DockState) => void;
  /** True while the REPL runs; handed to visual plugins so they can idle. */
  playing: boolean;
  /** Current beat/function owner for scoped controls. */
  scope?: ControlContext;
};

export function PluginDock({ dock, onChange, playing, scope = {} }: Props) {
  const defs = listPlugins();
  const byId = new Map<string, PluginDef>(defs.map((def) => [def.id, def]));
  const state = normalizeDockState(
    dock,
    defs.map((def) => def.id),
  );
  const [menuPane, setMenuPane] = useState<number>();
  const rootRef = useRef<HTMLElement>(null);

  const openIds = new Set(state.panes.flatMap((pane) => pane.tabs ?? []));
  const candidates = defs.filter((def) => !openIds.has(def.id));

  const writePane = (index: number, next: DockPaneState) => {
    onChange(
      normalizeDockState({ ...state, panes: state.panes.map((pane, i) => (i === index ? next : pane)) }, [
        ...byId.keys(),
      ]),
    );
  };

  const addPlugin = (index: number, id: string) => {
    const pane = state.panes[index];
    writePane(index, { ...pane, tabs: [...(pane?.tabs ?? []), id], active: id });
  };

  const removePlugin = (index: number, id: string) => {
    const pane = state.panes[index] ?? {};
    const tabs = (pane.tabs ?? []).filter((tab) => tab !== id);
    const next: DockPaneState = { tabs };
    if (pane.active && pane.active !== id) {
      next.active = pane.active;
    } else if (tabs[0] !== undefined) {
      next.active = tabs[0];
    }
    writePane(index, next);
  };

  const floatPlugin = (id: string) => {
    const floating = state.floating ? [...state.floating] : [];
    // Remove from all pane tabs when floating (detach)
    const nextPanes = state.panes.map((pane) => {
      const tabs = (pane.tabs ?? []).filter((tab) => tab !== id);
      const activeValue = pane.active === id ? (tabs[0] ?? undefined) : (pane.active ?? undefined);
      const nextPane: DockPaneState = activeValue !== undefined ? { tabs, active: activeValue } : { tabs };
      return nextPane;
    });
    if (!floating.some((f) => f.instanceId === id)) {
      const currentZ = Math.max(0, ...floating.map((f) => f.geometry.zIndex));
      floating.push({ instanceId: id, geometry: defaultGeometry(320, 180, currentZ + 1) });
    } else {
      // Already floating; bring to front by increasing zIndex
      floating.forEach((f) => {
        if (f.instanceId === id) {
          f.geometry.zIndex = Math.max(...floating.map((ff) => ff.geometry.zIndex)) + 1;
        }
      });
    }
    const nextState: DockState = { ...state, panes: nextPanes };
    if (floating.length > 0) {
      (nextState as DockState & { floating?: FloatingPanel[] }).floating = floating;
    } else {
      delete (nextState as DockState & { floating?: FloatingPanel[] }).floating;
    }
    onChange(normalizeDockState(nextState, [...byId.keys()]));
  };

  const closeFloating = (id: string) => {
    const floating = (state.floating ?? []).filter((f) => f.instanceId !== id);
    // Reattach to first pane
    const nextPanes = [...state.panes];
    const firstPane = nextPanes[0] ?? { tabs: [] };
    const tabs = [...(firstPane.tabs ?? [])];
    if (!tabs.includes(id)) {
      tabs.push(id);
    }
    nextPanes[0] = { ...firstPane, tabs, active: id };
    const nextState: DockState = { ...state, panes: nextPanes };
    if (floating.length > 0) {
      nextState.floating = floating;
    }
    onChange(normalizeDockState(nextState, [...byId.keys()]));
  };

  const toggleSplit = () => {
    if (!state.split) {
      onChange(normalizeDockState({ ...state, split: true, panes: [...state.panes, {}] }, [...byId.keys()]));
      return;
    }
    const [first, second] = state.panes;
    const tabs = [...(first?.tabs ?? [])];
    for (const id of second?.tabs ?? []) {
      if (!tabs.includes(id)) {
        tabs.push(id);
      }
    }
    const pane: DockPaneState = { tabs };
    const active = first?.active ?? tabs[0];
    if (active !== undefined) {
      pane.active = active;
    }
    onChange(normalizeDockState({ split: false, panes: [pane] }, [...byId.keys()]));
  };

  const setPluginState = (id: string, next: unknown) => {
    onChange(
      normalizeDockState({ ...state, pluginState: { ...(state.pluginState ?? {}), [id]: next } }, [...byId.keys()]),
    );
  };

  // Drag state for floating panels
  const dragRef = useRef<{ id: string; startX: number; startY: number; startGeo: Geometry } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const onPointerDown = useCallback(
    (id: string, event: React.PointerEvent) => {
      const panel = state.floating?.find((f) => f.instanceId === id);
      if (!panel) return;
      event.preventDefault();
      dragRef.current = {
        id,
        startX: event.clientX,
        startY: event.clientY,
        startGeo: { ...panel.geometry },
      };
    },
    [state.floating],
  );

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!dragRef.current) return;
      const deltaX = event.clientX - dragRef.current.startX;
      const deltaY = event.clientY - dragRef.current.startY;
      const updated = applyDelta(dragRef.current.startGeo, { x: deltaX, y: deltaY });
      const container = { width: window.innerWidth, height: window.innerHeight };
      const clamped = clampGeometry(updated, container);
      const floating = (stateRef.current.floating ?? []).map((f) =>
        f.instanceId === dragRef.current!.id ? { ...f, geometry: clamped } : f,
      );
      // Update z-order to front
      const maxZ = Math.max(0, ...floating.map((f) => f.geometry.zIndex));
      floating.forEach((f) => {
        if (f.instanceId === dragRef.current!.id) {
          f.geometry.zIndex = maxZ + 1;
        }
      });
      onChange(normalizeDockState({ ...stateRef.current, floating }, [...byId.keys()]));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    if (dragRef.current) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onChange, byId]);

  // Focus behavior: clicking anywhere on floating panel brings to front
  const focusPanel = useCallback(
    (id: string) => {
      const currentFloating = state.floating ?? [];
      if (!currentFloating.some((f) => f.instanceId === id)) {
        return;
      }
      const maxZ = Math.max(0, ...currentFloating.map((f) => f.geometry.zIndex));
      if (currentFloating.some((f) => f.instanceId === id && f.geometry.zIndex === maxZ)) {
        return;
      }
      const floating = currentFloating.map((f) => ({
        ...f,
        geometry: {
          ...f.geometry,
          zIndex: f.instanceId === id ? maxZ + 1 : f.geometry.zIndex,
        },
      }));
      const nextState: DockState = { ...state, floating };
      onChange(normalizeDockState(nextState, [...byId.keys()]));
    },
    [state, onChange, byId],
  );

  // Add menu close behavior (existing)
  useEffect(() => {
    if (menuPane === undefined) return;
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setMenuPane(undefined);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuPane(undefined);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuPane]);

  return (
    <section className="dock" aria-label="plugin dock" ref={rootRef} style={{ position: 'relative' }}>
      <div className={state.split ? 'dock-panes split' : 'dock-panes'}>
        {state.panes.map((pane, index) => {
          const activeDef = pane.active ? byId.get(pane.active) : undefined;
          return (
            <div className="dock-pane" key={index}>
              <div className="dock-tabs">
                {(pane.tabs ?? []).map((id) => {
                  const def = byId.get(id);
                  if (!def) return null;
                  return (
                    <span className="dock-tab" key={id}>
                      <button
                        className="dock-tab-name"
                        aria-current={pane.active === id}
                        onClick={() => writePane(index, { ...pane, active: id })}
                      >
                        [ {def.label} ]
                      </button>
                      <button className="dock-tab-float" title={`Float ${def.label}`} onClick={() => floatPlugin(id)}>
                        ⧉
                      </button>
                      <button
                        className="dock-tab-close"
                        title={`Close ${def.label}`}
                        onClick={() => removePlugin(index, id)}
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
                <span className="dock-add-wrap">
                  <button
                    className="dock-add"
                    title={candidates.length > 0 ? 'Add device' : 'Every device is open'}
                    disabled={candidates.length === 0}
                    onClick={() => setMenuPane(menuPane === index ? undefined : index)}
                  >
                    ＋
                  </button>
                  {menuPane === index && (
                    <div className="dock-menu" role="menu">
                      {candidates.map((def) => (
                        <button
                          key={def.id}
                          role="menuitem"
                          onClick={() => {
                            addPlugin(index, def.id);
                            setMenuPane(undefined);
                          }}
                        >
                          [ {def.label} ]
                        </button>
                      ))}
                    </div>
                  )}
                </span>
                <button
                  className="dock-split"
                  title={state.split ? 'Merge back to one pane' : 'Split into two panes'}
                  onClick={toggleSplit}
                >
                  {state.split ? '[ merge ]' : '[ split ]'}
                </button>
              </div>
              <div className="dock-body">
                {activeDef ? (
                  <activeDef.mount
                    key={`${index}:${activeDef.id}`}
                    playing={playing}
                    state={state.pluginState?.[activeDef.id]}
                    onState={(next) => setPluginState(activeDef.id, next)}
                    scope={scope}
                  />
                ) : (
                  <div className="dock-empty">[ no device ]</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating panels */}
      {state.floating?.map((panel) => {
        const def = byId.get(panel.instanceId);
        if (!def) return null;
        return (
          <div
            key={panel.instanceId}
            className="floating-panel"
            style={{
              position: 'absolute',
              left: panel.geometry.x,
              top: panel.geometry.y,
              width: panel.geometry.width,
              height: panel.geometry.height,
              zIndex: panel.geometry.zIndex,
            }}
            onClick={() => focusPanel(panel.instanceId)}
          >
            <div
              className="floating-header"
              onPointerDown={(e) => onPointerDown(panel.instanceId, e)}
              style={{ cursor: 'move', userSelect: 'none' }}
            >
              <span>[ {def.label} ]</span>
              <button
                className="floating-close"
                title={`Reattach ${def.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeFloating(panel.instanceId);
                }}
              >
                ×
              </button>
            </div>
            <div className="floating-body">
              <def.mount
                playing={playing}
                state={state.pluginState?.[panel.instanceId]}
                onState={(next) => setPluginState(panel.instanceId, next)}
                scope={scope}
              />
            </div>
          </div>
        );
      })}
    </section>
  );
}
