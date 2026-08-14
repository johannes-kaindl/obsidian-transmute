import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { TFile } from "./__mocks__/obsidian";
import {
  finalizeSnapshot, restoreSnapshot, rotateSnapshots, snapshotRoot, writeSnapshot,
} from "../src/obsidian/snapshot-io";
import { hashText } from "../src/core/vault/snapshot";
import type { RuleDraft } from "../src/core/types";

const RULE: RuleDraft = { regex: "alt", flags: "g", replacement: "neu", explanation: "" };

function fakeApp(vaultFiles: Record<string, string> = {}) {
  const disk: Record<string, string> = {};
  const dirs = new Set<string>();
  const app = {
    vault: {
      configDir: ".obsidian",
      adapter: {
        exists: (p: string) => Promise.resolve(p in disk || dirs.has(p)),
        mkdir: (p: string) => { dirs.add(p); return Promise.resolve(); },
        write: (p: string, data: string) => { disk[p] = data; return Promise.resolve(); },
        read: (p: string) => (p in disk ? Promise.resolve(disk[p]) : Promise.reject(new Error("weg"))),
        list: (p: string) => Promise.resolve({
          folders: [...dirs].filter((d) => d.startsWith(`${p}/`) && !d.slice(p.length + 1).includes("/")),
          files: [],
        }),
        rmdir: (p: string) => {
          dirs.delete(p);
          for (const k of Object.keys(disk)) if (k.startsWith(`${p}/`)) delete disk[k];
          return Promise.resolve();
        },
      },
      getFileByPath: (p: string) => (p in vaultFiles ? new TFile(p, "md") : null),
      cachedRead: (f: { path: string }) => Promise.resolve(vaultFiles[f.path]),
      process: (f: { path: string }, fn: (d: string) => string) => {
        vaultFiles[f.path] = fn(vaultFiles[f.path]);
        return Promise.resolve(vaultFiles[f.path]);
      },
    },
  } as unknown as App;
  return { app, disk, dirs, vaultFiles };
}

describe("snapshotRoot", () => {
  it("haengt am configDir, nicht an einem geratenen Pfad", () => {
    const { app } = fakeApp();
    expect(snapshotRoot(app)).toBe(".obsidian/plugins/transmute/snapshots");
  });
});

describe("writeSnapshot", () => {
  it("legt je Datei eine Kopie und ein Manifest ohne Hashes an", async () => {
    const { app, disk } = fakeApp();
    const dir = await writeSnapshot(app, "2026-08-14T17:02:11.000Z", RULE, ["a.md"],
      () => Promise.resolve("alt und alt"));
    expect(dir).toBe("2026-08-14T17-02-11");
    const root = `${snapshotRoot(app)}/${dir}`;
    expect(disk[`${root}/files/a.md`]).toBe("alt und alt");
    const manifest = JSON.parse(disk[`${root}/manifest.json`]);
    expect(manifest.files).toEqual([{ path: "a.md", hits: 0, afterHash: null }]);
  });

  it("bricht ab, wenn eine Datei nicht gesichert werden kann", async () => {
    const { app } = fakeApp();
    await expect(
      writeSnapshot(app, "2026-08-14T17:02:11.000Z", RULE, ["a.md"], () => Promise.resolve(null)),
    ).rejects.toThrow(/a\.md/);
  });
});

describe("finalizeSnapshot", () => {
  it("traegt die Hashes nach", async () => {
    const { app, disk } = fakeApp();
    const dir = await writeSnapshot(app, "2026-08-14T17:02:11.000Z", RULE, ["a.md"],
      () => Promise.resolve("alt"));
    await finalizeSnapshot(app, dir, [{ path: "a.md", hits: 1, afterHash: hashText("neu") }]);
    const manifest = JSON.parse(disk[`${snapshotRoot(app)}/${dir}/manifest.json`]);
    expect(manifest.files[0].afterHash).toBe(hashText("neu"));
  });
});

describe("rotateSnapshots", () => {
  it("entfernt die aeltesten Ordner ueber der Grenze", async () => {
    const { app, dirs } = fakeApp();
    const root = snapshotRoot(app);
    dirs.add(root);
    for (const name of ["2026-08-10T09-00-00", "2026-08-12T08-00-00", "2026-08-14T17-02-11"]) {
      dirs.add(`${root}/${name}`);
    }
    await rotateSnapshots(app, 2);
    expect([...dirs]).not.toContain(`${root}/2026-08-10T09-00-00`);
    expect([...dirs]).toContain(`${root}/2026-08-14T17-02-11`);
  });
});

describe("restoreSnapshot", () => {
  const vorbereiten = async (aktuell: string) => {
    const ctx = fakeApp({ "a.md": aktuell });
    const dir = await writeSnapshot(ctx.app, "2026-08-14T17:02:11.000Z", RULE, ["a.md"],
      () => Promise.resolve("alt"));
    await finalizeSnapshot(ctx.app, dir, [{ path: "a.md", hits: 1, afterHash: hashText("neu") }]);
    return { ...ctx, dir };
  };

  it("stellt her, was seither unveraendert blieb", async () => {
    const { app, dir, vaultFiles } = await vorbereiten("neu");
    const got = await restoreSnapshot(app, dir, false);
    expect(got.restored).toBe(1);
    expect(vaultFiles["a.md"]).toBe("alt");
  });

  it("laesst eine seither bearbeitete Datei in Ruhe", async () => {
    const { app, dir, vaultFiles } = await vorbereiten("neu, aber von Hand ergaenzt");
    const got = await restoreSnapshot(app, dir, false);
    expect(got.changed).toEqual(["a.md"]);
    expect(vaultFiles["a.md"]).toBe("neu, aber von Hand ergaenzt");
  });

  it("stellt eine bearbeitete Datei her, wenn es ausdruecklich verlangt wird", async () => {
    const { app, dir, vaultFiles } = await vorbereiten("neu, aber von Hand ergaenzt");
    const got = await restoreSnapshot(app, dir, true);
    expect(got.restored).toBe(1);
    expect(vaultFiles["a.md"]).toBe("alt");
  });

  it("meldet eine verschwundene Datei, statt sie neu anzulegen", async () => {
    const { app } = fakeApp({});
    const dir = await writeSnapshot(app, "2026-08-14T17:02:11.000Z", RULE, ["a.md"],
      () => Promise.resolve("alt"));
    await finalizeSnapshot(app, dir, [{ path: "a.md", hits: 1, afterHash: hashText("neu") }]);
    const got = await restoreSnapshot(app, dir, false);
    expect(got.gone).toEqual(["a.md"]);
  });
});
