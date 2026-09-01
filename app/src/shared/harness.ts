export type HarnessDef = {
  id: string;
  label: string;
  command: string;
  args?: string[];
};

export type HarnessConfig = {
  beatsRoot: string;
  harnesses: HarnessDef[];
};

export type ResolvedHarness = {
  command: string;
  args: string[];
  cwd: string;
};

/** Turn a harness id into the command to spawn. The cwd is always the beats folder. */
export function resolveHarness(id: string, config: HarnessConfig): ResolvedHarness {
  const def = config.harnesses.find((harness) => harness.id === id);
  if (!def) {
    throw new Error(`Unknown harness: ${id}`);
  }
  return { command: def.command, args: def.args ?? [], cwd: config.beatsRoot };
}
