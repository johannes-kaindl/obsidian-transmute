import type { RuleDraft } from "../types";

export type ParseResult =
  | { ok: true; draft: RuleDraft }
  | { ok: false; reason: "no-json" | "bad-schema"; detail: string };

/** Muster nach vault-crews/src/core/chat-response.ts */
export function extractChatContent(res: unknown): string | null {
  if (typeof res !== "object" || res === null) return null;
  const choices = (res as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

function stripThink(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*?<\/think>/, "");
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
