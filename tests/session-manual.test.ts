import { describe, expect, it, vi } from "vitest";
import { TransmuteSession } from "../src/core/session";

const options = () => ({ sampleChars: 500, budgetMs: 1000, maxHits: 500 });
const answer = JSON.stringify({ regex: "foo", flags: "", replacement: "bar", explanation: "e" });

function session(complete = vi.fn()): TransmuteSession {
  return new TransmuteSession({ complete, now: () => 0 }, options);
}

/** Eine Sitzung, die bereits einen Modell-Stand in der Vorschau hat. */
async function modelSession(): Promise<TransmuteSession> {
  const s = session(vi.fn().mockResolvedValue({ ok: true, reasoning: null, content: answer }));
  await s.generate("alle foo", "foo");
  return s;
}

describe("startManual", () => {
  it("oeffnet die Vorschau mit einem leeren Handstand", () => {
    const s = session();
    s.startManual();
    expect(s.state.phase).toBe("preview");
    const v = s.activeVersion;
    expect(v?.source).toBe("manual");
    expect(v?.rule.regex).toBe("");
    expect(v?.hits).toHaveLength(0);
    expect(v?.problem).toBeNull();
  });

  it("fragt dabei kein Modell", () => {
    const complete = vi.fn();
    const s = session(complete);
    s.startManual();
    expect(complete).not.toHaveBeenCalled();
  });

  it("verwirft einen vorherigen Verlauf", () => {
    const s = session();
    s.startManual();
    s.startManual();
    if (s.state.phase === "preview") expect(s.state.versions).toHaveLength(1);
  });
});

describe("editRule", () => {
  it("rechnet den Handstand bei jeder Aenderung neu", () => {
    const s = session();
    s.startManual();
    s.editRule({ regex: "foo", replacement: "bar" }, "foo und foo");
    expect(s.activeVersion?.hits).toHaveLength(2);
    expect(s.activeVersion?.selected).toEqual([true, true]);
  });

  it("aendert einen Handstand in-place statt anzuhaengen", () => {
    const s = session();
    s.startManual();
    s.editRule({ regex: "f" }, "foo");
    s.editRule({ regex: "fo" }, "foo");
    s.editRule({ regex: "foo" }, "foo");
    if (s.state.phase === "preview") expect(s.state.versions).toHaveLength(1);
  });

  it("haengt genau einen Stand an, wenn eine Modellregel bearbeitet wird", async () => {
    const s = await modelSession();
    s.editRule({ regex: "fo" }, "foo");
    s.editRule({ regex: "f" }, "foo");
    if (s.state.phase === "preview") {
      expect(s.state.versions).toHaveLength(2);
      expect(s.state.versions[0].source).toBe("model");
      expect(s.state.versions[1].source).toBe("manual");
      expect(s.state.active).toBe(1);
    }
  });

  it("laesst den Modellstand unveraendert", async () => {
    const s = await modelSession();
    s.editRule({ regex: "voellig anders" }, "foo");
    if (s.state.phase === "preview") expect(s.state.versions[0].rule.regex).toBe("foo");
  });

  it("legt einen Syntaxfehler in den Stand, nicht in den Zustand", () => {
    const s = session();
    s.startManual();
    s.editRule({ regex: "(unbalanced" }, "foo");
    expect(s.state.phase).toBe("preview");
    expect(s.activeVersion?.problem?.kind).toBe("syntax");
    expect(s.activeVersion?.hits).toHaveLength(0);
  });

  it("fuehrt ein leeres Muster nicht aus", () => {
    const s = session();
    s.startManual();
    s.editRule({ regex: "" }, "foo");
    expect(s.activeVersion?.hits).toHaveLength(0);
    expect(s.activeVersion?.problem).toBeNull();
  });

  it("meldet die Aenderung als edit", () => {
    const s = session();
    s.startManual();
    const reasons: string[] = [];
    s.onChange((_state, reason) => reasons.push(reason));
    s.editRule({ regex: "foo" }, "foo");
    expect(reasons).toEqual(["edit"]);
  });
});

