import { sameMatches } from "./anchor";
import { buildInitialPrompt, buildRefinePrompt, buildRetryPrompt, sampleForPrompt } from "./llm/prompt";
import { parseRuleResponse } from "./llm/response";
import type { CompleteResult } from "./llm/client";
import { compileRule } from "./regex/compile";
import { evaluate, type EvalOptions } from "./regex/evaluate";
import type { ChatMessage, Hit, Round, RuleDraft, RuleProblem, Version } from "./types";

export type SessionState =
  | { phase: "idle" }
  | { phase: "generating" }
  | { phase: "preview"; versions: Version[]; active: number }
  | { phase: "error"; messageKey: string; args: string[]; raw: string | null };

export type Revalidation = { kind: "ok"; hits: Hit[] } | { kind: "changed" };

/**
 * Warum sich der Zustand geaendert hat.
 *
 * Die View waehlt danach zwischen Voll- und Teil-Draw: ein Voll-Draw leert den Container
 * und zieht damit das Eingabefeld unter dem Cursor weg — samt Fokus, Cursorposition und
 * dem Undo-Stack des Feldes.
 */
export type ChangeReason = "edit" | "full";

/** Ein Problem in die Meldung uebersetzen, die der Fehlerzustand anzeigt. */
function problemToError(problem: RuleProblem): { messageKey: string; args: string[] } {
  switch (problem.kind) {
    case "syntax":
      return { messageKey: "error.syntax", args: [problem.message] };
    case "flags":
      return { messageKey: "error.flags", args: [problem.message] };
    case "risky":
      return { messageKey: `risk.${problem.rule}`, args: [] };
    case "too-many":
      return { messageKey: "error.tooMany", args: [String(problem.limit)] };
  }
}

export type SessionDeps = {
  complete(messages: ChatMessage[]): Promise<CompleteResult>;
  now(): number;
};

export type SessionOptions = { sampleChars: number; budgetMs: number; maxHits: number };

type Attempt =
  | { ok: true; draft: RuleDraft }
  | { ok: false; messageKey: string; args: string[]; raw: string | null; problem: string };

/**
 * Zustandsmaschine des Nachschaerf-Workflows. Bewusst obsidian-frei: der riskanteste Teil
 * dieses Plugins ist der Prompt, nicht die UI — er muss in Sekunden testbar sein.
 */
export class TransmuteSession {
  private current: SessionState = { phase: "idle" };
  private readonly listeners: ((state: SessionState, reason: ChangeReason) => void)[] = [];
  private versions: Version[] = [];

  constructor(
    private readonly deps: SessionDeps,
    private readonly options: () => SessionOptions,
  ) {}

  get state(): SessionState {
    return this.current;
  }

  onChange(cb: (state: SessionState, reason: ChangeReason) => void): void {
    this.listeners.push(cb);
  }

  reset(): void {
    this.versions = [];
    this.set({ phase: "idle" });
  }

  /** Der Stand, der gerade gezeigt wird — oder null ausserhalb der Vorschau. */
  get activeVersion(): Version | null {
    return this.current.phase === "preview" ? this.current.versions[this.current.active] : null;
  }

  /**
   * Zu einem frueheren Stand zurueckwechseln.
   *
   * Nichts geht dabei verloren: die spaeteren Staende bleiben stehen. Wer von hier aus
   * nachschaerft, haengt einen neuen Stand hinten an, der auf diesem hier aufbaut.
   */
  selectVersion(index: number): void {
    if (this.current.phase !== "preview") return;
    if (index < 0 || index >= this.current.versions.length || index === this.current.active) return;
    this.set({ ...this.current, active: index });
  }

  toggle(index: number): void {
    this.withSelection((selected) => selected.map((on, i) => (i === index ? !on : on)));
  }

  setAll(value: boolean): void {
    this.withSelection((selected) => selected.map(() => value));
  }

  /** Haekchen gehoeren zum aktiven Stand, nicht zur Sitzung. */
  private withSelection(next: (selected: boolean[]) => boolean[]): void {
    const state = this.current;
    if (state.phase !== "preview") return;
    const versions = state.versions.map((version, i) =>
      i === state.active ? { ...version, selected: next(version.selected) } : version,
    );
    this.set({ ...state, versions });
  }

  /**
   * Treffer gegen den aktuellen Text neu berechnen, statt auf alte Positionen zu
   * vertrauen.
   *
   * Positionen altern schnell: schon ein Linter, der beim Speichern `updated:` ins
   * Frontmatter schreibt, verschiebt alles dahinter. Deshalb wird beim Anwenden die Regel
   * noch einmal ausgefuehrt und nur geprueft, ob **dieselben Ersetzungen** herauskommen
   * wie in der Vorschau. Kommt etwas anderes heraus, wurde am Fundtext selbst gearbeitet
   * — dann lieber gar nichts schreiben.
   */
  revalidate(text: string): Revalidation {
    if (this.current.phase !== "preview") return { kind: "changed" };

    const version = this.current.versions[this.current.active];
    // Dieselbe Freigabe wie in der Vorschau. Ohne das koennte ein quittiertes Muster
    // angezeigt, aber nicht angewendet werden — und die Meldung waere die falsche
    // ("die Notiz hat sich geaendert").
    const allowRisky = version.riskAccepted === version.rule.regex;
    const res = evaluate(version.rule, text, allowRisky, this.evalOptions());
    if (res.kind !== "ok") return { kind: "changed" };
    if (!sameMatches(version.hits, res.hits)) return { kind: "changed" };
    return { kind: "ok", hits: res.hits };
  }

