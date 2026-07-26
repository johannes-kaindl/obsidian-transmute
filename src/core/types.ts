/** Die vom Modell gelieferte Regel, nach dem JSON-Vertrag. */
export type RuleDraft = {
  regex: string;
  flags: string;
  replacement: string;
  explanation: string;
};

/** Ein einzelner Treffer im Scope-Text. */
export type Hit = {
  /** 0-basierte Zeilennummer im Scope-Text */
  line: number;
  /** absoluter Offset, an dem die Zeile beginnt — die Render-Schicht leitet daraus die
   *  Position innerhalb der Zeile ab (start - lineStart), statt sie zu erraten */
  lineStart: number;
  /** absoluter Start-Offset im Scope-Text */
  start: number;
  /** absoluter End-Offset, exklusiv */
  end: number;
  /** getroffener Text */
  matched: string;
  /** Ersetzung nach $-Expansion */
  replacement: string;
  /** ganze Zeile vorher */
  before: string;
  /** ganze Zeile nachher — nur DIESER Treffer angewandt (Anzeige; der geschriebene
   *  Text entsteht in applyHits aus allen ausgewaehlten Treffern) */
  after: string;
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Eine Runde im Nachschaerf-Verlauf. */
export type Round = { instruction: string; draft: RuleDraft | null };

/**
 * Ein Stand im Verlauf: was eingegeben wurde und was dabei herauskam.
 *
 * Datenmodell uebernommen aus image-to-markdown (`refine: { base, rounds, selected }`,
 * `src/img_to_md_state.ts`). Dort haelt eine Runde den Ergebnistext, hier die Regel samt
 * ihrer Treffer — die Auswahl-Haekchen gehoeren zum Stand, nicht zur Sitzung, sonst
 * verliert ein Rueckwechsel sie.
 */
export type Version = {
  instruction: string;
  rule: RuleDraft;
  hits: Hit[];
  selected: boolean[];
  timedOutAtLine: number | null;
};
