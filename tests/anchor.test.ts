import { describe, expect, it } from "vitest";
import { locateRegion, sameMatches, textUnchanged } from "../src/core/anchor";
import type { Hit } from "../src/core/types";

const hit = (matched: string, replacement: string, start = 0): Hit => ({
  line: 0, lineStart: 0, start, end: start + matched.length, matched, replacement, before: "", after: "",
});

describe("textUnchanged", () => {
  it("erkennt den unveraenderten Text an derselben Stelle", () => {
    expect(textUnchanged("Termin am 25.07.2026.", 0, "Termin am 25.07.2026.")).toBe(true);
  });

  it("erkennt einen Ausschnitt an seinem Offset", () => {
    expect(textUnchanged("Termin am 25.07.2026.", 10, "25.07.2026")).toBe(true);
  });

  // Der Grund fuer diese Funktion: Treffer tragen Offsets in den Text VON DAMALS.
  // Ohne die Pruefung wuerde Anwenden nach einer Bearbeitung an falschen Stellen schreiben.
  it("meldet eine Bearbeitung zwischen Vorschau und Anwenden", () => {
    expect(textUnchanged("Neuer Satz. Termin am 25.07.2026.", 0, "Termin am 25.07.2026.")).toBe(false);
  });

  it("meldet einen verschobenen Ausschnitt", () => {
    expect(textUnchanged("XXTermin am 25.07.2026.", 10, "25.07.2026")).toBe(false);
  });

  it("meldet einen abgeschnittenen Text statt ihn als Praefix durchzuwinken", () => {
    expect(textUnchanged("Termin am", 0, "Termin am 25.07.2026.")).toBe(false);
  });
});

describe("locateRegion", () => {
  it("findet den Ausschnitt an seiner alten Stelle", () => {
    expect(locateRegion("aaaZIELbbb", 3, "ZIEL")).toBe(3);
  });

  // Der reale Fall: ein Linter-Plugin schreibt beim Speichern "updated:" ins Frontmatter.
  // Alles dahinter verschiebt sich — der Ausschnitt ist aber unveraendert da.
  it("findet den verschobenen Ausschnitt nach einem Frontmatter-Eingriff", () => {
    const doc = "---\ntitle: A\nupdated: 13:51\n---\n\nEin #alt Tag.";
    expect(locateRegion(doc, 18, "Ein #alt Tag.")).toBe(doc.indexOf("Ein #alt Tag."));
  });

  it("gibt null zurueck, wenn der Ausschnitt verschwunden ist", () => {
    expect(locateRegion("nichts davon", 0, "ZIEL")).toBeNull();
  });

  it("gibt null zurueck, wenn der Ausschnitt mehrdeutig ist", () => {
    expect(locateRegion("ZIEL und nochmal ZIEL", 99, "ZIEL")).toBeNull();
  });
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
