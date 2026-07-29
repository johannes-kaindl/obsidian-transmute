import { sameMatches } from "./anchor";
import {
  buildDiagnosePrompt,
  buildInitialPrompt,
  buildRefinePrompt,
  buildRetryPrompt,
  sampleForPrompt,
} from "./llm/prompt";
import { parseDiagnoseResponse, parseRuleResponse } from "./llm/response";
import type { CompleteResult } from "./llm/client";
import { compileRule } from "./regex/compile";
import { evaluate, type EvalOptions } from "./regex/evaluate";
import { probeRisky } from "./regex/probe";
import { probeRelaxations } from "./regex/relax";
import type { ChatMessage, Diagnosis, Hit, Round, RuleDraft, RuleProblem, Version } from "./types";

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

/** Zeit, die der Kanarienvogel auf 20 Zeichen hoechstens brauchen darf. Ein harmloses
 *  Muster liegt dort weit darunter; ein entgleisendes ueberschreitet es sofort. */
const PROBE_BUDGET_MS = 4;

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
    case "too-slow":
      return {
        messageKey: "error.tooSlow",
        args: [String(problem.sampleChars), String(problem.ms), String(problem.longestLine)],
      };
  }
}

export type SessionDeps = {
  complete(messages: ChatMessage[]): Promise<CompleteResult>;
  now(): number;
};

export type SessionOptions = { sampleChars: number; budgetMs: number; maxHits: number };

