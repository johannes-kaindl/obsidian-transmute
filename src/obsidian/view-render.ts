import { setIcon } from "obsidian";
import type { SessionState } from "../core/session";
import type { ScopeKind } from "../core/settings";
import { effectiveFlags } from "../core/regex/compile";
import { CHEATSHEET } from "../core/cheatsheet";
import { modelChoices, thinkToggleView } from "../core/reasoning-toggle";
import { clipContext } from "../core/snippet";
import type { Hit, RuleDraft, RuleProblem, Version } from "../core/types";
import { t } from "../vendor/kit/i18n";
import type { VaultFilter } from "../core/vault/scope";
import {
  renderRunState, renderScopeBlock, renderVaultList, renderVaultOutcome,
  type VaultListModel, type VaultOutcome, type VaultScopeModel,
} from "./vault-render";
import type { RunState } from "../core/vault/state";

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
  /** Gehoert ins Modell, nicht ins DOM: der Ergebnis-Container wird bei jedem
   *  Live-Update neu gezeichnet und wuerde ein offenes <details> sonst zuklappen. */
  reasoningOpen: boolean;
  /** Nur bei scope === "vault" gesetzt. */
  vault?: VaultPanel;
};

/** Alles, was der vault-weite Lauf zum Zeichnen braucht. */
export type VaultPanel = VaultScopeModel & VaultListModel & {
  run: RunState;
  outcome: VaultOutcome;
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
  onStartManual(): void;
  onEditRule(patch: Partial<RuleDraft>): void;
  onAcceptRisk(): void;
  onCopyRule(): void;
  onToggleReasoning(): void;
  onDiagnose(): void;
  onApplyFix(): void;
  onFilter(patch: Partial<VaultFilter>): void;
  onComputePreview(): void;
  onToggleFile(path: string): void;
  onToggleHit(path: string, index: number): void;
  onExpand(path: string): void;
  onAbort(): void;
  onUndo(): void;
};

type El = HTMLElement;

/** Die Container, die ein Teil-Draw neu zeichnen darf. Null ausserhalb der Vorschau. */
export type PanelParts = { history: El; outcome: El } | null;

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
    { kind: "vault", key: "view.scope.vault" },
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

  // Ohne Ueberschrift liest sich die Liste wie Teil des Ergebnisses statt wie ein Verlauf,
  // durch den man zurueckgehen kann.
  parent.createDiv({ text: t("view.history"), cls: "transmute-history-label" });

  const list = parent.createDiv({ cls: "transmute-versions" });
  state.versions.forEach((version, index) => {
    const row = list.createEl("button", { cls: "transmute-version" });
    row.toggleClass("is-active", index === state.active);
    row.createSpan({ text: `${index + 1}.`, cls: "transmute-version-no" });
    // Ein Handstand hat keine Anweisung — seine Beschriftung kommt aus der Herkunft.
    row.createSpan({
      text: version.source === "manual" ? t("view.edited") : version.instruction,
      cls: "transmute-version-label",
    });
    row.createSpan({ text: t("view.matches", version.hits.length), cls: "transmute-version-count" });
    row.addEventListener("click", () => handlers.onSelectVersion(index));
  });
}

/** Das Flag, das compileRule erzwingt — es wird gezeigt, aber nicht angeboten. */
const FORCED_FLAG = "g";

/** Flags, die als Schalter angeboten werden. `g` fehlt bewusst: ein Schalter, der nichts
 *  schaltet, waere eine Luege. */
const TOGGLE_FLAGS = ["i", "m", "s", "u"];

function flagButton(row: El, flag: string, flags: string, handlers: PanelHandlers): void {
  const active = flags.includes(flag);
  // Der Buchstabe ist Regex-Syntax, kein UI-Text — deshalb als <code> statt als
  // Button-Beschriftung (und damit ausserhalb der sentence-case-Regel des Stores).
  const button = row.createEl("button", { cls: `transmute-flag transmute-flag-${flag}` });
  button.createEl("code", { text: flag });
  button.setAttribute("aria-pressed", active ? "true" : "false");
  button.toggleClass("is-active", active);
  button.addEventListener("click", () => {
    handlers.onEditRule({ flags: active ? flags.replace(flag, "") : `${flags}${flag}` });
  });
}

