const NUMBERED = /^(.*?)-(\d+)$/;

/**
 * The next free numbered name beside a beat.
 *
 * Cloning a clone counts up rather than nesting, so a run of takes reads as
 * take, take-2, take-3 instead of take-2-2-2.
 */
export function nextCloneName(from: string, existing: string[]): string {
  const withoutExtension = from.replace(/\.js$/, '');
  const stem = NUMBERED.exec(withoutExtension)?.[1] ?? withoutExtension;
  const taken = new Set(existing);
  for (let number = 2; ; number += 1) {
    const candidate = `${stem}-${number}.js`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}
