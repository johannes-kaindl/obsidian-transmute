import { describe, expect, it, vi } from "vitest";
import { makeFakeEl } from "./__mocks__/obsidian";
import { findAllByClass, findByClass } from "./helpers/dom";
import { renderVaultList } from "../src/obsidian/vault-render";
import type { FileHits } from "../src/core/vault/run";
import "../src/core/i18n/strings";

const file = (path: string, selected: boolean[], complete = true): FileHits => ({
  path,
  hits: selected.map((_, i) => ({
    line: i, lineStart: 0, start: 0, end: 3, matched: "alt", replacement: "neu",
    before: "alt", after: "neu",
  })),
  selected, timedOutAtLine: null, complete,
});

const handlers = {
  onToggleFile: vi.fn(), onToggleHit: vi.fn(), onExpand: vi.fn(), onSetAll: vi.fn(),
};

describe("renderVaultList", () => {
  it("zeichnet je Datei eine Zeile", () => {
    const root = makeFakeEl();
    renderVaultList(root, {
      files: [file("a.md", [true, true]), file("b.md", [true])],
      expanded: new Set(), totalHits: 3,
    }, handlers);
    expect(findAllByClass(root, "transmute-file-row")).toHaveLength(2);
  });

  it("zeigt eingeklappt keine Treffer", () => {
    const root = makeFakeEl();
    renderVaultList(root, { files: [file("a.md", [true, true])], expanded: new Set(), totalHits: 2 }, handlers);
    expect(findAllByClass(root, "transmute-hit-row")).toHaveLength(0);
  });

  it("zeigt die Treffer der aufgeklappten Datei", () => {
    const root = makeFakeEl();
    renderVaultList(root, {
      files: [file("a.md", [true, true]), file("b.md", [true])],
      expanded: new Set(["a.md"]), totalHits: 3,
    }, handlers);
    expect(findAllByClass(root, "transmute-hit-row")).toHaveLength(2);
  });

  it("nennt die Trefferzahl je Datei", () => {
    const root = makeFakeEl();
    renderVaultList(root, { files: [file("a.md", [true, true])], expanded: new Set(), totalHits: 2 }, handlers);
    const count = findByClass<{ textContent?: string }>(root, "transmute-file-count");
    expect(count?.textContent).toBe("2");
  });

  it("markiert eine teilweise gewaehlte Datei als solche", () => {
    const root = makeFakeEl();
    renderVaultList(root, { files: [file("a.md", [true, false])], expanded: new Set(), totalHits: 2 }, handlers);
    const box = findByClass<{ indeterminate?: boolean }>(root, "transmute-file-check");
    expect(box?.indeterminate).toBe(true);
  });

  it("sperrt den Haken einer unvollstaendig gemessenen Datei", () => {
    const root = makeFakeEl();
    renderVaultList(root, {
      files: [file("gross.md", [false], false)], expanded: new Set(), totalHits: 1,
    }, handlers);
    const box = findByClass<{ disabled?: boolean }>(root, "transmute-file-check");
    expect(box?.disabled).toBe(true);
  });

  it("zeigt die Zusammenfassung ueber der Liste", () => {
    const root = makeFakeEl();
    renderVaultList(root, {
      files: [file("a.md", [true, true]), file("b.md", [true])], expanded: new Set(), totalHits: 3,
    }, handlers);
    const head = findByClass<{ textContent?: string }>(root, "transmute-affected");
    expect(head?.textContent).toContain("2");
    expect(head?.textContent).toContain("3");
  });

  it("meldet einen Klick auf die Dateizeile als Aufklappen", () => {
    const root = makeFakeEl();
    renderVaultList(root, { files: [file("a.md", [true])], expanded: new Set(), totalHits: 1 }, handlers);
    findByClass<{ onclick?: () => void }>(root, "transmute-file-name")?.onclick?.();
    expect(handlers.onExpand).toHaveBeenCalledWith("a.md");
  });
});
