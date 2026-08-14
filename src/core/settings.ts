import { mergeSettings } from "../vendor/kit/settings";
import { migrateEndpointList, type EndpointConfig } from "../vendor/kit/endpoint_config";

export type ScopeKind = "file" | "selection" | "vault";

export type TransmuteSettings = {
  /** Geordnete Fallback-Kette; der erste erreichbare gewinnt. Jede Zeile trägt ihren
   *  eigenen API-Schlüssel, damit lokale und gehostete Anbieter in EINER Liste stehen können. */
  endpoints: EndpointConfig[];
  model: string;
  timeoutMs: number;
  suppressReasoning: boolean;
  sampleChars: number;
  budgetMs: number;
  defaultScope: ScopeKind;
  /** Zweites, optionales Feld fuer das Ziel-Muster einblenden (Default aus:
   *  viele Anweisungen haben gar kein Ziel-Muster). */
  showTargetField: boolean;
  /** Ab wie vielen betroffenen Dateien vor dem Schreiben nachgefragt wird. */
  confirmThreshold: number;
  /** Wie viele Snapshot-Ordner aufgehoben werden. */
  snapshotKeep: number;
};

/**
 * Obergrenze fuer die Treffer eines Laufs.
 *
 * Bewusst eine Konstante und keine Einstellung: die Grenze schuetzt die Anzeige vor
 * Mustern wie a*, die an jeder Position den Leerstring treffen — das ist kein Geschmack,
 * sondern eine Belastungsgrenze. Wer sie erreicht, hat ein zu allgemeines Muster, nicht
 * eine zu kleine Zahl.
 */
export const MAX_HITS = 500;

export const DEFAULT_SETTINGS: TransmuteSettings = {
  endpoints: [{ url: "http://127.0.0.1:1234" }],
  model: "",            // modellagnostisch: kommt aus GET /v1/models
  timeoutMs: 120000,
  suppressReasoning: true,
  sampleChars: 2000,
  budgetMs: 2000,
  defaultScope: "file",
  showTargetField: false,
  confirmThreshold: 50,
  snapshotKeep: 5,
};

export function loadSettings(raw: unknown): TransmuteSettings {
  const merged = mergeSettings(DEFAULT_SETTINGS, raw);
  // mergeSettings ist ein shallow, typ-blinder Merge: `endpoints` kann aus einer data.json
  // von vor 0.5.0 noch string[] sein. migrateEndpointList ist die einzige Stelle, die das
  // geradezieht — danach ist der Typ im ganzen Repo verlässlich.
  const rawList = merged.endpoints as unknown as (string | EndpointConfig)[] | undefined;
  return { ...merged, endpoints: migrateEndpointList(undefined, rawList) };
}
