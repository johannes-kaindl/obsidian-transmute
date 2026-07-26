import { ItemView, MarkdownView, Notice, Scope, type WorkspaceLeaf } from "obsidian";
import type { SessionState, TransmuteSession } from "../core/session";
import type { ScopeKind } from "../core/settings";
import { t } from "../vendor/kit/i18n";
import { locateRegion } from "../core/anchor";
import { activeMarkdownView, applyHitsToEditor, readScope, viewForPath } from "./editor-io";
import { renderPanel, type PanelHandlers } from "./view-render";

export const VIEW_TYPE_TRANSMUTE = "transmute-panel";

/** Die Notiz, an der die laufende Runde haengt — samt des Textstands von der Vorschau. */
type Pinned = { path: string; name: string; scope: ScopeKind; text: string; baseOffset: number };

export type TransmuteViewDeps = {
  session(): TransmuteSession;
  defaultScope(): ScopeKind;
  showTargetField(): boolean;
};

export class TransmuteView extends ItemView {
  private scopeKind: ScopeKind;
  private instruction = "";
  private refinement = "";
  private target = "";
  private pinned: Pinned | null = null;

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

    this.deps.session().onChange(() => {
      this.draw();
    });
    this.draw();
    return Promise.resolve();
  }

  /** Kein Leaf-Detach hier (PROF-OBS-13) — Obsidian raeumt die View selbst ab. */
  protected onClose(): Promise<void> {
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
      onDiscard: () => {
        // Die Anweisung bleibt stehen: verworfen wird das Ergebnis, nicht der Gedanke.
        this.refinement = "";
        this.pinned = null;
        this.deps.session().reset();
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
    const state: SessionState = this.deps.session().state;
    if (state.phase !== "preview" || this.pinned === null) return;

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

    const applied = applyHitsToEditor(view.editor, fresh.hits, state.selected, region.offset);
    if (applied === 0) return;

    new Notice(t("view.applied", applied));
    this.pinned = null;
    this.deps.session().reset();
  }

  private draw(): void {
    renderPanel(
      this.contentEl,
      {
        state: this.deps.session().state,
        scope: this.scopeKind,
        instruction: this.instruction,
        refinement: this.refinement,
        showTarget: this.deps.showTargetField(),
        target: this.target,
        pinnedName: this.pinned?.name ?? null,
      },
      this.handlers(),
    );
  }
}
