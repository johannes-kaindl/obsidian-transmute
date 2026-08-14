import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile } from "./__mocks__/obsidian";
import { listCandidates, makeReader, writeSelected } from "../src/obsidian/vault-io";
import { EMPTY_FILTER } from "../src/core/vault/scope";
import type { FileHits } from "../src/core/vault/run";
import type { Hit, RuleDraft } from "../src/core/types";

const RULE: RuleDraft = { regex: "alt", flags: "g", replacement: "neu", explanation: "" };
const EVAL = { budgetMs: 2000, now: () => 0, maxHits: 500 };

const hit = (start: number, end: number): Hit => ({
  line: 0, lineStart: 0, start, end, matched: "alt", replacement: "neu",
  before: "alt", after: "neu",
});

function fakeApp(files: Record<string, string>, meta: Record<string, unknown> = {}): App {
  const store = { ...files };
  return {
    vault: {
      getMarkdownFiles: () => Object.keys(store).map((path) => new TFile(path, "md")),
      getFileByPath: (path: string) => (path in store ? new TFile(path, "md") : null),
      cachedRead: (file: { path: string }) => Promise.resolve(store[file.path]),
      process: (file: { path: string }, fn: (data: string) => string) => {
        const next = fn(store[file.path]);
        store[file.path] = next;
        return Promise.resolve(next);
      },
    },
    metadataCache: {
      getFileCache: (file: { path: string }) => meta[file.path] ?? {},
    },
    __store: store,
  } as unknown as App;
}

const storeOf = (app: App): Record<string, string> =>
  (app as unknown as { __store: Record<string, string> }).__store;

describe("listCandidates", () => {
  it("liefert alle Markdown-Notizen ohne Filter", () => {
    const app = fakeApp({ "a.md": "x", "b/c.md": "y" });
    expect(listCandidates(app, EMPTY_FILTER)).toEqual(["a.md", "b/c.md"]);
  });

  it("liest Tags aus Frontmatter und Body zusammen", () => {
    const app = fakeApp(
      { "a.md": "x", "b.md": "y" },
      {
        "a.md": { frontmatter: { tags: ["projekt"] } },
        "b.md": { tags: [{ tag: "#anderes" }] },
      },
    );
    expect(listCandidates(app, { ...EMPTY_FILTER, tag: "#projekt" })).toEqual(["a.md"]);
  });

  it("filtert ueber ein Frontmatter-Feld", () => {
    const app = fakeApp({ "a.md": "x", "b.md": "y" }, { "a.md": { frontmatter: { status: "aktiv" } } });
    const got = listCandidates(app, { ...EMPTY_FILTER, field: { key: "status", value: "aktiv" } });
    expect(got).toEqual(["a.md"]);
  });
});

describe("makeReader", () => {
  it("liest den Inhalt", async () => {
    const read = makeReader(fakeApp({ "a.md": "hallo" }));
    await expect(read("a.md")).resolves.toBe("hallo");
  });

  it("gibt null zurueck, wenn die Notiz verschwunden ist", async () => {
    const read = makeReader(fakeApp({}));
    await expect(read("weg.md")).resolves.toBeNull();
  });
});

describe("writeSelected", () => {
  const fileHits = (path: string, selected: boolean[]): FileHits => ({
    path, hits: [hit(0, 3), hit(8, 11)].slice(0, selected.length), selected,
    timedOutAtLine: null, complete: true,
  });

  it("schreibt genau die angehakten Treffer", async () => {
    const app = fakeApp({ "a.md": "alt und alt" });
    const out = await writeSelected(app, [fileHits("a.md", [true, false])], RULE, false, EVAL);
    expect(out.written).toBe(1);
    expect(out.hits).toBe(1);
    expect(storeOf(app)["a.md"]).toBe("neu und alt");
  });

  it("ueberspringt eine Datei, die sich seit der Vorschau geaendert hat", async () => {
    const app = fakeApp({ "a.md": "voellig anderer text" });
    const out = await writeSelected(app, [fileHits("a.md", [true, true])], RULE, false, EVAL);
    expect(out.skippedChanged).toEqual(["a.md"]);
    expect(out.written).toBe(0);
    expect(storeOf(app)["a.md"]).toBe("voellig anderer text");
  });

  it("legt je geschriebener Datei einen Snapshot-Eintrag mit Hash an", async () => {
    const app = fakeApp({ "a.md": "alt und alt" });
    const out = await writeSelected(app, [fileHits("a.md", [true, true])], RULE, false, EVAL);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]).toMatchObject({ path: "a.md", hits: 2 });
    expect(out.entries[0].afterHash).toMatch(/^[0-9a-f]+-[0-9a-f]+$/);
  });

  it("laesst Dateien ohne Auswahl unangetastet", async () => {
    const app = fakeApp({ "a.md": "alt und alt" });
    const out = await writeSelected(app, [fileHits("a.md", [false, false])], RULE, false, EVAL);
    expect(out.written).toBe(0);
    expect(out.entries).toHaveLength(0);
  });

  it("haelt beim ersten Schreibfehler an und nennt die Stelle", async () => {
    const app = fakeApp({ "a.md": "alt", "b.md": "alt" });
    const vault = (app as unknown as { vault: { process: unknown } }).vault;
    vault.process = vi.fn(() => Promise.reject(new Error("Platte voll")));
    const out = await writeSelected(
      app, [fileHits("a.md", [true]), fileHits("b.md", [true])], RULE, false, EVAL,
    );
    expect(out.failedAt).toEqual({ path: "a.md", message: "Platte voll" });
    expect(out.written).toBe(0);
  });

  it("meldet Fortschritt je Datei", async () => {
    const app = fakeApp({ "a.md": "alt" });
    const onProgress = vi.fn();
    await writeSelected(app, [fileHits("a.md", [true])], RULE, false, EVAL, onProgress);
    expect(onProgress).toHaveBeenCalledWith(1, 1, "a.md");
  });
});
