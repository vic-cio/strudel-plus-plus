export type TapDeps = {
  proto: { connect: (this: object, ...args: never[]) => unknown };
  isDestination: (target: unknown) => boolean;
  contextOf: (target: unknown) => object;
  createAnalyser: (context: object) => object;
};

const patched = new WeakMap<object, Map<object, object>>();

/**
 * Listen to everything that reaches the speakers.
 *
 * Strudel has more than one audio engine and they do not share an output node:
 * superdough runs through its own gain, while the dough worklet connects
 * straight to AudioContext.destination. Tapping either one by name misses the
 * other, and the symptom is a meter reading silence over an audible beat.
 * Intercepting the connection catches whichever engine is live.
 */
export function installMasterTap(deps: TapDeps): Map<object, object> {
  const existing = patched.get(deps.proto);
  if (existing) {
    return existing;
  }

  const taps = new Map<object, object>();
  const original = deps.proto.connect;

  deps.proto.connect = function (this: object, ...args: never[]) {
    const result = original.apply(this, args);
    const target = args[0] as unknown;
    if (deps.isDestination(target)) {
      try {
        const context = deps.contextOf(target);
        let tap = taps.get(context);
        if (!tap) {
          tap = deps.createAnalyser(context);
          taps.set(context, tap);
        }
        original.call(this, tap as never);
      } catch {
        // Never let a meter cost the audio.
      }
    }
    return result;
  };

  patched.set(deps.proto, taps);
  return taps;
}