function renderCheatsheet(parent: El): void {
  // Bewusst im Regel-Container: der wird beim Teil-Draw nicht neu gezeichnet, also bleibt
  // der Spickzettel offen, waehrend man tippt — genau dann braucht man ihn.
  const sheet = parent.createEl("details", { cls: "transmute-cheatsheet" });
  // Nur ein Dreieck davor war zu leise, um als Angebot gelesen zu werden
  // (GUI-Befund 2026-07-27). Icon + Akzentfarbe machen daraus eine sichtbare Tuer.
  const summary = sheet.createEl("summary");
  setIcon(summary.createSpan({ cls: "transmute-cheat-icon" }), "book-open");
  summary.createSpan({ text: t("cheat.title") });
  for (const group of CHEATSHEET) {
    sheet.createDiv({ text: t(group.titleKey), cls: "transmute-cheat-group" });
    for (const row of group.rows) {
      const line = sheet.createDiv({ cls: "transmute-cheat-row" });
      line.createEl("code", { text: row.syntax });
      line.createSpan({ text: t(row.descKey) });
    }
  }
}

/**
 * Muster, Ersetzung und Flags als Formular.
 *
 * Wird nur beim Voll-Draw gezeichnet — siehe renderOutcome.
 */
function renderRule(parent: El, version: Version, handlers: PanelHandlers): void {
  const regexRow = parent.createDiv({ cls: "transmute-regex-row" });
  const regex = regexRow.createEl("input", {
    attr: {
      type: "text",
      spellcheck: "false",
      placeholder: t("view.regexPlaceholder"),
      "aria-label": t("view.pattern"),
    },
    cls: "transmute-regex",
  });
  regex.value = version.rule.regex;
  regex.addEventListener("input", () => handlers.onEditRule({ regex: regex.value }));

  const copy = regexRow.createEl("button", { cls: "transmute-copy clickable-icon" });
  copy.setAttribute("aria-label", t("view.copyRule"));
  setIcon(copy, "copy");
  copy.addEventListener("click", () => handlers.onCopyRule());

  const replacement = parent.createEl("input", {
    attr: {
      type: "text",
      spellcheck: "false",
      placeholder: t("view.replacementPlaceholder"),
      "aria-label": t("view.replacement"),
    },
    cls: "transmute-replacement-input",
  });
  replacement.value = version.rule.replacement;
  replacement.addEventListener("input", () => handlers.onEditRule({ replacement: replacement.value }));

  const flagRow = parent.createDiv({ cls: "transmute-flags" });
  const forced = flagRow.createEl("button", { cls: "transmute-flag transmute-flag-g is-active" });
  forced.createEl("code", { text: FORCED_FLAG });
  // aria-disabled statt disabled: der Grund bleibt so vorlesbar (Muster aus dem
  // Thinking-Schalter).
  forced.setAttribute("aria-disabled", "true");
  forced.setAttribute("aria-pressed", "true");
  forced.setAttribute("aria-label", t("view.flagAlways"));
  for (const flag of TOGGLE_FLAGS) flagButton(flagRow, flag, version.rule.flags, handlers);

  renderCheatsheet(parent);
}

/** Die Meldung zu einem Problem — dieselbe Zuordnung wie im Fehlerzustand der Session. */
function problemText(problem: RuleProblem): string {
  switch (problem.kind) {
    case "syntax":
      return t("error.syntax", problem.message);
    case "flags":
      return t("error.flags", problem.message);
    case "risky":
      return t(`risk.${problem.rule}`);
    case "too-many":
      return t("error.tooMany", String(problem.limit));
    case "too-slow":
      return t("error.tooSlow", String(problem.sampleChars), String(problem.ms), String(problem.longestLine));
  }
}

