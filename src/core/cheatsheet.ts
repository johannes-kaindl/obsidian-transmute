export type CheatsheetRow = { syntax: string; descKey: string };
export type CheatsheetGroup = { titleKey: string; rows: readonly CheatsheetRow[] };

/**
 * Statische Regex-Referenz zum Nachschlagen — kein Modell, kein Netz.
 *
 * Die Syntax steht verbatim (sie ist in jeder Sprache dieselbe), die Beschreibung ist ein
 * Uebersetzungsschluessel. Bewusst kurz: wer hier laenger liest als tippt, hat das
 * falsche Werkzeug offen.
 */
export const CHEATSHEET: readonly CheatsheetGroup[] = [
  {
    titleKey: "cheat.chars",
    rows: [
      { syntax: ".", descKey: "cheat.any" },
      { syntax: "\\d", descKey: "cheat.digit" },
      { syntax: "\\w", descKey: "cheat.word" },
      { syntax: "\\s", descKey: "cheat.space" },
      { syntax: "[abc]", descKey: "cheat.set" },
      { syntax: "[^abc]", descKey: "cheat.notSet" },
      { syntax: "[a-z]", descKey: "cheat.range" },
    ],
  },
  {
    titleKey: "cheat.repeat",
    rows: [
      { syntax: "+", descKey: "cheat.plus" },
      { syntax: "*", descKey: "cheat.star" },
      { syntax: "?", descKey: "cheat.opt" },
      { syntax: "{2,4}", descKey: "cheat.range2" },
      { syntax: "+?", descKey: "cheat.lazy" },
    ],
  },
  {
    titleKey: "cheat.anchors",
    rows: [
      { syntax: "^", descKey: "cheat.start" },
      { syntax: "$", descKey: "cheat.end" },
      { syntax: "\\b", descKey: "cheat.boundary" },
    ],
  },
  {
    titleKey: "cheat.groups",
    rows: [
      { syntax: "(…)", descKey: "cheat.group" },
      { syntax: "(?:…)", descKey: "cheat.groupNo" },
      { syntax: "a|b", descKey: "cheat.alt" },
      { syntax: "\\.", descKey: "cheat.escape" },
    ],
  },
  {
    titleKey: "cheat.replace",
    rows: [
      { syntax: "$1", descKey: "cheat.ref" },
      { syntax: "$&", descKey: "cheat.whole" },
      { syntax: "$$", descKey: "cheat.dollar" },
    ],
  },
];
