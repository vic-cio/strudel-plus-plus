import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { normalizeDockState, type DockPaneState, type DockState } from '../../shared/dockState';
import { dockReducer } from '../../shared/dockReducer';
import { clampGeometry, applyDelta, defaultGeometry, type Geometry } from '../../shared/geometry';
import { dropFloatingPanel, resolveDockDropTarget, type DockDropTarget } from '../../shared/dockDrop';
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

/** A function control's contextual title: the exact call it edits and the
 *  line that call lives on, read from the instance's stored source range. */
function functionTitle(instance: FunctionPluginInstance): string {
  return `${instance.functionName} @ line ${instance.functionRange.from.line + 1}`;
}

type Props = {
  /** The session's dock state, restored on open and persisted on change. */
  dock: DockState;
  onChange: (next: DockState) => void;
  /** True while the REPL runs; handed to visual plugins so they can idle. */
  playing: boolean;
  /** Current beat/function owner for scoped controls. */
  scope?: ControlContext;
  /** App-level overlay that hosts floating panels and bounds their drags
   * across the whole app surface; omitted by isolated dock tests, which fall
   * back to the dock's own bounds. */
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
  // Only the pane under a dragged panel is highlighted. A full-width pane also
  // records the left/right half so a drop can auto-split deterministically.
  const [dropTarget, setDropTarget] = useState<DockDropTarget>();
  const rootRef = useRef<HTMLElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // The add menu may only offer devices that are closed everywhere — a pane
  // tab and a floating panel of the same plugin would show it twice.
  const openIds = new Set([
    ...state.panes.flatMap((pane) => pane.tabs ?? []),
    ...(state.floating ?? []).map((panel) => panel.instanceId),
  ]);
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
    const viewport = floatingRoot ?? rootRef.current;
    const bounds = viewport
      ? { width: viewport.offsetWidth, height: viewport.offsetHeight }
      : { width: window.innerWidth, height: window.innerHeight };
    const currentZ = Math.max(0, ...(state.floating ?? []).map((panel) => panel.geometry.zIndex));
    const geometry = clampGeometry(defaultGeometry(320, 180, currentZ + 1), bounds);
    onChange(
      normalizeDockState(dockReducer(state, { type: 'FLOAT_PANEL', instanceId: id, geometry }), [...byId.keys()]),
    );
  };

  // A floating panel returning to the dock. The header's close button and a
  // drop on the dock share this path: reattach to the first pane, unless the
  // plugin is already open in a pane — a second copy would clone the device,
  // so that case only activates the existing tab.
  const dockPanel = useCallback(
    (id: string) => {
      const current = stateRef.current;
      if (!current.floating?.some((panel) => panel.instanceId === id)) return;
      const floating = current.floating.filter((panel) => panel.instanceId !== id);
      const nextPanes = current.panes.map((pane) => {
        const next: DockPaneState & { tabs: string[] } = { tabs: [...(pane.tabs ?? [])] };
        if (pane.active !== undefined) next.active = pane.active;
        return next;
      });
      const openIndex = nextPanes.findIndex((pane) => pane.tabs.includes(id));
      if (openIndex === -1) {
        const firstPane = nextPanes[0] ?? { tabs: [] as string[] };
        firstPane.tabs.push(id);
        nextPanes[0] = { tabs: firstPane.tabs, active: id };
      } else {
        const openPane = nextPanes[openIndex];
        if (openPane) nextPanes[openIndex] = { tabs: openPane.tabs, active: id };
      }
      const nextState: DockState = { ...current, panes: nextPanes };
      if (floating.length > 0) {
        nextState.floating = floating;
      } else {
        // The last floating panel is gone: the key must go with it, or the
        // spread above would resurrect the closed panel next to its new tab.
        delete nextState.floating;
      }
      onChange(normalizeDockState(nextState, [...byId.keys()]));
    },
    [byId, onChange],
  );

  const closeFloatingPanel = useCallback(
    (id: string) => {
      const current = stateRef.current;
      if (!current.floating?.some((panel) => panel.instanceId === id)) return;
      onChange(normalizeDockState(dockReducer(current, { type: 'CLOSE_FLOATING', instanceId: id }), [...byId.keys()]));
    },
    [byId, onChange],
  );

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

  // Pane hit-testing is measured from live rectangles rather than DOM hit
  // testing — the dragged panel sits above the dock in the overlay.
  const getDropTarget = useCallback((clientX: number, clientY: number) => {
    const panes = rootRef.current
      ? Array.from(rootRef.current.querySelectorAll<HTMLElement>('.dock-pane')).map((pane) => {
          const bounds = pane.getBoundingClientRect();
          return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
        })
      : [];
    return resolveDockDropTarget({ x: clientX, y: clientY, panes });
  }, []);

  const dropSessionPanel = useCallback(
    (id: string, target: DockDropTarget) => {
      const current = stateRef.current;
      if (!current.floating?.some((panel) => panel.instanceId === id)) return;
      onChange(normalizeDockState(dropFloatingPanel(current, id, target), [...byId.keys()]));
    },
    [byId, onChange],
  );

  // Drag state for floating panels. `moved` gates docking: a pointer that
  // never travelled is a click (focus), not a drop, so a panel resting over
  // the dock must not dock itself on a plain click of its header.
  const DRAG_THRESHOLD = 3;
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    startGeo: Geometry;
    moved: boolean;
  } | null>(null);

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
        moved: false,
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
      drag.moved =
        drag.moved ||
        Math.abs(event.clientX - drag.startX) > DRAG_THRESHOLD ||
        Math.abs(event.clientY - drag.startY) > DRAG_THRESHOLD;
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      const updated = applyDelta(drag.startGeo, { x: deltaX, y: deltaY });
      const viewport = floatingRoot ?? rootRef.current;
      const container = viewport
        ? { width: viewport.offsetWidth, height: viewport.offsetHeight }
        : { width: window.innerWidth, height: window.innerHeight };
      const clamped = clampGeometry(updated, container);
      setDropTarget(drag.moved ? getDropTarget(event.clientX, event.clientY) : undefined);
      const floating = (stateRef.current.floating ?? []).map((f) =>
        f.instanceId === drag.id ? { ...f, geometry: clamped } : f,
      );
      const maxZ = Math.max(0, ...floating.map((f) => f.geometry.zIndex));
      const target = floating.find((f) => f.instanceId === drag.id);
      if (target && target.geometry.zIndex < maxZ) target.geometry.zIndex = maxZ + 1;
      onChange(normalizeDockState({ ...stateRef.current, floating }, [...byId.keys()]));
    },
    [byId, floatingRoot, getDropTarget, onChange],
  );

  const stopDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, allowDrop: boolean) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      const target = allowDrop && drag.moved ? getDropTarget(event.clientX, event.clientY) : undefined;
      setDropTarget(undefined);
      // Releasing over a pane docks there; anywhere else leaves the panel
      // floating where the pointer let go.
      if (target) {
        dropSessionPanel(drag.id, target);
      }
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // Capture can already be gone after pointercancel.
        }
      }
    },
    [dropSessionPanel, getDropTarget],
  );

  const functionInstancesRef = useRef(functionInstances);
  functionInstancesRef.current = functionInstances;
  const functionDragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    startGeo: Geometry;
    moved: boolean;
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
        moved: false,
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
      drag.moved =
        drag.moved ||
        Math.abs(event.clientX - drag.startX) > DRAG_THRESHOLD ||
        Math.abs(event.clientY - drag.startY) > DRAG_THRESHOLD;
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
      setDropTarget(drag.moved ? getDropTarget(event.clientX, event.clientY) : undefined);
      functionPlugins.onChange(
        functionInstancesRef.current.map((candidate) => (candidate.instanceId === id ? moved : candidate)),
      );
    },
    [floatingRoot, functionPlugins, getDropTarget],
  );

  const stopFunctionDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, allowDrop: boolean) => {
      const drag = functionDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      functionDragRef.current = null;
      const target = allowDrop && drag.moved ? getDropTarget(event.clientX, event.clientY) : undefined;
      setDropTarget(undefined);
      if (target && functionPlugins) {
        // An exact-function control is ephemeral renderer state, never
        // session DockState: its drop must not split or otherwise mutate the
        // persisted dock. Clamp to a pane that actually exists so the panel
        // never docks into thin air on a single-pane dock.
        const paneCount = Math.max(1, stateRef.current.panes.length);
        const rawIndex = target.autoSplit ? (target.side === 'left' ? 0 : 1) : target.paneIndex;
        const paneIndex = Math.min(Math.max(rawIndex, 0), paneCount - 1);
        functionPlugins.onChange(
          functionInstancesRef.current.map((candidate) =>
            candidate.instanceId === drag.id
              ? paneIndex === 0
                ? { ...candidate, placement: { kind: 'docked' } }
                : { ...candidate, placement: { kind: 'docked', paneIndex } }
              : candidate,
          ),
        );
        setActiveFunctionId(drag.id);
      }
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // Capture can already be gone after pointercancel.
        }
      }
    },
    [functionPlugins, getDropTarget],
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

  type DockTabDrag = {
    kind: 'session' | 'function';
    id: string;
    paneIndex: number;
    pointerId: number;
    startX: number;
    startY: number;
    startGeo: Geometry;
    moved: boolean;
  };
  const tabDragRef = useRef<DockTabDrag | null>(null);
  const suppressTabClickRef = useRef(false);

  const geometryAtPointer = useCallback(
    (clientX: number, clientY: number, width: number, height: number): Geometry => {
      const viewport = floatingRoot ?? rootRef.current;
      const bounds = viewport
        ? { width: viewport.offsetWidth, height: viewport.offsetHeight }
        : { width: window.innerWidth, height: window.innerHeight };
      const viewportBounds = viewport?.getBoundingClientRect();
      const zIndex =
        Math.max(
          0,
          ...(stateRef.current.floating ?? []).map((panel) => panel.geometry.zIndex),
          ...functionInstancesRef.current.flatMap((instance) =>
            instance.placement.kind === 'floating' ? [instance.placement.geometry.zIndex] : [],
          ),
        ) + 1;
      return clampGeometry(
        {
          ...defaultGeometry(width, height, zIndex),
          x: clientX - (viewportBounds?.left ?? 0) - 24,
          y: clientY - (viewportBounds?.top ?? 0) - 12,
        },
        bounds,
      );
    },
    [floatingRoot],
  );

  // Detaching a dock tab floats it at the pointer, then moves it with the
  // same gesture. The session path must emit ONE state update: the detach
  // reads stateRef, which only refreshes on re-render, so a second update
  // built from the same stale ref would overwrite the just-added floating
  // panel and the tab would snap back instead of floating out.
  const detachSessionTab = useCallback(
    (drag: DockTabDrag): DockState =>
      normalizeDockState(
        dockReducer(stateRef.current, {
          type: 'FLOAT_PANEL',
          instanceId: drag.id,
          geometry: drag.startGeo,
        }),
        [...byId.keys()],
      ),
    [byId],
  );

  const detachDockTab = useCallback(
    (drag: DockTabDrag) => {
      if (drag.kind === 'session') {
        onChange(detachSessionTab(drag));
        return;
      }
      const instance = functionInstancesRef.current.find((candidate) => candidate.instanceId === drag.id);
      if (!instance || instance.placement.kind !== 'docked' || !functionPlugins) return;
      functionPlugins.onChange(
        functionInstancesRef.current.map((candidate) =>
          candidate.instanceId === drag.id
            ? { ...candidate, placement: { kind: 'floating', geometry: drag.startGeo } }
            : candidate,
        ),
      );
      setActiveFunctionId(undefined);
    },
    [byId, detachSessionTab, functionPlugins, onChange],
  );

  const moveDockTab = useCallback(
    (event: PointerEvent) => {
      const drag = tabDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const crossedThreshold =
        Math.abs(event.clientX - drag.startX) > DRAG_THRESHOLD ||
        Math.abs(event.clientY - drag.startY) > DRAG_THRESHOLD;
      if (!drag.moved && !crossedThreshold) return;
      if (!drag.moved) {
        drag.moved = true;
        suppressTabClickRef.current = true;
        event.preventDefault();
        if (drag.kind === 'session') {
          const viewport = floatingRoot ?? rootRef.current;
          const bounds = viewport
            ? { width: viewport.offsetWidth, height: viewport.offsetHeight }
            : { width: window.innerWidth, height: window.innerHeight };
          const nextGeometry = clampGeometry(
            applyDelta(drag.startGeo, { x: event.clientX - drag.startX, y: event.clientY - drag.startY }),
            bounds,
          );
          const detached = detachSessionTab(drag);
          const floating = (detached.floating ?? []).map((panel) =>
            panel.instanceId === drag.id ? { ...panel, geometry: nextGeometry } : panel,
          );
          onChange(normalizeDockState({ ...detached, floating }, [...byId.keys()]));
          setDropTarget(getDropTarget(event.clientX, event.clientY));
          return;
        }
        detachDockTab(drag);
      }
      const nextGeometry = clampGeometry(
        applyDelta(drag.startGeo, { x: event.clientX - drag.startX, y: event.clientY - drag.startY }),
        (() => {
          const viewport = floatingRoot ?? rootRef.current;
          return viewport
            ? { width: viewport.offsetWidth, height: viewport.offsetHeight }
            : { width: window.innerWidth, height: window.innerHeight };
        })(),
      );
      if (drag.kind === 'session') {
        const floating = (stateRef.current.floating ?? []).map((panel) =>
          panel.instanceId === drag.id ? { ...panel, geometry: nextGeometry } : panel,
        );
        onChange(normalizeDockState({ ...stateRef.current, floating }, [...byId.keys()]));
      } else if (functionPlugins) {
        functionPlugins.onChange(
          functionInstancesRef.current.map((instance) =>
            instance.instanceId === drag.id
              ? { ...instance, placement: { kind: 'floating', geometry: nextGeometry } }
              : instance,
          ),
        );
      }
      setDropTarget(getDropTarget(event.clientX, event.clientY));
    },
    [byId, detachDockTab, detachSessionTab, floatingRoot, functionPlugins, getDropTarget, onChange],
  );

  const finishDockTabDrag = useCallback((event: PointerEvent) => {
    const drag = tabDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      event.preventDefault();
      suppressTabClickRef.current = true;
    }
    tabDragRef.current = null;
    setDropTarget(undefined);
  }, []);

  useEffect(() => {
    window.addEventListener('pointermove', moveDockTab);
    window.addEventListener('pointerup', finishDockTabDrag);
    window.addEventListener('pointercancel', finishDockTabDrag);
    return () => {
      window.removeEventListener('pointermove', moveDockTab);
      window.removeEventListener('pointerup', finishDockTabDrag);
      window.removeEventListener('pointercancel', finishDockTabDrag);
    };
  }, [finishDockTabDrag, moveDockTab]);

  const onDockTabPointerDown = useCallback(
    (kind: 'session' | 'function', id: string, paneIndex: number, event: React.PointerEvent<HTMLSpanElement>) => {
      if (!(event.target instanceof Element) || !event.target.closest('.dock-tab-name')) return;
      const startGeo = geometryAtPointer(
        event.clientX,
        event.clientY,
        kind === 'function' ? 280 : 320,
        kind === 'function' ? 132 : 180,
      );
      tabDragRef.current = {
        kind,
        id,
        paneIndex,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startGeo,
        moved: false,
      };
    },
    [geometryAtPointer],
  );

  const onDockTabClick = useCallback(
    (kind: 'session' | 'function', id: string, paneIndex: number) => {
      if (suppressTabClickRef.current) {
        suppressTabClickRef.current = false;
        return;
      }
      if (kind === 'function') {
        setActiveFunctionId(id);
        return;
      }
      if (paneIndex === 0) setActiveFunctionId(undefined);
      const pane = stateRef.current.panes[paneIndex] ?? {};
      writePane(paneIndex, { ...pane, active: id });
    },
    [writePane],
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
          onPointerUp={(event) => stopDrag(event, true)}
          onPointerCancel={(event) => stopDrag(event, false)}
          style={{ cursor: 'move', userSelect: 'none', touchAction: 'none' }}
        >
          <span>[ {def.label} ]</span>
          <button
            className="floating-close"
            title={def.id === 'eq' ? `Close ${def.label}` : `Reattach ${def.label}`}
            onClick={(event) => {
              event.stopPropagation();
              if (def.id === 'eq') {
                closeFloatingPanel(panel.instanceId);
              } else {
                dockPanel(panel.instanceId);
              }
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
            [ {def.label} · {functionTitle(instance)} ]
          </span>
          <button
            className="floating-close"
            title={`Close ${functionTitle(instance)} control`}
            onClick={(event) => {
              event.stopPropagation();
              closeFunctionPlugin(instance.instanceId);
            }}
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
            <div
              className={dropTarget?.paneIndex === index ? 'dock-pane dock-pane-drop-target' : 'dock-pane'}
              data-drop-side={dropTarget?.paneIndex === index ? dropTarget.side : undefined}
              key={index}
            >
              <div className="dock-tabs">
                {(pane.tabs ?? []).map((id) => {
                  const def = byId.get(id);
                  if (!def) return null;
                  return (
                    <span
                      className="dock-tab"
                      key={id}
                      onPointerDown={(event) => onDockTabPointerDown('session', id, index, event)}
                    >
                      <button
                        className="dock-tab-name"
                        aria-current={pane.active === id}
                        onClick={() => onDockTabClick('session', id, index)}
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
                {dockedFunctions
                  .filter(
                    (instance) => instance.placement.kind === 'docked' && (instance.placement.paneIndex ?? 0) === index,
                  )
                  .map((instance) => {
                    const def = functionById.get(instance.pluginId);
                    if (!def) return null;
                    return (
                      <span
                        className="dock-tab function-plugin-tab"
                        key={instance.instanceId}
                        onPointerDown={(event) => onDockTabPointerDown('function', instance.instanceId, index, event)}
                      >
                        <button
                          className="dock-tab-name"
                          aria-current={activeFunctionId === instance.instanceId}
                          onClick={() => onDockTabClick('function', instance.instanceId, index)}
                        >
                          [ {def.label} · {functionTitle(instance)} ]
                        </button>
                        <button
                          className="dock-tab-float"
                          title={`Float ${functionTitle(instance)} control`}
                          onClick={() => floatFunctionPlugin(instance.instanceId)}
                        >
                          ⧉
                        </button>
                        <button
                          className="dock-tab-close"
                          title={`Close ${functionTitle(instance)} control`}
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
                {activeFunction &&
                activeFunctionDef &&
                activeFunction.placement.kind === 'docked' &&
                (activeFunction.placement.paneIndex ?? 0) === index ? (
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
