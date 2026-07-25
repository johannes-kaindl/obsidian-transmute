import { describe, expect, it } from "vitest";
import { runRule } from "../src/core/regex/execute";

const opts = { budgetMs: 1000, now: () => 0 };

describe("runRule", () => {
  it("findet Treffer mit Offsets und Zeilentext", () => {
    const text = "foo bar\nbaz foo";
    const res = runRule(text, /foo/g, "qux", false, opts);
    expect(res.hits).toHaveLength(2);
    expect(res.hits[0]).toMatchObject({ line: 0, start: 0, end: 3, matched: "foo", replacement: "qux" });
    expect(res.hits[0].before).toBe("foo bar");
    expect(res.hits[0].after).toBe("qux bar");
    expect(res.hits[1]).toMatchObject({ line: 1, start: 12, end: 15 });
  });

  it("expandiert Gruppenverweise im Ersetzungsmuster", () => {
    const res = runRule("25.07.2026", /(\d{2})\.(\d{2})\.(\d{4})/g, "$3-$2-$1", false, opts);
    expect(res.hits[0].replacement).toBe("2026-07-25");
    expect(res.hits[0].after).toBe("2026-07-25");
  });

  it("expandiert $& als gesamten Treffer", () => {
    const res = runRule("hallo", /hal/g, "[$&]", false, opts);
    expect(res.hits[0].replacement).toBe("[hal]");
  });

  it("bricht bei ueberschrittenem Zeitbudget ab und meldet die Zeile", () => {
    let t = 0;
    const res = runRule("a\nb\nc\nd", /./g, "x", false, { budgetMs: 5, now: () => (t += 4) });
    expect(res.timedOut).toBe(true);
    expect(res.timedOutAtLine).not.toBeNull();
    expect(res.hits.length).toBeGreaterThan(0);
  });

  it("nimmt bei Mehrzeilen-Mustern den Volltext-Pfad", () => {
    const res = runRule("a\nb", /a\nb/g, "c", true, opts);
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0].start).toBe(0);
    expect(res.hits[0].end).toBe(3);
  });

  it("laeuft bei leerem Treffer nicht endlos", () => {
    const res = runRule("abc", /x*/g, "-", false, opts);
    expect(res.hits.length).toBeLessThanOrEqual(4);
  });
});
