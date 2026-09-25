import { mergeSettings } from "../vendor/kit/settings";
import { migrateEndpointList, type EndpointConfig } from "../vendor/kit/endpoint_config";
import type { EndpointChoice } from "../vendor/kit/endpoint-source";
import { removeNewlinesPreset } from "./presets/remove-newlines";

export type ScopeKind = "file" | "selection" | "vault";

/** Eine gespeicherte, per Klick abfeuerbare Regel — ohne erneuten Modell-Umweg. */
export type PresetDef = {
  id: string;
  name: string;
  regex: string;
  flags: string;
  replacement: string;
};

export type TransmuteSettings = {
  /** Geordnete Fallback-Kette; der erste erreichbare gewinnt. Jede Zeile trägt ihren
   *  eigenen API-Schlüssel, damit lokale und gehostete Anbieter in EINER Liste stehen können. */
  endpoints: EndpointConfig[];
  /** Wahl gegenueber dem LLM Endpoint Manager (Endpunkt + Modell); leer = automatisch. Gilt nur,
   *  solange der Manager installiert ist — sonst zaehlen `endpoints` und `model`. */
  choice: EndpointChoice;
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
  /** In den Einstellungen angelegt, in der Sidebar per Klick abfeuerbar. */
  presets: PresetDef[];
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
  choice: {},
  model: "",            // modellagnostisch: kommt aus GET /v1/models
  timeoutMs: 120000,
  suppressReasoning: true,
  sampleChars: 2000,
  budgetMs: 2000,
  defaultScope: "file",
  showTargetField: false,
  confirmThreshold: 50,
  snapshotKeep: 5,
  presets: [],
};

export function loadSettings(raw: unknown): TransmuteSettings {
  const merged = mergeSettings(DEFAULT_SETTINGS, raw);
  // mergeSettings ist ein shallow, typ-blinder Merge: `endpoints` kann aus einer data.json
  // von vor 0.5.0 noch string[] sein. migrateEndpointList ist die einzige Stelle, die das
  // geradezieht — danach ist der Typ im ganzen Repo verlässlich.
  const rawList = merged.endpoints as unknown as (string | EndpointConfig)[] | undefined;
  // Geseedet wird nur, wenn `raw` den Schluessel `presets` GAR NICHT traegt (Erstinstallation
  // oder Upgrade von vor 0.6.0) — ein leeres Array ist eine bewusste Nutzerentscheidung
  // (alle Presets geloescht) und wird nicht resurrektiert. Ein Wertevergleich koennte beide
  // Faelle nicht unterscheiden, der Schluessel-Check kann es.
  const hadPresetsKey = typeof raw === "object" && raw !== null && "presets" in raw;
  const presets = hadPresetsKey ? merged.presets : [removeNewlinesPreset()];
  const rawChoice = (merged as { choice?: unknown }).choice as EndpointChoice | null | undefined;
  const choice: EndpointChoice = rawChoice && typeof rawChoice === "object"
    ? {
        ...(rawChoice.endpointId ? { endpointId: String(rawChoice.endpointId) } : {}),
        ...(rawChoice.model ? { model: String(rawChoice.model) } : {}),
      }
    : {};
  return { ...merged, endpoints: migrateEndpointList(undefined, rawList), presets, choice };
}
