import { setIcon } from "obsidian";
import type { SessionState } from "../core/session";
import type { ScopeKind } from "../core/settings";
import { effectiveFlags } from "../core/regex/compile";
import { modelChoices, thinkToggleView } from "../core/reasoning-toggle";
import { clipContext } from "../core/snippet";
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
  /** Name der Notiz, an der die Runde haengt — null, solange keine gemerkt ist. */
  pinnedName: string | null;
  /** Zuletzt vom Endpunkt geladene Modelle; leer, solange nichts geladen wurde. */
  models: string[];
  model: string;
  suppressReasoning: boolean;
};

export type PanelHandlers = {
  onScope(scope: ScopeKind): void;
  onInstruction(value: string): void;
  onTarget(value: string): void;
  onRefinement(value: string): void;
  onGenerate(): void;
  onRefine(): void;
  onApply(): void;
  onDiscard(): void;
  onSelectVersion(index: number): void;
  onModel(model: string): void;
  onRefreshModels(): void;
  onToggleThinking(): void;
  onToggle(index: number): void;
  onSetAll(value: boolean): void;
};

type El = HTMLElement;

/**
 * Modellwahl und Thinking-Schalter direkt im Panel.
 *
 * Beides steht auch in den Einstellungen — aber wer beim Ausprobieren merkt, dass ein
 * anderes Modell besser passt, will nicht durch zwei Dialoge. (Muster aus
 * image-to-markdown, `refreshModels` / `renderThinkToggle`.)
 */
function modelRow(parent: El, model: PanelModel, handlers: PanelHandlers): void {
  const row = parent.createDiv({ cls: "transmute-model-row" });

  const select = row.createEl("select", { cls: "transmute-model dropdown" });
  select.setAttribute("aria-label", t("set.model"));
  select.createEl("option", { text: t("set.modelAuto"), value: "" });
  for (const id of modelChoices(model.models, model.model)) {
    select.createEl("option", { text: id, value: id });
  }
  select.value = model.model;
  select.addEventListener("change", () => handlers.onModel(select.value));

  const refresh = row.createEl("button", { cls: "transmute-model-refresh clickable-icon" });
  refresh.setAttribute("aria-label", t("set.modelReload"));
  setIcon(refresh, "refresh-cw");
  refresh.addEventListener("click", () => handlers.onRefreshModels());

  // Zustand traegt Text UND Klasse, nicht nur Farbe (WCAG 1.4.1).
  const think = thinkToggleView(model.model, model.suppressReasoning);
  const toggle = row.createEl("button", { cls: "transmute-think" });
  toggle.addClass(...(think.cls === "" ? [] : [think.cls]));
  setIcon(toggle.createSpan(), "brain");
  toggle.createSpan({ text: t(think.labelKey) });
  if (think.disabled) {
    // aria-disabled statt disabled: der Grund bleibt so vorlesbar.
    toggle.setAttribute("aria-disabled", "true");
  } else {
    toggle.addEventListener("click", () => handlers.onToggleThinking());
  }
}

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
  // Gekuerzter Kontext: liegen mehrere Treffer in einer Zeile, stuende die Zeile sonst
  // je Treffer zweimal komplett da — das liest sich wie ein doppelter Treffer.
  const { lead, lag } = clipContext(hit.before, localStart, localEnd);

  const before = parent.createDiv({ cls: "transmute-before" });
  before.createSpan({ text: lead });
  before.createSpan({ text: hit.matched, cls: "transmute-mark transmute-mark-old" });
  before.createSpan({ text: lag });

  const after = parent.createDiv({ cls: "transmute-after" });
  after.createSpan({ text: lead });
  after.createSpan({ text: hit.replacement, cls: "transmute-mark transmute-mark-new" });
  after.createSpan({ text: lag });
}

