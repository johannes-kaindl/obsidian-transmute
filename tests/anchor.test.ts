import { describe, expect, it } from "vitest";
import { textUnchanged } from "../src/core/anchor";

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
