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
