/**
 * Musical key → Camelot wheel conversion and harmonic-compatibility helpers.
 * SoundCloud's `key_signature` is free text (often null), so parsing is lenient.
 */

export interface CamelotKey {
  /** 1–12 */
  number: number;
  /** A = minor, B = major */
  letter: "A" | "B";
  code: string;
}

// Pitch class (C=0 … B=11) → Camelot number.
const MAJOR: Record<number, number> = { 0: 8, 7: 9, 2: 10, 9: 11, 4: 12, 11: 1, 6: 2, 1: 3, 8: 4, 3: 5, 10: 6, 5: 7 };
const MINOR: Record<number, number> = { 9: 8, 4: 9, 11: 10, 6: 11, 1: 12, 8: 1, 3: 2, 10: 3, 5: 4, 0: 5, 7: 6, 2: 7 };

const NOTE_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function makeKey(number: number, letter: "A" | "B"): CamelotKey {
  return { number, letter, code: `${number}${letter}` };
}

/**
 * Parses keys like "C major", "Am", "A minor", "F#m", "Gb maj", "Bbmin",
 * "C♯ minor", "8A", "11B", or Open Key notation "1m"/"1d".
 */
export function toCamelot(input: string | null | undefined): CamelotKey | null {
  if (!input) return null;
  const raw = input.trim();
  if (raw === "") return null;

  const camelot = /^(1[0-2]|[1-9])\s*([ABab])$/.exec(raw);
  if (camelot?.[1] && camelot[2]) {
    return makeKey(Number(camelot[1]), camelot[2].toUpperCase() as "A" | "B");
  }

  // Open Key: 1d = C major (8B), 1m = A minor (8A); number shifts by +7 mod 12.
  const openKey = /^(1[0-2]|[1-9])\s*([dmDM])$/.exec(raw);
  if (openKey?.[1] && openKey[2]) {
    const n = ((Number(openKey[1]) + 6) % 12) + 1;
    return makeKey(n, openKey[2].toLowerCase() === "m" ? "A" : "B");
  }

  const s = raw.replace(/♯/g, "#").replace(/♭/g, "b");
  const m = /^([A-Ga-g])\s*(#|b|sharp|flat)?\s*(.*)$/i.exec(s);
  if (!m || !m[1]) return null;
  const letter = m[1].toUpperCase();
  const accidentalRaw = (m[2] ?? "").toLowerCase();
  const rest = (m[3] ?? "").trim();

  let pc = NOTE_PC[letter];
  if (pc === undefined) return null;
  if (accidentalRaw === "#" || accidentalRaw === "sharp") pc += 1;
  if (accidentalRaw === "b" || accidentalRaw === "flat") pc -= 1;
  pc = (pc + 12) % 12;

  let minor: boolean;
  // Uppercase "M" alone is the (rare) shorthand for major; lowercase "m" is minor.
  if (rest === "M") minor = false;
  else if (/^(m|min|minor|moll|mi|-)\.?$/i.test(rest)) minor = true;
  else if (rest === "" || /^(maj|major|dur)\.?$/i.test(rest)) minor = false;
  else return null;

  const number = minor ? MINOR[pc] : MAJOR[pc];
  return number ? makeKey(number, minor ? "A" : "B") : null;
}

/** Camelot distance on the wheel (0 = same number). */
function wheelDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 12;
  return Math.min(d, 12 - d);
}

export type Compatibility = "same" | "adjacent" | "relative" | "energy_boost" | "clash";

/**
 * Classic harmonic-mixing rules: same key, ±1 on the wheel (same letter),
 * relative major/minor (same number, other letter), or +2 "energy boost".
 */
export function compatibility(a: CamelotKey, b: CamelotKey): Compatibility {
  if (a.number === b.number && a.letter === b.letter) return "same";
  if (a.number === b.number) return "relative";
  if (a.letter === b.letter && wheelDistance(a.number, b.number) === 1) return "adjacent";
  if (a.letter === b.letter && ((a.number + 1) % 12) + 1 === b.number) return "energy_boost";
  return "clash";
}

export function isCompatible(a: CamelotKey, b: CamelotKey): boolean {
  return compatibility(a, b) !== "clash";
}
