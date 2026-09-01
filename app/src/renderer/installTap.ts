import { installMasterTap } from './masterTap';

/**
 * Patch before any audio node exists, which is why this is imported for its
 * side effect at the top of main.tsx rather than called from a component.
 */
export const masterTaps =
  typeof AudioNode === 'undefined'
    ? new Map<object, object>()
    : installMasterTap({
        proto: AudioNode.prototype as unknown as {
          connect: (this: object, ...args: never[]) => unknown;
        },
        isDestination: (target) => target instanceof AudioDestinationNode,
        contextOf: (target) => (target as AudioDestinationNode).context,
        createAnalyser: (context) => {
          const analyser = (context as BaseAudioContext).createAnalyser();
          analyser.fftSize = 1024;
          analyser.smoothingTimeConstant = 0.5;
          return analyser;
        },
      });

/** The most recently tapped context is the one making sound. */
export function masterAnalyser(): AnalyserNode | undefined {
  let last: AnalyserNode | undefined;
  for (const tap of masterTaps.values()) {
    last = tap as AnalyserNode;
  }
  return last;
}
