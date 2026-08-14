import { describe, expect, it, vi } from "vitest";
import { makeFakeEl } from "./__mocks__/obsidian";
import { findAllByClass, findByClass } from "./helpers/dom";
import { renderScopeBlock, type VaultScopeModel } from "../src/obsidian/vault-render";
import { EMPTY_FILTER } from "../src/core/vault/scope";
import "../src/core/i18n/strings";

const model = (patch: Partial<VaultScopeModel> = {}): VaultScopeModel => ({
  filter: EMPTY_FILTER,
  candidates: 412,
  total: 2140,
  folders: ["10_Notizen", "90_Archiv"],
  tags: ["#projekt", "#archiv"],
  ...patch,
});

const handlers = { onFilter: vi.fn(), onComputePreview: vi.fn() };

describe("renderScopeBlock", () => {
  it("zeigt drei Filterfelder und den Unterordner-Schalter", () => {
    const root = makeFakeEl();
    renderScopeBlock(root, model(), handlers);
    expect(findAllByClass(root, "transmute-filter-row")).toHaveLength(3);
    expect(findByClass(root, "transmute-subfolders")).not.toBeNull();
  });

  it("nennt die Zahl der Kandidaten", () => {
    const root = makeFakeEl();
    renderScopeBlock(root, model(), handlers);
    const count = findByClass<{ textContent?: string }>(root, "transmute-candidates");
    expect(count?.textContent).toContain("412");
    expect(count?.textContent).toContain("2140");
  });

  it("meldet einen leeren Umfang als eigenen Fall, nicht als null Treffer", () => {
    const root = makeFakeEl();
    renderScopeBlock(root, model({ candidates: 0 }), handlers);
    const count = findByClass<{ textContent?: string }>(root, "transmute-candidates");
    expect(count?.textContent).toContain("No note matches this scope");
  });

  it("sperrt den Vorschau-Knopf bei leerem Umfang", () => {
    const root = makeFakeEl();
    renderScopeBlock(root, model({ candidates: 0 }), handlers);
    const btn = findByClass<{ disabled?: boolean }>(root, "transmute-compute");
    expect(btn?.disabled).toBe(true);
  });

  it("meldet eine Ordner-Aenderung nach oben", () => {
    const root = makeFakeEl();
    const onFilter = vi.fn();
    renderScopeBlock(root, model(), { onFilter, onComputePreview: vi.fn() });
    const input = findByClass<{ value: string; onchange?: () => void }>(root, "transmute-folder");
    if (input !== null) { input.value = "10_Notizen"; input.onchange?.(); }
    expect(onFilter).toHaveBeenCalledWith({ folder: "10_Notizen" });
  });

  it("macht aus einem leeren Ordnerfeld wieder den ganzen Vault", () => {
    const root = makeFakeEl();
    const onFilter = vi.fn();
    renderScopeBlock(root, model({ filter: { ...EMPTY_FILTER, folder: "10_Notizen" } }),
      { onFilter, onComputePreview: vi.fn() });
    const input = findByClass<{ value: string; onchange?: () => void }>(root, "transmute-folder");
    if (input !== null) { input.value = ""; input.onchange?.(); }
    expect(onFilter).toHaveBeenCalledWith({ folder: null });
  });

  it("meldet ein Frontmatter-Paar erst, wenn der Schluessel steht", () => {
    const root = makeFakeEl();
    const onFilter = vi.fn();
    renderScopeBlock(root, model(), { onFilter, onComputePreview: vi.fn() });
    const key = findByClass<{ value: string; onchange?: () => void }>(root, "transmute-field-key");
    const val = findByClass<{ value: string }>(root, "transmute-field-value");
    if (key !== null && val !== null) { key.value = "status"; val.value = "aktiv"; key.onchange?.(); }
    expect(onFilter).toHaveBeenCalledWith({ field: { key: "status", value: "aktiv" } });
  });
});
