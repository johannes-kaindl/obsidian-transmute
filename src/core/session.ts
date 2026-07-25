import { buildInitialPrompt, buildRefinePrompt, buildRetryPrompt, sampleForPrompt } from "./llm/prompt";
import { parseRuleResponse } from "./llm/response";
import type { CompleteResult } from "./llm/client";
import { compileRule, isMultilinePattern } from "./regex/compile";
import { runRule } from "./regex/execute";
import type { ChatMessage, Hit, Round, RuleDraft } from "./types";

export type SessionState =
  | { phase: "idle" }
  | { phase: "generating" }
  | { phase: "preview"; rule: RuleDraft; hits: Hit[]; selected: boolean[]; timedOutAtLine: number | null }
  | { phase: "error"; messageKey: string; args: string[]; raw: string | null };

export type SessionDeps = {
  complete(messages: ChatMessage[]): Promise<CompleteResult>;
  now(): number;
};

export type SessionOptions = { sampleChars: number; budgetMs: number };

type Attempt =
  | { ok: true; draft: RuleDraft }
  | { ok: false; messageKey: string; args: string[]; raw: string | null; problem: string };

/**
 * Zustandsmaschine des Nachschaerf-Workflows. Bewusst obsidian-frei: der riskanteste Teil
 * dieses Plugins ist der Prompt, nicht die UI — er muss in Sekunden testbar sein.
 */
export class TransmuteSession {
  private current: SessionState = { phase: "idle" };
  private readonly listeners: ((state: SessionState) => void)[] = [];
  private rounds: Round[] = [];

  constructor(
    private readonly deps: SessionDeps,
    private readonly options: () => SessionOptions,
  ) {}

  get state(): SessionState {
    return this.current;
  }

  onChange(cb: (state: SessionState) => void): void {
    this.listeners.push(cb);
  }

  reset(): void {
    this.rounds = [];
    this.set({ phase: "idle" });
  }

  toggle(index: number): void {
    if (this.current.phase !== "preview") return;
    const selected = [...this.current.selected];
    selected[index] = !selected[index];
    this.set({ ...this.current, selected });
  }

  setAll(value: boolean): void {
    if (this.current.phase !== "preview") return;
    this.set({ ...this.current, selected: this.current.selected.map(() => value) });
  }

  async generate(instruction: string, text: string): Promise<void> {
    this.rounds = [];
    const sample = sampleForPrompt(text, this.options().sampleChars);
    await this.run(instruction, buildInitialPrompt(instruction, sample), text);
  }

  async refine(refinement: string, text: string): Promise<void> {
    const sample = sampleForPrompt(text, this.options().sampleChars);
    const hits = this.current.phase === "preview" ? this.current.hits : [];
    await this.run(refinement, buildRefinePrompt(this.rounds, refinement, hits, sample), text);
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
      this.rounds.push({ instruction, draft: null });
      this.set({ phase: "error", messageKey: attempt.messageKey, args: attempt.args, raw: attempt.raw });
      return;
    }

    this.rounds.push({ instruction, draft: attempt.draft });

    const compiled = compileRule(attempt.draft);
    if (!compiled.ok) {
      // Unerreichbar: ask() hat bereits kompiliert. Defensive Absicherung gegen kuenftige Umbauten.
      this.set({ phase: "error", messageKey: "error.syntax", args: [""], raw: null });
      return;
    }

    const result = runRule(text, compiled.re, attempt.draft.replacement, isMultilinePattern(attempt.draft), {
      budgetMs: this.options().budgetMs,
      now: () => this.deps.now(),
    });

    this.set({
      phase: "preview",
      rule: attempt.draft,
      hits: result.hits,
      selected: result.hits.map(() => true),
      timedOutAtLine: result.timedOutAtLine,
    });
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

  private set(state: SessionState): void {
    this.current = state;
    for (const cb of this.listeners) cb(state);
  }
}
