/**
 * Erzeugt einen Wegwerf-Vault fuer den GUI-Durchlauf des vault-weiten Scopes.
 *
 * Bewusst KEIN echter Vault: dieses Feature schreibt in viele Dateien gleichzeitig, und
 * der erste Durchlauf gehoert an einen Ort, an dem ein Fehler nichts kostet.
 *
 *   npm run lab:vault -- --out ./test-vault --notes 400
 *
 * Danach in Obsidian als Vault oeffnen und das Plugin hineinkopieren:
 *   OBSIDIAN_PLUGIN_DIR=<out>/.obsidian/plugins/transmute npm run deploy
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const argOf = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  const value = i >= 0 ? args[i + 1] : undefined;
  return value ?? fallback;
};

const out = argOf("out", "./test-vault");
const count = Number(argOf("notes", "400"));

const ORDNER = ["10_Notizen", "10_Notizen/tief", "20_Projekte", "90_Archiv"];
const TAGS = ["#projekt", "#projekt/aktiv", "#archiv", ""];
const STATUS = ["aktiv", "ruht", ""];

// Nur die Notiz-Ordner neu aufbauen. `.obsidian` bleibt stehen: dort haengen die
// Plugin-Installation und die Community-Plugin-Freigabe, und die jedes Mal neu zu
// erteilen macht aus einem Werkzeug eine Handarbeit.
for (const dir of ORDNER) {
  rmSync(join(out, dir), { recursive: true, force: true });
  mkdirSync(join(out, dir), { recursive: true });
}
mkdirSync(join(out, ".obsidian", "plugins"), { recursive: true });

for (let i = 0; i < count; i++) {
  const dir = ORDNER[i % ORDNER.length];
  const tag = TAGS[i % TAGS.length];
  const status = STATUS[i % STATUS.length];
  const front = [
    "---",
    status === "" ? null : `status: ${status}`,
    tag === "" ? null : `tags: [${tag.slice(1)}]`,
    "---",
  ].filter((x) => x !== null).join("\n");

  const body = [
    `# Notiz ${i}`,
    "",
    "Hier steht die alte Schreibweise, und zwar mehrfach: alte Schreibweise.",
    "Ein Datum im deutschen Format: 14.08.2026.",
    "Ein Codeblock, der NICHT angefasst werden soll:",
    "```",
    "const alt = 'alte Schreibweise';",
    "```",
    // Jede fuenfzigste Notiz ist absichtlich gross: sie soll das Zeitbudget reissen
    // und dadurch als unvollstaendig gemessen und abgewaehlt erscheinen.
    i % 50 === 0 ? `Sehr lange Zeile: ${"wort ".repeat(4000)}` : "",
  ].join("\n");

  writeFileSync(join(out, dir, `Notiz ${i}.md`), `${front}\n\n${body}\n`, "utf8");
}

// Zwei Sonderfaelle, die im GUI-Durchlauf regelmaessig etwas finden.
writeFileSync(
  join(out, "10_Notizen", "Sonderzeichen & Klammern (v2).md"),
  "---\nstatus: aktiv\n---\n\nalte Schreibweise mit Sonderzeichen im Dateinamen.\n",
  "utf8",
);
writeFileSync(
  join(out, "90_Archiv", "Ohne Treffer.md"),
  "---\nstatus: ruht\n---\n\nHier steht nichts dergleichen.\n",
  "utf8",
);

process.stdout.write(`${count + 2} Notizen in ${out}\n`);
