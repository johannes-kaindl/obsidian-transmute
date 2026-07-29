import { ItemView, MarkdownView, Notice, Scope, type WorkspaceLeaf } from "obsidian";
import type { TransmuteSession } from "../core/session";
import type { ScopeKind } from "../core/settings";
import { t } from "../vendor/kit/i18n";
import { locateRegion } from "../core/anchor";
import { activeMarkdownView, applyHitsToEditor, readScope, viewForPath } from "./editor-io";
import { renderOutcome, renderPanel, type PanelHandlers, type PanelModel, type PanelParts } from "./view-render";
import { effectiveFlags } from "../core/regex/compile";
import type { RuleDraft } from "../core/types";

export const VIEW_TYPE_TRANSMUTE = "transmute-panel";

/**
 * Tippause, nach der die Regel neu gerechnet wird.
 *
 * Ohne die Pause liefe die Regel bei jedem Tastendruck — auch ueber jeden halbfertigen
 * Zwischenstand, von denen manche teuer sind.
 */
const EDIT_DELAY_MS = 300;

/** Die Notiz, an der die laufende Runde haengt — samt des Textstands von der Vorschau. */
type Pinned = { path: string; name: string; scope: ScopeKind; text: string; baseOffset: number };

export type TransmuteViewDeps = {
  session(): TransmuteSession;
  defaultScope(): ScopeKind;
  showTargetField(): boolean;
  listModels(): Promise<string[]>;
  getModel(): string;
  setModel(model: string): void;
  getSuppressReasoning(): boolean;
  setSuppressReasoning(value: boolean): void;
};

