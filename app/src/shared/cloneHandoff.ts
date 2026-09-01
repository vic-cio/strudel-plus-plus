export type CloneHandoffArgs = {
  playing: boolean;
  activate: () => void;
  reevaluate: () => void;
};

export function handoffClonedBeat({ playing, activate, reevaluate }: CloneHandoffArgs): void {
  activate();
  if (playing) {
    reevaluate();
  }
}
