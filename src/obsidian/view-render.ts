import { setIcon } from "obsidian";
import type { SessionState } from "../core/session";
import type { ScopeKind } from "../core/settings";
import type { Hit } from "../core/types";
import { t } from "../vendor/kit/i18n";

export type PanelModel = {
  state: SessionState;
  scope: ScopeKind;
  instruction: string;
  refinement: string;
  /** Zweites Feld nur zeigen, wenn in den Einstellungen freigeschaltet. */
  showTarget: boolean;
  target: string;
};

export type PanelHandlers = {
  onScope(scope: ScopeKind): void;
  onInstruction(value: string): void;
  onTarget(value: string): void;
  onRefinement(value: string): void;
  onGenerate(): void;
  onRefine(): void;
  onApply(): void;
  onToggle(index: number): void;
  onSetAll(value: boolean): void;
};

type El = HTMLElement;

function scopeSwitch(parent: El, model: PanelModel, handlers: PanelHandlers): void {
  const row = parent.createDiv({ cls: "transmute-scope" });
  const options: { kind: ScopeKind; key: string }[] = [
    { kind: "file", key: "view.scope.file" },
    { kind: "selection", key: "view.scope.selection" },
  ];
  for (const option of options) {
    const button = row.createEl("button", { text: t(option.key), cls: "transmute-scope-btn" });
    button.toggleClass("is-active", model.scope === option.kind);
    button.addEventListener("click", () => handlers.onScope(option.kind));
  }
}

/** Zeigt eine Zeile mit hervorgehobener Fundstelle. Die Position kommt aus
 *  start - lineStart — nie aus einer indexOf-Suche, die bei mehrfachen gleichen
 *  Treffern in einer Zeile die falsche Stelle markieren wuerde. */
function hitLine(parent: El, hit: Hit): void {
  const localStart = hit.start - hit.lineStart;
  const localEnd = hit.end - hit.lineStart;

  const before = parent.createDiv({ cls: "transmute-before" });
  before.createSpan({ text: hit.before.slice(0, localStart) });
  before.createSpan({ text: hit.matched, cls: "transmute-mark transmute-mark-old" });
  before.createSpan({ text: hit.before.slice(localEnd) });

  const after = parent.createDiv({ cls: "transmute-after" });
  after.createSpan({ text: hit.before.slice(0, localStart) });
  after.createSpan({ text: hit.replacement, cls: "transmute-mark transmute-mark-new" });
  after.createSpan({ text: hit.before.slice(localEnd) });
}

function renderPreview(
  parent: El,
  state: Extract<SessionState, { phase: "preview" }>,
  model: PanelModel,
  handlers: PanelHandlers,
): void {
  const pattern = parent.createDiv({ cls: "transmute-pattern" });
  pattern.createEl("code", { text: `/${state.rule.regex}/${state.rule.flags}` });
  if (state.rule.explanation.length > 0) {
    pattern.createDiv({ text: state.rule.explanation, cls: "transmute-explanation" });
  }

  if (state.timedOutAtLine !== null) {
    parent.createDiv({ text: t("view.timedOut", state.timedOutAtLine + 1), cls: "transmute-warning" });
  }

  if (state.hits.length === 0) {
    parent.createDiv({ text: t("view.noMatches"), cls: "transmute-empty" });
  } else {
    const head = parent.createDiv({ cls: "transmute-hits-head" });
    head.createSpan({ text: t("view.matches", state.hits.length) });
    const none = head.createEl("button", { text: t("view.selectNone"), cls: "transmute-link" });
    none.addEventListener("click", () => handlers.onSetAll(false));
    const all = head.createEl("button", { text: t("view.selectAll"), cls: "transmute-link" });
    all.addEventListener("click", () => handlers.onSetAll(true));

    const list = parent.createDiv({ cls: "transmute-hits" });
    state.hits.forEach((hit, index) => {
      const row = list.createDiv({ cls: "transmute-hit" });
      const box = row.createEl("input", { attr: { type: "checkbox" } });
      if (state.selected[index]) box.setAttribute("checked", "checked");
      box.addEventListener("change", () => handlers.onToggle(index));
      const body = row.createDiv({ cls: "transmute-hit-body" });
      body.createDiv({ text: t("view.line", hit.line + 1), cls: "transmute-lineno" });
      hitLine(body, hit);
    });
  }

  const refineRow = parent.createDiv({ cls: "transmute-refine" });
  const refineInput = refineRow.createEl("textarea", {
    attr: { rows: "2", placeholder: t("view.refinePlaceholder") },
  });
  refineInput.value = model.refinement;
  refineInput.addEventListener("input", () => handlers.onRefinement(refineInput.value));

  const actions = parent.createDiv({ cls: "transmute-actions" });
  const refine = actions.createEl("button", { text: t("view.refine") });
  refine.addEventListener("click", () => handlers.onRefine());

  const apply = actions.createEl("button", { text: t("view.apply"), cls: "mod-cta" });
  const applicable = state.hits.some((_, i) => state.selected[i]);
  if (!applicable) apply.setAttribute("disabled", "true");
  apply.addEventListener("click", () => {
    if (applicable) handlers.onApply();
  });
}

/** Zeichnet das gesamte Panel neu. Pure DOM-Funktion, getrennt vom ItemView-Mount
 *  (Muster: epub-exporter) — dadurch headless mit einem Fake-Element testbar. */
export function renderPanel(root: El, model: PanelModel, handlers: PanelHandlers): void {
  root.empty();
  root.addClass("transmute-panel");

  // Kein eigener Titel: der Reiter traegt ihn bereits (Obsidian-Konvention fuer Panels).
  scopeSwitch(root, model, handlers);

  const input = root.createEl("textarea", {
    attr: { rows: "3", placeholder: t("view.instructionPlaceholder") },
    cls: "transmute-instruction",
  });
  input.value = model.instruction;
  input.addEventListener("input", () => handlers.onInstruction(input.value));

  if (model.showTarget) {
    const targetLabel = root.createDiv({ text: t("view.target"), cls: "transmute-label" });
    targetLabel.setAttribute("id", "transmute-target-label");
    const targetInput = root.createEl("input", {
      attr: { type: "text", placeholder: t("view.targetPlaceholder"), "aria-labelledby": "transmute-target-label" },
      cls: "transmute-target",
    });
    targetInput.value = model.target;
    targetInput.addEventListener("input", () => handlers.onTarget(targetInput.value));
  }

  const generate = root.createEl("button", { text: t("view.generate"), cls: "mod-cta" });
  generate.addEventListener("click", () => handlers.onGenerate());

  const body = root.createDiv({ cls: "transmute-body" });

  switch (model.state.phase) {
    case "idle":
      break;
    case "generating": {
      const busy = body.createDiv({ cls: "transmute-busy" });
      setIcon(busy.createSpan(), "loader");
      busy.createSpan({ text: t("view.working") });
      break;
    }
    case "preview":
      renderPreview(body, model.state, model, handlers);
      break;
    case "error": {
      const error = body.createDiv({ cls: "transmute-error" });
      error.createDiv({ text: t(model.state.messageKey, ...model.state.args) });
      if (model.state.raw !== null) {
        const details = error.createEl("details");
        details.createEl("summary", { text: t("view.rawAnswer") });
        details.createEl("pre", { text: model.state.raw });
      }
      break;
    }
  }
}
