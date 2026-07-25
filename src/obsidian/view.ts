import { ItemView, MarkdownView, Notice, Scope, type WorkspaceLeaf } from "obsidian";
import type { SessionState, TransmuteSession } from "../core/session";
import type { ScopeKind } from "../core/settings";
import { t } from "../vendor/kit/i18n";
import { activeMarkdownView, applyHitsToEditor, readScope, type ScopeRead } from "./editor-io";
import { renderPanel, type PanelHandlers } from "./view-render";

export const VIEW_TYPE_TRANSMUTE = "transmute-panel";

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
      onToggle: (index) => {
        this.deps.session().toggle(index);
      },
      onSetAll: (value) => {
        this.deps.session().setAll(value);
      },
    };
  }

  /** Liest den Arbeitsbereich und meldet den Grund, wenn es nicht geht. */
  private currentScope(): { view: MarkdownView; read: Extract<ScopeRead, { kind: "ok" }> } | null {
    const view = activeMarkdownView(this.app.workspace);
    if (view === null) {
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
    return { view, read };
  }

  private async generate(): Promise<void> {
    if (this.instruction.trim().length === 0) return;
    const scope = this.currentScope();
    if (scope === null) return;
    await this.deps.session().generate(this.instruction, scope.read.text, this.target);
  }

  private async refine(): Promise<void> {
    if (this.refinement.trim().length === 0) return;
    const scope = this.currentScope();
    if (scope === null) return;
    const refinement = this.refinement;
    this.refinement = "";
    await this.deps.session().refine(refinement, scope.read.text, this.target);
  }

  private apply(): void {
    const state: SessionState = this.deps.session().state;
    if (state.phase !== "preview") return;

    const scope = this.currentScope();
    if (scope === null) return;

    const applied = applyHitsToEditor(
      scope.view.editor,
      state.hits,
      state.selected,
      scope.read.baseOffset,
    );
    if (applied === 0) return;

    new Notice(t("view.applied", applied));
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
      },
      this.handlers(),
    );
  }
}
