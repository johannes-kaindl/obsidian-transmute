import { mergeSettings } from "../vendor/kit/settings";

export type ScopeKind = "file" | "selection";

export type TransmuteSettings = {
  endpoints: string[];
  model: string;
  timeoutMs: number;
  suppressReasoning: boolean;
  sampleChars: number;
  budgetMs: number;
  defaultScope: ScopeKind;
  /** Zweites, optionales Feld fuer das Ziel-Muster einblenden (Default aus:
   *  viele Anweisungen haben gar kein Ziel-Muster). */
  showTargetField: boolean;
};

export const DEFAULT_SETTINGS: TransmuteSettings = {
  endpoints: ["http://127.0.0.1:1234"],
  model: "",            // modellagnostisch: kommt aus GET /v1/models
  timeoutMs: 120000,
  suppressReasoning: true,
  sampleChars: 2000,
  budgetMs: 2000,
  defaultScope: "file",
  showTargetField: false,
};

export function loadSettings(raw: unknown): TransmuteSettings {
  return mergeSettings(DEFAULT_SETTINGS, raw);
}