function renderProblem(parent: El, version: Version, handlers: PanelHandlers): void {
  if (version.problem === null) return;

  const box = parent.createDiv({ cls: "transmute-problem" });
  box.createDiv({ text: problemText(version.problem) });

  // Nur das Risiko ist ein Abwaegen. Syntax, Flags und zu viele Treffer sind es nicht:
  // dort gaebe es nichts freizugeben, sondern nur etwas zu reparieren.
  if (version.problem.kind !== "risky") return;

  const accept = box.createEl("button", { text: t("view.runAnyway"), cls: "transmute-accept-risk" });
  accept.addEventListener("click", () => handlers.onAcceptRisk());
}

function renderReasoning(parent: El, version: Version, model: PanelModel, handlers: PanelHandlers): void {
  if (version.reasoning === null) return;

  const details = parent.createEl("details", { cls: "transmute-reasoning" });
  // Der offene Zustand kommt aus dem Modell: dieser Container wird bei jedem Tastendruck
  // neu gezeichnet und wuerde ein offenes <details> sonst zuklappen.
  details.open = model.reasoningOpen;
  details.createEl("summary", { text: t("view.reasoning") });
  details.createEl("pre", { text: version.reasoning });
  details.addEventListener("toggle", () => handlers.onToggleReasoning());
}

/**
 * Was WIRKLICH laeuft, in kopierbarer Schreibweise.
 *
 * Gehoert in den Ergebnis-Container, nicht zu den Feldern: sie muss sich bei jedem
 * Tastendruck mitbewegen. Lag sie beim Formular, zeigte sie das Muster der vorigen Runde,
 * waehrend laengst ein anderes lief (GUI-Befund 2026-07-27) — genau die Fehlerklasse,
 * gegen die dieses Plugin gebaut ist.
 *
 * effectiveFlags, nicht rule.flags: ein angezeigtes /x/i, das als /x/gi lief, waere fuer
 * jemanden, der daraus lernen will, schlicht falsch.
 */
function renderEffective(parent: El, version: Version): void {
  if (version.rule.regex.length === 0) return;
  parent.createEl("code", {
    text: `/${version.rule.regex}/${effectiveFlags(version.rule.flags)}`,
    cls: "transmute-effective",
  });
}

function renderExplanation(parent: El, version: Version): void {
  if (version.rule.explanation.length > 0) {
    parent.createDiv({ text: version.rule.explanation, cls: "transmute-explanation" });
  }
  if (version.timedOutAtLine !== null) {
    parent.createDiv({ text: t("view.timedOut", version.timedOutAtLine + 1), cls: "transmute-warning" });
  }
}

