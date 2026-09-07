/**
 * The plugin seam.
 *
 * Each import below is a self-registering plugin file; a future mixer, scope,
 * or FX macro is one new file plus one line here. Nothing else in the app
 * knows individual plugins exist — the dock renders whatever the registry
 * holds, and session state remembers them by id.
 */
import './eq';
import './gain';
import './gainFunction';

export { getPlugin, listFunctionPlugins, listPlugins, listSessionPlugins, registerPlugin } from './registry';
export type {
  FunctionPluginDef,
  FunctionPluginProps,
  PluginDef,
  PluginKind,
  PluginProps,
  SessionPluginDef,
} from './registry';
export {
  applyFunctionPluginValue,
  createFunctionPluginInstance,
  materializeFunctionControl,
  moveFunctionPlugin,
  rebaseFunctionPluginInstances,
  resolveFunctionPluginTarget,
  type FunctionPluginInstance,
  type FunctionPluginPlacement,
  type FunctionPluginTarget,
} from './functionPlugin';
export {
  isControlScopeActive,
  pruneInactiveControls,
  validateControlValue,
  type ControlContext,
  type ControlScope,
  type NumericControl,
  type ScopedControlValue,
  type ScopedControlValues,
} from './controlModel';
