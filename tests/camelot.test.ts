import { describe, expect, it } from "vitest";
import { compatibility, isCompatible, toCamelot } from "../src/camelot.js";

const code = (s: string | null) => toCamelot(s)?.code ?? null;

describe("toCamelot", () => {
  it.each([
    ["C major", "8B"],
    ["A minor", "8A"],
    ["Am", "8A"],
    ["a minor", "8A"],
    ["G major", "9B"],
    ["E minor", "9A"],
    ["F#m", "11A"],
    ["F# minor", "11A"],
    ["Gb major", "2B"],
    ["F# major", "2B"],
    ["Bb", "6B"],
    ["Bbm", "3A"],
    ["Eb minor", "2A"],
    ["D# min", "2A"],
    ["C♯ minor", "12A"],
    ["Db major", "3B"],
    ["B major", "1B"],
    ["G# minor", "1A"],
    ["Ab minor", "1A"],
    ["F major", "7B"],
    ["D minor", "7A"],
    ["C sharp minor", "12A"],
    ["E flat major", "5B"],
    ["CM", "8B"],
    ["8A", "8A"],
    ["12b", "12B"],
    ["1m", "8A"],
    ["1d", "8B"],
    ["6d", "1B"],
  ])("%s -> %s", (input, expected) => {
    expect(code(input)).toBe(expected);
  });

  it.each([null, "", "   ", "H major", "C lydian", "13A", "unknown"])("returns null for %j", (input) => {
    expect(code(input as string | null)).toBeNull();
  });
});

describe("compatibility", () => {
  const k = (s: string) => toCamelot(s)!;
  it("follows harmonic-mixing rules", () => {
    expect(compatibility(k("8A"), k("8A"))).toBe("same");
    expect(compatibility(k("8A"), k("9A"))).toBe("adjacent");
    expect(compatibility(k("8A"), k("7A"))).toBe("adjacent");
    expect(compatibility(k("12A"), k("1A"))).toBe("adjacent");
    expect(compatibility(k("8A"), k("8B"))).toBe("relative");
    expect(compatibility(k("8A"), k("10A"))).toBe("energy_boost");
    expect(compatibility(k("11B"), k("1B"))).toBe("energy_boost");
    expect(compatibility(k("8A"), k("3B"))).toBe("clash");
    expect(isCompatible(k("8A"), k("9B"))).toBe(false);
  });
});
