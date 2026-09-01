import { getAudioContext } from '@strudel/webaudio';

// The unpublished upstream Dough adapter expects this helper from the source
// webaudio workspace. Published @strudel/webaudio no longer exports it, so keep
// the same tiny always-on signal at the wrapper boundary.
let constantSource;
let constantSourceContext;

export function ensureMinimalOutput() {
  const audioContext = getAudioContext();
  if (constantSource && constantSourceContext === audioContext) {
    return;
  }
  constantSourceContext = audioContext;
  constantSource = audioContext.createConstantSource();
  constantSource.offset.value = 1e-7;
  constantSource.connect(audioContext.destination);
  constantSource.start();
}
