import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings } from "../src/core/settings";
import { STRINGS } from "../src/core/i18n/strings";
import { removeNewlinesPreset } from "../src/core/presets/remove-newlines";

describe("loadSettings", () => {
  it("fuellt fehlende Felder aus den Defaults", () => {
    expect(loadSettings({ model: "x" }).budgetMs).toBe(DEFAULT_SETTINGS.budgetMs);
  });

  it("bringt die Schwelle als Vorgabe mit", () => {
    expect(DEFAULT_SETTINGS.confirmThreshold).toBe(50);
  });

  it("ergaenzt die neuen Felder in einer alten data.json", () => {
    const geladen = loadSettings({ endpoints: [{ url: "http://x" }], model: "" });
    expect(geladen.confirmThreshold).toBe(50);
    expect("snapshotKeep" in geladen).toBe(false);
  });

  it("wirft den abgeloesten Schluessel snapshotKeep aus einer alten data.json weg", () => {
    expect("snapshotKeep" in loadSettings({ snapshotKeep: 12 })).toBe(false);
  });

  it("startet ohne Presets (Default-Objekt selbst, ohne Seeding)", () => {
    expect(DEFAULT_SETTINGS.presets).toEqual([]);
  });

  it("uebernimmt gespeicherte Presets aus einer alten data.json unveraendert", () => {
    const geladen = loadSettings({
      presets: [{ id: "p1", name: "Trim", regex: " +$", flags: "gm", replacement: "" }],
    });
    expect(geladen.presets).toEqual([{ id: "p1", name: "Trim", regex: " +$", flags: "gm", replacement: "" }]);
  });

  it("sät das eingebaute 'Zeilenumbrueche entfernen'-Preset bei Erstinstallation (kein presets-Feld in raw)", () => {
    const geladen = loadSettings({ model: "x" });
    expect(geladen.presets).toHaveLength(1);
    expect(geladen.presets[0].regex.length).toBeGreaterThan(0);
  });

  it("resurrektiert das eingebaute Preset NICHT, wenn der Nutzer alle Presets geloescht hat", () => {
    // Unterscheidungsmerkmal: raw TRAEGT den Schluessel presets, nur eben leer — das ist
    // eine bewusste Nutzerentscheidung, kein Upgrade-Fall.
    const geladen = loadSettings({ presets: [] });
    expect(geladen.presets).toEqual([]);
  });
});

describe("i18n", () => {
  it("hat fuer jeden EN-Key einen DE-Key", () => {
    expect(Object.keys(STRINGS.de).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });
});

describe("loadSettings — gespeichertes Zeilenumbruch-Preset mit dem alten Muster", () => {
  // Das Muster bis zur Umstellung auf ein Muster ohne Rückwärtsprüfung, wörtlich aus der alten data.json (Commit 4eac874^).
  const BLOCK = "(?:#{1,6}\\s|>|[-*+]\\s|\\d+\\.\\s|```|~~~|\\|)";
  const ALT = `(?<=\\S)(?<!^${BLOCK}[^\\n]*)\\n(?!\\n)(?!${BLOCK})(?=\\S)`;
  const gespeichert = { id: "builtin-remove-newlines", name: "Zeilenumbrüche in Absätzen entfernen", regex: ALT, flags: "m", replacement: " " };
  const neu = removeNewlinesPreset();

  it("zieht das unveränderte alte Standardpreset auf das neue Muster, Id und Name bleiben", () => {
    const [p] = loadSettings({ presets: [gespeichert] }).presets;
    expect(p.regex).toBe(neu.regex);
    expect(p.replacement).toBe(neu.replacement);
    expect(p.flags).toBe("m");
    expect([p.id, p.name]).toEqual([gespeichert.id, gespeichert.name]);
    expect(p.regex).not.toContain("(?<");
  });

  it("lässt ein abgewandeltes Muster unberührt (anderes Muster, andere Flags, andere Ersetzung)", () => {
    for (const abw of [
      { ...gespeichert, regex: ALT + "x" },
      { ...gespeichert, flags: "gm" },
      { ...gespeichert, replacement: "  " },
    ]) {
      expect(loadSettings({ presets: [abw] }).presets).toEqual([abw]);
    }
  });

  it("zieht auch einen duplizierten Eintrag mit dem alten Standardtext (andere Id, anderer Name)", () => {
    const [p] = loadSettings({ presets: [{ ...gespeichert, id: "p-kopie", name: "Meine Kopie" }] }).presets;
    expect([p.id, p.name, p.regex]).toEqual(["p-kopie", "Meine Kopie", neu.regex]);
  });

  it("fasst fremde Presets in derselben Liste nicht an", () => {
    const trim = { id: "p1", name: "Trim", regex: " +$", flags: "gm", replacement: "" };
    expect(loadSettings({ presets: [trim, gespeichert] }).presets).toEqual([trim, { ...gespeichert, regex: neu.regex, replacement: neu.replacement }]);
  });

  it("Gegenprobe: die Test-Konstante ist wirklich das alte Muster (kompiliert in dieser Umgebung und entfernt weiche Umbrüche)", () => {
    const text = "Satz eins\nSatz zwei\n\n- Punkt\nweiter";
    expect(text.replace(new RegExp(ALT, "m"), " ")).toBe("Satz eins Satz zwei\n\n- Punkt\nweiter");
  });
});
