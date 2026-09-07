import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { normalizeDockState, type DockPaneState, type DockState } from '../../shared/dockState';
import { dockReducer } from '../../shared/dockReducer';
import { clampGeometry, applyDelta, defaultGeometry, type Geometry } from '../../shared/geometry';
import {
  listFunctionPlugins,
  listSessionPlugins,
  materializeFunctionControl,
  moveFunctionPlugin,
  type FunctionPluginInstance,
} from '../plugins';
import type { ControlContext } from '../plugins';
import type { SessionPluginDef } from '../plugins/registry';

type FunctionPlugins = {
  instances: readonly FunctionPluginInstance[];
  onChange: (next: FunctionPluginInstance[]) => void;
  onValue: (instanceId: string, value: number) => void;
};

type Props = {
  /** The session's dock state, restored on open and persisted on change. */
  dock: DockState;
  onChange: (next: DockState) => void;
  /** True while the REPL runs; handed to visual plugins so they can idle. */
  playing: boolean;
  /** Current beat/function owner for scoped controls. */
  scope?: ControlContext;
  /** Editor viewport that owns floating panels; omitted by isolated dock tests. */
  floatingRoot?: HTMLElement | null;
  /** Ephemeral controls bound to exact calls in the active beat. */
  functionPlugins?: FunctionPlugins;
};

