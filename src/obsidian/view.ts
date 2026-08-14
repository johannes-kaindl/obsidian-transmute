import { ItemView, MarkdownView, Notice, Scope, type WorkspaceLeaf } from "obsidian";
import type { TransmuteSession } from "../core/session";
import type { ScopeKind } from "../core/settings";
import { t } from "../vendor/kit/i18n";
import { locateRegion } from "../core/anchor";
import { activeMarkdownView, applyHitsToEditor, readScope, viewForPath } from "./editor-io";
import { renderOutcome, renderPanel, type PanelHandlers, type PanelModel, type PanelParts } from "./view-render";
import { effectiveFlags } from "../core/regex/compile";
import type { RuleDraft } from "../core/types";
import type { EvalOptions } from "../core/regex/evaluate";
import { EMPTY_FILTER } from "../core/vault/scope";
import { runOverFiles } from "../core/vault/run";
import {
  RUN_IDLE, runAborted, runFinished, runPhaseChanged, runProgressed, runStarted,
} from "../core/vault/state";
import { countSelected, setAllFiles, toggleFile, toggleHit } from "../core/vault/selection";
import { buildSample, chooseSampleSource } from "../core/vault/sample";
import { allTags, listCandidates, makeReader, writeSelected } from "./vault-io";
import { finalizeSnapshot, restoreSnapshot, rotateSnapshots, writeSnapshot } from "./snapshot-io";
import { ConfirmModal } from "./confirm-modal";
import type { VaultPanel } from "./view-render";

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
  /** Dieselben Werte, die auch die Sitzung bekommt (main.ts). */
  runOptions(): { sampleChars: number; budgetMs: number; maxHits: number };
  confirmThreshold(): number;
  snapshotKeep(): number;
};

