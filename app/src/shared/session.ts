import type { BeatSortMode, BeatSummary } from './beatSorting';
import type { DockState } from './dockState';

export type SessionState = {
  beat?: string | null;
  cpsByBeat?: Record<string, number>;
  beatSort?: BeatSortMode;
  manualBeatOrder?: string[];
  dock?: DockState;
};

export type SessionOpenResult = {
  name: string;
  folder: string;
  harness: string | undefined;
  state: SessionState;
  beats: BeatSummary[];
  beat: string | undefined;
  content: string | undefined;
};
