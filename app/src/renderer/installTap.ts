import { installMasterTap, liveMasterStream, selectLiveTap } from './masterTap';

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
        // An OfflineAudioContext's destination is still an AudioDestinationNode,
        // so an offline render (a bounce, or superdough rendering a reverb
        // impulse response off `.room()`/`.size()`) would otherwise get tapped
        // too. Excluding it keeps the map to contexts that actually reach the
        // speakers — see selectLiveTap for what happens when one slips through.
        isDestination: (target) =>
          target instanceof AudioDestinationNode && !(target.context instanceof OfflineAudioContext),
        contextOf: (target) => (target as AudioDestinationNode).context,
        createAnalyser: (context) => {
          const analyser = (context as BaseAudioContext).createAnalyser();
          analyser.fftSize = 1024;
          analyser.smoothingTimeConstant = 0.5;
          return analyser;
        },
        createMediaStreamDestination: (context) => (context as AudioContext).createMediaStreamDestination(),
      });

export function masterAnalyser(): AnalyserNode | undefined {
  return selectLiveTap(masterTaps) as AnalyserNode | undefined;
}

export function masterMediaStream(): MediaStream | undefined {
  return liveMasterStream(masterTaps);
}
