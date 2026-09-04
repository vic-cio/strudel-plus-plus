import type { ComponentType } from 'react';
import type { ControlContext } from './controlModel';

/** What a plugin does in its pane. Visual plugins draw; functional ones control. */
export type PluginKind = 'visual' | 'functional';

/** Everything a plugin's component gets from the pane hosting it. */
export type PluginProps = {
  /** True while the REPL runs. A visual plugin idles, rather than spinning its
   * animation loop, when audio is stopped. */
  playing: boolean;
  /** The plugin's own persisted slice of the session's dock state — fader and
   * knob positions survive a restart because the pane hands this back. */
  state: unknown;
  /** Replace the persisted slice. */
  onState: (state: unknown) => void;
  /** The current owner context for controls that are not session-wide. */
  scope?: ControlContext;
};

export type PluginDef = {
  /** Stable id; this is what session state remembers the plugin by. */
  id: string;
  /** Tab label, shown between the brackets in the strip. */
  label: string;
  kind: PluginKind;
  /** The component mounted into the pane, stretched to fill it. */
  mount: ComponentType<PluginProps>;
};

const plugins = new Map<string, PluginDef>();

/**
 * Declare a plugin.
 *
 * Built-ins register at import time from their own files, so a future mixer or
 * scope is one file that ends in a `registerPlugin` call. A duplicate id is a
 * programming error and says so immediately, rather than letting two
 * definitions silently fight over one tab.
 */
export function registerPlugin(def: PluginDef): void {
  if (plugins.has(def.id)) {
    throw new Error(`plugin already registered: ${def.id}`);
  }
  plugins.set(def.id, def);
}

/** Every registered plugin, in registration order. */
export function listPlugins(): PluginDef[] {
  return [...plugins.values()];
}

export function getPlugin(id: string): PluginDef | undefined {
  return plugins.get(id);
}
