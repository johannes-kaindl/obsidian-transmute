import { getLang, type Lang } from "../../vendor/kit/i18n";
import type { ProbeFinding, ProbeKind } from "../regex/relax";
import type { ChatMessage, Hit, Round, RuleDraft } from "../types";

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

/**
 * Die gemessenen Befunde in Saetze, die das Modell lesen kann.
 *
 * Bewusst englisch und bewusst als Tatsachenbehauptung: Das ist kein UI-Text, sondern
 * Beweismaterial. Die Uebersetzung fuer die Anzeige liegt in den i18n-Strings.
 */
const FINDING_TEXT: Record<ProbeKind, string> = {
  "ignore-case": "the same pattern matches when upper- and lowercase are ignored",
  "no-anchors": "the same pattern matches once the ^ / $ anchors are removed",
  "no-boundaries": "the same pattern matches once the \\b word boundaries are removed",
  "loose-space": "the same pattern matches when a literal space may be several whitespace characters",
};

function findingLines(findings: ProbeFinding[]): string[] {
  if (findings.length === 0) {
    return [
      "I ran the pattern again with each of these conditions relaxed, one at a time,",
      "against the WHOLE text: ignore case, drop anchors, drop word boundaries,",
      "allow flexible whitespace. None of these relaxations produced a match either.",
    ];
  }
  return [
    "I measured this against the WHOLE text (not just the sample below):",
    ...findings.map((finding) => {
      const where = finding.line === null ? "many times" : `in line ${finding.line + 1}`;
      return `- ${FINDING_TEXT[finding.kind]} — ${where}.`;
    }),
  ];
}

const DIAGNOSE_RULES = [
  "Answer with a single JSON object and nothing else. No code fence.",
  "Fields:",
  '  "diagnosis" — one to three short sentences saying why the pattern finds nothing.',
  '  "fix"       — a corrected rule as {"regex": "…", "flags": "…", "replacement": "…"},',
  "                or null.",
  "",
  "Rules:",
  '- Use null for "fix" when the text simply contains nothing of the kind. Do NOT invent',
  "  a pattern in that case — saying so plainly is the more useful answer.",
  "- The measurements above are facts. Do not contradict them.",
  "- Be concrete: name the character or condition that fails, not the concept.",
  "- Never use nested quantifiers such as (a+)+ — they can hang the editor.",
];

/**
 * Warum ein Muster nichts trifft — mit dem Gemessenen als Grundlage.
 *
 * Das Modell sieht den Text nur als Probe. Die Sonden-Befunde stammen dagegen vom ganzen
 * Text; sie stehen deshalb VOR der Probe im Prompt und sind ausdruecklich als Tatsachen
 * ausgewiesen. Ohne sie koennte das Modell behaupten, im Text stehe nichts dergleichen,
 * waehrend in Zeile 400 etwas steht.
 */
export function buildDiagnosePrompt(
  rule: RuleDraft,
  findings: ProbeFinding[],
  sample: string,
  instruction: string,
  lang: Lang = getLang(),
): ChatMessage[] {
  const system = [
    "You explain why a JavaScript regular expression found no matches in a text,",
    "and suggest a correction when one is warranted.",
    "",
    `Answer in ${languageName(lang)}.`,
    "",
    ...DIAGNOSE_RULES,
  ].join("\n");

  const intent = instruction.trim().length === 0 ? [] : [`The user asked for: ${instruction.trim()}`, ""];

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        `Pattern: /${rule.regex}/${rule.flags}`,
        `Replacement: ${rule.replacement}`,
        "It found nothing.",
        "",
        ...intent,
        ...findingLines(findings),
        "",
        "Sample of the text:",
        "---",
        sample,
        "---",
      ].join("\n"),
    },
  ];
}
