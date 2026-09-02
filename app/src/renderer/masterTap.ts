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

type TapContext = { state?: string; resume?: () => Promise<void> };

/**
 * Pick the tap that is actually reaching the speakers.
 *
 * A tap can outlive the context it points at: an offline render (a bounce,
 * or superdough generating a reverb impulse response) connects to its own
 * throwaway OfflineAudioContext.destination, which still passes as a
 * destination and gets tapped. That context finishes and closes within
 * milliseconds, and a closed context's analyser freezes on its last
 * rendered frame forever. Picking "whatever was inserted last" then
 * permanently prefers that dead tap over the live, running one. A closed
 * context's tap is pruned from the map on sight since nothing will ever
 * read it again; a merely suspended one gets an opportunistic resume.
 */
export function selectLiveTap(taps: Map<object, object>): object | undefined {
  let running: object | undefined;
  let fallback: object | undefined;
  for (const [context, tap] of taps) {
    const state = (context as TapContext).state;
    if (state === 'closed') {
      taps.delete(context);
      continue;
    }
    if (state === 'running') {
      running = tap;
    } else {
      fallback = tap;
      if (state === 'suspended') {
        void Promise.resolve((context as TapContext).resume?.()).catch(() => {});
      }
    }
  }
  return running ?? fallback;
}
