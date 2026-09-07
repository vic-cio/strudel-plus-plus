import type { ComponentType } from 'react';
import type { ControlContext, NumericControl } from './controlModel';

/** What a plugin does in its pane. Visual plugins draw; functional ones control. */
export type PluginKind = 'visual' | 'functional';

/** Everything a plugin's component gets from the pane hosting it. */
export type SessionPluginProps = {
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

export type FunctionPluginProps = {
  instanceId: string;
  beat: string;
  functionName: string;
  control: NumericControl;
  value: number;
  playing: boolean;
  onValue: (value: number) => void;
};

type PluginBase = {
  /** Stable id; this is what session state remembers the plugin by. */
  id: string;
  /** Tab label, shown between the brackets in the strip. */
  label: string;
  kind: PluginKind;
};

export type SessionPluginDef = PluginBase & {
  scope: 'session';
  /** The component mounted into the pane, stretched to fill it. */
  mount: ComponentType<SessionPluginProps>;
};

export type FunctionControlTemplate = Omit<NumericControl, 'scope'> & { argumentIndex: number };

export type FunctionPluginDef = PluginBase & {
  scope: 'function';
  /** Function names this catalog entry can control from the editor menu. */
  functionNames: readonly string[];
  /** This first slice supports one numeric argument per function plugin. */
  control: FunctionControlTemplate;
  mount: ComponentType<FunctionPluginProps>;
};

export type PluginDef = SessionPluginDef | FunctionPluginDef;
export type PluginProps = SessionPluginProps;

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

export function listSessionPlugins(): SessionPluginDef[] {
  return listPlugins().filter((plugin): plugin is SessionPluginDef => plugin.scope === 'session');
}

export function listFunctionPlugins(): FunctionPluginDef[] {
  return listPlugins().filter((plugin): plugin is FunctionPluginDef => plugin.scope === 'function');
}

export function getPlugin(id: string): PluginDef | undefined {
  return plugins.get(id);
}
