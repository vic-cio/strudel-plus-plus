import { masterMediaStream } from './installTap';
import { recordingIntent, type RecordingMode } from '../shared/recording';

export type RecordingCapture = {
  /** The extension the take was started with, so a mid-take settings change
   * cannot mislabel the saved file. */
  extension: string;
  stop: () => Promise<Blob>;
};

type Surface = {
  stream: MediaStream;
  release: () => void;
};

function masterAudio(): MediaStream {
  const audio = masterMediaStream();
  if (!audio) {
    throw new Error('No live master audio is available. Start playback before recording.');
  }
  return audio;
}

/** A canvas only emits capture frames while something repaints it, so the
 * title card is redrawn every frame with the elapsed time. */
function videoSurface(audio: MediaStream, source: string): Surface {
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
  const started = performance.now();
  let frame = 0;
  const paint = () => {
    const elapsed = Math.floor((performance.now() - started) / 1000);
    context.fillStyle = '#3a251d';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#efe7d3';
    context.font = '32px monospace';
    context.fillText('strudel++ recording', 56, 74);
    context.font = '20px monospace';
    context.fillText(source.slice(0, 88), 56, 120);
    context.fillText(`${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`, 56, 160);
    frame = requestAnimationFrame(paint);
  };
  paint();
  const video = canvas.captureStream(30);
  for (const track of audio.getAudioTracks()) {
    video.addTrack(track);
  }
  return { stream: video, release: () => cancelAnimationFrame(frame) };
}

export function startRecording(mode: RecordingMode, source: string): RecordingCapture {
  const intent = recordingIntent(mode);
  if (!('MediaRecorder' in window) || !MediaRecorder.isTypeSupported(intent.mimeType)) {
    throw new Error(`${intent.mimeType} recording is unavailable on this platform.`);
  }
  const audio = masterAudio();
  const surface: Surface = mode === 'audio' ? { stream: audio, release: () => {} } : videoSurface(audio, source);
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(surface.stream, { mimeType: intent.mimeType });
  } catch (error) {
    surface.release();
    throw error;
  }
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start();
  return {
    extension: intent.extension,
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => {
          surface.release();
          resolve(new Blob(chunks, { type: intent.mimeType }));
        };
        recorder.onerror = () => {
          surface.release();
          reject(new Error('The recorder stopped unexpectedly.'));
        };
        recorder.stop();
      }),
  };
}
