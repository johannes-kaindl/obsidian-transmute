import type { ScopeKind } from "../settings";

/** Ein Schluessel je Variante — damit der Waechter-Record ueberhaupt etwas pruefen kann. */
export function scopeKindKey(kind: ScopeKind): string {
  return `view.scope.${kind}`;
}
