type Props = {
  root: string;
  beat: string | undefined;
  dirty: boolean;
  playing: boolean;
  cps: number;
  harness: string;
  error: string | undefined;
  recordingMode: string;
};

export function StatusBar({ root, beat, dirty, playing, cps, harness, error, recordingMode }: Props) {
  return (
    <footer className="status">
      <span className={`slot ${playing ? 'on' : 'off'}`}>{playing ? '● playing' : '○ stopped'}</span>
      <span className="slot">{cps.toFixed(2)} cps</span>
      <span className="slot">{cps ? `${Math.round(cps * 240)} bpm` : '—'}</span>
      <span className="slot">
        {beat ?? 'no beat'}
        {dirty ? ' *' : ''}
      </span>
      <span className="slot">harness: {harness}</span>
      <span className="slot">rec: {recordingMode}</span>
      {error && (
        <span className="slot warn" title={error}>
          {error}
        </span>
      )}
      <span className="slot">{root}</span>
    </footer>
  );
}
