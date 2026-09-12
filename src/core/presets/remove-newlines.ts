import { t } from "../../vendor/kit/i18n";
import type { PresetDef } from "../settings";

/**
 * Block-Start-Marker, die NICHT in einen Fliesstext-Absatz gezogen werden duerfen — weder
 * als die Zeile VOR dem Zeilenumbruch (Lookbehind) noch als die Zeile DANACH (Lookahead).
 * Eine einzige Definition fuer beide Richtungen, damit sie nicht auseinanderlaufen.
 */
const BLOCK_START = "(?:#{1,6}\\s|>|[-*+]\\s|\\d+\\.\\s|```|~~~|\\|)";

/**
 * Quicktask (Johannes, 2026-09-12): weich umgebrochene Zeilen eines Absatzes
 * zusammenfuehren, ohne echte Absatzgrenzen (Leerzeile) oder Markdown-Blockstrukturen
 * anzufassen.
 *
 * Bewusst ALS REGEL ueber evaluate() ausgefuehrt, nicht als eigener Ausfuehrungspfad —
 * evaluate() ist die einzige Stelle im Repo, die kompiliert und ausfuehrt (AGENTS.md,
 * Architecture principles). Ein deterministischer Transform bekommt dadurch dieselbe
 * Vorschau/Diff/Snapshot-Kette wie jede Modell- oder Handregel, ohne sie zu duplizieren.
 *
 * BEKANNTE GRENZE: das Muster erkennt zwei aufeinanderfolgende Zeilen, nicht "bin ich
 * innerhalb eines Codeblocks" ueber mehrere Zeilen hinweg — Fence-ZEILEN selbst bleiben
 * stehen, Zeilen DAZWISCHEN wuerden trotzdem zusammengezogen. Eine Regex ohne Zustand kann
 * das nicht unterscheiden; das ist der Grund, warum Differenzierungspunkt 1 (Vorschau vor
 * Anwendung) kein Kosmetik-Feature ist, sondern hier traegt.
 */
export function removeNewlinesPreset(): PresetDef {
  return {
    id: "builtin-remove-newlines",
    name: t("preset.removeNewlines"),
    regex: `(?<=\\S)(?<!^${BLOCK_START}[^\\n]*)\\n(?!\\n)(?!${BLOCK_START})(?=\\S)`,
    flags: "m",
    replacement: " ",
  };
}
