import { describe, expect, it } from "vitest";
import { CHEATSHEET } from "../src/core/cheatsheet";
import { STRINGS } from "../src/core/i18n/strings";

describe("CHEATSHEET", () => {
  it("hat fuer jede Zeile einen uebersetzten Text in beiden Sprachen", () => {
    for (const group of CHEATSHEET) {
      expect(STRINGS.en).toHaveProperty(group.titleKey);
      expect(STRINGS.de).toHaveProperty(group.titleKey);
      for (const row of group.rows) {
        expect(STRINGS.en).toHaveProperty(row.descKey);
        expect(STRINGS.de).toHaveProperty(row.descKey);
      }
    }
  });

  it("deckt die Bausteine ab, die man beim ersten eigenen Muster braucht", () => {
    const syntax = CHEATSHEET.flatMap((g) => g.rows.map((r) => r.syntax));
    for (const needed of ["\\d", "\\b", "+", "*", "?", "^", "$", "[abc]", "(…)", "$1"]) {
      expect(syntax).toContain(needed);
    }
  });

  it("vergibt keinen Schluessel doppelt", () => {
    const keys = CHEATSHEET.flatMap((g) => [g.titleKey, ...g.rows.map((r) => r.descKey)]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
