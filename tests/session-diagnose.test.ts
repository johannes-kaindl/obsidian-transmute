import { describe, expect, it, vi } from "vitest";
import { TransmuteSession } from "../src/core/session";

const options = () => ({ sampleChars: 500, budgetMs: 1000, maxHits: 500 });

/** Eine Sitzung mit genau einem Handstand, dessen Muster nichts trifft. */
const manualSession = (complete: ReturnType<typeof vi.fn>, regex: string, text: string) => {
  const session = new TransmuteSession({ complete, now: () => 0 }, options);
  session.startManual();
  session.editRule({ regex }, text);
  return session;
};

describe("diagnose", () => {
  it("legt das Ergebnis am Stand ab, mitsamt den gemessenen Befunden", async () => {
    const complete = vi.fn().mockResolvedValue({
      ok: true,
      reasoning: null,
      content: JSON.stringify({
        diagnosis: "Der Anker passt nicht.",
        fix: { regex: "foo", flags: "", replacement: "X" },
      }),
    });
    const session = manualSession(complete, "^foo", "bar foo");
    await session.diagnose("bar foo");

    const diagnosis = session.activeVersion!.diagnosis!;
    expect(diagnosis.kind).toBe("done");
    if (diagnosis.kind === "done") {
      expect(diagnosis.text).toBe("Der Anker passt nicht.");
      expect(diagnosis.findings).toEqual([{ kind: "no-anchors", line: 0 }]);
      expect(diagnosis.fix!.regex).toBe("foo");
    }
  });

  it("zeigt waehrenddessen den Laufzustand — ohne die Vorschau zu verlassen", async () => {
    const phases: string[] = [];
    const complete = vi.fn().mockResolvedValue({ ok: true, reasoning: null, content: "Der Text enthaelt nichts." });
    const session = manualSession(complete, "^foo", "nichts");
    session.onChange((state) => phases.push(state.phase));
    const running = session.diagnose("nichts");
    expect(session.activeVersion!.diagnosis).toEqual({ kind: "running" });
    await running;
    expect(phases.every((phase) => phase === "preview")).toBe(true);
  });

  it("nimmt Prosa als Diagnose und schlaegt dann nichts vor", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue({ ok: true, reasoning: null, content: "Hier steht schlicht nichts dergleichen." });
    const session = manualSession(complete, "^foo", "nichts");
    await session.diagnose("nichts");
    const diagnosis = session.activeVersion!.diagnosis!;
    if (diagnosis.kind === "done") expect(diagnosis.fix).toBeNull();
    expect(complete).toHaveBeenCalledTimes(1); // kein Retry
  });

  it("meldet gesondert, wenn das Modell nur nachgedacht hat", async () => {
    const complete = vi.fn().mockResolvedValue({ ok: false, error: "…", thoughtOnly: true });
    const session = manualSession(complete, "^foo", "nichts");
    await session.diagnose("nichts");
    expect(session.activeVersion!.diagnosis).toEqual({ kind: "failed", messageKey: "error.thoughtOnly", args: [] });
  });

  it("bleibt bei einem Endpunkt-Fehler in der Vorschau", async () => {
    const complete = vi.fn().mockResolvedValue({ ok: false, error: "connection refused" });
    const session = manualSession(complete, "^foo", "nichts");
    await session.diagnose("nichts");
    expect(session.state.phase).toBe("preview");
    const diagnosis = session.activeVersion!.diagnosis!;
    expect(diagnosis.kind).toBe("failed");
    if (diagnosis.kind === "failed") expect(diagnosis.messageKey).toBe("error.endpoint");
  });

  it("verwirft eine Antwort, deren Muster inzwischen ein anderes ist", async () => {
    let release: (value: unknown) => void = () => {};
    const complete = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const session = manualSession(complete, "^foo", "nichts");
    const running = session.diagnose("nichts");

    session.editRule({ regex: "^bar" }, "nichts"); // waehrend die Antwort unterwegs ist
    release({ ok: true, reasoning: null, content: "zu spaet" });
    await running;

    expect(session.activeVersion!.diagnosis).toBeNull();
  });

  it("tut nichts, wenn es Treffer gibt", async () => {
    const complete = vi.fn();
    const session = manualSession(complete, "foo", "foo bar");
    await session.diagnose("foo bar");
    expect(complete).not.toHaveBeenCalled();
    expect(session.activeVersion!.diagnosis).toBeNull();
  });
});

describe("applyFix", () => {
  const withFix = async () => {
    const complete = vi.fn().mockResolvedValue({
      ok: true,
      reasoning: null,
      content: JSON.stringify({
        diagnosis: "Der Anker passt nicht.",
        fix: { regex: "foo", flags: "", replacement: "X" },
      }),
    });
    const session = manualSession(complete, "^foo", "bar foo");
    await session.diagnose("bar foo");
    return session;
  };

  it("haengt den Vorschlag als eigenen Stand an und fuehrt ihn aus", async () => {
    const session = await withFix();
    const before = session.state.phase === "preview" ? session.state.versions.length : 0;
    session.applyFix("bar foo");

    expect(session.state.phase).toBe("preview");
    if (session.state.phase === "preview") {
      expect(session.state.versions).toHaveLength(before + 1);
      expect(session.state.active).toBe(before);
    }
    expect(session.activeVersion!.source).toBe("fix");
    expect(session.activeVersion!.rule.regex).toBe("foo");
    expect(session.activeVersion!.hits).toHaveLength(1);
    // Der neue Stand traegt keine Diagnose — er ist ja das Ergebnis einer.
    expect(session.activeVersion!.diagnosis).toBeNull();
  });

  it("laesst den vorigen Stand samt Diagnose stehen", async () => {
    const session = await withFix();
    session.applyFix("bar foo");
    if (session.state.phase === "preview") {
      expect(session.state.versions[0].rule.regex).toBe("^foo");
      expect(session.state.versions[0].diagnosis!.kind).toBe("done");
    }
  });

  it("tut nichts, wenn es keinen Vorschlag gibt", async () => {
    const complete = vi.fn().mockResolvedValue({ ok: true, reasoning: null, content: "Hier steht nichts dergleichen." });
    const session = manualSession(complete, "^foo", "nichts");
    await session.diagnose("nichts");
    session.applyFix("nichts");
    if (session.state.phase === "preview") expect(session.state.versions).toHaveLength(1);
  });
});