export class TransmuteView extends ItemView {
  private scopeKind: ScopeKind;
  private instruction = "";
  private refinement = "";
  private target = "";
  private pinned: Pinned | null = null;
  private models: string[] = [];
  /** Container fuer den Teil-Draw, aus dem letzten Voll-Draw. */
  private parts: PanelParts = null;
  private editTimer: number | null = null;
  private reasoningOpen = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: TransmuteViewDeps,
  ) {
    super(leaf);
    this.scopeKind = deps.defaultScope();
  }

  getViewType(): string {
    return VIEW_TYPE_TRANSMUTE;
  }

  getDisplayText(): string {
    return t("view.title");
  }

  getIcon(): string {
    return "replace";
  }

  protected onOpen(): Promise<void> {
    // View-lokaler Scope mit Fallthrough (PROF-OBS-14): ohne das editiert Mod+Z im
    // Eingabefeld das ganze Dokument statt des getippten Textes. View.scope ist
    // standardmaessig null — erst anlegen, dann registrieren.
    this.scope ??= new Scope(this.app.scope);
    this.scope.register(["Mod"], "z", () => false);
    this.scope.register(["Mod", "Shift"], "z", () => false);

    this.deps.session().onChange((_state, reason) => {
      // Ein Voll-Draw leert den Container und zoege damit das Eingabefeld unter dem
      // Cursor weg — samt Fokus, Cursorposition und Undo-Stack des Feldes.
      if (reason === "edit") this.drawOutcome();
      else this.draw();
    });
    this.draw();
    void this.refreshModels();
    return Promise.resolve();
  }

  /** Kein Leaf-Detach hier (PROF-OBS-13) — Obsidian raeumt die View selbst ab.
   *  Der Timer dagegen muss weg, sonst feuert er in ein geleertes Panel. */
  protected onClose(): Promise<void> {
    this.clearEditTimer();
    return Promise.resolve();
  }

  private handlers(): PanelHandlers {
    return {
      onScope: (scope) => {
        this.scopeKind = scope;
        this.draw();
      },
      onInstruction: (value) => {
        this.instruction = value;
      },
      onTarget: (value) => {
        this.target = value;
      },
      onRefinement: (value) => {
        this.refinement = value;
      },
      onGenerate: () => {
        void this.generate();
      },
      onRefine: () => {
        void this.refine();
      },
      onApply: () => {
        this.apply();
      },
      onModel: (model) => {
        this.deps.setModel(model);
        this.draw();
      },
      onRefreshModels: () => {
        void this.refreshModels(true);
      },
      onToggleThinking: () => {
        this.deps.setSuppressReasoning(!this.deps.getSuppressReasoning());
        this.draw();
      },
      onSelectVersion: (index) => {
        this.deps.session().selectVersion(index);
      },
      onDiscard: () => {
        // Die Anweisung bleibt stehen: verworfen wird das Ergebnis, nicht der Gedanke.
        this.clearEditTimer();
        this.refinement = "";
        this.pinned = null;
        this.deps.session().reset();
      },
      onStartManual: () => {
        // Derselbe Weg wie beim Erzeugen — inklusive der Meldungen fuer Lesemodus,
        // fehlende Auswahl und fehlende Notiz. Ein zweiter Pfad wuerde driften.
        const pinned = this.pinScope();
        if (pinned === null) return;
        this.pinned = pinned;
        this.deps.session().startManual();
      },
      onEditRule: (patch) => {
        this.scheduleEdit(patch);
      },
      onAcceptRisk: () => {
        if (this.pinned === null) return;
        this.deps.session().acceptRisk(this.pinned.text);
      },
      onDiagnose: () => {
        // Dieselbe gemerkte Notiz wie fuer jede andere Runde — die Diagnose fragt ueber
        // genau den Text, den die Vorschau zeigt.
        if (this.pinned === null) return;
        void this.deps.session().diagnose(this.pinned.text);
      },
      onApplyFix: () => {
        if (this.pinned === null) return;
        this.deps.session().applyFix(this.pinned.text);
      },
      onCopyRule: () => {
        void this.copyRule();
      },
      onToggleReasoning: () => {
        // Nur merken, nicht zeichnen: das <details> hat sich selbst schon umgeschaltet.
        this.reasoningOpen = !this.reasoningOpen;
      },
      onToggle: (index) => {
        this.deps.session().toggle(index);
      },
      onSetAll: (value) => {
        this.deps.session().setAll(value);
      },
    };
  }

  /**
   * Modell-Liste vom Endpunkt holen.
   *
   * Ein eingestelltes Modell, das der Endpunkt nicht mehr kennt, wird gemeldet statt
   * stillschweigend ersetzt — sonst laeuft die naechste Anfrage gegen ein anderes Modell,
   * als im Panel steht. (Muster aus image-to-markdown, `refreshModels`.)
   */
  private async refreshModels(userTriggered = false): Promise<void> {
    this.models = await this.deps.listModels();
    const current = this.deps.getModel();
    if (current.length > 0 && !this.models.includes(current)) {
      new Notice(t("view.modelGone", current));
    } else if (userTriggered) {
      new Notice(t("view.modelsLoaded", String(this.models.length)));
    }
    this.draw();
  }

  /**
   * Liest den Arbeitsbereich aus der aktiven Notiz und merkt sie sich fuer die Runde.
   * Meldet den Grund, wenn es nicht geht.
   */
  private pinScope(): Pinned | null {
    const view = activeMarkdownView(this.app.workspace);
    if (view === null) {
      new Notice(t("error.noEditor"));
      return null;
    }
    const path = view.file?.path;
    if (path === undefined) {
      new Notice(t("error.noEditor"));
      return null;
    }
    const read = readScope(view, this.scopeKind);
    if (read.kind === "reading-mode") {
      new Notice(t("error.readingMode"));
      return null;
    }
    if (read.kind === "no-selection") {
      new Notice(t("error.noSelection"));
      return null;
    }
    return {
      path,
      name: view.file?.basename ?? path,
      scope: this.scopeKind,
      text: read.text,
      baseOffset: read.baseOffset,
    };
  }

  /**
   * Der Bereich, auf den die Regel angewendet wird, im *aktuellen* Dokument.
   *
   * Bei „Ganze Notiz" ist das schlicht der jetzige Text. Bei „Auswahl" muss der damalige
   * Ausschnitt wiedergefunden werden — er kann sich verschoben haben, ohne sich geaendert
   * zu haben.
   */
  private currentRegion(documentText: string): { text: string; offset: number } | null {
    if (this.pinned === null) return null;
    if (this.pinned.scope === "file") return { text: documentText, offset: 0 };

    const offset = locateRegion(documentText, this.pinned.baseOffset, this.pinned.text);
    return offset === null ? null : { text: this.pinned.text, offset };
  }

  /** Die gemerkte Notiz wiederfinden — welcher Reiter Fokus hat, ist dabei egal. */
  private pinnedView(): MarkdownView | null {
    if (this.pinned === null) return null;
    const view = viewForPath(this.app.workspace, this.pinned.path);
    if (view === null) new Notice(t("error.noteGone", this.pinned.name));
    return view;
  }

  private async generate(): Promise<void> {
    if (this.instruction.trim().length === 0) return;
    const pinned = this.pinScope();
    if (pinned === null) return;
    this.pinned = pinned;
    await this.deps.session().generate(this.instruction, pinned.text, this.target);
  }

  /**
   * Nachschaerfen laeuft gegen den gemerkten Textstand, nicht gegen die aktive Notiz.
   * Sonst muesste man erst den richtigen Reiter suchen, obwohl die Runde laengst an
   * einer bestimmten Notiz haengt.
   */
  private async refine(): Promise<void> {
    if (this.refinement.trim().length === 0 || this.pinned === null) return;
    const refinement = this.refinement;
    this.refinement = "";
    await this.deps.session().refine(refinement, this.pinned.text, this.target);
  }

  private apply(): void {
    const active = this.deps.session().activeVersion;
    if (active === null || this.pinned === null) return;

    const view = this.pinnedView();
    if (view === null) return;

    const region = this.currentRegion(view.editor.getValue());
    if (region === null) {
      new Notice(t("error.noteChanged"));
      return;
    }

    // Nicht auf die alten Positionen vertrauen, sondern die Regel gegen den jetzigen Text
    // neu ausfuehren. Geschrieben wird nur, wenn dabei dieselben Ersetzungen herauskommen
    // wie in der Vorschau.
    const fresh = this.deps.session().revalidate(region.text);
    if (fresh.kind === "changed") {
      new Notice(t("error.noteChanged"));
      return;
    }

    const applied = applyHitsToEditor(view.editor, fresh.hits, active.selected, region.offset);
    if (applied === 0) return;

    new Notice(t("view.applied", applied));
    this.pinned = null;
    this.deps.session().reset();
  }

  /**
   * Die Regel erst nach einer Tippause neu rechnen.
   *
   * window, nicht activeWindow: die prefer-window-timers-Regel des Stores zielt auf
   * DOM-Timer, dieser hat keinen DOM-Bezug.
   */
  private scheduleEdit(patch: Partial<RuleDraft>): void {
    this.clearEditTimer();
    this.editTimer = window.setTimeout(() => {
      this.editTimer = null;
      if (this.pinned === null) return;
      this.deps.session().editRule(patch, this.pinned.text);
    }, EDIT_DELAY_MS);
  }

  private clearEditTimer(): void {
    if (this.editTimer !== null) {
      window.clearTimeout(this.editTimer);
      this.editTimer = null;
    }
  }

  private async copyRule(): Promise<void> {
    const active = this.deps.session().activeVersion;
    if (active === null) return;
    // effectiveFlags, nicht rule.flags: kopiert wird, was wirklich laeuft.
    const text = `/${active.rule.regex}/${effectiveFlags(active.rule.flags)}`;
    try {
      await navigator.clipboard.writeText(text);
      new Notice(t("view.copied"));
    } catch (err) {
      new Notice(t("view.copyFailed", err instanceof Error ? err.message : String(err)));
    }
  }

  private panelModel(): PanelModel {
    return {
      state: this.deps.session().state,
      scope: this.scopeKind,
      instruction: this.instruction,
      refinement: this.refinement,
      showTarget: this.deps.showTargetField(),
      target: this.target,
      pinnedName: this.pinned?.name ?? null,
      models: this.models,
      model: this.deps.getModel(),
      suppressReasoning: this.deps.getSuppressReasoning(),
      reasoningOpen: this.reasoningOpen,
    };
  }

  private draw(): void {
    this.parts = renderPanel(this.contentEl, this.panelModel(), this.handlers());
  }

  /** Teil-Draw: Verlauf und Ergebnis neu, die Regel-Felder bleiben stehen. */
  private drawOutcome(): void {
    renderOutcome(this.parts, this.panelModel(), this.handlers());
  }
}
