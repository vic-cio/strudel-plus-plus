import { getAudioContext } from '@strudel/webaudio';

// Published @strudel/webaudio no longer exports the clock bridge used by the
// upstream OSC adapter. Keep the conversion at this wrapper boundary so OSC
// timestamps still share the audio scheduler's output clock.
let offset;
let lastPerformanceTime;

function smoothOffset(nextOffset, performanceTime) {
  const delta = performanceTime - (lastPerformanceTime ?? performanceTime);
  const decay = 1 / 10000;
  const previous = offset ?? nextOffset;
  offset = nextOffset + (previous - nextOffset) * Math.exp(-decay * delta);
  lastPerformanceTime = performanceTime;
  return offset;
}

export function getPerformanceTime(audioContextTime) {
  const { contextTime, performanceTime } = getAudioContext().getOutputTimestamp();
  if (!contextTime || !performanceTime) {
    return audioContextTime * 1000;
  }
  return audioContextTime * 1000 + smoothOffset(performanceTime - contextTime * 1000, performanceTime);
}
