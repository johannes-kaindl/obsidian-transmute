import { describe, expect, it } from "vitest";
import { STRINGS } from "../src/core/i18n/strings";
import { scopeKindKey } from "../src/core/vault/labels";
import type { ScopeKind } from "../src/core/settings";

const DICTS: Record<"en" | "de", Record<string, string>> = STRINGS;

// Vollstaendigkeits-Kanarienvogel: kommt eine weitere Scope-Variante dazu, bricht dieser
// Record am `typecheck:test`, bevor der rohe Schluessel in der Oberflaeche landet.
const ALL_SCOPES: Record<ScopeKind, true> = {
  "file": true,
  "selection": true,
  "vault": true,
};

describe("i18n-Abdeckung der Scope-Varianten", () => {
  it.each(Object.keys(ALL_SCOPES) as ScopeKind[])("hat EN und DE fuer %s", (kind) => {
    const key = scopeKindKey(kind);
    expect(DICTS.en[key], `EN fehlt: ${key}`).toBeTruthy();
    expect(DICTS.de[key], `DE fehlt: ${key}`).toBeTruthy();
  });
});
