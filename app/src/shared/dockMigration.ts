/**
 * Migrate old definition-keyed plugin state to stable instance IDs.
 */

import type { DockState } from './dockState';

export function migrateDockState(old: DockState, mapping: Record<string, string>): DockState {
  const nextPluginState: Record<string, unknown> = {};
  if (old.pluginState) {
    for (const [defId, value] of Object.entries(old.pluginState)) {
      const instanceId = mapping[defId] ?? defId;
      nextPluginState[instanceId] = value;
    }
  }
  return { ...old, pluginState: nextPluginState };
}
