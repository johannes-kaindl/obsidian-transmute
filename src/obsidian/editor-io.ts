import type { Editor, EditorPosition } from "obsidian";
import type { ScopeKind } from "../core/settings";

export type ScopeRange = { text: string; from: EditorPosition; to: EditorPosition };

export function readScope(editor: Editor, scope: ScopeKind): ScopeRange | null {
  if (scope === "selection") {
    const text = editor.getSelection();
    if (text.length === 0) return null;
    return { text, from: editor.getCursor("from"), to: editor.getCursor("to") };
  }
  const lastLine = editor.lastLine();
  return {
    text: editor.getValue(),
    from: { line: 0, ch: 0 },
    to: { line: lastLine, ch: editor.getLine(lastLine).length },
  };
}

/**
 * Schreibt ueber replaceRange, NICHT ueber Vault.modify — nur so landet die Aenderung in
 * Obsidians Undo-Stack und Cmd+Z macht sie in EINEM Schritt rueckgaengig. Genau deshalb
 * braucht v0.1 kein eigenes Snapshot-System.
 */
export function writeScope(editor: Editor, range: ScopeRange, text: string): void {
  editor.replaceRange(text, range.from, range.to);
}