function renderHits(parent: El, version: Version, handlers: PanelHandlers): void {
  // Bei einem Problem steht der Grund schon oben — eine Trefferliste daneben waere die
  // zweite, widersprechende Aussage.
  if (version.problem !== null) return;

  if (version.hits.length === 0) {
    // Ein leeres Muster hat noch nichts gesucht; "findet nichts" waere eine Aussage
    // ueber eine Suche, die gar nicht stattgefunden hat.
    if (version.rule.regex.length > 0) {
      parent.createDiv({ text: t("view.noMatches"), cls: "transmute-empty" });
    }
    return;
  }

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

function renderRefineRow(parent: El, model: PanelModel, handlers: PanelHandlers): void {
  const refineRow = parent.createDiv({ cls: "transmute-refine" });
  const refineInput = refineRow.createEl("textarea", {
    attr: { rows: "2", placeholder: t("view.refinePlaceholder") },
  });
  refineInput.value = model.refinement;
  refineInput.addEventListener("input", () => handlers.onRefinement(refineInput.value));
}

function renderActions(parent: El, version: Version, handlers: PanelHandlers): void {
  const actions = parent.createDiv({ cls: "transmute-actions" });
  const refine = actions.createEl("button", { text: t("view.refine") });
  refine.addEventListener("click", () => handlers.onRefine());

  const discard = actions.createEl("button", { text: t("view.discard") });
  discard.addEventListener("click", () => handlers.onDiscard());

  const apply = actions.createEl("button", { text: t("view.apply"), cls: "mod-cta" });
  // Ein Problem sperrt das Anwenden ausdruecklich — auch wenn ohnehin nichts ausgewaehlt
  // waere. Der Knopf soll den Grund zeigen, nicht ihn verschweigen.
  const applicable = version.problem === null && version.hits.some((_, i) => version.selected[i]);
  if (!applicable) apply.setAttribute("disabled", "true");
  apply.addEventListener("click", () => {
    if (applicable) handlers.onApply();
  });
}

/**
 * Der Diagnose-Block unter der Null-Treffer-Meldung.
 *
 * Das Gemessene steht VOR der Modell-Prosa: Ein Befund aus dem ganzen Text traegt weiter
 * als ein Satz, der auf einer Textprobe fusst.
 */
function renderDiagnosis(parent: El, version: Version, handlers: PanelHandlers): void {
  // Genau die Lage, in der die Frage sinnvoll ist. Ein leeres Muster hat noch nichts
  // gesucht; bei einem Problem steht der Grund schon da.
  if (version.problem !== null || version.rule.regex.length === 0 || version.hits.length > 0) return;

  const box = parent.createDiv({ cls: "transmute-diagnosis" });
  const diagnosis = version.diagnosis;

  if (diagnosis === null) {
    const ask = box.createEl("button", { text: t("view.whyNoMatch"), cls: "transmute-link transmute-why" });
    ask.addEventListener("click", () => handlers.onDiagnose());
    return;
  }
  if (diagnosis.kind === "running") {
    box.createDiv({ text: t("view.diagnosing"), cls: "transmute-empty" });
    return;
  }
  if (diagnosis.kind === "failed") {
    box.createDiv({ text: t(diagnosis.messageKey, ...diagnosis.args), cls: "transmute-warning" });
    return;
  }

  for (const finding of diagnosis.findings) {
    const row = box.createDiv({ cls: "transmute-finding" });
    row.createSpan({ text: t(`probe.${finding.kind}`) });
    if (finding.line !== null) row.createSpan({ text: ` · ${t("view.line", finding.line + 1)}` });
  }
  box.createDiv({ text: diagnosis.text, cls: "transmute-explanation" });

  if (diagnosis.fix === null) {
    box.createDiv({ text: t("view.noFix"), cls: "transmute-empty" });
    return;
  }
  const use = box.createEl("button", { text: t("view.applyFix"), cls: "transmute-apply-fix" });
  use.addEventListener("click", () => handlers.onApplyFix());
}

/**
 * Verlauf und Ergebnis neu zeichnen, ohne die Regel-Felder anzufassen.
 *
 * Das ist der Weg fuer die Live-Vorschau: alles ueber und unter dem Formular darf sich
 * bei jedem Tastendruck aendern, das Formular selbst nicht — sonst verliert das Feld
 * unter dem Cursor Fokus, Cursorposition und seinen Undo-Stack.
 */
export function renderOutcome(parts: PanelParts, model: PanelModel, handlers: PanelHandlers): void {
  if (parts === null || model.state.phase !== "preview") return;
  const state = model.state;
  const version = state.versions[state.active];

  parts.history.empty();
  versionList(parts.history, state, handlers);

  parts.outcome.empty();
  renderEffective(parts.outcome, version);
  renderProblem(parts.outcome, version, handlers);
  renderExplanation(parts.outcome, version);
  renderReasoning(parts.outcome, version, model, handlers);
  if (model.scope === "vault" && model.vault !== undefined) {
    renderRunState(parts.outcome, model.vault.run, () => handlers.onAbort());
    renderVaultList(parts.outcome, model.vault, {
      onToggleFile: (path) => handlers.onToggleFile(path),
      onToggleHit: (path, index) => handlers.onToggleHit(path, index),
      onExpand: (path) => handlers.onExpand(path),
      onSetAll: (value) => handlers.onSetAll(value),
    });
    renderVaultOutcome(parts.outcome, model.vault.outcome, () => handlers.onUndo());
  } else {
    renderHits(parts.outcome, version, handlers);
  }
  renderDiagnosis(parts.outcome, version, handlers);
  renderRefineRow(parts.outcome, model, handlers);
  renderActions(parts.outcome, version, handlers);
}

function renderPreview(
  parent: El,
  state: Extract<SessionState, { phase: "preview" }>,
  model: PanelModel,
  handlers: PanelHandlers,
): PanelParts {
  // Sichtbar machen, woran die Runde haengt: gemerkt ohne Anzeige waere nur eine andere
  // Art von Ueberraschung.
  if (model.pinnedName !== null) {
    parent.createDiv({ text: t("view.pinned", model.pinnedName), cls: "transmute-pinned" });
  }

  const history = parent.createDiv({ cls: "transmute-history" });
  const rule = parent.createDiv({ cls: "transmute-rule" });
  const outcome = parent.createDiv({ cls: "transmute-outcome" });

  // Die Regel-Felder entstehen genau einmal je Voll-Draw.
  renderRule(rule, state.versions[state.active], handlers);

  const parts: PanelParts = { history, outcome };
  renderOutcome(parts, model, handlers);
  return parts;
}

/** Zeichnet das gesamte Panel neu. Pure DOM-Funktion, getrennt vom ItemView-Mount
 *  (Muster: epub-exporter) — dadurch headless mit einem Fake-Element testbar. */
export function renderPanel(root: El, model: PanelModel, handlers: PanelHandlers): PanelParts {
  root.empty();
  root.addClass("transmute-panel");

  // Kein eigener Titel: der Reiter traegt ihn bereits (Obsidian-Konvention fuer Panels).
  modelRow(root, model, handlers);
  scopeSwitch(root, model, handlers);

  // Der Umfang wird gewaehlt, BEVOR eine Regel existiert — der Block gehoert deshalb in
  // den Panel-Rumpf und nicht in den Regel-Container, den es im Ruhezustand nicht gibt.
  if (model.scope === "vault" && model.vault !== undefined) {
    renderScopeBlock(root, model.vault, {
      onFilter: (patch) => handlers.onFilter(patch),
      onComputePreview: () => handlers.onComputePreview(),
    });
  }

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

  // Kein Tab und kein Modus: der Link oeffnet dieselbe Vorschau, nur mit leerem Muster.
  const manual = root.createEl("button", { text: t("view.startManual"), cls: "transmute-manual-link transmute-link" });
  manual.addEventListener("click", () => handlers.onStartManual());

  const body = root.createDiv({ cls: "transmute-body" });

  switch (model.state.phase) {
    case "idle":
      return null;
    case "generating": {
      const busy = body.createDiv({ cls: "transmute-busy" });
      setIcon(busy.createSpan(), "loader");
      // Nur der Satz, der etwas erklaert. Ein zusaetzliches "Frage das Modell…" neben
      // dem Kreisel sagt dasselbe wie der Kreisel und steht dem Satz im Weg.
      busy.createSpan({ text: t("view.working") });
      return null;
    }
    case "preview":
      return renderPreview(body, model.state, model, handlers);
    case "error": {
      const error = body.createDiv({ cls: "transmute-error" });
      error.createDiv({ text: t(model.state.messageKey, ...model.state.args) });
      if (model.state.raw !== null) {
        const details = error.createEl("details");
        details.createEl("summary", { text: t("view.rawAnswer") });
        details.createEl("pre", { text: model.state.raw });
      }
      return null;
    }
  }
}
