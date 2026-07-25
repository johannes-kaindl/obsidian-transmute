import { describe, expect, it } from "vitest";
import { clipContext } from "../src/core/snippet";

describe("clipContext", () => {
  it("laesst kurze Zeilen unveraendert", () => {
    expect(clipContext("Termin am 25.07.2026.", 10, 20, 30)).toEqual({
      lead: "Termin am ",
      lag: ".",
    });
  });

  // Der eigentliche Grund: liegen zwei Treffer in derselben Zeile, wurde die ganze Zeile
  // je Treffer zweimal wiederholt (vorher/nachher). Vier fast gleiche Zeilen lesen sich
  // wie ein doppelt angezeigter Treffer.
  it("kuerzt langen Vorlauf und markiert den Schnitt", () => {
    const line = `${"a".repeat(100)}TREFFER${"b".repeat(100)}`;
    const clipped = clipContext(line, 100, 107, 10);
    expect(clipped.lead).toBe("…aaaaaaaaaa");
    expect(clipped.lag).toBe("bbbbbbbbbb…");
  });

  it("schneidet nur die Seite, die zu lang ist", () => {
    const clipped = clipContext(`ab${"c".repeat(50)}`, 0, 2, 10);
    expect(clipped.lead).toBe("");
    expect(clipped.lag).toBe("cccccccccc…");
  });

  it("kommt mit einem Treffer am Zeilenende zurecht", () => {
    expect(clipContext("hallo welt", 6, 10, 30)).toEqual({ lead: "hallo ", lag: "" });
  });
});
