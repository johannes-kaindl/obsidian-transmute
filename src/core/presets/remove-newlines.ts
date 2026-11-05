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

/**
 * Das Muster bis 0.x: mit Rückwärtsprüfung. Es steht hier NUR, um ein in der `data.json` gespeichertes Preset
 * wiederzuerkennen (Zeichenvergleich, es wird nie kompiliert). Auf iOS-Safari vor 16.4 wirft schon das
 * Kompilieren dieser Zeichenkette; wer das Preset beim ersten Start gespeichert hat, trägt sie weiter.
 * (Eine Suche nach der Rückwärtsprüfung im Quelltext trifft deshalb diese Zeile: sie ist Vergleichsdaten, kein Regex-Literal.)
 */
const LEGACY_REMOVE_NEWLINES_REGEX = `(?<=\\S)(?<!^${BLOCK_START}[^\\n]*)\\n(?!\\n)(?!${BLOCK_START})(?=\\S)`;

/**
 * Zieht ein gespeichertes eingebautes Preset auf das Muster ohne Rückwärtsprüfung, aber NUR, wenn Muster, Flags und
 * Ersetzung genau dem alten Standard entsprechen (der Nutzer hat nichts angepasst). Name und Id bleiben, ein
 * abgewandeltes Preset bleibt unberührt. Der Vergleich nimmt keine Id und keinen Namen: ein duplizierter Eintrag mit
 * dem alten Standardtext bricht auf iOS vor 16.4 genauso. Gibt dieselbe Liste zurück, wenn nichts zu tun ist.
 */
export function migrateLegacyRemoveNewlines(presets: PresetDef[]): PresetDef[] {
  if (!presets.some(isLegacyRemoveNewlines)) return presets;
  return presets.map((p) => (isLegacyRemoveNewlines(p) ? { ...p, regex: REMOVE_NEWLINES_REGEX, replacement: "$1 " } : p));
}

function isLegacyRemoveNewlines(p: PresetDef): boolean {
  return p.regex === LEGACY_REMOVE_NEWLINES_REGEX && p.flags === "m" && p.replacement === " ";
}