describe("Risiko-Quittung", () => {
  it("fuehrt ein riskantes Muster erst nach der Quittung aus", () => {
    const s = session();
    s.startManual();
    s.editRule({ regex: "(a+)+b", replacement: "x" }, "aaab");
    expect(s.activeVersion?.problem?.kind).toBe("risky");

    s.acceptRisk("aaab");
    expect(s.activeVersion?.problem).toBeNull();
    expect(s.activeVersion?.hits).toHaveLength(1);
  });

  it("verliert die Quittung, sobald das Muster sich aendert", () => {
    const s = session();
    s.startManual();
    s.editRule({ regex: "(a+)+b", replacement: "x" }, "aaab");
    s.acceptRisk("aaab");
    s.editRule({ regex: "(a+)+bc" }, "aaabc");
    expect(s.activeVersion?.problem?.kind).toBe("risky");
    expect(s.activeVersion?.riskAccepted).toBeNull();
  });

  it("behaelt die Quittung, wenn nur die Ersetzung sich aendert", () => {
    const s = session();
    s.startManual();
    s.editRule({ regex: "(a+)+b", replacement: "x" }, "aaab");
    s.acceptRisk("aaab");
    s.editRule({ replacement: "y" }, "aaab");
    expect(s.activeVersion?.problem).toBeNull();
    expect(s.activeVersion?.hits[0].replacement).toBe("y");
  });

  // Der load-bearing Punkt: angezeigt und ausgefuehrt muessen dieselbe Freigabe sehen,
  // sonst meldet das Anwenden faelschlich "die Notiz hat sich geaendert".
  it("laesst ein quittiertes Muster auch beim Anwenden durch", () => {
    const s = session();
    s.startManual();
    s.editRule({ regex: "(a+)+b", replacement: "x" }, "aaab");
    s.acceptRisk("aaab");
    expect(s.revalidate("aaab").kind).toBe("ok");
  });
});

describe("Regression: die Erklaerung gehoert zum Muster, das sie erklaert", () => {
  // GUI-Befund 2026-07-27: nach einer Handbearbeitung stand weiter der Satz des Modells
  // da ("replaces every occurrence of 'foo'") — er beschrieb aber ein Muster, das laengst
  // nicht mehr lief.
  it("verwirft die Modell-Erklaerung, sobald von Hand editiert wird", async () => {
    const s = await modelSession();
    expect(s.activeVersion?.rule.explanation).toBe("e");

    s.editRule({ regex: "voellig anders" }, "foo");
    expect(s.activeVersion?.rule.explanation).toBe("");
  });

  it("laesst die Erklaerung des Modellstandes im Verlauf stehen", async () => {
    const s = await modelSession();
    s.editRule({ regex: "anders" }, "foo");
    if (s.state.phase === "preview") {
      expect(s.state.versions[0].rule.explanation).toBe("e");
    }
  });

  it("verwirft sie auch, wenn nur die Ersetzung geaendert wird", async () => {
    const s = await modelSession();
    s.editRule({ replacement: "anders" }, "foo");
    // Die Erklaerung beschreibt in aller Regel auch, WOMIT ersetzt wird.
    expect(s.activeVersion?.rule.explanation).toBe("");
  });
});

describe("Kanarienvogel vor der Freigabe", () => {
  // GUI-Befund 2026-07-27: die Freigabe hat Obsidian eingefroren. Das Zeitbudget greift
  // nur zwischen Zeilen; ein entgleister Match auf EINER Zeile kommt nie zurueck.
  it("fuehrt nicht aus, wenn die Probe schon zu lange braucht", () => {
    let t = 0;
    const s = new TransmuteSession(
      { complete: vi.fn(), now: () => (t += 10) },
      () => ({ sampleChars: 500, budgetMs: 1000, maxHits: 500 }),
    );
    s.startManual();
    s.editRule({ regex: "(a+)+b", replacement: "x" }, "aaab");
    s.acceptRisk("aaab");

    expect(s.activeVersion?.problem?.kind).toBe("too-slow");
    expect(s.activeVersion?.riskAccepted).toBeNull();
  });

  it("fuehrt aus, wenn die Probe schnell zurueckkommt", () => {
    const s = session();
    s.startManual();
    s.editRule({ regex: "(a+)+b", replacement: "x" }, "aaab");
    s.acceptRisk("aaab");

    expect(s.activeVersion?.problem).toBeNull();
    expect(s.activeVersion?.hits).toHaveLength(1);
  });
});

it("loescht die Diagnose, sobald am Muster getippt wird", () => {
  const s = session();
  s.startManual();
  // Von aussen gibt es keinen Weg, eine Diagnose zu setzen — hier steht sie stellvertretend
  // fuer alles, was zu einem Muster gehoert und mit ihm veraltet.
  s.editRule({ regex: "foo" }, "foo bar");
  expect(s.activeVersion!.diagnosis).toBeNull();
});
