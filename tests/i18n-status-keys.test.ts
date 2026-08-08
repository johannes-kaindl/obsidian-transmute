import { describe, expect, it } from "vitest";
import { STRINGS } from "../src/core/i18n/strings";
import { statusKindKey, roleKindKey } from "../src/core/settings/endpoint-editor-model";
import type { EndpointStatusKind } from "../src/vendor/kit/endpoint_diagnostics";
import type { EndpointRole } from "../src/vendor/kit/endpoint_config";

// STRINGS ist `as const` — ueber die Literal-Schluessel laesst sich nicht mit einem
// zur Laufzeit gebauten Schluessel indizieren. Die breitere Sicht ist der Vertrag, den
// die Kit-i18n-Engine ohnehin nutzt (Dict = Record<string, string>).
const DICTS: Record<"en" | "de", Record<string, string>> = STRINGS;

// Vollstaendigkeits-Kanarienvogel: bringt ein Kit-Update eine neue Statusklasse mit
// (0.24.0 brachte "unauthorized"), bricht dieser Record am `typecheck:test`, bevor der
// rohe Schluessel in der Oberflaeche landet — t() faellt auf den Key zurueck, nicht auf EN.
const ALL_KINDS: Record<EndpointStatusKind, true> = {
  "ok": true,
  "refused": true,
  "unknown-host": true,
  "timeout": true,
  "not-an-llm-api": true,
  "unauthorized": true,
  "unknown": true,
};

const ALL_ROLES: EndpointRole[] = [
  { kind: "active" },
  { kind: "standby", position: 1 },
  { kind: "unreachable" },
  { kind: "skipped-model" },
];

describe("i18n-Abdeckung der Kit-Aufzaehlungen", () => {
  it.each(Object.keys(ALL_KINDS) as EndpointStatusKind[])(
    "hat EN und DE fuer den Endpunkt-Status %s",
    (kind) => {
      const key = statusKindKey(kind);
      expect(DICTS.en[key], `EN fehlt: ${key}`).toBeTruthy();
      expect(DICTS.de[key], `DE fehlt: ${key}`).toBeTruthy();
    },
  );

  it.each(ALL_ROLES)("hat EN und DE fuer die Endpunkt-Rolle $kind", (role) => {
    const key = roleKindKey(role);
    expect(DICTS.en[key], `EN fehlt: ${key}`).toBeTruthy();
    expect(DICTS.de[key], `DE fehlt: ${key}`).toBeTruthy();
  });
});
