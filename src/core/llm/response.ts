import { firstJsonObject } from "../../vendor/kit/llm-json";
import { stripThinkBlocks } from "../../vendor/kit/think-splitter";
import type { RuleDraft } from "../types";

export type ParseResult =
  | { ok: true; draft: RuleDraft }
  | { ok: false; reason: "no-json" | "bad-schema"; detail: string };

/** Das Kit (`llm-json`) liest das JSON: erste umzaeunte Stelle (`fence: "first"`, wie bisher), Fliesstext mit
 *  Klammern davor wird uebersprungen, ein offenes `<think>` verwirft den Rest (Standard des Kits). */
const JSON_OPTS = { fence: "first" } as const;

export function parseRuleResponse(raw: string): ParseResult {
  const obj = firstJsonObject(raw, JSON_OPTS);
  if (obj === null) return { ok: false, reason: "no-json", detail: raw.slice(0, 400) };
  if (typeof obj.regex !== "string" || obj.regex.length === 0) {
    return { ok: false, reason: "bad-schema", detail: "regex fehlt" };
  }
  return {
    ok: true,
    draft: {
      regex: obj.regex,
      flags: typeof obj.flags === "string" ? obj.flags : "",
      replacement: typeof obj.replacement === "string" ? obj.replacement : "",
      explanation: typeof obj.explanation === "string" ? obj.explanation : "",
    },
  };
}

export type DiagnoseResult = { text: string; fix: RuleDraft | null };

function readFix(value: unknown): RuleDraft | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.regex !== "string" || obj.regex.length === 0) return null;
  return {
    regex: obj.regex,
    flags: typeof obj.flags === "string" ? obj.flags : "",
    replacement: typeof obj.replacement === "string" ? obj.replacement : "",
    // Die Erklaerung zur Reparatur IST die Diagnose — ein zweites Feld waere die
    // gleiche Aussage an zwei Orten, die auseinanderlaufen koennen.
    explanation: "",
  };
}

/**
 * Die Antwort auf die Diagnose-Frage auswerten.
 *
 * Anders als beim Regel-Pfad ist fehlendes JSON hier **kein** Fehlschlag: Antwortet das
 * Modell in Prosa, ist die Prosa genau das, wonach gefragt war. Deshalb auch kein Retry —
 * ein Netz-Aufruf pro Klick.
 */
export function parseDiagnoseResponse(raw: string): DiagnoseResult {
  // Fuer die Prosa-Rueckfallebene dieselbe Strenge wie das Kit beim JSON: ein offenes <think> verwirft den Rest.
  const clean = stripThinkBlocks(raw, { dropStrayClose: true, dropUnclosed: true }).trim();
  const obj = firstJsonObject(raw, JSON_OPTS);
  if (obj !== null) {
    const text = typeof obj.diagnosis === "string" ? obj.diagnosis.trim() : "";
    if (text.length > 0) return { text, fix: readFix(obj.fix) };
  }
  return { text: clean, fix: null };
}
