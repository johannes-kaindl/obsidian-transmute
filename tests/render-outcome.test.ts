import { describe, expect, it, vi } from "vitest";
import { makeFakeEl } from "./__mocks__/obsidian";
import { findAllByClass, findByClass } from "./helpers/dom";
import { renderOutcome, renderPanel, type PanelHandlers, type PanelModel } from "../src/obsidian/view-render";
import type { Hit, Version } from "../src/core/types";
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
};

const hit = (): Hit => ({
  line: 0,
  lineStart: 0,
  start: 0,
  end: 3,
  matched: "foo",
  replacement: "bar",
  before: "foo",
  after: "bar",
});

const version = (over: Partial<Version> = {}): Version => ({
  instruction: "alle foo",
  rule: { regex: "foo", flags: "i", replacement: "bar", explanation: "trifft foo" },
  hits: [],
  selected: [],
  timedOutAtLine: null,
  source: "model",
  riskAccepted: null,
  problem: null,
  reasoning: null,
  ...over,
});

const model = (...versions: Version[]): PanelModel => ({
  state: { phase: "preview", versions, active: versions.length - 1 },
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
});

describe("Dreiteilung", () => {
  it("liefert Verlaufs- und Ergebnis-Container aus der Vorschau", () => {
    const root = makeFakeEl();
    expect(renderPanel(root, model(version()), handlers)).not.toBeNull();
  });

  it("liefert ausserhalb der Vorschau keine Container", () => {
    const root = makeFakeEl();
    const parts = renderPanel(root, { ...model(version()), state: { phase: "idle" } }, handlers);
    expect(parts).toBeNull();
  });

  // Der Kern des Umbaus: ein empty() unter dem Cursor nimmt Fokus, Cursorposition und
  // den Undo-Stack des Feldes mit.
  it("laesst die Regel-Felder beim Teil-Draw unberuehrt", () => {
    const root = makeFakeEl();
    const parts = renderPanel(root, model(version()), handlers);
    const ruleEl = findByClass<{ children: unknown[] }>(root, "transmute-rule");
    const before = ruleEl?.children.length;

    renderOutcome(
      parts,
      model(version({ rule: { regex: "andere", flags: "", replacement: "x", explanation: "" } })),
      handlers,
    );

    expect(findByClass(root, "transmute-rule")).toBe(ruleEl);
    expect(ruleEl?.children.length).toBe(before);
  });

  it("zeichnet die Trefferzahl beim Teil-Draw neu", () => {
    const root = makeFakeEl();
    const parts = renderPanel(root, model(version()), handlers);
    renderOutcome(parts, model(version({ hits: [hit()], selected: [true] })), handlers);
    expect(parts?.outcome.textContent).toContain("1 matches");
  });

  it("tut nichts, wenn keine Container da sind", () => {
    expect(() => renderOutcome(null, model(version()), handlers)).not.toThrow();
  });

  it("verdoppelt beim wiederholten Teil-Draw nichts", () => {
    const root = makeFakeEl();
    const parts = renderPanel(root, model(version({ hits: [hit()], selected: [true] })), handlers);
    renderOutcome(parts, model(version({ hits: [hit()], selected: [true] })), handlers);
    renderOutcome(parts, model(version({ hits: [hit()], selected: [true] })), handlers);
    expect(findAllByClass(parts?.outcome, "transmute-hit")).toHaveLength(1);
  });

  it("beschriftet einen Handstand im Verlauf als bearbeitet", () => {
    const root = makeFakeEl();
    const parts = renderPanel(root, model(version(), version({ instruction: "", source: "manual" })), handlers);
    expect(parts?.history.textContent).toContain("Edited by hand");
  });
});

describe("Anwenden-Knopf", () => {
  it("ist bei einem Problem gesperrt, auch wenn Treffer dastehen", () => {
    const root = makeFakeEl();
    const v = version({
      problem: { kind: "risky", rule: "nested-quantifier" },
      hits: [hit()],
      selected: [true],
    });
    renderPanel(root, model(v), handlers);
    const apply = findAllByClass<{ getAttribute(k: string): string | null }>(root, "mod-cta").at(-1);
    expect(apply?.getAttribute("disabled")).toBe("true");
  });
});
