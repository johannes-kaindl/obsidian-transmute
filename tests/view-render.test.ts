import { describe, expect, it, vi } from "vitest";
import { makeFakeEl } from "./__mocks__/obsidian";
import { findByClass } from "./helpers/dom";
import { renderPanel, type PanelHandlers, type PanelModel } from "../src/obsidian/view-render";
import type { Hit } from "../src/core/types";
import "../src/core/i18n/strings";

const handlers: PanelHandlers = {
  onScope: vi.fn(),
  onInstruction: vi.fn(),
  onTarget: vi.fn(),
  onRefinement: vi.fn(),
  onGenerate: vi.fn(),
  onRefine: vi.fn(),
  onApply: vi.fn(),
  onToggle: vi.fn(),
  onDiscard: vi.fn(),
  onSelectVersion: vi.fn(),
  onModel: vi.fn(),
  onRefreshModels: vi.fn(),
  onToggleThinking: vi.fn(),
  onSetAll: vi.fn(),
  onStartManual: vi.fn(),
  onEditRule: vi.fn(),
  onAcceptRisk: vi.fn(),
  onCopyRule: vi.fn(),
  onToggleReasoning: vi.fn(),
  onDiagnose: vi.fn(),
  onApplyFix: vi.fn(),
};

const base: Omit<PanelModel, "state"> = {
  scope: "file",
  instruction: "",
  refinement: "",
  showTarget: false,
  target: "",
  pinnedName: null,
  models: [],
  model: "",
  suppressReasoning: true,
  reasoningOpen: false,
};

const hit = (over: Partial<Hit> = {}): Hit => ({
  line: 0,
  lineStart: 0,
  start: 4,
  end: 7,
  matched: "foo",
  replacement: "bar",
  before: "say foo now",
  after: "say bar now",
  ...over,
});

