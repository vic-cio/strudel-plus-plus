export type BeatSortMode = 'chronological' | 'alphabetical' | 'manual';

export type BeatSummary = {
  name: string;
  modifiedAt: number;
};

export const DEFAULT_BEAT_SORT: BeatSortMode = 'chronological';

export function isBeatSortMode(value: unknown): value is BeatSortMode {
  return value === 'chronological' || value === 'alphabetical' || value === 'manual';
}

export function sortBeats(
  beats: BeatSummary[],
  mode: BeatSortMode = DEFAULT_BEAT_SORT,
  manualOrder: string[] = [],
): BeatSummary[] {
  const chronological = [...beats].sort(
    (a, b) =>
      b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  );

  switch (mode) {
    case 'chronological':
      return chronological;
    case 'alphabetical':
      return [...beats].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    case 'manual': {
      const byName = new Map(beats.map((beat) => [beat.name, beat]));
      const seen = new Set<string>();
      const saved = manualOrder.flatMap((name) => {
        const beat = byName.get(name);
        if (!beat || seen.has(name)) {
          return [];
        }
        seen.add(name);
        return [beat];
      });
      return saved.concat(chronological.filter((beat) => !seen.has(beat.name)));
    }
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function moveBeat({
  order,
  from,
  to,
  position = 'before',
}: {
  order: string[];
  from: string;
  to: string;
  position?: 'before' | 'after';
}): string[] {
  const fromIndex = order.indexOf(from);
  if (fromIndex < 0 || from === to || !order.includes(to)) {
    return [...order];
  }

  const next = [...order];
  next.splice(fromIndex, 1);
  const toIndex = next.indexOf(to);
  next.splice(position === 'after' ? toIndex + 1 : toIndex, 0, from);
  return next;
}
