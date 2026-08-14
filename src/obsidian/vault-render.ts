import { t } from "../vendor/kit/i18n";
import type { VaultFilter } from "../core/vault/scope";
import type { FileHits } from "../core/vault/run";
import { countSelected, fileCheckState } from "../core/vault/selection";
import { canAbort, type RunPhase, type RunState } from "../core/vault/state";

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

export type VaultListModel = {
  files: FileHits[];
  /** Welche Dateien aufgeklappt sind. Gehoert ins Modell, nicht ins DOM — ein Teil-Draw
   *  wuerde den Zustand sonst bei jedem Haekchen verlieren. */
  expanded: Set<string>;
  totalHits: number;
};

export type VaultListHandlers = {
  onToggleFile(path: string): void;
  onToggleHit(path: string, index: number): void;
  onExpand(path: string): void;
  onSetAll(value: boolean): void;
};

export function renderVaultList(
  parent: El,
  model: VaultListModel,
  handlers: VaultListHandlers,
): void {
  const counted = countSelected(model.files);
  const head = parent.createDiv({ cls: "transmute-list-head" });
  head.createSpan({
    cls: "transmute-affected",
    text: t("view.affected", String(counted.files), String(counted.hits)),
  });
  const all = head.createEl("button", { text: t("view.selectAll") });
  all.onclick = (): void => handlers.onSetAll(true);
  const none = head.createEl("button", { text: t("view.selectNone") });
  none.onclick = (): void => handlers.onSetAll(false);

  const list = parent.createDiv({ cls: "transmute-file-list" });
  for (const file of model.files) {
    const row = list.createDiv({ cls: "transmute-file-row" });

    const box = row.createEl("input", { cls: "transmute-file-check", type: "checkbox" });
    const state = fileCheckState(file);
    box.checked = state === "all";
    box.indeterminate = state === "some";
    box.disabled = !file.complete;
    box.onchange = (): void => handlers.onToggleFile(file.path);

    const name = row.createSpan({ cls: "transmute-file-name", text: file.path });
    name.onclick = (): void => handlers.onExpand(file.path);
    row.createSpan({ cls: "transmute-file-count", text: String(file.hits.length) });

    if (!model.expanded.has(file.path)) continue;

    const hits = list.createDiv({ cls: "transmute-file-hits" });
    file.hits.forEach((hit, index) => {
      const hitRow = hits.createDiv({ cls: "transmute-hit-row" });
      const hitBox = hitRow.createEl("input", { cls: "transmute-hit-check", type: "checkbox" });
      hitBox.checked = file.selected[index] === true;
      hitBox.disabled = !file.complete;
      hitBox.onchange = (): void => handlers.onToggleHit(file.path, index);
      hitRow.createSpan({ cls: "transmute-hit-line", text: t("view.line", String(hit.line + 1)) });
      hitRow.createDiv({ cls: "transmute-hit-before", text: hit.before });
      hitRow.createDiv({ cls: "transmute-hit-after", text: hit.after });
    });
  }
}

const PHASE_KEY: Record<RunPhase, string> = {
  reading: "view.scanning",
  matching: "view.scanning",
  writing: "view.writing",
  restoring: "view.restoring",
};

export function renderRunState(parent: El, state: RunState, onAbort: () => void): void {
  if (state.status !== "running") return;
  const box = parent.createDiv({ cls: "transmute-run" });
  box.createSpan({
    cls: "transmute-run-line",
    text: t(PHASE_KEY[state.phase], String(state.done), String(state.total)),
  });
  if (!canAbort(state)) return;
  const btn = box.createEl("button", { cls: "transmute-abort", text: t("view.cancel") });
  btn.onclick = (): void => onAbort();
}

export type VaultOutcome = {
  applied: { files: number; hits: number; snapshotDir: string } | null;
  skippedChanged: string[];
  unreadable: string[];
  /** Zu gross, um vollstaendig gemessen zu werden — bewusst nicht geschrieben. */
  incomplete: string[];
};

export function renderVaultOutcome(parent: El, outcome: VaultOutcome, onUndo: () => void): void {
  if (outcome.applied !== null) {
    const box = parent.createDiv({ cls: "transmute-vault-outcome" });
    box.createDiv({
      cls: "transmute-applied",
      text: t("view.appliedVault", String(outcome.applied.hits), String(outcome.applied.files)),
    });
    box.createDiv({ cls: "transmute-snapshot", text: t("view.snapshotAt", outcome.applied.snapshotDir) });
    const undo = box.createEl("button", { cls: "transmute-undo", text: t("view.undo") });
    undo.onclick = (): void => onUndo();
  }

  // Jeder Grund bekommt seine eigene Zeile: „uebersprungen" ohne Grund ist eine Meldung,
  // die den Nutzer ratlos zuruecklaesst.
  const notes: [string[], string, string][] = [
    [outcome.skippedChanged, "transmute-skipped-changed", "view.skippedChanged"],
    [outcome.unreadable, "transmute-skipped-unreadable", "view.skippedUnreadable"],
    [outcome.incomplete, "transmute-skipped-incomplete", "view.skippedIncomplete"],
  ];
  for (const [items, cls, key] of notes) {
    if (items.length === 0) continue;
    parent.createDiv({ cls, text: t(key, String(items.length)) });
  }
}