describe("renderPanel", () => {
  it("zeigt im idle-Zustand Bereichswahl und Vorschau-Knopf", () => {
    const root = makeFakeEl();
    renderPanel(root, { ...base, state: { phase: "idle" } }, handlers);
    expect(root.textContent).toContain("Whole note");
    expect(root.textContent).toContain("Preview");
  });

  it("doppelt den Reiter-Titel nicht als Ueberschrift", () => {
    const root = makeFakeEl();
    renderPanel(root, { ...base, state: { phase: "idle" } }, handlers);
    expect(root.textContent).not.toContain("Transmute");
  });

  it("zeigt das Ziel-Feld nur, wenn es freigeschaltet ist", () => {
    const off = makeFakeEl();
    renderPanel(off, { ...base, state: { phase: "idle" } }, handlers);
    expect(off.textContent).not.toContain("Replace with");

    const on = makeFakeEl();
    renderPanel(on, { ...base, showTarget: true, state: { phase: "idle" } }, handlers);
    expect(on.textContent).toContain("Replace with");
  });

  it("leert den Container vor jedem Rendern", () => {
    const root = makeFakeEl();
    renderPanel(root, { ...base, state: { phase: "idle" } }, handlers);
    const first = root.children.length;
    renderPanel(root, { ...base, state: { phase: "idle" } }, handlers);
    expect(root.children.length).toBe(first);
  });

  it("zeigt im preview-Zustand Muster, Erklaerung und Trefferzahl", () => {
    const root = makeFakeEl();
    renderPanel(
      root,
      {
        ...base,
        state: {
          phase: "preview",
          versions: [{ instruction: "i", rule: { regex: "foo", flags: "g", replacement: "bar", explanation: "matcht foo" }, hits: [hit()], selected: [true], timedOutAtLine: null, source: "model" as const, riskAccepted: null, problem: null, reasoning: null, diagnosis: null }],
          active: 0,
        },
      },
      handlers,
    );
    expect(root.textContent).toContain("matcht foo");
    expect(root.textContent).toContain("1 matches");
    expect(root.textContent).toContain("/foo/g");
  });

  // Regression 0.2.0: angezeigt wurde /#alt/i, ausgefuehrt aber /#alt/gi. Wer das
  // Muster kopiert oder daraus lernt, bekam ein anderes Muster als das gelaufene.
  it("zeigt die Flags, mit denen das Muster tatsaechlich lief", () => {
    const root = makeFakeEl();
    renderPanel(
      root,
      {
        ...base,
        state: {
          phase: "preview",
          versions: [{ instruction: "i", rule: { regex: "#alt", flags: "i", replacement: "#neu", explanation: "" }, hits: [hit()], selected: [true], timedOutAtLine: null, source: "model" as const, riskAccepted: null, problem: null, reasoning: null, diagnosis: null }],
          active: 0,
        },
      },
      handlers,
    );
    expect(root.textContent).toContain("/#alt/gi");
  });

  it("zeigt neben dem Suchmuster auch das Ersetzungsmuster", () => {
    const root = makeFakeEl();
    renderPanel(
      root,
      {
        ...base,
        state: {
          phase: "preview",
          versions: [{ instruction: "i", rule: { regex: "(\\d+)", flags: "g", replacement: "Nr. $1", explanation: "" }, hits: [hit()], selected: [true], timedOutAtLine: null, source: "model" as const, riskAccepted: null, problem: null, reasoning: null, diagnosis: null }],
          active: 0,
        },
      },
      handlers,
    );
    // Seit 0.3.0 steht das Ersetzungsmuster in einem Eingabefeld, nicht mehr im Text —
    // die Zusage "es ist sichtbar und veraenderbar" gilt unveraendert.
    const field = findByClass<{ value: string }>(root, "transmute-replacement-input");
    expect(field?.value).toBe("Nr. $1");
  });

  it("nennt die Notiz, an der die Runde haengt", () => {
    const root = makeFakeEl();
    renderPanel(
      root,
      {
        ...base,
        pinnedName: "Projektnotizen",
        state: {
          phase: "preview",
          versions: [{ instruction: "i", rule: { regex: "a", flags: "g", replacement: "b", explanation: "" }, hits: [hit()], selected: [true], timedOutAtLine: null, source: "model" as const, riskAccepted: null, problem: null, reasoning: null, diagnosis: null }],
          active: 0,
        },
      },
      handlers,
    );
    expect(root.textContent).toContain("Projektnotizen");
  });

  it("markiert die Fundstelle ueber lineStart, nicht per Textsuche", () => {
    const root = makeFakeEl();
    // Zwei gleiche Vorkommen in einer Zeile: eine indexOf-Suche wuerde das erste
    // markieren, obwohl der Treffer das zweite ist.
    renderPanel(
      root,
      {
        ...base,
        state: {
          phase: "preview",
          versions: [{ instruction: "i", rule: { regex: "aa", flags: "g", replacement: "X", explanation: "" }, hits: [hit({ start: 3, end: 5, matched: "aa", replacement: "X", before: "aa aa", after: "aa X" })], selected: [true], timedOutAtLine: null, source: "model" as const, riskAccepted: null, problem: null, reasoning: null, diagnosis: null }],
          active: 0,
        },
      },
      handlers,
    );
    expect(root.textContent).toContain("aa aa");
    expect(root.textContent).toContain("aa X");
  });

  it("zeigt bei null Treffern den Hinweis statt einer Liste", () => {
    const root = makeFakeEl();
    renderPanel(
      root,
      {
        ...base,
        state: {
          phase: "preview",
          versions: [{ instruction: "i", rule: { regex: "zzz", flags: "g", replacement: "", explanation: "" }, hits: [], selected: [], timedOutAtLine: null, source: "model" as const, riskAccepted: null, problem: null, reasoning: null, diagnosis: null }],
          active: 0,
        },
      },
      handlers,
    );
    // Die Meldung darf die Ursache nicht der Anweisung zuschieben — sie stimmt genauso
    // oft, wenn der Text gar nicht (mehr) enthaelt, wonach gesucht wird.
    expect(root.textContent).toContain("found nothing in this text");
  });

  it("meldet einen Zeitbudget-Abbruch mit Zeilennummer", () => {
    const root = makeFakeEl();
    renderPanel(
      root,
      {
        ...base,
        state: {
          phase: "preview",
          versions: [{ instruction: "i", rule: { regex: "a", flags: "g", replacement: "b", explanation: "" }, hits: [hit()], selected: [true], timedOutAtLine: 41, source: "model" as const, riskAccepted: null, problem: null, reasoning: null, diagnosis: null }],
          active: 0,
        },
      },
      handlers,
    );
    expect(root.textContent).toContain("42");
  });

  it("zeigt im Fehlerfall die uebersetzte Meldung und die Rohantwort", () => {
    const root = makeFakeEl();
    renderPanel(
      root,
      { ...base, state: { phase: "error", messageKey: "error.noJson", args: [], raw: "I cannot" } },
      handlers,
    );
    expect(root.textContent).toContain("did not answer with JSON");
    expect(root.textContent).toContain("I cannot");
  });

  it("uebersetzt Fehler mit Argumenten", () => {
    const root = makeFakeEl();
    renderPanel(
      root,
      { ...base, state: { phase: "error", messageKey: "error.endpoint", args: ["ECONNREFUSED"], raw: null } },
      handlers,
    );
    expect(root.textContent).toContain("ECONNREFUSED");
  });
});

