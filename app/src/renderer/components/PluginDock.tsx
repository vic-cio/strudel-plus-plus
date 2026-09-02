import { useEffect, useRef, useState } from 'react';
import { normalizeDockState, type DockPaneState, type DockState } from '../../shared/dockState';
import { listPlugins } from '../plugins';
import type { PluginDef } from '../plugins/registry';

type Props = {
  /** The session's dock state, restored on open and persisted on change. */
  dock: DockState;
  onChange: (next: DockState) => void;
  /** True while the REPL runs; handed to visual plugins so they can idle. */
  playing: boolean;
};

/**
 * The plugin dock: one or two panes of live gear between the editors and the
 * status bar.
 *
 * Each pane is a tab strip over exactly one plugin, stretched to the pane. The
 * strip follows the pane-title pattern — sunk ground, hairline border,
 * bracketed labels — and never takes focus on its own: nothing here autofocuses
 * or calls focus(), so opening a device cannot pull the caret out of the
 * editor or the harness. The captain splits the dock for two devices or leaves
 * one pane full width for one that deserves it; both are remembered with the
 * session.
 */
export function PluginDock({ dock, onChange, playing }: Props) {
  const defs = listPlugins();
  const byId = new Map<string, PluginDef>(defs.map((def) => [def.id, def]));
  // Render from canonical state, so a session file written by an older build
  // cannot summon tabs for plugins that no longer exist.
  const state = normalizeDockState(
    dock,
    defs.map((def) => def.id),
  );
  const [menuPane, setMenuPane] = useState<number>();
  const rootRef = useRef<HTMLElement>(null);

  const openIds = new Set(state.panes.flatMap((pane) => pane.tabs ?? []));
  const candidates = defs.filter((def) => !openIds.has(def.id));

  /** Write one pane back through the canonicalizer. */
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

  const toggleSplit = () => {
    if (!state.split) {
      onChange(normalizeDockState({ ...state, split: true, panes: [...state.panes, {}] }, [...byId.keys()]));
      return;
    }
    // Merging keeps both panes' devices open: collapsing the dock is a layout
    // change, not "close the mixer".
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

  // The add menu closes on any click outside the dock, and on Escape, without
  // stealing focus from wherever the caret was.
  useEffect(() => {
    if (menuPane === undefined) {
      return;
    }
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) {
        return;
      }
      setMenuPane(undefined);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuPane(undefined);
      }
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuPane]);

  return (
    <section className="dock" aria-label="plugin dock" ref={rootRef}>
      <div className={state.split ? 'dock-panes split' : 'dock-panes'}>
        {state.panes.map((pane, index) => {
          const activeDef = pane.active ? byId.get(pane.active) : undefined;
          return (
            <div className="dock-pane" key={index}>
              <div className="dock-tabs">
                {(pane.tabs ?? []).map((id) => {
                  const def = byId.get(id);
                  if (!def) {
                    return null;
                  }
                  return (
                    <span className="dock-tab" key={id}>
                      <button
                        className="dock-tab-name"
                        aria-current={pane.active === id}
                        onClick={() => writePane(index, { ...pane, active: id })}
                      >
                        [ {def.label} ]
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
                  />
                ) : (
                  <div className="dock-empty">[ no device ]</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
