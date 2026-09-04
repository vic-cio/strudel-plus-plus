export type TapDeps = {
  proto: { connect: (this: object, ...args: never[]) => unknown };
  isDestination: (target: unknown) => boolean;
  contextOf: (target: unknown) => object;
  createAnalyser: (context: object) => object;
  createMediaStreamDestination?: (context: object) => { stream: MediaStream };
};

const patched = new WeakMap<object, Map<object, object>>();
const streams = new WeakMap<Map<object, object>, Map<object, { stream: MediaStream }>>();

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
  const contextStreams = new Map<object, { stream: MediaStream }>();
  streams.set(taps, contextStreams);
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
          if (deps.createMediaStreamDestination) {
            contextStreams.set(context, deps.createMediaStreamDestination(context));
          }
        }
        original.call(this, tap as never);
        const recordingDestination = contextStreams.get(context);
        if (recordingDestination) {
          original.call(this, recordingDestination as never);
        }
      } catch {
        // Never let a meter cost the audio.
      }
    }
    return result;
  };

  patched.set(deps.proto, taps);
  return taps;
}

/**
 * Every engine that reaches the speakers is connected to the recording
 * destination, not just the first one that created it, so a take carries the
 * same mix the meters show.
 */
export function liveMasterStream(taps: Map<object, object>): MediaStream | undefined {
  let fallback: MediaStream | undefined;
  for (const [context, destination] of streams.get(taps) ?? []) {
    if ((context as TapContext).state === 'closed') {
      streams.get(taps)?.delete(context);
      continue;
    }
    if ((context as TapContext).state === 'running') {
      return destination.stream;
    }
    fallback = destination.stream;
  }
  return fallback;
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
