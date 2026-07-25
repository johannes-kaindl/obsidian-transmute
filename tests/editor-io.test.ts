import { describe, expect, it } from "vitest";
import { MarkdownView } from "./__mocks__/obsidian";
import { activeMarkdownView, readScope, writeScope } from "../src/obsidian/editor-io";
import type { Editor, Workspace } from "obsidian";

/** Minimaler Workspace-Stub: rootSplit klammert die Sidebars aus. */
function workspaceWith(view: unknown): Workspace {
  return {
    rootSplit: { id: "root" },
    getMostRecentLeaf: (container: unknown) => (container === undefined ? null : { view }),
  } as unknown as Workspace;
}

function fakeEditor(lines: string[], selection = ""): Editor {
  return {
    getValue: () => lines.join("\n"),
    getSelection: () => selection,
    getCursor: (which: string) => (which === "from" ? { line: 0, ch: 0 } : { line: 0, ch: selection.length }),
    lastLine: () => lines.length - 1,
    getLine: (i: number) => lines[i],
    replaceRange: () => undefined,
  } as unknown as Editor;
}

describe("activeMarkdownView", () => {
  // Regression 0.1.2: mit getActiveViewOfType lieferte das beim Klick ins Seitenpanel
  // null — das Panel ist dann die aktive Ansicht und jede Aktion scheiterte mit
  // "oeffne zuerst eine Notiz", obwohl daneben eine Notiz offen war.
  it("findet die Notiz im Hauptbereich, auch wenn das Panel den Fokus hat", () => {
    const view = new MarkdownView();
    expect(activeMarkdownView(workspaceWith(view))).toBe(view);
  });

  it("gibt null zurueck, wenn im Hauptbereich keine Markdown-Notiz liegt", () => {
    expect(activeMarkdownView(workspaceWith({ notAView: true }))).toBeNull();
  });

  it("gibt null zurueck, wenn gar kein Leaf da ist", () => {
    const workspace = {
      rootSplit: { id: "root" },
      getMostRecentLeaf: () => null,
    } as unknown as Workspace;
    expect(activeMarkdownView(workspace)).toBeNull();
  });

  it("fragt den rootSplit ab, nicht den gesamten Workspace", () => {
    let asked: unknown = "nie aufgerufen";
    const workspace = {
      rootSplit: { id: "root" },
      getMostRecentLeaf: (container: unknown) => {
        asked = container;
        return null;
      },
    } as unknown as Workspace;
    activeMarkdownView(workspace);
    expect(asked).toEqual({ id: "root" });
  });
});

describe("readScope", () => {
  it("liest die ganze Notiz im file-Modus", () => {
    const range = readScope(fakeEditor(["eins", "zwei"]), "file");
    expect(range?.text).toBe("eins\nzwei");
    expect(range?.from).toEqual({ line: 0, ch: 0 });
    expect(range?.to).toEqual({ line: 1, ch: 4 });
  });

  it("gibt null zurueck, wenn im selection-Modus nichts markiert ist", () => {
    expect(readScope(fakeEditor(["eins"]), "selection")).toBeNull();
  });

  it("liest die Auswahl im selection-Modus", () => {
    expect(readScope(fakeEditor(["eins zwei"], "eins"), "selection")?.text).toBe("eins");
  });
});

describe("writeScope", () => {
  it("schreibt ueber replaceRange, damit Cmd+Z in einem Schritt zurueckgeht", () => {
    const calls: unknown[][] = [];
    const editor = {
      replaceRange: (...args: unknown[]) => calls.push(args),
    } as unknown as Editor;
    writeScope(editor, { text: "alt", from: { line: 0, ch: 0 }, to: { line: 0, ch: 3 } }, "neu");
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("neu");
  });
});
