import { describe, expect, it } from "vitest";
import { roleKindKey } from "../src/core/settings/endpoint-editor-model";

describe("roleKindKey", () => {
  it("bildet jede Rolle auf einen i18n-Schluessel ab", () => {
    expect(roleKindKey({ kind: "active" })).toBe("set.epRole.active");
    expect(roleKindKey({ kind: "standby", position: 3 })).toBe("set.epRole.standby");
    expect(roleKindKey({ kind: "unreachable" })).toBe("set.epRole.unreachable");
    expect(roleKindKey({ kind: "skipped-model" })).toBe("set.epRole.skipped-model");
  });
});
