import { describe, expect, it } from "vitest";
import { applyHits } from "../src/core/apply";
import type { Hit } from "../src/core/types";

const hit = (start: number, end: number, replacement: string): Hit => ({
  line: 0, lineStart: 0, start, end, matched: "", replacement, before: "", after: "",
});

describe("applyHits", () => {
  it("ersetzt rueckwaerts, damit spaetere Offsets gueltig bleiben", () => {
    const text = "aaa bbb ccc";
    const hits = [hit(0, 3, "X"), hit(4, 7, "YYYYY"), hit(8, 11, "Z")];
    expect(applyHits(text, hits, [true, true, true])).toBe("X YYYYY Z");
  });

  it("laesst abgewaehlte Treffer unberuehrt", () => {
    const text = "aaa bbb";
    const hits = [hit(0, 3, "X"), hit(4, 7, "Y")];
    expect(applyHits(text, hits, [false, true])).toBe("aaa Y");
  });

  it("gibt bei keiner Auswahl den Originaltext zurueck", () => {
    expect(applyHits("abc", [hit(0, 1, "X")], [false])).toBe("abc");
  });

  it("behandelt leere Ersetzung als Loeschen", () => {
    expect(applyHits("abc", [hit(1, 2, "")], [true])).toBe("ac");
  });

  it("sortiert unsortierte Treffer selbst", () => {
    const hits = [hit(4, 7, "Y"), hit(0, 3, "X")];
    expect(applyHits("aaa bbb", hits, [true, true])).toBe("X Y");
  });
});
