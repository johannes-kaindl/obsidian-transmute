/**
 * Diagnose-Lab — der LLM-Pfad von „Warum trifft das nicht?" gegen einen echten Endpunkt,
 * ohne Obsidian und ohne Plugin-Rebuild.
 *
 * Muster: `vim-dojo/scripts/debrief-lab.mjs` (Dach-REGISTRY, „Prompt-Iterations-Lab").
 * AGENTS.md nennt es als den vorgesehenen Weg für Prompt-Arbeit — nicht über
 * Plugin-Rebuilds tunen.
 *
 * Es prüft genau das, was 261 Unit-Tests **nicht** können: ob ein echtes Modell den
 * JSON-Vertrag hält, in der verlangten Sprache antwortet, die Messung der Sonden nicht
 * überschreibt — und ob es die Erlaubnis annimmt, KEINEN Reparaturvorschlag zu machen.
 *
 * Der erste Lauf (2026-07-30) hat einen Befund geliefert, den das Gate nicht sah:
 * qwen3.6-35b erklärte ein nicht treffendes `^` mit dem YAML-Frontmatter am Dateianfang.
 * Plausibel und falsch — `runRule` läuft zeilenweise. Seither nennt der Prompt den
 * Ausführungsmodus.
 *
 *   npm run lab:diagnose
 *   npm run lab:diagnose -- --model google/gemma-4-e2b
 *   npm run lab:diagnose -- --endpoint http://127.0.0.1:11434 --thinking
 *   npm run lab:diagnose -- --note "$VAULT/_transmute-smoke/0.4.0-testtext.md"
 */
import { readFileSync } from "node:fs";
import { RuleClient, type JsonTransport } from "../src/core/llm/client";
import { buildDiagnosePrompt } from "../src/core/llm/prompt";
import { parseDiagnoseResponse } from "../src/core/llm/response";
import { probeRelaxations, type ProbeKind } from "../src/core/regex/relax";
import { setLang, type Lang } from "../src/vendor/kit/i18n";
import type { RuleDraft } from "../src/core/types";
import "../src/core/i18n/strings";

/**
 * Der Testtext gehört ins Skript, nicht in eine Vault-Notiz.
 *
 * Eine Notiz ist kein stiller Ort: Beim ersten Lauf hatte ein Linter die vier Leerzeichen
 * der `loose-space`-Zeile auf eins zusammengezogen — der Test prüfte danach nichts mehr.
 * Über `--note` lässt sich trotzdem gegen eine echte Notiz messen.
 */
const BUILT_IN_TEXT = [
  "Eine Zeile ohne Testwort.",
  "Hier steht KATZE in Grossbuchstaben.",
  "In dieser Zeile steht hund nicht am Anfang.",
  "Hier klebt xmausx ohne Wortgrenze zusammen.",
  "Hier stehen rot    blau mit vier Leerzeichen dazwischen.",
].join("\n");

const rule = (regex: string, flags = ""): RuleDraft => ({
  regex,
  flags,
  replacement: "ERSATZ",
  explanation: "",
});

/** Jeder Fall löst genau eine Sonde aus — die Wörter sind verschieden, damit sich die
 *  Fälle nicht gegenseitig treffen. Fall 5 ist der wichtigste: dort darf das Modell
 *  nichts erfinden. */
const CASES: { name: string; rule: RuleDraft; expect: ProbeKind[] }[] = [
  { name: "1 · Gross/klein", rule: rule("katze"), expect: ["ignore-case"] },
  { name: "2 · Anker", rule: rule("^hund"), expect: ["no-anchors"] },
  { name: "3 · Wortgrenze", rule: rule("\\bmaus\\b"), expect: ["no-boundaries"] },
  { name: "4 · Leerzeichen", rule: rule("rot blau"), expect: ["loose-space"] },
  { name: "5 · nichts dergleichen", rule: rule("giraffe"), expect: [] },
];

const transport: JsonTransport = {
  async postJson(url, body, timeoutMs) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, text: await res.text() };
  },
  async getJson(url, timeoutMs) {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, text: await res.text() };
  },
};

function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

async function main(): Promise<void> {
  const endpoint = flag("endpoint") ?? "http://127.0.0.1:1234";
  const lang = (flag("lang") ?? "de") as Lang;
  const thinking = process.argv.includes("--thinking");
  const note = flag("note");
  const text = note === null ? BUILT_IN_TEXT : readFileSync(note, "utf8");

  // Die Zielsprache steht im Prompt, statt erraten zu werden — hier wird geprüft, ob das
  // beim echten Modell auch ankommt.
  setLang(lang);

  const client = new RuleClient(transport, () => ({
    endpoint,
    model: flag("model") ?? "",
    timeoutMs: 180000,
    suppressReasoning: !thinking,
  }));

  const models = flag("model") !== null ? [flag("model") as string] : await client.listModels(endpoint);
  const chat = models.filter((id) => !id.includes("embed"));
  if (chat.length === 0) {
    console.log(`Kein Modell erreichbar unter ${endpoint} — läuft der Server?`);
    process.exitCode = 1;
    return;
  }

  console.log(`Endpunkt: ${endpoint} · Sprache: ${lang}${thinking ? " · Denken AN" : ""}`);
  console.log(`Text: ${note ?? "eingebaut"}\n`);
  text.split("\n").forEach((line, i) => console.log(`  ${String(i + 1).padStart(2)} | ${line}`));

  for (const model of chat) {
    console.log(`\n${"=".repeat(78)}\nMODELL: ${model}\n${"=".repeat(78)}`);

    for (const testCase of CASES) {
      const findings = probeRelaxations(testCase.rule, text, {
        budgetMs: 1000,
        maxHits: 500,
        now: () => Date.now(),
      });
      const kinds = findings.map((f) => f.kind);
      const ok = kinds.length === testCase.expect.length && testCase.expect.every((k) => kinds.includes(k));
      const seen = findings.map((f) => `${f.kind}@${f.line === null ? "viele" : f.line + 1}`).join(", ");

      console.log(`\n── ${testCase.name}  /${testCase.rule.regex}/`);
      console.log(`   Sonden: ${ok ? "OK" : "ABWEICHUNG"}  erwartet [${testCase.expect.join(", ")}]  bekommen [${seen}]`);

      const started = Date.now();
      const res = await client.complete(buildDiagnosePrompt(testCase.rule, findings, text, ""));
      const secs = ((Date.now() - started) / 1000).toFixed(1);

      if (!res.ok) {
        console.log(`   FEHLER nach ${secs}s · thoughtOnly=${res.thoughtOnly ?? false}`);
        console.log(`   ${res.error.slice(0, 200).replace(/\n/g, " ")}`);
        continue;
      }

      const parsed = parseDiagnoseResponse(res.content);
      const asJson = res.content.includes("diagnosis");
      console.log(`   Antwort nach ${secs}s · ${asJson ? "JSON" : "PROSA (Fallback)"}`);
      console.log(`   ${parsed.text.replace(/\n/g, " ").slice(0, 300)}`);
      console.log(
        `   fix: ${parsed.fix === null ? "null" : `/${parsed.fix.regex}/${parsed.fix.flags} → ${parsed.fix.replacement}`}`,
      );
    }
  }
}

void main();
