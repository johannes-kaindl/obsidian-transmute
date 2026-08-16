import { describe, expect, it, vi } from "vitest";
import { makeFakeEl } from "./__mocks__/obsidian";
import { findAllByClass, findByClass } from "./helpers/dom";
import { renderRunState, renderVaultBody, renderVaultOutcome } from "../src/obsidian/vault-render";
import { runPhaseChanged, runProgressed, runStarted, RUN_IDLE } from "../src/core/vault/state";
import type { FileHits } from "../src/core/vault/run";
import "../src/core/i18n/strings";

const handlers = {
  onToggleFile: vi.fn(), onToggleHit: vi.fn(), onExpand: vi.fn(), onSetAll: vi.fn(), onUndo: vi.fn(), onAbort: vi.fn(),
};

describe("renderRunState", () => {
  it("zeichnet im Ruhezustand nichts", () => {
    const root = makeFakeEl();
    renderRunState(root, RUN_IDLE, vi.fn());
    expect(findByClass(root, "transmute-run")).toBeNull();
  });

  it("zeigt beim Durchsuchen Zahlen und den Abbrechen-Knopf", () => {
    const root = makeFakeEl();
    renderRunState(root, runProgressed(runStarted(412), 17, "a.md"), vi.fn());
    const line = findByClass<{ textContent?: string }>(root, "transmute-run-line");
    expect(line?.textContent).toContain("17");
    expect(line?.textContent).toContain("412");
    expect(findByClass(root, "transmute-abort")).not.toBeNull();
  });

  it("laesst in der Schreibphase keinen Abbruch zu", () => {
    const root = makeFakeEl();
    renderRunState(root, runPhaseChanged(runStarted(412), "writing"), vi.fn());
    expect(findByClass(root, "transmute-abort")).toBeNull();
  });

  it("meldet den Abbruch nach oben", () => {
    const root = makeFakeEl();
    const onAbort = vi.fn();
    renderRunState(root, runStarted(10), onAbort);
    findByClass<{ onclick?: () => void }>(root, "transmute-abort")?.onclick?.();
    expect(onAbort).toHaveBeenCalled();
  });
});

describe("renderVaultOutcome", () => {
  const leer = { applied: null, skippedChanged: [], unreadable: [], incomplete: [] };

  it("zeigt nach der Anwendung Zahlen und den Rueckgaengig-Knopf", () => {
    const root = makeFakeEl();
    renderVaultOutcome(root, {
      ...leer, applied: { files: 339, hits: 1192, snapshotDir: "2026-08-14T17-02-11" },
    }, vi.fn());
    const line = findByClass<{ textContent?: string }>(root, "transmute-applied");
    expect(line?.textContent).toContain("1192");
    expect(line?.textContent).toContain("339");
    expect(findByClass(root, "transmute-undo")).not.toBeNull();
  });

  it("benennt uebersprungene Dateien einzeln nach Grund", () => {
    const root = makeFakeEl();
    renderVaultOutcome(root, {
      applied: { files: 1, hits: 1, snapshotDir: "d" },
      skippedChanged: ["a.md", "b.md"], unreadable: ["c.md"], incomplete: ["gross.md"],
    }, vi.fn());
    expect(findByClass<{ textContent?: string }>(root, "transmute-skipped-changed")?.textContent).toContain("2");
    expect(findByClass<{ textContent?: string }>(root, "transmute-skipped-unreadable")?.textContent).toContain("1");
    expect(findByClass<{ textContent?: string }>(root, "transmute-skipped-incomplete")?.textContent).toContain("1");
  });

  it("laesst die Hinweise weg, wenn nichts uebersprungen wurde", () => {
    const root = makeFakeEl();
    renderVaultOutcome(root, { ...leer, applied: { files: 1, hits: 1, snapshotDir: "d" } }, vi.fn());
    expect(findByClass(root, "transmute-skipped-changed")).toBeNull();
  });

  it("zeigt uebersprungene Dateien auch ohne Anwendung", () => {
    const root = makeFakeEl();
    renderVaultOutcome(root, { ...leer, incomplete: ["gross.md"] }, vi.fn());
    expect(findByClass(root, "transmute-vault-outcome")).toBeNull();
    expect(findByClass(root, "transmute-skipped-incomplete")).not.toBeNull();
  });
});

describe("Zeichnen waehrend eines laufenden Laufs", () => {
  const file = (path: string): FileHits => ({
    path,
    hits: [{ line: 0, lineStart: 0, start: 0, end: 3, matched: "alt", replacement: "neu", before: "alt", after: "neu" }],
    selected: [true], timedOutAtLine: null, complete: true,
  });

  it("zeichnet die Trefferliste erst, wenn der Lauf fertig ist", () => {
    // Regression (GUI-Smoke 2026-08-16): waehrend des Laufs wurde bei JEDEM Fortschritt
    // die komplette Liste neu gebaut. Bei 11.770 Dateien kostet das mehr als der Lauf
    // selbst — und blockiert ausgerechnet die Oberflaeche, die der Fortschritt
    // informieren soll. Der Abbrechen-Knopf wurde dadurch nie erreichbar.
    const root = makeFakeEl();
    renderVaultBody(root, {
      files: [file("a.md"), file("b.md")],
      expanded: new Set<string>(),
      totalHits: 2,
      run: runProgressed(runStarted(1000), 17, "a.md"),
      outcome: { applied: null, skippedChanged: [], unreadable: [], incomplete: [] },
    }, handlers);

    expect(findByClass(root, "transmute-run")).not.toBeNull();
    expect(findAllByClass(root, "transmute-file-row")).toHaveLength(0);
  });

  it("zeichnet die Trefferliste, sobald der Lauf steht", () => {
    const root = makeFakeEl();
    renderVaultBody(root, {
      files: [file("a.md"), file("b.md")],
      expanded: new Set<string>(),
      totalHits: 2,
      run: RUN_IDLE,
      outcome: { applied: null, skippedChanged: [], unreadable: [], incomplete: [] },
    }, handlers);

    expect(findAllByClass(root, "transmute-file-row")).toHaveLength(2);
  });
});
