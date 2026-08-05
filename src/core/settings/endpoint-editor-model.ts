// Muster: yijing-oracle/src/core/settings/endpoint-editor-model.ts (guter Schnitt:
// pure Logik getrennt vom obsidian-Modul). Die Kit-EndpointStatus.klartext-Felder sind
// hart deutsch — deshalb hier i18n-Keys statt Text. Dasselbe gilt fuer die Endpunkt-Rolle:
// das Kit liefert die Ableitung, den Text baut dieses Repo.
import type { EndpointStatusKind } from "../../vendor/kit/endpoint_diagnostics";
import type { EndpointRole } from "../../vendor/kit/endpoint_config";

export function activeIndexFromStatuses(statuses: (EndpointStatusKind | null)[]): number {
  return statuses.findIndex((s) => s === "ok");
}

export function statusKindKey(kind: EndpointStatusKind): string {
  return `status.${kind}`;
}

export function warnRuleKey(rule: string): string {
  return `warn.${rule}`;
}

export function roleKindKey(role: EndpointRole): string {
  return `set.epRole.${role.kind}`;
}
