import type { RiskRule } from "./regex/guard-types";

/**
 * Warum eine Regel nicht ausgefuehrt werden konnte.
 *
 * Im Modell-Pfad wird daraus ein Fehlerzustand — dort gibt es nichts zu tippen, an dem
 * man es reparieren koennte. Im Handpfad lebt es dagegen IM Stand, weil das Panel beim
 * Tippen nicht aus der Vorschau fliegen darf.
 */
export type RuleProblem =
  | { kind: "syntax"; message: string }
  | { kind: "flags"; message: string }
  | { kind: "risky"; rule: RiskRule }
  | { kind: "too-many"; limit: number }
  | { kind: "too-slow"; ms: number; sampleChars: number; longestLine: number };

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
export type Round = { instruction: string; draft: RuleDraft | null; source: "model" | "manual" };

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
  /** Woher die Regel stammt — steuert die Beschriftung im Verlauf und ob eine
   *  Handbearbeitung diesen Stand aendert oder einen neuen anhaengt. */
  source: "model" | "manual";
  /** Das Muster, fuer das die Risiko-Warnung quittiert wurde. Null = keine Quittung.
   *  Bewusst der Pattern-String und kein Ja/Nein: eine Freigabe fuer (a+)+b sagt nichts
   *  ueber (a+)+bc. */
  riskAccepted: string | null;
  /** Warum dieser Stand keine Treffer hat. Nur im Handpfad besetzt. */
  problem: RuleProblem | null;
  /** Gedankengang des Modells, falls es einen geliefert hat. */
  reasoning: string | null;
};