describe("renderPanel — Verlauf", () => {
  const version = (instruction: string, count: number) => ({
    instruction,
    rule: { regex: "a", flags: "g", replacement: "b", explanation: "" },
    hits: Array.from({ length: count }, () => hit()),
    selected: Array.from({ length: count }, () => true),
    timedOutAtLine: null, source: "model" as const, riskAccepted: null, problem: null, reasoning: null, diagnosis: null,
  });

  it("zeigt keinen Verlauf, solange es nur einen Stand gibt", () => {
    const root = makeFakeEl();
    renderPanel(root, { ...base, state: { phase: "preview", versions: [version("erste", 1)], active: 0 } }, handlers);
    expect(root.textContent).not.toContain("erste");
  });

  it("listet ab dem zweiten Stand alle mit Anweisung und Trefferzahl", () => {
    const root = makeFakeEl();
    renderPanel(
      root,
      { ...base, state: { phase: "preview", versions: [version("erste", 2), version("zweite", 1)], active: 1 } },
      handlers,
    );
    expect(root.textContent).toContain("erste");
    expect(root.textContent).toContain("zweite");
  });

  it("zeigt den aktiven Stand, nicht immer den letzten", () => {
    const root = makeFakeEl();
    const versions = [
      { ...version("erste", 1), rule: { regex: "ALT", flags: "g", replacement: "b", explanation: "" } },
      { ...version("zweite", 1), rule: { regex: "NEU", flags: "g", replacement: "b", explanation: "" } },
    ];
    renderPanel(root, { ...base, state: { phase: "preview", versions, active: 0 } }, handlers);
    expect(root.textContent).toContain("/ALT/g");
    expect(root.textContent).not.toContain("/NEU/g");
  });
});

describe("renderPanel — Modellzeile", () => {
  it("bietet die geladenen Modelle zur Auswahl", () => {
    const root = makeFakeEl();
    renderPanel(root, { ...base, models: ["qwen", "gemma"], state: { phase: "idle" } }, handlers);
    expect(root.textContent).toContain("qwen");
    expect(root.textContent).toContain("gemma");
  });

  // Sonst waehlt die Anzeige stillschweigend ein anderes Modell aus.
  it("behaelt ein eingestelltes, aber nicht geladenes Modell in der Liste", () => {
    const root = makeFakeEl();
    renderPanel(root, { ...base, models: ["qwen"], model: "weg", state: { phase: "idle" } }, handlers);
    expect(root.textContent).toContain("weg");
  });

  it("zeigt den Thinking-Zustand als Text, nicht nur als Farbe", () => {
    const off = makeFakeEl();
    renderPanel(off, { ...base, model: "qwen", state: { phase: "idle" } }, handlers);
    expect(off.textContent).toContain("Thinking off");

    const on = makeFakeEl();
    renderPanel(on, { ...base, model: "qwen", suppressReasoning: false, state: { phase: "idle" } }, handlers);
    expect(on.textContent).toContain("Thinking on");
  });

  it("sperrt den Schalter bei Modellen, die immer denken", () => {
    const root = makeFakeEl();
    renderPanel(root, { ...base, model: "gpt-oss-20b", state: { phase: "idle" } }, handlers);
    expect(root.textContent).toContain("Always thinks");
  });
});

describe("renderPanel — Verlauf ist als Verlauf erkennbar", () => {
  const version = (instruction: string) => ({
    instruction,
    rule: { regex: "a", flags: "g", replacement: "b", explanation: "" },
    hits: [hit()],
    selected: [true],
    timedOutAtLine: null, source: "model" as const, riskAccepted: null, problem: null, reasoning: null, diagnosis: null,
  });

  // Ohne Ueberschrift liest sich die Liste wie Teil des Ergebnisses statt wie ein Verlauf.
  it("beschriftet die Liste und sagt, was ein Klick tut", () => {
    const root = makeFakeEl();
    renderPanel(
      root,
      { ...base, state: { phase: "preview", versions: [version("a"), version("b")], active: 1 } },
      handlers,
    );
    expect(root.textContent).toContain("History");
    expect(root.textContent).toContain("click a step to go back");
  });

  it("beschriftet nichts, solange es keinen Verlauf gibt", () => {
    const root = makeFakeEl();
    renderPanel(root, { ...base, state: { phase: "preview", versions: [version("a")], active: 0 } }, handlers);
    expect(root.textContent).not.toContain("History");
  });
});