type Attempt =
  | { ok: true; draft: RuleDraft; reasoning: string | null }
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

  /**
   * Die Vorschau ohne Modell oeffnen.
   *
   * Kein eigener Zustand und kein Modus: es entsteht schlicht ein leerer Stand, in den
   * getippt werden kann. Ausgefuehrt wird nichts — ein leeres Muster ist gueltig und
   * traefe den Leerstring an jeder Position.
   */
  startManual(): void {
    this.versions = [
      {
        instruction: "",
        rule: { regex: "", flags: "", replacement: "", explanation: "" },
        hits: [],
        selected: [],
        timedOutAtLine: null,
        source: "manual",
        riskAccepted: null,
        problem: null,
        reasoning: null,
        diagnosis: null,
      },
    ];
    this.set({ phase: "preview", versions: this.versions, active: 0 });
  }

  /**
   * Die Regel des aktiven Standes von Hand aendern.
   *
   * Ein Handstand wird an Ort und Stelle geaendert; eine Modellregel bekommt EINEN neuen
   * Stand angehaengt. So bleibt der Modellstand zurueckwaehlbar — dafuer gibt es den
   * Verlauf — ohne dass die Liste beim Tippen zuwaechst.
   */
  editRule(patch: Partial<RuleDraft>, text: string): void {
    const state = this.current;
    if (state.phase !== "preview") return;

    const active = state.versions[state.active];
    // Die Erklaerung stammt vom Modell und beschreibt DESSEN Regel; die Diagnose erklaert
    // das Muster, das sie untersucht hat. Nach einem Eingriff von Hand beschreiben beide
    // etwas anderes als das, was laeuft — also fallen sie weg. Der Stand im Verlauf
    // behaelt seine.
    const rule = { ...active.rule, ...patch, explanation: "" };
    const next = this.evaluateInto({ ...active, rule, diagnosis: null }, text);

    if (active.source === "manual") {
      this.versions = state.versions.map((version, i) => (i === state.active ? next : version));
      this.set({ ...state, versions: this.versions }, "edit");
      return;
    }

    // Die Beschriftung im Verlauf kommt aus source, nicht aus instruction — deshalb
    // bleibt die Anweisung leer, statt einen erfundenen Text zu tragen.
    this.versions = [...state.versions, { ...next, instruction: "", source: "manual", reasoning: null, diagnosis: null }];
    this.set({ phase: "preview", versions: this.versions, active: this.versions.length - 1 }, "edit");
  }

  /**
   * Die Risiko-Warnung fuer genau das Muster des aktiven Standes quittieren.
   *
   * Vor der echten Ausfuehrung laeuft ein Kanarienvogel: dasselbe Muster auf einem kurzen
   * Ausschnitt, mit Zeitmessung. Obsidian erlaubt keine Web-Worker, ein laufender Match
   * ist also nicht abbrechbar — die Freigabe waere sonst ein Knopf, der das Fenster
   * einfrieren kann (real eingetreten, GUI-Durchlauf 2026-07-27).
   */
  acceptRisk(text: string): void {
    const state = this.current;
    if (state.phase !== "preview") return;

    const active = state.versions[state.active];

    const probe = probeRisky(active.rule, text, { now: () => this.deps.now(), budgetMs: PROBE_BUDGET_MS });
    if (!probe.ok) {
      // Die Quittung wird NICHT gesetzt: sonst liefe das Muster beim naechsten
      // Tastendruck ungebremst.
      const problem: RuleProblem = {
        kind: "too-slow",
        ms: probe.ms,
        sampleChars: probe.sampleChars,
        longestLine: probe.longestLine,
      };
      const stopped = state.versions.map((version, i) =>
        i === state.active ? { ...version, riskAccepted: null, hits: [], selected: [], problem } : version,
      );
      this.versions = stopped;
      this.set({ ...state, versions: stopped }, "edit");
      return;
    }

    const next = this.evaluateInto({ ...active, riskAccepted: active.rule.regex }, text);
    this.versions = state.versions.map((version, i) => (i === state.active ? next : version));
    this.set({ ...state, versions: this.versions }, "edit");
  }

  /**
   * Einen Stand gegen den Text neu rechnen.
   *
   * Die Risiko-Quittung ueberlebt nur, solange das Muster dasselbe bleibt: eine Freigabe
   * fuer (a+)+b sagt nichts ueber (a+)+bc.
   */
  private evaluateInto(version: Version, text: string): Version {
    const riskAccepted = version.riskAccepted === version.rule.regex ? version.riskAccepted : null;

    if (version.rule.regex.length === 0) {
      return { ...version, riskAccepted, hits: [], selected: [], timedOutAtLine: null, problem: null };
    }

    const res = evaluate(version.rule, text, riskAccepted !== null, this.evalOptions());
    if (res.kind !== "ok") {
      return { ...version, riskAccepted, hits: [], selected: [], timedOutAtLine: null, problem: res };
    }
    return {
      ...version,
      riskAccepted,
      hits: res.hits,
      selected: res.hits.map(() => true),
      timedOutAtLine: res.timedOutAtLine,
      problem: null,
    };
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
        reasoning: attempt.reasoning,
        diagnosis: null,
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

    return { ok: true, draft: parsed.draft, reasoning: res.reasoning };
  }

  /**
   * Warum trifft das nicht?
   *
   * Erst messen, dann fragen: Die Lockerungs-Sonden laufen gegen den ganzen Text, das
   * Modell sieht nur eine Probe. Ohne die Messung koennte es behaupten, im Text stehe
   * nichts dergleichen, waehrend in Zeile 400 etwas steht — eine falsche Auskunft mit
   * Autoritaet, und damit die teuerste Fehlerklasse fuer dieses Plugin.
   *
   * Kein `phase: "generating"`: Der Ladezustand ersetzt das ganze Panel und naehme den
   * Stand mit, um den es geht.
   */
  async diagnose(text: string): Promise<void> {
    const state = this.current;
    if (state.phase !== "preview") return;

    const index = state.active;
    const version = state.versions[index];
    // Genau der Fall, fuer den der Knopf da ist — sonst gibt es nichts zu erklaeren.
    if (version.rule.regex.length === 0 || version.problem !== null || version.hits.length > 0) return;

    const regex = version.rule.regex;
    this.setDiagnosis(index, { kind: "running" });

    const findings = probeRelaxations(version.rule, text, this.evalOptions());
    const sample = sampleForPrompt(text, this.options().sampleChars);
    const res = await this.deps.complete(buildDiagnosePrompt(version.rule, findings, sample, version.instruction));

    if (!res.ok) {
      const failed: Diagnosis =
        res.thoughtOnly === true
          ? { kind: "failed", messageKey: "error.thoughtOnly", args: [] }
          : { kind: "failed", messageKey: "error.endpoint", args: [res.error] };
      this.settleDiagnosis(index, regex, failed);
      return;
    }

    // Prosa ist hier kein Fehlschlag, sondern die Antwort — deshalb auch kein Retry.
    const parsed = parseDiagnoseResponse(res.content);
    if (parsed.text.length === 0) {
      this.settleDiagnosis(index, regex, { kind: "failed", messageKey: "error.emptyDiagnosis", args: [] });
      return;
    }
    this.settleDiagnosis(index, regex, { kind: "done", findings, text: parsed.text, fix: parsed.fix });
  }

  /**
   * Ein eingetroffenes Ergebnis nur dann ablegen, wenn der Zielstand noch dasselbe Muster
   * traegt — dieselbe Semantik wie bei der Risiko-Quittung.
   *
   * Der Index allein genuegt nicht (nach einer Handbearbeitung zeigt er auf ein anderes
   * Muster), das Muster allein auch nicht (zwei Staende koennen dasselbe tragen).
   */
  private settleDiagnosis(index: number, regex: string, diagnosis: Diagnosis): void {
    const state = this.current;
    if (state.phase !== "preview") return;
    const target = state.versions[index] as Version | undefined;
    if (target === undefined || target.rule.regex !== regex) return;
    this.setDiagnosis(index, diagnosis);
  }

  /** Teil-Draw ("edit"): Die Diagnose liegt im Ergebnis-Container, die Regel-Felder
   *  duerfen dabei nicht neu gezeichnet werden. */
  private setDiagnosis(index: number, diagnosis: Diagnosis): void {
    const state = this.current;
    if (state.phase !== "preview") return;
    this.versions = state.versions.map((version, i) => (i === index ? { ...version, diagnosis } : version));
    this.set({ ...state, versions: this.versions }, "edit");
  }

  private set(state: SessionState, reason: ChangeReason = "full"): void {
    this.current = state;
    for (const cb of this.listeners) cb(state, reason);
  }
}
