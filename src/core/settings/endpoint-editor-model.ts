// Muster: yijing-oracle/src/core/settings/endpoint-editor-model.ts (guter Schnitt:
// pure Logik getrennt vom obsidian-Modul). Die Kit-EndpointStatus.klartext-Felder sind
// hart deutsch — deshalb hier i18n-Keys statt Text.
import type { EndpointStatusKind } from "../../vendor/kit/endpoint_diagnostics";

export function applyEndpointEdit(list: string[], index: number, value: string, isAdder: boolean): string[] {
  const trimmed = value.trim();
  if (isAdder) return trimmed.length === 0 ? [...list] : [...list, trimmed];
  const next = [...list];
  if (trimmed.length === 0) next.splice(index, 1);
  else next[index] = trimmed;
  return next;
}

export function activeIndexFromStatuses(statuses: (EndpointStatusKind | null)[]): number {
  return statuses.findIndex((s) => s === "ok");
}

export function statusKindKey(kind: EndpointStatusKind): string {
  return `status.${kind}`;
}

export function warnRuleKey(rule: string): string {
  return `warn.${rule}`;
}