  private evalOptions(): EvalOptions {
    const opts = this.options();
    return { budgetMs: opts.budgetMs, maxHits: opts.maxHits, now: () => this.deps.now() };
  }

  async generate(instruction: string, text: string, target = ""): Promise<void> {
    this.versions = [];
    const sample = sampleForPrompt(text, this.options().sampleChars);
    await this.run(instruction, buildInitialPrompt(instruction, sample, target), text);
  }

  /**
   * Nachschaerfen baut auf dem **aktiven** Stand auf, nicht zwingend auf dem letzten.
   * Wer im Verlauf zurueckgeht und von dort nachschaerft, bekommt genau das: eine
   * Fortsetzung dieses Standes. Die spaeteren bleiben trotzdem stehen.
   */
  async refine(refinement: string, text: string, target = ""): Promise<void> {
    const sample = sampleForPrompt(text, this.options().sampleChars);
    const base = this.current.phase === "preview" ? this.current.versions.slice(0, this.current.active + 1) : [];
    const rounds: Round[] = base.map((version) => ({
      instruction: version.instruction,
      draft: version.rule,
      source: version.source,
    }));
    const hits = this.activeVersion?.hits ?? [];
    await this.run(refinement, buildRefinePrompt(rounds, refinement, hits, sample, target), text);
  }

  /** Ein Retry-Budget pro Runde, geteilt ueber alle Fehlerklassen — kleine Modelle
   *  drehen sonst Schleifen. Der Retry bekommt den konkreten Grund als Text zurueck. */
  private async run(instruction: string, messages: ChatMessage[], text: string): Promise<void> {
    this.set({ phase: "generating" });

    let attempt = await this.ask(messages);
    if (!attempt.ok) {
      const retry = buildRetryPrompt(messages, attempt.raw ?? "", attempt.problem);
      attempt = await this.ask(retry);
    }
    if (!attempt.ok) {
      this.set({ phase: "error", messageKey: attempt.messageKey, args: attempt.args, raw: attempt.raw });
      return;
    }

    const res = evaluate(attempt.draft, text, false, this.evalOptions());
    if (res.kind !== "ok") {
      // Im Modell-Pfad ist ein Problem ein Fehlerzustand: es gibt hier nichts zu tippen,
      // an dem man es reparieren koennte.
      const { messageKey, args } = problemToError(res);
      this.set({ phase: "error", messageKey, args, raw: null });
      return;
    }

    this.versions = [
      ...this.versions,
      {
        instruction,
        rule: attempt.draft,
        hits: res.hits,
        selected: res.hits.map(() => true),
        timedOutAtLine: res.timedOutAtLine,
        source: "model",
        riskAccepted: null,
        problem: null,
        reasoning: null,
      },
    ];
    this.set({ phase: "preview", versions: this.versions, active: this.versions.length - 1 });
  }

  private async ask(messages: ChatMessage[]): Promise<Attempt> {
    const res = await this.deps.complete(messages);
    if (!res.ok) {
      return { ok: false, messageKey: "error.endpoint", args: [res.error], raw: null, problem: res.error };
    }

    const parsed = parseRuleResponse(res.content);
    if (!parsed.ok) {
      const key = parsed.reason === "no-json" ? "error.noJson" : "error.badSchema";
      return { ok: false, messageKey: key, args: [], raw: res.content, problem: parsed.detail };
    }

    const compiled = compileRule(parsed.draft);
    if (!compiled.ok) {
      if (compiled.kind === "risky") {
        return {
          ok: false,
          messageKey: `risk.${compiled.rule}`,
          args: [],
          raw: res.content,
          problem: `the pattern is unsafe (${compiled.rule})`,
        };
      }
      if (compiled.kind === "flags") {
        return {
          ok: false,
          messageKey: "error.flags",
          args: [compiled.message],
          raw: res.content,
          problem: `unknown flag ${compiled.message}`,
        };
      }
      return {
        ok: false,
        messageKey: "error.syntax",
        args: [compiled.message],
        raw: res.content,
        problem: compiled.message,
      };
    }

    return { ok: true, draft: parsed.draft };
  }

  private set(state: SessionState, reason: ChangeReason = "full"): void {
    this.current = state;
    for (const cb of this.listeners) cb(state, reason);
  }
}
