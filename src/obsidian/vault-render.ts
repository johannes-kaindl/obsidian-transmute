import { t } from "../vendor/kit/i18n";
import type { VaultFilter } from "../core/vault/scope";

type El = HTMLElement;

export type VaultScopeModel = {
  filter: VaultFilter;
  candidates: number;
  total: number;
  /** Vorschlaege fuer die Vervollstaendigung — aus dem Vault, nicht geraten. */
  folders: string[];
  tags: string[];
};

export type VaultScopeHandlers = {
  onFilter(patch: Partial<VaultFilter>): void;
  onComputePreview(): void;
};

function suggestions(row: El, options: string[]): void {
  if (options.length === 0) return;
  const list = row.createEl("datalist");
  for (const option of options) list.createEl("option", { value: option });
}

function textRow(
  parent: El, labelKey: string, cls: string, value: string, options: string[],
  onChange: (value: string) => void,
): void {
  const row = parent.createDiv({ cls: "transmute-filter-row" });
  row.createEl("label", { text: t(labelKey) });
  const input = row.createEl("input", { cls, type: "text", value });
  suggestions(row, options);
  input.onchange = (): void => onChange(input.value.trim());
}

export function renderScopeBlock(
  parent: El,
  model: VaultScopeModel,
  handlers: VaultScopeHandlers,
): void {
  const block = parent.createDiv({ cls: "transmute-scope-block" });

  textRow(block, "view.folder", "transmute-folder", model.filter.folder ?? "", model.folders,
    (value) => handlers.onFilter({ folder: value === "" ? null : value }));

  const sub = block.createDiv({ cls: "transmute-subfolders" });
  const box = sub.createEl("input", { type: "checkbox" });
  box.checked = model.filter.includeSubfolders;
  sub.createEl("label", { text: t("view.includeSubfolders") });
  box.onchange = (): void => handlers.onFilter({ includeSubfolders: box.checked });

  textRow(block, "view.tag", "transmute-tag", model.filter.tag ?? "", model.tags,
    (value) => handlers.onFilter({ tag: value === "" ? null : value }));

  const fieldRow = block.createDiv({ cls: "transmute-filter-row" });
  fieldRow.createEl("label", { text: t("view.field") });
  const key = fieldRow.createEl("input", {
    cls: "transmute-field-key", type: "text", value: model.filter.field?.key ?? "",
  });
  const val = fieldRow.createEl("input", {
    cls: "transmute-field-value", type: "text", value: model.filter.field?.value ?? "",
  });
  // Ohne Schluessel gibt es kein Feld — ein Wert allein ist keine Bedingung.
  const pushField = (): void => {
    const k = key.value.trim();
    handlers.onFilter({ field: k === "" ? null : { key: k, value: val.value.trim() } });
  };
  key.onchange = pushField;
  val.onchange = pushField;

  const empty = model.candidates === 0;
  block.createDiv({
    cls: "transmute-candidates",
    text: empty
      ? t("view.noCandidates")
      : t("view.candidates", String(model.candidates), String(model.total)),
  });

  const btn = block.createEl("button", { cls: "transmute-compute", text: t("view.computePreview") });
  btn.disabled = empty;
  btn.onclick = (): void => handlers.onComputePreview();
}
