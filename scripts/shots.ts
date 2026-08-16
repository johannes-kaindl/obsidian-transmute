/**
 * Aufnahme der README-Bilder gegen ein **laufendes** Obsidian.
 *
 * Der Vertrag — was jedes Bild zeigen muss — steht in `docs/images/README.md`; der
 * Bild-Standard (Klassen, Breiten, Budgets) zentral in `_docs/readme/readme-spec.json`.
 * Dieses Skript ist nur das Rezept: wie der Zustand entsteht, den der Vertrag verlangt.
 *
 * **Ohne Modell.** Alle Bilder laufen ueber den Handpfad („or write the pattern
 * yourself"). Ein Aufnahmelauf, der an einem LLM haengt, ist nicht reproduzierbar — und
 * die Bilder sollen das Werkzeug zeigen, nicht die Tagesform eines Modells.
 *
 * ## Ablauf
 *
 * ```bash
 * export STAGING_VAULTS_DIR="$HOME/StagingVaults"
 * npm run build
 * npm run shots -- --setup        # Vault bauen, danach Obsidian NEU STARTEN
 * npm run shots -- --only preview
 * ```
 *
 * Ein Bild pro Obsidian-Start ist der sichere Weg: jeder Lauf hinterlaesst Zustand.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { attachTo, closeExtraLeaves, openExisting, pollUntil, setAppConfig, type Cdp } from "./lib/cdp.js";
import { boxAround, boxOf, capture, setWindowSize, writeShot } from "./lib/shot.js";
import { buildVault, stagingVaultDir } from "./lib/vault.js";

const PLUGIN_ID = "transmute";
const VIEW_TYPE = "transmute-panel";
// Das Bundle landet im Repo-Root (.shots.mjs), nicht in scripts/ — ein relativer Pfad
// ueber import.meta.url zeigt deshalb eine Ebene zu hoch. npm-Scripts laufen ohnehin im
// Repo-Root, also ist cwd hier die ehrlichere Quelle.
const REPO_ROOT = process.cwd();
const FIXTURE = join(REPO_ROOT, "docs/images/fixture");
const OUT_DIR = join(REPO_ROOT, "docs/images");
const CAPTURE_WIDTH = 1200;
const THUMB_WIDTH = 380;

/** Die Beispiel-Regel: deutsche Datumsangaben in ISO-Form. Zeigt Gruppen, ist in einem
 *  Satz erklaert und trifft in mehreren Notizen — genau das, was die Bilder brauchen. */
const REGEX = "(\\d{2})\\.(\\d{2})\\.(\\d{4})";
const REPLACEMENT = "$3-$2-$1";
const HERO_NOTE = "Projects/Acme Consulting.md";

const args = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const PORT = Number(argOf("port") ?? "9222");
const ONLY = argOf("only");
const VAULT_NAME = "transmute-shots";

// --- Helfer ------------------------------------------------------------------

async function click(cdp: Cdp, selector: string, index = 0): Promise<boolean> {
  return cdp.evaluate<boolean>(`
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .filter((e) => e.getBoundingClientRect().width > 1);
    const el = els[${index}];
    if (!el) return false;
    el.click();
    await new Promise((r) => setTimeout(r, 350));
    return true;
  `);
}