const EMPTY_VAULT_OUTCOME = {
  applied: null,
  skippedChanged: [] as string[],
  unreadable: [] as string[],
  incomplete: [] as string[],
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

  /** Alles, was der vault-weite Lauf zum Zeichnen braucht. */
  private vault: VaultPanel = {
    filter: EMPTY_FILTER,
    candidates: 0,
    total: 0,
    folders: [],
    tags: [],
    files: [],
    expanded: new Set<string>(),
    totalHits: 0,
    run: RUN_IDLE,
    outcome: { ...EMPTY_VAULT_OUTCOME },
  };
  /** Die Kandidaten zum aktuellen Filter — Grundlage fuer Lauf und Stichprobe. */
  private vaultPaths: string[] = [];
  /** Der Beispieltext fuer das Modell. Wird beim Filterwechsel vorbereitet, damit
   *  `pinScope()` synchron bleiben kann. */
  private vaultSample: { text: string; label: string } | null = null;
  private abortCtrl: AbortController | null = null;
  private lastSnapshot: string | null = null;

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
        if (scope === "vault") void this.refreshCandidates();
        else this.draw();
      },
      onFilter: (patch) => {
        this.vault.filter = { ...this.vault.filter, ...patch };
        void this.refreshCandidates();
      },
      onComputePreview: () => {
        void this.computeVaultPreview();
      },
      onToggleFile: (path) => {
        this.vault.files = toggleFile(this.vault.files, path);
        this.drawOutcome();
      },
      onToggleHit: (path, index) => {
        this.vault.files = toggleHit(this.vault.files, path, index);
        this.drawOutcome();
      },
      onExpand: (path) => {
        if (this.vault.expanded.has(path)) this.vault.expanded.delete(path);
        else this.vault.expanded.add(path);
        this.drawOutcome();
      },
      onAbort: () => {
        this.abortCtrl?.abort();
      },
      onUndo: () => {
        void this.undoVault();
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
        this.vault.files = [];
        this.vault.totalHits = 0;
        this.vault.expanded.clear();
        this.vault.run = RUN_IDLE;
        this.vault.outcome = { ...EMPTY_VAULT_OUTCOME };
        this.lastSnapshot = null;
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
        if (this.scopeKind === "vault") {
          this.vault.files = setAllFiles(this.vault.files, value);
          this.drawOutcome();
          return;
        }
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
    // Der vault-weite Lauf braucht keine offene Notiz — der Umfang steht in den
    // Filterfeldern. Nur der BEISPIELTEXT fuer das Modell muss irgendwo herkommen.
    if (this.scopeKind === "vault") {
      if (this.vaultSample === null) {
        new Notice(t("view.noCandidates"));
        return null;
      }
      return {
        path: "",
        name: this.vaultSample.label,
        scope: "vault",
        text: this.vaultSample.text,
        baseOffset: 0,
      };
    }

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
    if (this.pinned.scope !== "selection") return { text: documentText, offset: 0 };

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
    if (this.scopeKind === "vault") {
      void this.applyVault();
      return;
    }
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

  // ---------------------------------------------------------------------------
  // Vault-Scope

  private evalOptions(): EvalOptions {
    const opts = this.deps.runOptions();
    return { budgetMs: opts.budgetMs, now: () => Date.now(), maxHits: opts.maxHits };
  }

  private folderChoices(): string[] {
    const out = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cut = file.path.lastIndexOf("/");
      if (cut > 0) out.add(file.path.slice(0, cut));
    }
    return [...out].sort();
  }

  private tagChoices(): string[] {
    return allTags(this.app);
  }

  /** Kandidaten, Vervollstaendigungen und Beispieltext zum aktuellen Filter. */
  private async refreshCandidates(): Promise<void> {
    this.vaultPaths = listCandidates(this.app, this.vault.filter);
    this.vault.candidates = this.vaultPaths.length;
    this.vault.total = this.app.vault.getMarkdownFiles().length;
    this.vault.folders = this.folderChoices();
    this.vault.tags = this.tagChoices();
    this.vaultSample = await this.buildVaultSample();
    this.draw();
  }

  /**
   * Der Beispieltext fuer den Prompt.
   *
   * Die offene Notiz gewinnt — aber nur, wenn der Filter sie einschliesst. Sonst baut das
   * Modell die Regel an einem Text, der gar nicht im Umfang liegt.
   */
  private async buildVaultSample(): Promise<{ text: string; label: string } | null> {
    const activePath = activeMarkdownView(this.app.workspace)?.file?.path ?? null;
    const source = chooseSampleSource(activePath, this.vaultPaths);
    if (source.kind === "none") return null;

    const read = makeReader(this.app);
    const paths = source.kind === "active" ? [source.path] : source.paths;
    const parts: { path: string; text: string }[] = [];
    for (const path of paths) {
      const text = await read(path);
      if (text !== null) parts.push({ path, text });
    }
    if (parts.length === 0) return null;

    const label = source.kind === "active"
      ? t("view.sampleFrom", parts[0].path)
      : t("view.sampleFromMany", String(parts.length));
    return { text: buildSample(parts, this.deps.runOptions().sampleChars), label };
  }

  private setRun(next: typeof this.vault.run): void {
    this.vault.run = next;
    this.drawOutcome();
  }

  /**
   * Die Vorschau ueber den ganzen Umfang.
   *
   * Bewusst an einem Knopf und nicht am Tipp-Timer: ein paar hundert Notizen zu lesen ist
   * nichts, was zwischen zwei Tastendruecken passieren sollte.
   */
  private async computeVaultPreview(): Promise<void> {
    const active = this.deps.session().activeVersion;
    if (active === null) return;

    const ctrl = new AbortController();
    this.abortCtrl = ctrl;
    this.vault.expanded.clear();
    this.vault.outcome = { ...EMPTY_VAULT_OUTCOME };
    this.setRun(runStarted(this.vaultPaths.length));

    const run = await runOverFiles(
      this.vaultPaths,
      active.rule,
      active.riskAccepted === active.rule.regex,
      makeReader(this.app),
      this.evalOptions(),
      {
        signal: ctrl.signal,
        onProgress: (done, _total, path) => this.setRun(runProgressed(this.vault.run, done, path)),
        // Echter Makrotask: ohne ihn wird der Klick auf „Abbrechen" nie zugestellt.
        // window, nicht activeWindow — wie beim Tipp-Timer: kein DOM-Bezug.
        yieldToUi: () => new Promise((resolve) => { window.setTimeout(resolve, 0); }),
      },
    );
    this.abortCtrl = null;

    this.vault.files = run.files;
    this.vault.totalHits = run.totalHits;
    this.vault.outcome = {
      applied: null,
      skippedChanged: [],
      unreadable: run.unreadable,
      incomplete: run.files.filter((f) => !f.complete).map((f) => f.path),
    };
    this.setRun(run.aborted
      ? runAborted(this.vault.run)
      : runFinished(this.vault.run, run.files.length, run.totalHits));
  }

  private async applyVault(): Promise<void> {
    const counted = countSelected(this.vault.files);
    if (counted.files === 0) return;
    if (counted.files >= this.deps.confirmThreshold()) {
      new ConfirmModal(this.app, counted.files, counted.hits, () => { void this.writeVault(); }).open();
      return;
    }
    await this.writeVault();
  }

  /**
   * Erst sichern, dann aendern.
   *
   * Scheitert der Snapshot, wird NICHTS geschrieben — ein Snapshot, der parallel zum
   * Schreiben entsteht, schuetzt genau die Dateien nicht, bei denen es schiefging.
   */
  private async writeVault(): Promise<void> {
    const active = this.deps.session().activeVersion;
    if (active === null) return;
    const touched = this.vault.files.filter((f) => f.selected.some((s) => s)).map((f) => f.path);

    let dir: string;
    try {
      dir = await writeSnapshot(
        this.app, new Date().toISOString(), active.rule, touched, makeReader(this.app),
      );
    } catch (err) {
      new Notice(t("error.snapshotFailed", err instanceof Error ? err.message : String(err)));
      return;
    }

    this.setRun(runPhaseChanged(runStarted(touched.length), "writing"));
    const out = await writeSelected(
      this.app, this.vault.files, active.rule,
      active.riskAccepted === active.rule.regex, this.evalOptions(),
      (done, _total, path) => this.setRun(runProgressed(this.vault.run, done, path)),
    );
    await finalizeSnapshot(this.app, dir, out.entries);
    await rotateSnapshots(this.app, this.deps.snapshotKeep());

    this.lastSnapshot = dir;
    this.vault.outcome = {
      applied: { files: out.written, hits: out.hits, snapshotDir: dir },
      skippedChanged: out.skippedChanged,
      unreadable: this.vault.outcome.unreadable,
      incomplete: this.vault.outcome.incomplete,
    };
    if (out.failedAt !== null) {
      new Notice(t(
        "error.writeFailed",
        String(out.written), String(touched.length), out.failedAt.message,
      ));
    }
    this.setRun(runFinished(this.vault.run, out.written, out.hits));
  }

  private async undoVault(): Promise<void> {
    if (this.lastSnapshot === null) return;
    this.setRun(runPhaseChanged(runStarted(1), "restoring"));
    const got = await restoreSnapshot(this.app, this.lastSnapshot, false);
    this.setRun(runFinished(this.vault.run, got.restored, 0));

    new Notice(t("view.undone", String(got.restored)));
    if (got.changed.length > 0) {
      new Notice(t("error.restoreChanged", String(got.changed.length)));
    }
    this.vault.outcome = { ...EMPTY_VAULT_OUTCOME };
    this.lastSnapshot = null;
    this.draw();
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
      vault: this.scopeKind === "vault" ? this.vault : undefined,
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