/**
 * Der Verlauf als klickbare Liste.
 *
 * Nachschaerfen ist Probieren — und Probieren heisst, dass der dritte Versuch schlechter
 * sein kann als der erste. Ohne Verlauf waere der erste dann verloren. Ab zwei Staenden
 * sichtbar; bei einem gaebe es nichts zu waehlen.
 * (Muster aus image-to-markdown, `syncRefineLog` — ohne dessen Streaming-Zweig.)
 */
function versionList(
  parent: El,
  state: Extract<SessionState, { phase: "preview" }>,
  handlers: PanelHandlers,
): void {
  if (state.versions.length < 2) return;

  const list = parent.createDiv({ cls: "transmute-versions" });
  state.versions.forEach((version, index) => {
    const row = list.createEl("button", { cls: "transmute-version" });
    row.toggleClass("is-active", index === state.active);
    row.createSpan({ text: `${index + 1}.`, cls: "transmute-version-no" });
    row.createSpan({ text: version.instruction, cls: "transmute-version-label" });
    row.createSpan({ text: t("view.matches", version.hits.length), cls: "transmute-version-count" });
    row.addEventListener("click", () => handlers.onSelectVersion(index));
  });
}

function renderPreview(
  parent: El,
  state: Extract<SessionState, { phase: "preview" }>,
  model: PanelModel,
  handlers: PanelHandlers,
): void {
  // Sichtbar machen, woran die Runde haengt: gemerkt ohne Anzeige waere nur eine andere
  // Art von Ueberraschung.
  if (model.pinnedName !== null) {
    parent.createDiv({ text: t("view.pinned", model.pinnedName), cls: "transmute-pinned" });
  }

  const version = state.versions[state.active];
  versionList(parent, state, handlers);

  const pattern = parent.createDiv({ cls: "transmute-pattern" });
  // effectiveFlags, nicht rule.flags: angezeigt werden muss, was lief.
  pattern.createEl("code", { text: `/${version.rule.regex}/${effectiveFlags(version.rule.flags)}` });
  const replacement = pattern.createDiv({ cls: "transmute-replacement" });
  replacement.createSpan({ text: t("view.replacement"), cls: "transmute-replacement-label" });
  replacement.createEl("code", { text: version.rule.replacement });
  if (version.rule.explanation.length > 0) {
    pattern.createDiv({ text: version.rule.explanation, cls: "transmute-explanation" });
  }

  if (version.timedOutAtLine !== null) {
    parent.createDiv({ text: t("view.timedOut", version.timedOutAtLine + 1), cls: "transmute-warning" });
  }

  if (version.hits.length === 0) {
    parent.createDiv({ text: t("view.noMatches"), cls: "transmute-empty" });
  } else {
    const head = parent.createDiv({ cls: "transmute-hits-head" });
    head.createSpan({ text: t("view.matches", version.hits.length) });
    const none = head.createEl("button", { text: t("view.selectNone"), cls: "transmute-link" });
    none.addEventListener("click", () => handlers.onSetAll(false));
    const all = head.createEl("button", { text: t("view.selectAll"), cls: "transmute-link" });
    all.addEventListener("click", () => handlers.onSetAll(true));

    const list = parent.createDiv({ cls: "transmute-hits" });
    version.hits.forEach((hit, index) => {
      const row = list.createDiv({ cls: "transmute-hit" });
      const box = row.createEl("input", { attr: { type: "checkbox" } });
      if (version.selected[index]) box.setAttribute("checked", "checked");
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

  const discard = actions.createEl("button", { text: t("view.discard") });
  discard.addEventListener("click", () => handlers.onDiscard());

  const apply = actions.createEl("button", { text: t("view.apply"), cls: "mod-cta" });
  const applicable = version.hits.some((_, i) => version.selected[i]);
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
  modelRow(root, model, handlers);
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
      // Nur der Satz, der etwas erklaert. Ein zusaetzliches "Frage das Modell…" neben
      // dem Kreisel sagt dasselbe wie der Kreisel und steht dem Satz im Weg.
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
