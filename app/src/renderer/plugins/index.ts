/**
 * The plugin seam.
 *
 * Each import below is a self-registering plugin file; a future mixer, scope,
 * or FX macro is one new file plus one line here. Nothing else in the app
 * knows individual plugins exist — the dock renders whatever the registry
 * holds, and session state remembers them by id.
 */
import './eq';

export { getPlugin, listPlugins, registerPlugin } from './registry';
export type { PluginDef, PluginKind, PluginProps } from './registry';
