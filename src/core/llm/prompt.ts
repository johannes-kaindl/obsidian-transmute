import { getLang, type Lang } from "../../vendor/kit/i18n";
import type { ChatMessage, Hit, Round } from "../types";

/** Sprachname, wie ein Modell ihn versteht — ein ISO-Code ist dafuer zu leise. */
export function languageName(lang: Lang): string {
  return lang === "de" ? "German" : "English";
}

/**
 * Die Zielsprache wird genannt, nicht erraten.
 *
 * „In the user's language" laesst das Modell aus der Anweisung schliessen — bei kurzen
 * oder gemischtsprachigen Eingaben raet es dann falsch, und die Erklaerung kommt englisch
 * in einer deutschen Oberflaeche an (beobachtet 2026-07-27). Die Sprache der Oberflaeche
 * ist bekannt; sie zu verschweigen ist eine Informationsluecke, kein Feature.
 */
function systemPrompt(lang: Lang): string {
  return [
    "You turn a plain-language editing instruction into a JavaScript regular expression.",
    "",
    "Answer with a single JSON object and nothing else. No prose, no code fence.",
    "Fields:",
    '  "regex"       — the pattern, WITHOUT delimiters, escaped for JSON.',
    '  "flags"       — any of gimsuy. Use "i" for case-insensitive. "g" is added automatically.',
    '  "replacement" — the replacement string. Use $1, $2 for capture groups, $& for the whole match.',
    '  "explanation" — ONE short sentence describing what the pattern matches.',
    "",
    "Rules:",
    `- Write the explanation in ${languageName(lang)}. Answer in ${languageName(lang)}.`,
    "- Prefer a pattern that works line by line. Only use multi-line constructs when asked for.",
    "- Never use nested quantifiers such as (a+)+ — they can hang the editor.",
    "- Match exactly what was asked for and nothing more. When in doubt, match less.",
  ].join("\n");
}

export function sampleForPrompt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…`;
}

export function sampleHits(hits: Hit[], max: number, maxChars: number): string[] {
  return hits.slice(0, max).map((h) => {
    const before = h.before.length > maxChars ? `${h.before.slice(0, maxChars)}…` : h.before;
    const after = h.after.length > maxChars ? `${h.after.slice(0, maxChars)}…` : h.after;
    return `- ${before}  →  ${after}`;
  });
}

/** Optionales Ziel-Muster aus dem zweiten Eingabefeld (Setting showTargetField).
 *  Leer = weglassen, nicht als leere Zeile mitschicken. */
function targetLine(target: string): string[] {
  return target.trim().length === 0 ? [] : [`The replacement should produce: ${target.trim()}`, ""];
}

export function buildInitialPrompt(
  instruction: string,
  sample: string,
  target = "",
  lang: Lang = getLang(),
): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt(lang) },
    {
      role: "user",
      content: [
        `Instruction: ${instruction}`,
        "",
        ...targetLine(target),
        "Here is a sample of the text it will run on:",
        "---",
        sample,
        "---",
      ].join("\n"),
    },
  ];
}

export function buildRefinePrompt(
  rounds: Round[],
  refinement: string,
  hits: Hit[],
  sample: string,
  target = "",
  lang: Lang = getLang(),
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt(lang) }];
  for (const round of rounds) {
    if (round.source === "manual") {
      // Eine Handrunde hat keine Anweisung — sie IST das Ergebnis. Ein leerer
      // "Instruction:"-Zug wuerde das Modell zum Erfinden einladen.
      messages.push({ role: "user", content: `I edited the rule by hand to: ${JSON.stringify(round.draft)}` });
      continue;
    }
    messages.push({ role: "user", content: `Instruction: ${round.instruction}` });
    if (round.draft !== null) {
      messages.push({ role: "assistant", content: JSON.stringify(round.draft) });
    }
  }
  const samples = sampleHits(hits, 3, 120);
  messages.push({
    role: "user",
    content: [
      samples.length > 0 ? "Your pattern matched these lines:" : "Your pattern matched nothing.",
      ...samples,
      "",
      `Now refine it: ${refinement}`,
      "",
      ...targetLine(target),
      "Sample of the text:",
      "---",
      sample,
      "---",
    ].join("\n"),
  });
  return messages;
}

export function buildRetryPrompt(previous: ChatMessage[], badAnswer: string, problem: string): ChatMessage[] {
  return [
    ...previous,
    { role: "assistant", content: badAnswer },
    { role: "user", content: `That did not work: ${problem}. Answer again with a single valid JSON object and nothing else.` },
  ];
}
