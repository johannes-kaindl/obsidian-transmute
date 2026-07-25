// Der Store wertet ein Inline-`eslint-disable` einer obsidianmd-Regel als ERROR — unabhaengig
// von der Begruendung. Das hat anderswo zwei reine Wartungs-Releases gekostet, obwohl das
// Verbot woertlich in der eslint-Config stand (CORE-META-15: Regel ohne Check ist keine Regel).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const PATTERN = /eslint-disable/;

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const offenders = [];
for (const file of walk(ROOT).filter((f) => f.endsWith(".ts"))) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (PATTERN.test(line)) offenders.push(`${file}:${i + 1}`);
    });
}

if (offenders.length > 0) {
  console.error("Inline eslint-disable ist verboten (der Store wertet es als Error).");
  console.error("Ausweg: file-scoped Override in eslint.config.mjs, mit Begruendung.");
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log("check-no-inline-disables: sauber");
