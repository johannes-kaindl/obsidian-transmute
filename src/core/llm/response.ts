import { stripThinkBlocks } from "../../vendor/kit/think-splitter";
import type { RuleDraft } from "../types";

export type ParseResult =
  | { ok: true; draft: RuleDraft }
  | { ok: false; reason: "no-json" | "bad-schema"; detail: string };

function stripThink(raw: string): string {
  return stripThinkBlocks(raw, { dropStrayClose: true });
}

function stripFence(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  return fenced ? fenced[1] : raw;
}

/** Erstes balanciertes JSON-Objekt; String-Literale werden dabei uebersprungen. */
function firstJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

export function parseRuleResponse(raw: string): ParseResult {
  const candidate = firstJsonObject(stripFence(stripThink(raw)));
  if (candidate === null) return { ok: false, reason: "no-json", detail: raw.slice(0, 400) };

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    return { ok: false, reason: "no-json", detail: err instanceof Error ? err.message : String(err) };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "bad-schema", detail: candidate.slice(0, 400) };
  }

  const obj = parsed as Record<string, unknown>;
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
  const clean = stripThink(raw).trim();
  const candidate = firstJsonObject(stripFence(clean));
  if (candidate !== null) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed !== null) {
        const obj = parsed as Record<string, unknown>;
        const text = typeof obj.diagnosis === "string" ? obj.diagnosis.trim() : "";
        if (text.length > 0) return { text, fix: readFix(obj.fix) };
      }
    } catch {
      // Kaputtes JSON ist hier kein Grund zu scheitern — der Rohtext bleibt brauchbar.
    }
  }
  return { text: clean, fix: null };
}