export function PluginDock({ dock, onChange, playing, scope = {}, floatingRoot, functionPlugins }: Props) {
  const defs = listSessionPlugins();
  const byId = new Map<string, SessionPluginDef>(defs.map((def) => [def.id, def]));
  const functionById = new Map(listFunctionPlugins().map((def) => [def.id, def]));
  const functionInstances = functionPlugins?.instances ?? [];
  const state = normalizeDockState(
    dock,
    defs.map((def) => def.id),
  );
  const [menuPane, setMenuPane] = useState<number>();
  const [activeFunctionId, setActiveFunctionId] = useState<string>();
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
    onChange(normalizeDockState(dockReducer(state, { type: 'FLOAT_PANEL', instanceId: id }), [...byId.keys()]));
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
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    startGeo: Geometry;
  } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const onPointerDown = useCallback(
    (id: string, event: React.PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('button')) return;
      const panel = state.floating?.find((f) => f.instanceId === id);
      if (!panel) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragRef.current = {
        id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startGeo: { ...panel.geometry },
      };
    },
    [state.floating],
  );

  const onPointerMove = useCallback(
    (id: string, event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.id !== id || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      const updated = applyDelta(drag.startGeo, { x: deltaX, y: deltaY });
      const viewport = floatingRoot ?? rootRef.current;
      const container = viewport
        ? { width: viewport.offsetWidth, height: viewport.offsetHeight }
        : { width: window.innerWidth, height: window.innerHeight };
      const clamped = clampGeometry(updated, container);
      const floating = (stateRef.current.floating ?? []).map((f) =>
        f.instanceId === drag.id ? { ...f, geometry: clamped } : f,
      );
      const maxZ = Math.max(0, ...floating.map((f) => f.geometry.zIndex));
      const target = floating.find((f) => f.instanceId === drag.id);
      if (target && target.geometry.zIndex < maxZ) target.geometry.zIndex = maxZ + 1;
      onChange(normalizeDockState({ ...stateRef.current, floating }, [...byId.keys()]));
    },
    [byId, floatingRoot, onChange],
  );

  const stopDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // Capture can already be gone after pointercancel.
        }
      }
    }
  }, []);

  const functionInstancesRef = useRef(functionInstances);
  functionInstancesRef.current = functionInstances;
  const functionDragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    startGeo: Geometry;
  } | null>(null);

  const onFunctionPointerDown = useCallback(
    (id: string, event: React.PointerEvent<HTMLDivElement>) => {
      if (event.target instanceof Element && event.target.closest('button')) return;
      const instance = functionInstances.find((candidate) => candidate.instanceId === id);
      if (instance?.placement.kind !== 'floating') return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      functionDragRef.current = {
        id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startGeo: { ...instance.placement.geometry },
      };
      const maxZ = Math.max(
        0,
        ...functionInstances.flatMap((candidate) =>
          candidate.placement.kind === 'floating' ? [candidate.placement.geometry.zIndex] : [],
        ),
      );
      if (instance.placement.geometry.zIndex < maxZ) {
        functionPlugins?.onChange(
          functionInstances.map((candidate) =>
            candidate.instanceId === id && candidate.placement.kind === 'floating'
              ? {
                  ...candidate,
                  placement: {
                    kind: 'floating',
                    geometry: { ...candidate.placement.geometry, zIndex: maxZ + 1 },
                  },
                }
              : candidate,
          ),
        );
      }
    },
    [functionInstances, functionPlugins],
  );

  const onFunctionPointerMove = useCallback(
    (id: string, event: React.PointerEvent<HTMLDivElement>) => {
      const drag = functionDragRef.current;
      if (!drag || drag.id !== id || drag.pointerId !== event.pointerId || !functionPlugins) return;
      const instance = functionInstancesRef.current.find((candidate) => candidate.instanceId === id);
      if (!instance) return;
      event.preventDefault();
      event.stopPropagation();
      const viewport = floatingRoot ?? rootRef.current;
      const bounds = viewport
        ? { width: viewport.offsetWidth, height: viewport.offsetHeight }
        : { width: window.innerWidth, height: window.innerHeight };
      const moved = moveFunctionPlugin(
        instance,
        drag.startGeo,
        { x: event.clientX - drag.startX, y: event.clientY - drag.startY },
        bounds,
      );
      functionPlugins.onChange(
        functionInstancesRef.current.map((candidate) => (candidate.instanceId === id ? moved : candidate)),
      );
    },
    [floatingRoot, functionPlugins],
  );

  const stopFunctionDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, allowDrop: boolean) => {
      const drag = functionDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      functionDragRef.current = null;
      if (allowDrop && functionPlugins) {
        const bounds = rootRef.current?.getBoundingClientRect();
        if (
          bounds &&
          event.clientX >= bounds.left &&
          event.clientX <= bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY <= bounds.bottom
        ) {
          functionPlugins.onChange(
            functionInstancesRef.current.map((candidate) =>
              candidate.instanceId === drag.id ? { ...candidate, placement: { kind: 'docked' } } : candidate,
            ),
          );
          setActiveFunctionId(drag.id);
        }
      }
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // Capture can already be gone after pointercancel.
        }
      }
    },
    [functionPlugins],
  );

  const closeFunctionPlugin = useCallback(
    (id: string) => {
      functionPlugins?.onChange(functionInstances.filter((candidate) => candidate.instanceId !== id));
      setActiveFunctionId((current) => (current === id ? undefined : current));
    },
    [functionInstances, functionPlugins],
  );

  const floatFunctionPlugin = useCallback(
    (id: string) => {
      if (!functionPlugins) return;
      const viewport = floatingRoot ?? rootRef.current;
      const bounds = viewport
        ? { width: viewport.offsetWidth, height: viewport.offsetHeight }
        : { width: window.innerWidth, height: window.innerHeight };
      const maxZ = Math.max(
        99,
        ...functionInstances.flatMap((candidate) =>
          candidate.placement.kind === 'floating' ? [candidate.placement.geometry.zIndex] : [],
        ),
      );
      functionPlugins.onChange(
        functionInstances.map((candidate) =>
          candidate.instanceId === id
            ? {
                ...candidate,
                placement: {
                  kind: 'floating',
                  geometry: clampGeometry(defaultGeometry(280, 132, maxZ + 1), bounds),
                },
              }
            : candidate,
        ),
      );
      setActiveFunctionId(undefined);
    },
    [floatingRoot, functionInstances, functionPlugins],
  );

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

  const dockedFunctions = useMemo(
    () => functionInstances.filter((instance) => instance.placement.kind === 'docked'),
    [functionInstances],
  );
  useEffect(() => {
    setActiveFunctionId((current) =>
      current && dockedFunctions.some((instance) => instance.instanceId === current)
        ? current
        : dockedFunctions[0]?.instanceId,
    );
  }, [dockedFunctions]);
  const activeFunction = dockedFunctions.find((instance) => instance.instanceId === activeFunctionId);
  const activeFunctionDef = activeFunction ? functionById.get(activeFunction.pluginId) : undefined;

  const floatingPanels = state.floating?.map((panel) => {
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
          onPointerDown={(event) => onPointerDown(panel.instanceId, event)}
          onPointerMove={(event) => onPointerMove(panel.instanceId, event)}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          style={{ cursor: 'move', userSelect: 'none', touchAction: 'none' }}
        >
          <span>[ {def.label} ]</span>
          <button
            className="floating-close"
            title={`Reattach ${def.label}`}
            onClick={(event) => {
              event.stopPropagation();
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
  });

  const functionFloatingPanels = functionInstances.flatMap((instance) => {
    if (instance.placement.kind !== 'floating') return [];
    const def = functionById.get(instance.pluginId);
    if (!def) return [];
    const geometry = instance.placement.geometry;
    return [
      <div
        key={instance.instanceId}
        className="floating-panel function-floating-panel"
        style={{
          position: 'absolute',
          left: geometry.x,
          top: geometry.y,
          width: geometry.width,
          height: geometry.height,
          zIndex: geometry.zIndex,
        }}
      >
        <div
          className="floating-header function-floating-header"
          onPointerDown={(event) => onFunctionPointerDown(instance.instanceId, event)}
          onPointerMove={(event) => onFunctionPointerMove(instance.instanceId, event)}
          onPointerUp={(event) => stopFunctionDrag(event, true)}
          onPointerCancel={(event) => stopFunctionDrag(event, false)}
          style={{ cursor: 'move', userSelect: 'none', touchAction: 'none' }}
        >
          <span>
            [ {def.label} · {instance.functionName} ]
          </span>
          <button
            className="floating-close"
            title={`Close ${instance.functionName} control`}
            onClick={() => closeFunctionPlugin(instance.instanceId)}
          >
            ×
          </button>
        </div>
        <div className="floating-body">
          <def.mount
            instanceId={instance.instanceId}
            beat={instance.beat}
            functionName={instance.functionName}
            control={materializeFunctionControl(def, instance)}
            value={instance.value}
            playing={playing}
            onValue={(value) => functionPlugins?.onValue(instance.instanceId, value)}
          />
        </div>
      </div>,
    ];
  });

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
                        onClick={() => {
                          if (index === 0) setActiveFunctionId(undefined);
                          writePane(index, { ...pane, active: id });
                        }}
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
                {index === 0 &&
                  dockedFunctions.map((instance) => {
                    const def = functionById.get(instance.pluginId);
                    if (!def) return null;
                    return (
                      <span className="dock-tab function-plugin-tab" key={instance.instanceId}>
                        <button
                          className="dock-tab-name"
                          aria-current={activeFunctionId === instance.instanceId}
                          onClick={() => setActiveFunctionId(instance.instanceId)}
                        >
                          [ {def.label} · {instance.functionName} ]
                        </button>
                        <button
                          className="dock-tab-float"
                          title={`Float ${instance.functionName} control`}
                          onClick={() => floatFunctionPlugin(instance.instanceId)}
                        >
                          ⧉
                        </button>
                        <button
                          className="dock-tab-close"
                          title={`Close ${instance.functionName} control`}
                          onClick={() => closeFunctionPlugin(instance.instanceId)}
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
                            if (index === 0) setActiveFunctionId(undefined);
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
                {index === 0 && activeFunction && activeFunctionDef ? (
                  <div className="function-docked-panel">
                    <activeFunctionDef.mount
                      instanceId={activeFunction.instanceId}
                      beat={activeFunction.beat}
                      functionName={activeFunction.functionName}
                      control={materializeFunctionControl(activeFunctionDef, activeFunction)}
                      value={activeFunction.value}
                      playing={playing}
                      onValue={(value) => functionPlugins?.onValue(activeFunction.instanceId, value)}
                    />
                  </div>
                ) : activeDef ? (
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

      {floatingRoot
        ? createPortal(
            <>
              {floatingPanels}
              {functionFloatingPanels}
            </>,
            floatingRoot,
          )
        : [floatingPanels, functionFloatingPanels]}
    </section>
  );
}
