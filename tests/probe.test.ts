import { describe, expect, it } from "vitest";
import { probeRisky, PROBE_CHARS } from "../src/core/regex/probe";

/** Uhr, die bei jedem Aufruf um `step` ms weiterspringt. */
const clock = (step: number) => {
  let t = 0;
  return () => (t += step);
};

describe("probeRisky", () => {
  it("laesst ein harmloses Muster durch", () => {
    const res = probeRisky({ regex: "foo", flags: "", replacement: "x", explanation: "" }, "foo bar", {
      now: clock(0),
      budgetMs: 4,
    });
    expect(res.ok).toBe(true);
  });

  it("lehnt ab, wenn die Probe laenger als das Budget braucht", () => {
    const res = probeRisky({ regex: "(a+)+b", flags: "", replacement: "x", explanation: "" }, "aaaaaaaa", {
      now: clock(10),
      budgetMs: 4,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.ms).toBeGreaterThanOrEqual(4);
      // Der Text ist kuerzer als PROBE_CHARS — gemeldet wird, was wirklich geprobt wurde.
      expect(res.sampleChars).toBe(8);
    }
  });

  it("meldet die laengste Zeile, damit die Hochrechnung nachvollziehbar ist", () => {
    const text = `kurz\n${"a".repeat(412)}\nkurz`;
    const res = probeRisky({ regex: "(a+)+b", flags: "", replacement: "x", explanation: "" }, text, {
      now: clock(10),
      budgetMs: 4,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.longestLine).toBe(412);
  });

  // Die Probe selbst darf nicht das sein, was haengt: sie laeuft auf einem kurzen
  // Ausschnitt, dessen Backtracking-Raum noch ueberschaubar ist.
  it("probt hoechstens PROBE_CHARS Zeichen, egal wie lang der Text ist", () => {
    expect(PROBE_CHARS).toBeLessThanOrEqual(24);

    const start = Date.now();
    const res = probeRisky(
      { regex: "(a+)+b", flags: "", replacement: "x", explanation: "" },
      "a".repeat(5000),
      { now: () => Date.now(), budgetMs: 4 },
    );
    // Echte Zeit: die Probe muss in Sekundenbruchteilen zurueckkommen, sonst waere sie
    // selbst die Bombe, vor der sie schuetzen soll.
    expect(Date.now() - start).toBeLessThan(3000);
    expect(res.ok).toBe(false);
  });

  it("nimmt den Ausschnitt aus der laengsten Zeile, nicht aus der ersten", () => {
    const text = `x\n${"a".repeat(100)}`;
    const res = probeRisky({ regex: "(a+)+b", flags: "", replacement: "x", explanation: "" }, text, {
      now: clock(10),
      budgetMs: 4,
    });
    expect(res.ok).toBe(false);
  });

  it("laesst ein syntaktisch kaputtes Muster durch — dafuer ist evaluate zustaendig", () => {
    const res = probeRisky({ regex: "(unbalanced", flags: "", replacement: "", explanation: "" }, "text", {
      now: clock(0),
      budgetMs: 4,
    });
    expect(res.ok).toBe(true);
  });
});