async function fill(cdp: Cdp, selector: string, value: string): Promise<boolean> {
  return cdp.evaluate<boolean>(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    return true;
  `);
}

/** Panel oeffnen und breit genug machen, dass Vorher/Nachher nebeneinander lesbar sind.
 *  Die Sidebar-Breite ist Fensterzustand, kein Plugin-Zustand — sie wird hier gesetzt,
 *  weil ein zu schmales Panel jedes Bild unlesbar macht. */
async function panelOeffnen(cdp: Cdp, breite = 460): Promise<void> {
  await cdp.evaluate(`
    app.commands.executeCommandById("${PLUGIN_ID}:open-panel");
    await new Promise((r) => setTimeout(r, 900));
    const split = app.workspace.rightSplit;
    if (split && typeof split.setSize === "function") split.setSize(${breite});
    await new Promise((r) => setTimeout(r, 400));
    return true;
  `);
}

/** Regel ueber den Handpfad setzen und auf Treffer warten. */
async function regelSetzen(cdp: Cdp, regex = REGEX, replacement = REPLACEMENT): Promise<boolean> {
  if (!(await click(cdp, ".transmute-manual-link"))) return false;
  await fill(cdp, ".transmute-regex", regex);
  await fill(cdp, ".transmute-replacement-input", replacement);
  const treffer = await pollUntil<number>(
    cdp,
    `return document.querySelectorAll(".transmute-hit, .transmute-file-row").length || null;`,
    15_000,
    400,
  );
  return (treffer ?? 0) > 0;
}

/** Ausschnitt um das Panel — mit etwas Luft, damit es nicht angeschnitten wirkt. */
async function panelBox(cdp: Cdp): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return boxOf(cdp, `.workspace-leaf-content[data-type="${VIEW_TYPE}"]`, 8);
}

async function schreibe(cdp: Cdp, name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
  const png = await capture(cdp, clip);
  const hinweis = await writeShot(cdp, name, png, {
    outDir: OUT_DIR,
    captureWidth: CAPTURE_WIDTH,
    thumbWidth: THUMB_WIDTH,
  });
  console.log(`  ${hinweis}`);
}

// --- Bilder ------------------------------------------------------------------

/** Hero: Panel neben der offenen Notiz, mit fertiger Vorschau. Der ganze Fensterinhalt —
 *  die Aussage ist gerade das Nebeneinander von Notiz und Vorschau. */
async function shotPreview(cdp: Cdp): Promise<void> {
  await closeExtraLeaves(cdp);
  await openExisting(cdp, HERO_NOTE, "source");
  await panelOeffnen(cdp);
  if (!(await regelSetzen(cdp))) throw new Error("preview: keine Treffer — Handpfad hat nicht gegriffen");
  await schreibe(cdp, "preview.png");
}

/** Vault-Scope: Umfangs-Block mit Filtern und die zweistufige Liste, eine Datei offen. */
async function shotVaultScope(cdp: Cdp): Promise<void> {
  await closeExtraLeaves(cdp);
  await openExisting(cdp, HERO_NOTE, "source");
  await panelOeffnen(cdp, 520);
  if (!(await regelSetzen(cdp))) throw new Error("vault-scope: keine Treffer im Datei-Bereich");

  // Auf den ganzen Vault umstellen (dritter Bereichs-Knopf) und auf Projects filtern.
  await click(cdp, ".transmute-scope-btn", 2);
  await fill(cdp, ".transmute-folder", "Projects");
  await click(cdp, ".transmute-compute");
  const zeilen = await pollUntil<number>(
    cdp,
    `return document.querySelectorAll(".transmute-file-row").length || null;`,
    20_000,
    400,
  );
  if (!zeilen) throw new Error("vault-scope: keine Dateiliste");

  // Die MITTLERE Datei aufklappen: darueber und darunter bleibt je eine zugeklappte
  // Zeile stehen, und beide Ebenen der Auswahl sind auf engem Raum zu sehen. Die erste
  // aufzuklappen schiebt die uebrigen Zeilen aus dem Ausschnitt, die letzte macht das
  // Bild zu hoch fuer die Klasse.
  await click(cdp, ".transmute-file-name", Math.min(1, zeilen - 1));

  // Ausschnitt vom Umfangs-Block bis zur Liste. Der obere Panel-Teil (Modellwahl,
  // Anweisungsfeld, Vorschau-Knopf) steht schon im Hero; hier wuerde er das Bild nur
  // ueber das Seitenverhaeltnis der Klasse `feature` (1.6) heben.
  const box = await boxAround(cdp, [".transmute-scope-block", ".transmute-file-list"], 8);
  // Auf das Seitenverhaeltnis der Klasse `feature` (1.6) deckeln. Unten mitten in der
  // Liste zu enden ist kein Mangel — eine Liste, die weitergeht, sieht auch so aus.
  if (box && box.height > box.width * 1.55) box.height = Math.round(box.width * 1.55);
  await schreibe(cdp, "vault-scope.png", box ?? (await panelBox(cdp)) ?? undefined);
}

/** Regel-Editor mit aufgeklapptem Spickzettel. */
async function shotRuleEditor(cdp: Cdp): Promise<void> {
  await closeExtraLeaves(cdp);
  await openExisting(cdp, HERO_NOTE, "source");
  await panelOeffnen(cdp, 520);
  // Voraussetzung selbst herstellen: ein vorangegangener Lauf kann den Bereich auf
  // „Whole vault" gelassen haben, und dieses Bild handelt vom Regel-Formular.
  await click(cdp, ".transmute-scope-btn", 0);
  if (!(await regelSetzen(cdp))) throw new Error("rule-editor: keine Treffer");
  await cdp.evaluate(`
    const sheet = document.querySelector(".transmute-cheatsheet");
    if (sheet) sheet.open = true;
    await new Promise((r) => setTimeout(r, 400));
    return true;
  `);
  // Nur das Formular und der Spickzettel — das ist die Aussage. Der Rest des Panels
  // steht im Hero.
  const box = await boxAround(cdp, [".transmute-regex-row", ".transmute-cheatsheet"], 8);
  if (box && box.height > box.width * 1.55) box.height = Math.round(box.width * 1.55);
  await schreibe(cdp, "rule-editor.png", box ?? (await panelBox(cdp)) ?? undefined);
}

/** Einstellungen. In Obsidian 1.13 ein EIGENES Fenster — deshalb ueber `attachTo`
 *  gewaehlt und nicht ueber den Titel: beide Fenster tragen denselben Vault-Namen. */
async function shotSettings(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    app.setting.open();
    await new Promise((r) => setTimeout(r, 700));
    const tab = (app.setting.pluginTabs ?? []).find((t) => t.id === ${JSON.stringify(PLUGIN_ID)});
    if (tab) app.setting.openTab(tab);
    await new Promise((r) => setTimeout(r, 900));
    return true;
  `);

  const fenster = await attachTo("settings", PORT, VAULT_NAME);
  const ziel = fenster ?? cdp;
  const box = await boxOf(ziel, ".vertical-tab-content", 0);
  const png = await capture(ziel, box ?? undefined);
  const hinweis = await writeShot(ziel, "settings.png", png, {
    outDir: OUT_DIR, captureWidth: CAPTURE_WIDTH, thumbWidth: THUMB_WIDTH,
  });
  console.log(`  ${hinweis}`);
  fenster?.close();
  await cdp.evaluate(`app.setting.close(); return true;`);
}

