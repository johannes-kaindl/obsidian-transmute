import { t } from "../../vendor/kit/i18n";
import type { PresetDef } from "../settings";

/**
 * Block-Start-Marker, die NICHT in einen Fliesstext-Absatz gezogen werden duerfen — weder
 * als die Zeile VOR dem Zeilenumbruch (Zeilenanfang-Pruefung) noch als die Zeile DANACH (Lookahead).
 * Eine einzige Definition fuer beide Richtungen, damit sie nicht auseinanderlaufen.
 */
const BLOCK_START = "(?:#{1,6}\\s|>|[-*+]\\s|\\d+\\.\\s|```|~~~|\\|)";

/**
 * Dasselbe fuer die Zeile VOR dem Umbruch, aber `\s` darf den Umbruch nicht fressen: das
 * alte Lookbehind sah nur bis zum Zeilenende, ein Lookahead am Zeilenanfang sieht darueber
 * hinaus ("-\na" ist kein Listenpunkt, "- " + Umbruch haette ihn dazu gemacht — der
 * Differentialtest hat genau diese Abweichung gefunden).
 */
const BLOCK_START_LINE = BLOCK_START.replace(/\\s/g, "[^\\S\\n]");

/**
 * Kein Lookbehind (iOS-Safari vor 16.4 parst `(?<…)` nicht, Store-Regel `regex-lookbehind`):
 * die Zeile VOR dem Umbruch wird mit verbraucht und als Gruppe 1 zurueckgeschrieben
 * (`$1 `). Der Zeilenanfang `^(?!BLOCK_START)` ersetzt die alte
 * Rueckwaerts-Pruefung auf die Zeile, das letzte Nicht-Leerzeichen `\S` vor dem `\n` die alte auf `\S`. Folge: die Vorschau
 * markiert die ganze Zeile statt nur den Umbruch; das Ergebnis ist byte-gleich zum alten
 * Muster (Differentialtest in tests/remove-newlines.test.ts).
 * Zwei bekannte Abweichungen an Randfaellen, die das alte Muster nur durch Zufall hatte: ein
 * nackter Marker direkt vor dem Umbruch ("-\na\nb") sperrte dort die uebernaechste Zeile,
 * weil `\s` den Umbruch frass; ein `\r` oder U+2028 mitten in der Zeile zaehlte als
 * Zeilenanfang fuer die Marker-Pruefung, hier gilt nur der Zeilenanfang nach `\n`.
 */
const REMOVE_NEWLINES_REGEX = `^(?!${BLOCK_START_LINE})([^\\n]*\\S)\\n(?!\\n)(?!${BLOCK_START})(?=\\S)`;

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
    regex: REMOVE_NEWLINES_REGEX,
    flags: "m",
    replacement: "$1 ",
  };
}
