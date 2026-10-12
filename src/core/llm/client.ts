import { classifyShortcutFailure, type ShortcutFailure } from "../../vendor/kit/shortcut-failure";

export type CompleteResult =
  /** truncated: finish_reason === "length" — am Token-Limit abgeschnitten. Kein Fehler,
   *  der Teiltext bleibt verwertbar; nur wer ihn zeigt, muss es sagen koennen (sonst sieht
   *  ein abgeschnittenes Ergebnis wie ein vollstaendiges aus). */
  | { ok: true; content: string; reasoning: string | null; truncated: boolean }
  /** thoughtOnly: Der Aufruf gelang, aber das Modell hat sein Token-Budget vollstaendig
   *  ins Denken gesteckt — gemessen bei qwen3.6 unter LM Studio (512 von 551 Tokens).
   *  Das ist die tueckischere Fehlerklasse als ein toter Port: kein Fehlerstatus, nur
   *  ein leerer String, der sich als leere Modellantwort tarnt.
   *  truncatedEmpty: abgeschnitten UND ohne verwertbaren Text — die Meldung muss das
   *  Limit nennen, nicht "leere Antwort" (REGISTRY "Abgeschnittene LLM-Antwort …"). */
  | { ok: false; error: string; thoughtOnly?: boolean; truncatedEmpty?: boolean; shortcutReason?: ShortcutFailure };

/** Ausgang der Verbindung, soweit die Abbildung ihn braucht — strukturell gehalten, damit der Kern
 *  die obsidian-Schicht (`LlmResult`) nicht importiert (PROF-OBS-12). */
export type ConnectionOutcome =
  | { ok: true; content: string; reasoning: string; truncated: boolean }
  | { ok: false; kind: string; detail: string; reasoning?: string; status?: number; body?: string };

/** `LlmResult` der Verbindung → `CompleteResult` des Plugins. `shortcuts`: der aufgeloeste Endpunkt
 *  ist ein Kurzbefehl (Apple Intelligence) — dessen Fehler tragen einen eigenen Grund. */
export function toCompleteResult(r: ConnectionOutcome, shortcuts: boolean): CompleteResult {
  if (!r.ok) {
    // Abgeschnitten ohne Text: die Meldung muss das Limit nennen, nicht „leere Antwort“.
    if (r.kind === "truncated") return { ok: false, error: "length", truncatedEmpty: true };
    if (shortcuts) {
      // Konfigurationsfehler (Bruecke fehlt) kommt ohne Status; die Bruecke selbst meldet mit Status.
      if (r.kind === "http" && r.status !== undefined) {
        const f = classifyShortcutFailure(r.status, r.body ?? r.detail);
        return { ok: false, error: f.detail, shortcutReason: f.reason };
      }
      if (r.kind === "no-endpoint") return { ok: false, error: r.detail, shortcutReason: "error" };
    }
    return { ok: false, error: r.detail };
  }
  if (r.content.trim().length === 0) {
    if (r.reasoning.trim().length > 0) return { ok: false, error: r.reasoning.slice(0, 300), thoughtOnly: true };
    return { ok: false, error: "empty answer" };
  }
  return { ok: true, content: r.content, reasoning: r.reasoning !== "" ? r.reasoning : null, truncated: r.truncated };
}
