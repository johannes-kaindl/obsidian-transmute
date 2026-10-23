import { describe, expect, it } from "vitest";
import { sameMatches } from "../src/core/anchor";
import type { Hit } from "../src/core/types";

const hit = (matched: string, replacement: string, start = 0): Hit => ({
  line: 0, lineStart: 0, start, end: start + matched.length, matched, replacement, before: "", after: "",
});

describe("sameMatches", () => {
  it("erkennt dieselben Ersetzungen trotz verschobener Positionen", () => {
    expect(sameMatches([hit("#alt", "#neu", 10)], [hit("#alt", "#neu", 42)])).toBe(true);
  });

  it("meldet eine geaenderte Trefferzahl", () => {
    expect(sameMatches([hit("#alt", "#neu")], [hit("#alt", "#neu"), hit("#alt", "#neu")])).toBe(false);
  });

  it("meldet einen anderen Fundtext", () => {
    expect(sameMatches([hit("#alt", "#neu")], [hit("#alter", "#neu")])).toBe(false);
  });

  it("meldet eine andere Ersetzung", () => {
    expect(sameMatches([hit("#alt", "#neu")], [hit("#alt", "#anders")])).toBe(false);
  });
});
