import { describe, expect, it, vi } from "vitest";
import { runOverFiles, type ReadFile } from "../src/core/vault/run";
import type { RuleDraft } from "../src/core/types";

const RULE: RuleDraft = { regex: "alt", flags: "g", replacement: "neu", explanation: "" };
const EVAL = { budgetMs: 2000, now: () => 0, maxHits: 500 };

const reader = (files: Record<string, string | null>): ReadFile =>
  (path) => Promise.resolve(files[path] ?? null);

describe("runOverFiles", () => {
  it("gruppiert Treffer nach Datei und zaehlt sie zusammen", async () => {
    const run = await runOverFiles(
      ["a.md", "b.md"], RULE, false,
      reader({ "a.md": "alt und alt", "b.md": "alt" }), EVAL,
    );
    expect(run.files.map((f) => f.path)).toEqual(["a.md", "b.md"]);
    expect(run.files[0].hits).toHaveLength(2);
    expect(run.totalHits).toBe(3);
    expect(run.scanned).toBe(2);
  });

  it("laesst Dateien ohne Treffer aus der Liste weg", async () => {
    const run = await runOverFiles(
      ["a.md", "leer.md"], RULE, false,
      reader({ "a.md": "alt", "leer.md": "nichts hier" }), EVAL,
    );
    expect(run.files.map((f) => f.path)).toEqual(["a.md"]);
    expect(run.scanned).toBe(2);
  });

  it("startet mit allen Treffern angehakt", async () => {
    const run = await runOverFiles(["a.md"], RULE, false, reader({ "a.md": "alt alt" }), EVAL);
    expect(run.files[0].selected).toEqual([true, true]);
  });

  it("merkt unlesbare Dateien, ohne den Lauf abzubrechen", async () => {
    const run = await runOverFiles(
      ["weg.md", "a.md"], RULE, false, reader({ "a.md": "alt" }), EVAL,
    );
    expect(run.unreadable).toEqual(["weg.md"]);
    expect(run.files.map((f) => f.path)).toEqual(["a.md"]);
  });

  it("waehlt eine unvollstaendig gemessene Datei komplett ab", async () => {
    let t = 0;
    const run = await runOverFiles(
      ["a.md"], RULE, false, reader({ "a.md": "alt\nalt\nalt" }),
      { budgetMs: 0, now: () => (t += 10), maxHits: 500 },
    );
    const file = run.files[0];
    expect(file.complete).toBe(false);
    expect(file.selected.every((s) => s === false)).toBe(true);
  });

  it("bricht bei einem Problem der Regel ab, statt es je Datei zu wiederholen", async () => {
    const kaputt: RuleDraft = { regex: "(", flags: "g", replacement: "x", explanation: "" };
    const run = await runOverFiles(
      ["a.md", "b.md"], kaputt, false, reader({ "a.md": "x", "b.md": "x" }), EVAL,
    );
    expect(run.problem?.kind).toBe("syntax");
    expect(run.scanned).toBe(1);
  });

  it("haelt an, wenn das Abbruch-Signal kommt", async () => {
    const ctrl = new AbortController();
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) files[`f${i}.md`] = "alt";
    const run = await runOverFiles(
      Object.keys(files), RULE, false,
      (path) => { if (path === "f3.md") ctrl.abort(); return Promise.resolve(files[path]); },
      EVAL, { signal: ctrl.signal },
    );
    expect(run.aborted).toBe(true);
    expect(run.scanned).toBeLessThan(10);
  });

  it("meldet Fortschritt und gibt die Oberflaeche zeitgetaktet frei", async () => {
    let t = 0;
    const onProgress = vi.fn();
    const yieldToUi = vi.fn(() => Promise.resolve());
    const files: Record<string, string> = {};
    for (let i = 0; i < 5; i++) files[`f${i}.md`] = "alt";
    await runOverFiles(
      Object.keys(files), RULE, false, reader(files), EVAL,
      { onProgress, yieldToUi, yieldEveryMs: 250, now: () => (t += 300) },
    );
    expect(onProgress).toHaveBeenCalled();
    expect(yieldToUi).toHaveBeenCalled();
  });

it("gibt die Oberflaeche auch frei, wenn Dateien die Obergrenze reissen", async () => {
    // Regression (GUI-Smoke 2026-08-16): Fortschritt und Freigabe standen am Ende der
    // Schleife, hinter dem `continue` fuer „zu viele Treffer". Ein Muster wie [a-z]
    // reisst die Grenze in JEDER Datei — also wurde die Oberflaeche nie freigegeben,
    // ausgerechnet im teuersten Fall. Der Abbrechen-Knopf war dort Dekoration.
    let t = 0;
    const yieldToUi = vi.fn(() => Promise.resolve());
    const onProgress = vi.fn();
    const files: Record<string, string> = {};
    for (let i = 0; i < 5; i++) files[`f${i}.md`] = "aaaa";
    await runOverFiles(
      Object.keys(files), { regex: "a", flags: "g", replacement: "b", explanation: "" }, false,
      reader(files), { budgetMs: 2000, now: () => 0, maxHits: 2 },
      { onProgress, yieldToUi, yieldEveryMs: 250, now: () => (t += 300) },
    );
    expect(yieldToUi).toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalled();
  });

  it("gibt die Oberflaeche auch bei unlesbaren Dateien frei", async () => {
    let t = 0;
    const yieldToUi = vi.fn(() => Promise.resolve());
    await runOverFiles(
      ["weg1.md", "weg2.md", "weg3.md"], RULE, false, reader({}), EVAL,
      { yieldToUi, yieldEveryMs: 250, now: () => (t += 300) },
    );
    expect(yieldToUi).toHaveBeenCalled();
  });

  it("gibt die Oberflaeche NICHT frei, solange das Zeitfenster nicht um ist", async () => {
    const yieldToUi = vi.fn(() => Promise.resolve());
    const files: Record<string, string> = {};
    for (let i = 0; i < 5; i++) files[`f${i}.md`] = "alt";
    await runOverFiles(
      Object.keys(files), RULE, false, reader(files), EVAL,
      { yieldToUi, yieldEveryMs: 250, now: () => 0 },
    );
    expect(yieldToUi).not.toHaveBeenCalled();
  });
});