const BILDER: Record<string, (cdp: Cdp) => Promise<void>> = {
  "preview": shotPreview,
  "vault-scope": shotVaultScope,
  "rule-editor": shotRuleEditor,
  "settings": shotSettings,
};

// --- Ablauf ------------------------------------------------------------------

async function main(): Promise<void> {
  if (args.includes("--setup")) {
    const vaultDir = stagingVaultDir(VAULT_NAME);
    for (const zeile of buildVault({ repoRoot: REPO_ROOT, vaultDir, fixtureDir: FIXTURE, pluginId: PLUGIN_ID })) {
      console.log(`  ${zeile}`);
    }
    console.log(`\nVault steht: ${vaultDir}\nObsidian jetzt NEU STARTEN und diesen Vault oeffnen.`);
    return;
  }

  const cdp = await attachTo("workspace", PORT, VAULT_NAME);
  if (!cdp) throw new Error(`Kein Obsidian-Hauptfenster fuer Vault „${VAULT_NAME}" auf Port ${PORT}.`);

  try {
    await cdp.send("Page.bringToFront");
    const { execFileSync } = await import("node:child_process");
    execFileSync("osascript", ["-e", 'tell application "Obsidian" to activate']);
    await new Promise((r) => setTimeout(r, 2000));

    // Aufnahmesprache ist Englisch — README.md ist die kanonische Fassung. Die
    // Einstellung ist APP-weit und wird deshalb geprueft, nicht gesetzt: ein stiller
    // Wechsel wuerde den Arbeits-Vault des Maintainers mitnehmen.
    const sprache = await cdp.evaluate<string>(`return window.localStorage.getItem("language") || "en";`);
    if (!sprache.startsWith("en")) {
      throw new Error(
        `Obsidian steht auf „${sprache}". Die Bilder sind englisch (README.md ist kanonisch).\n`
        + "Sprache in den Einstellungen auf English stellen, Obsidian neu starten, danach zurueckstellen.",
      );
    }

    const aktiv = await cdp.evaluate<boolean>(`return !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];`);
    if (!aktiv) throw new Error(`Plugin „${PLUGIN_ID}" ist in diesem Vault nicht aktiv.`);

    // Hoch genug, dass die Aktionsknoepfe unter der Trefferliste ins Bild passen: ein
    // Hero, der „Anwenden" abschneidet, laesst ausgerechnet die Aussage weg (nichts wird
    // geschrieben, bevor man es gesehen hat). Fuer die Klasse `hero` gilt H/B <= 1.0.
    await setWindowSize(cdp, 1280, 940);
    await setAppConfig(cdp, "showInlineTitle", false);

    const namen = ONLY ? [ONLY] : Object.keys(BILDER);
    for (const name of namen) {
      const fn = BILDER[name];
      if (!fn) throw new Error(`Unbekanntes Bild: ${name}. Bekannt: ${Object.keys(BILDER).join(", ")}`);
      console.log(`\n${name}`);
      await fn(cdp);
    }
  } finally {
    cdp.close();
  }
}

if (!existsSync(FIXTURE)) throw new Error(`Fixture fehlt: ${FIXTURE}`);
await main();
