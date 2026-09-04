import { masterMediaStream } from './installTap';
import { recordingFailureMessage, recordingIntent, type RecordingMode } from '../shared/recording';

export type RecordingCapture = {
  stop: () => Promise<Blob>;
};

function mediaStreamFor(mode: RecordingMode, source: string): MediaStream {
  const audio = masterMediaStream();
  if (!audio) {
    throw new Error('No live master audio is available. Start playback before recording.');
  }
  if (mode === 'audio') {
    return audio;
  }
  if (!HTMLCanvasElement.prototype.captureStream) {
    throw new Error('This platform cannot capture video.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('This platform cannot create a video surface.');
  }
  context.fillStyle = '#3a251d';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#efe7d3';
  context.font = '32px monospace';
  context.fillText('strudel++ recording', 56, 74);
  context.font = '20px monospace';
  context.fillText(source.slice(0, 88), 56, 120);
  const video = canvas.captureStream(30);
  for (const track of audio.getAudioTracks()) {
    video.addTrack(track);
  }
  return video;
}

export function startRecording(mode: RecordingMode, source: string): RecordingCapture {
  const intent = recordingIntent(mode, source);
  if (!('MediaRecorder' in window) || !MediaRecorder.isTypeSupported(intent.mimeType)) {
    throw new Error(`${intent.mimeType} recording is unavailable on this platform.`);
  }
  const recorder = new MediaRecorder(mediaStreamFor(mode, source), { mimeType: intent.mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start();
  return {
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: intent.mimeType }));
        recorder.onerror = () => reject(new Error('The recorder stopped unexpectedly.'));
        recorder.stop();
      }),
  };
}

export { recordingFailureMessage };
