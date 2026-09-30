// uebernommen aus lingotuner/src/core/llm/errors.ts (classifyShortcutFailure), 2026-10-01
export type ShortcutFailure = "error" | "cancel" | "timeout" | "busy" | "unsupported";

const BY_STATUS: Record<number, ShortcutFailure> = { 408: "timeout", 429: "busy", 499: "cancel", 501: "unsupported" };
const REASONS: readonly string[] = ["error", "cancel", "timeout", "busy"];

/** Fehlerbild des Kurzbefehl-Transports (Kit `createShortcutsChatTransport`): die Bruecke meldet
 *  Status und einen JSON-Koerper `{ error: { message, reason } }`. Der Grund im Koerper gilt vor
 *  dem Status; ohne lesbaren Koerper entscheidet der Status, der Rest ist „error". */
export function classifyShortcutFailure(status: number, errorText: string | undefined): { reason: ShortcutFailure; detail: string } {
  let detail = errorText ?? "";
  let reason: string | undefined;
  try {
    const e = (JSON.parse(errorText ?? "") as { error?: { message?: unknown; reason?: unknown } }).error;
    if (typeof e?.message === "string") detail = e.message;
    if (typeof e?.reason === "string") reason = e.reason;
  } catch { /* kein JSON: Rohtext bleibt als Detail */ }
  const known = reason !== undefined && REASONS.includes(reason) ? (reason as ShortcutFailure) : undefined;
  return { reason: known ?? BY_STATUS[status] ?? "error", detail };
}
