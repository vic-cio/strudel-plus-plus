export const CPS_MIN = 0.05;
export const CPS_MAX = 8;

/** Strudel counts cycles; a bar is four beats, which is what the status bar shows. */
const BEATS_PER_CYCLE = 4;

export function bpmFromCps(cps: number): number {
  return cps * 60 * BEATS_PER_CYCLE;
}

export function cpsFromBpm(bpm: number): number {
  return bpm / (60 * BEATS_PER_CYCLE);
}

/** Whether the beat declares its own tempo through setcps or setcpm. */
export function hasCodedTempo(code: string): boolean {
  let quote: string | undefined;

  for (let index = 0; index < code.length; index += 1) {
    const character = code[index];
    const next = code[index + 1];

    if (quote) {
      if (character === '\\') {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === '/' && next === '/') {
      index += 2;
      while (index < code.length && code[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    if (character === '/' && next === '*') {
      index += 2;
      while (index < code.length && !(code[index] === '*' && code[index + 1] === '/')) {
        index += 1;
      }
      index += 1;
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }

    const name = ['setcps', 'setcpm'].find((candidate) => code.startsWith(candidate, index));
    if (!name || isIdentifierCharacter(code[index - 1]) || isIdentifierCharacter(code[index + name.length])) {
      continue;
    }
    let afterName = index + name.length;
    while (/\s/.test(code[afterName] ?? '')) {
      afterName += 1;
    }
    if (code[afterName] === '(') {
      return true;
    }
  }
  return false;
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_$]/.test(character);
}

/** Read a typed tempo. Undefined means the box does not hold one yet. */
export function parseBpm(text: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:bpm)?\s*$/i.exec(text);
  const bpm = match ? Number(match[1]) : NaN;
  return Number.isFinite(bpm) && bpm > 0 ? bpm : undefined;
}

export function clampCps(cps: number): number {
  const bounded = Math.min(CPS_MAX, Math.max(CPS_MIN, cps));
  return Math.round(bounded * 10000) / 10000;
}
