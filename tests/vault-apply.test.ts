import { describe, expect, it } from "vitest";
import { applyHitsToText, sameHits } from "../src/core/vault/apply";
import type { Hit } from "../src/core/types";

const hit = (start: number, end: number, matched: string, replacement: string): Hit => ({
  line: 0, lineStart: 0, start, end, matched, replacement,
  before: matched, after: replacement,
});

describe("applyHitsToText", () => {
  it("ersetzt genau die angehakten Treffer", () => {
    const text = "alt und alt";
    const hits = [hit(0, 3, "alt", "neu"), hit(8, 11, "alt", "neu")];
    expect(applyHitsToText(text, hits, [true, false])).toBe("neu und alt");
  });

  it("ersetzt von hinten nach vorn, damit Offsets gueltig bleiben", () => {
    const text = "aa bb";
    const hits = [hit(0, 2, "aa", "xxxx"), hit(3, 5, "bb", "y")];
    expect(applyHitsToText(text, hits, [true, true])).toBe("xxxx y");
  });

  it("laesst den Text unberuehrt, wenn nichts angehakt ist", () => {
    const text = "alt";
    expect(applyHitsToText(text, [hit(0, 3, "alt", "neu")], [false])).toBe(text);
  });

  it("kommt mit unsortierten Treffern zurecht", () => {
    const text = "aa bb";
    const hits = [hit(3, 5, "bb", "y"), hit(0, 2, "aa", "x")];
    expect(applyHitsToText(text, hits, [true, true])).toBe("x y");
  });
});

describe("sameHits", () => {
  it("erkennt dieselbe Treffermenge", () => {
    const a = [hit(0, 3, "alt", "neu")];
    const b = [hit(0, 3, "alt", "neu")];
    expect(sameHits(a, b)).toBe(true);
  });

  it("erkennt eine verschobene Stelle", () => {
    expect(sameHits([hit(0, 3, "alt", "neu")], [hit(5, 8, "alt", "neu")])).toBe(false);
  });

  it("erkennt eine andere Anzahl", () => {
    expect(sameHits([hit(0, 3, "alt", "neu")], [])).toBe(false);
  });

  it("erkennt einen anderen getroffenen Text", () => {
    expect(sameHits([hit(0, 3, "alt", "neu")], [hit(0, 3, "ALT", "neu")])).toBe(false);
  });

  it("erkennt eine andere Ersetzung", () => {
    expect(sameHits([hit(0, 3, "alt", "neu")], [hit(0, 3, "alt", "anders")])).toBe(false);
  });
});
