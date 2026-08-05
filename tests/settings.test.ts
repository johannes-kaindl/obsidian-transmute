import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings } from "../src/core/settings";
import { statusKindKey } from "../src/core/settings/endpoint-editor-model";
import { STRINGS } from "../src/core/i18n/strings";

describe("loadSettings", () => {
  it("fuellt fehlende Felder aus den Defaults", () => {
    expect(loadSettings({ model: "x" }).budgetMs).toBe(DEFAULT_SETTINGS.budgetMs);
  });

  it("startet ohne hartkodiertes Modell (Modellagnostik)", () => {
    expect(DEFAULT_SETTINGS.model).toBe("");
  });
});

describe("i18n", () => {
  it("hat fuer jeden EN-Key einen DE-Key", () => {
    expect(Object.keys(STRINGS.de).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });

  it("liefert Statuskeys statt des hart deutschen Kit-Klartexts", () => {
    expect(statusKindKey("ok")).toMatch(/^status\./);
  });
});
