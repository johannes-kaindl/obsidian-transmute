import { describe, expect, it, vi } from "vitest";
import { makeFakeEl } from "./__mocks__/obsidian";
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
  onSetAll: vi.fn(),
};

const base: Omit<PanelModel, "state"> = {
  scope: "file",
  instruction: "",
  refinement: "",
  showTarget: false,
  target: "",
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
          rule: { regex: "foo", flags: "g", replacement: "bar", explanation: "matcht foo" },
          hits: [hit()],
          selected: [true],
          timedOutAtLine: null,
        },
      },
      handlers,
    );
    expect(root.textContent).toContain("matcht foo");
    expect(root.textContent).toContain("1 matches");
    expect(root.textContent).toContain("/foo/g");
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
          rule: { regex: "aa", flags: "g", replacement: "X", explanation: "" },
          hits: [hit({ start: 3, end: 5, matched: "aa", replacement: "X", before: "aa aa", after: "aa X" })],
          selected: [true],
          timedOutAtLine: null,
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
          rule: { regex: "zzz", flags: "g", replacement: "", explanation: "" },
          hits: [],
          selected: [],
          timedOutAtLine: null,
        },
      },
      handlers,
    );
    expect(root.textContent).toContain("No matches");
  });

  it("meldet einen Zeitbudget-Abbruch mit Zeilennummer", () => {
    const root = makeFakeEl();
    renderPanel(
      root,
      {
        ...base,
        state: {
          phase: "preview",
          rule: { regex: "a", flags: "g", replacement: "b", explanation: "" },
          hits: [hit()],
          selected: [true],
          timedOutAtLine: 41,
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
