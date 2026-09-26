/**
 * GUI-Smoke-Treiber — faehrt die Pruefpunkte aus `docs/SMOKE.md` gegen ein **laufendes**
 * Obsidian statt von Hand.
 *
 * Warum getrackt (CORE-TEST-02 b): 0.5.0 schreibt erstmals in Dateien, die in keinem
 * Editor offen sind. Genau dort hilft weder ein Unit-Test (der Vault ist gemockt) noch
 * Obsidians Undo-Stack. Die drei Releases davor haben ihre echten Fehler samt und sonders
 * im GUI-Durchlauf gefunden und keinen einzigen im Gate.
 *
 * Der Treiber kommt **ohne echtes LLM aus**: die Regel wird ueber den Handpfad gesetzt
 * („oder Regex selbst schreiben"). Ein Smoke, der an einem Modell haengt, misst das
 * Modell mit. Einzige Ausnahme: der llm-lab-Pruefpunkt (Abschnitt „llm-lab") — dort geht es
 * genau um die Meldestrecke zum Modell-Aufruf, deshalb ein eigener Stub-Server statt eines
 * echten Modells (Muster koda-agent Punkt 41).
 *
 * ## Voraussetzung
 *
 * ⚠️ **Zuerst pruefen, wer sonst an Obsidian haengt.** Obsidian ist Single-Instance — ein
 * `quit` trifft die Instanz, an der moeglicherweise eine andere Session arbeitet, und zerstoert
 * deren Zustand. Der eigene Lauf ist danach sauber gruen; der Schaden entsteht woanders und
 * faellt nicht auf.
 *
 * ```bash
 * lsof -nP -iTCP:9222 -sTCP:LISTEN >/dev/null && echo "laeuft bereits — NICHT beenden"
 * ```
 *
 * Hoert der Port schon, dann **mitnutzen statt neu starten**: ein eigenes Fenster per
 * `vault-open` ueber IPC oeffnen, dann `attachTo("workspace", port, vault)` — der Vault-Name
 * waehlt, nicht die Reihenfolge. ⚠️ Die Port-Pruefung ersetzt die Frage nicht: sie zeigt aktive
 * CDP-Treiber, aber nicht, wer ein Fenster offen haelt oder auf den Port wartet.
 *
 * Erst wenn nichts laeuft — oder nach Absprache mit dem, der es benutzt — gilt das Rezept unten.
 *
 * ```bash
 * osascript -e 'quit app "Obsidian"'
 * open -a Obsidian --args --remote-debugging-port=9222
 * OBSIDIAN_PLUGIN_DIR="<vault>/.obsidian/plugins/transmute" npm run deploy
 * ```
 *
 * Dann:
 *
 * ```bash
 * npm run smoke:gui -- --vault test-vault
 * npm run smoke:gui -- --port 9222 --keep
 * ```
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { attachTo, Cdp, closeExtraLeaves, notices, pollUntil, releaseAlwaysOnTop, requireVisible, setPluginSetting }
  from "../../tools/obsidian-cdp/cdp.js";
import { requireEigenerBuild } from "../../tools/obsidian-cdp/vault.js";

const PLUGIN_ID = "transmute";
const VIEW_TYPE = "transmute-panel";

/** Ordner, den der Treiber anlegt und wieder entfernt. Eigene Buehne statt fremder
 *  Notizen: sonst haengt jeder Pruefpunkt am Zufall des Vaults. */
const SMOKE_DIR = "_transmute-smoke";
/** So viele Notizen legt der Treiber an. Ueber der Bestaetigungsschwelle, die er
 *  weiter unten auf 3 setzt — der Dialog soll ja erscheinen. */
const SMOKE_NOTES = 8;
const ALT = "alte Schreibweise";
const NEU = "neue Schreibweise";
/** Ab so vielen Kandidaten ist der Abbruch-Pruefpunkt ueberhaupt messbar. Darunter ist
 *  der Lauf durch, bevor der Klick ankommt — dann wird uebersprungen statt geraten. */
const ABORT_MIN_KANDIDATEN = 100;

const args = process.argv.slice(2);
const argOf = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  const value = i >= 0 ? args[i + 1] : undefined;
  return value ?? fallback;
};
const PORT = Number(argOf("port", "9222"));
const VAULT = args.includes("--vault") ? argOf("vault", "") : undefined;
const KEEP = args.includes("--keep");

// --- Pruefpunkte -------------------------------------------------------------

/** Drei Zustaende, nicht zwei — und das ist der ganze Punkt.
 *
 * Bis zum 2026-09-02 schrieb `skipped()` `passed: true`, und die Schlusszeile zaehlte
 * `checks.length - rot.length`. Ein uebersprungener Pruefpunkt erschien damit in der
 * **Bilanz als gruener**: der Lauf an diesem Tag meldete „25/25 gruen", obwohl 23 gemessen
 * und 2 uebersprungen waren — ausgerechnet die zwei, wegen derer der Lauf gefahren wurde.
 * Auch der Exit-Code blieb 0.
 *
 * Das ist dieselbe Gattung wie die Fehler, die dieser Pruefpunkt schon dreimal hatte, nur
 * andersherum: dort wurde *Abwesenheit von Bedarf* als Defekt gemeldet, hier wird
 * *Abwesenheit von Messung* als Erfolg gemeldet. Ein Zaehler, der beides in einen Topf
 * wirft, ist genau dann falsch, wenn man ihn braucht. */
type Zustand = "gruen" | "rot" | "uebersprungen";

interface Check {
  name: string;
  zustand: Zustand;
  detail: string;
}
const checks: Check[] = [];

function record(name: string, passed: boolean, detail: string): void {
  checks.push({ name, zustand: passed ? "gruen" : "rot", detail });
  console.log(`${passed ? "✓" : "✗"} ${name} — ${detail}`);
}

function skipped(name: string, reason: string): void {
  checks.push({ name, zustand: "uebersprungen", detail: `übersprungen: ${reason}` });
  console.log(`· ${name} — übersprungen: ${reason}`);
}

// --- DOM-Helfer --------------------------------------------------------------

/** Textinhalt des ersten Treffers, oder null wenn es das Element nicht gibt.
 *
 * Die Unterscheidung ist load-bearing: ein Vergleich gegen ein NICHT existierendes
 * Element wird sonst gruen — ausgerechnet im Defektfall. */
async function text(cdp: Cdp, selector: string): Promise<string | null> {
  return cdp.evaluate<string | null>(`
    const el = document.querySelector(${JSON.stringify(selector)});
    return el ? el.textContent.trim() : null;
  `);
}

async function count(cdp: Cdp, selector: string): Promise<number> {
  return cdp.evaluate<number>(`return document.querySelectorAll(${JSON.stringify(selector)}).length;`);
}

async function exists(cdp: Cdp, selector: string): Promise<boolean> {
  return (await count(cdp, selector)) > 0;
}

/** Eigenschaft eines Elements lesen (checked, disabled, indeterminate …). */
async function prop<T>(cdp: Cdp, selector: string, name: string): Promise<T | null> {
  return cdp.evaluate<T | null>(`
    const el = document.querySelector(${JSON.stringify(selector)});
    return el ? el[${JSON.stringify(name)}] : null;
  `);
}

async function click(cdp: Cdp, selector: string, index = 0): Promise<boolean> {
  return cdp.evaluate<boolean>(`
    const els = document.querySelectorAll(${JSON.stringify(selector)});
    const el = els[${index}];
    if (!el) return false;
    el.click();
    await new Promise((r) => setTimeout(r, 250));
    return true;
  `);
}

/** Wert in ein Eingabefeld schreiben — mit beiden Ereignissen.
 *
 * Die Regel-Felder haengen an `input`, die Filter-Felder an `change`; wer nur eines
 * feuert, setzt den Wert sichtbar und loest nichts aus. Genau so sieht ein
 * Pruefpunkt aus, der den Prueflings-Zustand misst, ohne ihn erreicht zu haben. */
async function fill(cdp: Cdp, selector: string, value: string): Promise<boolean> {
  return cdp.evaluate<boolean>(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    return true;
  `);
}

/** Knopf ueber seinen sichtbaren Text finden und klicken (fuer Modal-Knoepfe ohne Klasse). */
async function clickByText(cdp: Cdp, root: string, label: string): Promise<boolean> {
  return cdp.evaluate<boolean>(`
    const scope = document.querySelector(${JSON.stringify(root)});
    if (!scope) return false;
    const btn = [...scope.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === ${JSON.stringify(label)});
    if (!btn) return false;
    btn.click();
    await new Promise((r) => setTimeout(r, 300));
    return true;
  `);
}


// --- Szene -------------------------------------------------------------------

/** Notizen anlegen, auf denen gemessen wird. Eigene Buehne, damit der Treiber in
 *  JEDEM Vault laeuft und nichts Fremdes anfasst. */
async function buehneAufbauen(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    const dir = ${JSON.stringify(SMOKE_DIR)};
    if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
    for (let i = 0; i < ${SMOKE_NOTES}; i++) {
      const path = dir + "/notiz-" + i + ".md";
      const body = "---\\nstatus: " + (i % 2 === 0 ? "aktiv" : "ruht") + "\\ntags: [smoke]\\n---\\n\\n"
        + "Hier steht die ${ALT}, und zwar zweimal: ${ALT}.\\n";
      const vorhanden = app.vault.getAbstractFileByPath(path);
      if (vorhanden) await app.vault.modify(vorhanden, body);
      else await app.vault.create(path, body);
    }
    await new Promise((r) => setTimeout(r, 600));
    return true;
  `);
}

async function buehneAbbauen(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    const dir = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_DIR)});
    if (dir) await app.fileManager.trashFile(dir);
    return true;
  `);
}

/** Inhalt einer Smoke-Notiz lesen — der EFFEKT, an dem eine Ersetzung gemessen wird.
 *  Nicht die Trefferanzeige: die hat in 0.2.0 schon einmal etwas anderes behauptet
 *  als das, was geschrieben wurde. */
async function notizText(cdp: Cdp, index: number): Promise<string | null> {
  return cdp.evaluate<string | null>(`
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_DIR)} + "/notiz-${index}.md");
    return f ? await app.vault.read(f) : null;
  `);
}

async function panelOeffnen(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    app.commands.executeCommandById("${PLUGIN_ID}:open-panel");
    await new Promise((r) => setTimeout(r, 800));
    return true;
  `);
}

/** Den Bereich umschalten. Die Knoepfe tragen alle dieselbe Klasse — unterschieden
 *  wird ueber den sichtbaren Text, damit der Punkt nicht an der Reihenfolge haengt. */
async function bereichWaehlen(cdp: Cdp, label: string): Promise<boolean> {
  return cdp.evaluate<boolean>(`
    const btn = [...document.querySelectorAll(".transmute-scope-btn")]
      .find((b) => b.textContent.trim() === ${JSON.stringify(label)});
    if (!btn) return false;
    btn.click();
    await new Promise((r) => setTimeout(r, 600));
    return true;
  `);
}

// --- Abschnitt: Umfang -------------------------------------------------------

/** Der Bereich wird ueber die Position gewaehlt, nicht ueber den Text: die Beschriftung
 *  ist sprachabhaengig, die Reihenfolge (Notiz · Auswahl · Vault) steht im Code fest.
 *  Geprueft wird danach der EFFEKT — der Umfangs-Block erscheint. */
async function abschnittUmfang(cdp: Cdp): Promise<void> {
  await click(cdp, ".transmute-scope-btn", 2);

  const block = await exists(cdp, ".transmute-scope-block");
  record("Bereich Vault zeigt den Umfangs-Block", block, block ? "sichtbar" : "fehlt");
  if (!block) return;

  const alle = await text(cdp, ".transmute-candidates");
  const zahlen = (alle ?? "").match(/\d+/g) ?? [];
  const gesamt = Number(zahlen[1] ?? 0);
  record(
    "Kandidatenzahl nennt Treffer und Gesamtzahl",
    zahlen.length >= 2 && gesamt >= SMOKE_NOTES,
    `„${alle ?? "(nichts)"}"`,
  );

  // Ordner-Filter: die Zahl muss SINKEN. Ein Filter, der nichts aendert, sieht in der
  // Oberflaeche genauso aus wie einer, der wirkt.
  await fill(cdp, ".transmute-folder", SMOKE_DIR);
  const gefiltert = await text(cdp, ".transmute-candidates");
  const nachher = Number((gefiltert ?? "").match(/\d+/)?.[0] ?? -1);
  record(
    "Ordner-Filter grenzt ein",
    nachher === SMOKE_NOTES,
    `${nachher} von ${gesamt} (erwartet ${SMOKE_NOTES})`,
  );

  // Leerer Umfang ist ein EIGENER Fall, nicht „null Treffer".
  await fill(cdp, ".transmute-tag", "#gibtsnicht");
  const leerText = await text(cdp, ".transmute-candidates");
  const gesperrt = await prop<boolean>(cdp, ".transmute-compute", "disabled");
  record(
    "Leerer Umfang meldet sich als solcher",
    (leerText ?? "").length > 0 && !/^\d/.test(leerText ?? ""),
    `„${leerText ?? "(nichts)"}"`,
  );
  record("Vorschau-Knopf ist bei leerem Umfang gesperrt", gesperrt === true, `disabled=${gesperrt}`);

  await fill(cdp, ".transmute-tag", "");
}

// --- Abschnitt: Vorschau -----------------------------------------------------

async function abschnittVorschau(cdp: Cdp): Promise<boolean> {
  // Handpfad statt Modell: ein Smoke, der ein LLM braucht, misst das LLM mit.
  const manual = await click(cdp, ".transmute-manual-link");
  if (!manual) {
    record("Handpfad ohne Modell erreichbar", false, "Knopf „oder Regex selbst schreiben“ nicht gefunden");
    return false;
  }
  await fill(cdp, ".transmute-regex", ALT);
  await fill(cdp, ".transmute-replacement-input", NEU);
  await cdp.evaluate("await new Promise((r) => setTimeout(r, 700)); return true;");

  const berechnet = await click(cdp, ".transmute-compute");
  if (!berechnet) {
    record("Vorschau berechnen ist erreichbar", false, "Knopf fehlt");
    return false;
  }

  const zeilen = await pollUntil<number>(
    cdp,
    `return document.querySelectorAll(".transmute-file-row").length || null;`,
    30_000,
    500,
  );
  record("Vorschau listet betroffene Dateien", (zeilen ?? 0) === SMOKE_NOTES, `${zeilen ?? 0} Zeilen`);
  if (!zeilen) return false;

  // Eingeklappt starten ist kein Schoenheitswunsch: sonst sind 340 Dateien 1.204
  // DOM-Zeilen.
  const treffer = await count(cdp, ".transmute-hit-row");
  record("Dateien starten eingeklappt", treffer === 0, `${treffer} sichtbare Treffer`);

  const kopf = await text(cdp, ".transmute-affected");
  record(
    "Zusammenfassung nennt Dateien und Treffer",
    /\d+.*\d+/.test(kopf ?? ""),
    `„${kopf ?? "(nichts)"}"`,
  );

  // Aufklappen → Treffer sichtbar
  await click(cdp, ".transmute-file-name");
  const auf = await count(cdp, ".transmute-hit-row");
  record("Aufklappen zeigt die Treffer der Datei", auf === 2, `${auf} Treffer (erwartet 2)`);

  // Einen Treffer abwaehlen → der Dateihaken wird zum Teil-Zustand. Der Haken ist
  // ABGELEITET; genau hier wuerde eine zweite Auswahlebene auseinanderlaufen.
  await click(cdp, ".transmute-hit-check", 0);
  const teil = await prop<boolean>(cdp, ".transmute-file-check", "indeterminate");
  record("Teilweise gewaehlte Datei zeigt den Teil-Zustand", teil === true, `indeterminate=${teil}`);

  // Wieder anwaehlen, damit der Anwenden-Abschnitt auf vollen Dateien misst.
  await click(cdp, ".transmute-hit-check", 0);
  return true;
}

// --- Abschnitt: Anwenden -----------------------------------------------------

async function abschnittAnwenden(cdp: Cdp): Promise<boolean> {
  const vorher = await notizText(cdp, 0);
  const trefferVorher = (vorher ?? "").split(ALT).length - 1;

  await clickByText(cdp, ".transmute-actions", (await panelSprache(cdp)) === "de" ? "Anwenden" : "Apply");

  // Bestaetigungsschwelle steht auf 3 → der Dialog MUSS kommen.
  const dialog = await pollUntil<boolean>(
    cdp,
    `return document.querySelector(".modal-container") ? true : null;`,
    5_000,
    250,
  );
  record("Bestaetigungsdialog erscheint ueber der Schwelle", dialog === true, `Dialog=${dialog === true}`);
  if (dialog) await click(cdp, ".modal-container button.mod-cta");

  const geschrieben = await pollUntil<string>(
    cdp,
    `const el = document.querySelector(".transmute-applied"); return el ? el.textContent.trim() : null;`,
    30_000,
    500,
  );
  record("Anwendung meldet ihr Ergebnis", (geschrieben ?? "").length > 0, `„${geschrieben ?? "(nichts)"}"`);

  // Der EFFEKT, nicht die Meldung: steht der neue Text wirklich in der Datei?
  const nachher = await notizText(cdp, 0);
  const trefferNachher = (nachher ?? "").split(ALT).length - 1;
  record(
    "Die Ersetzung steht wirklich in der Datei",
    trefferVorher === 2 && trefferNachher === 0 && (nachher ?? "").includes(NEU),
    `„${ALT}" ${trefferVorher}→${trefferNachher}, „${NEU}" ${(nachher ?? "").includes(NEU)}`,
  );

  const snapshot = await cdp.evaluate<number>(`
    const root = app.vault.configDir + "/plugins/${PLUGIN_ID}/snapshots";
    if (!(await app.vault.adapter.exists(root))) return 0;
    const list = await app.vault.adapter.list(root);
    return list.folders.length;
  `);
  record("Snapshot liegt auf der Platte", snapshot > 0, `${snapshot} Snapshot-Ordner`);

  const undo = await exists(cdp, ".transmute-undo");
  record("Rueckgaengig-Knopf steht bereit", undo, undo ? "vorhanden" : "fehlt");
  return undo;
}

// --- Abschnitt: Rueckgaengig -------------------------------------------------

async function abschnittRueckgaengig(cdp: Cdp): Promise<void> {
  // Eine Datei NACH der Ersetzung von Hand aendern. Sie darf beim Zurueckholen nicht
  // ueberschrieben werden — das ist der Unterschied zwischen einem Undo und einem
  // stillen Verlust fremder Arbeit.
  await cdp.evaluate(`
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_DIR)} + "/notiz-1.md");
    await app.vault.modify(f, (await app.vault.read(f)) + "\\nvon Hand ergaenzt\\n");
    await new Promise((r) => setTimeout(r, 300));
    return true;
  `);

  await click(cdp, ".transmute-undo");
  await cdp.evaluate("await new Promise((r) => setTimeout(r, 1200)); return true;");

  const wieder = await notizText(cdp, 0);
  record(
    "Unveraenderte Datei wird wiederhergestellt",
    (wieder ?? "").includes(ALT) && !(wieder ?? "").includes(NEU),
    `enthaelt „${ALT}": ${(wieder ?? "").includes(ALT)}`,
  );

  const beruehrt = await notizText(cdp, 1);
  record(
    "Seither bearbeitete Datei bleibt unangetastet",
    (beruehrt ?? "").includes("von Hand ergaenzt"),
    (beruehrt ?? "").includes("von Hand ergaenzt") ? "Zusatz noch da" : "Zusatz weg — ueberschrieben",
  );

  const meldung = await notices(cdp);
  record(
    "Uebersprungene Datei wird benannt",
    /\b1\b/.test(meldung),
    `Notices: „${meldung.slice(0, 120)}"`,
  );
}

// --- Abschnitt: Datei-Anwenden (Geltungsbereich "Notiz") ---------------------

/** Die Notiz im Hauptbereich oeffnen — nicht in der Sidebar, wo das Panel selbst haengt.
 *  `activeMarkdownView` (editor-io.ts) sucht ueber `rootSplit` genau dort. */
async function dateiOeffnen(cdp: Cdp, pfad: string): Promise<void> {
  await cdp.evaluate(`
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(pfad)});
    if (!f) throw new Error("Smoke-Notiz fehlt: ${pfad}");
    await app.workspace.getLeaf(false).openFile(f);
    await new Promise((r) => setTimeout(r, 500));
    return true;
  `);
}

/** Live-Inhalt der offenen Notiz — der Editor-Puffer, nicht die Platte: ein Speichern
 *  laeuft debounced, der Puffer aendert sich sofort mit `applyHitsToEditor`. */
async function dateiPufferInhalt(cdp: Cdp, pfad: string): Promise<string | null> {
  return cdp.evaluate<string | null>(`
    const leaf = app.workspace.getLeavesOfType("markdown")
      .find((l) => l.view.file?.path === ${JSON.stringify(pfad)});
    return leaf ? leaf.view.editor.getValue() : null;
  `);
}

/**
 * Regression (Johannes' Quicktasks 2026-09-16): „Anwenden" leerte im Geltungsbereich
 * Notiz die ganze Runde — ein zweites Anwenden mit kleiner Korrektur brauchte deshalb
 * jedes Mal eine neue Anfrage von vorn. Gemessen wird hier genau der Fall „zweimal
 * Anwenden mit Aenderung dazwischen", dazu der neue „Zuruecksetzen"-Knopf.
 */
async function abschnittDateiAnwenden(cdp: Cdp): Promise<void> {
  const pfad = `${SMOKE_DIR}/notiz-datei-anwenden.md`;
  await cdp.evaluate(`
    const p = ${JSON.stringify(pfad)};
    const body = "Zeile mit ${ALT} und ${ALT}.\\n";
    const vorhanden = app.vault.getAbstractFileByPath(p);
    if (vorhanden) await app.vault.modify(vorhanden, body);
    else await app.vault.create(p, body);
    return true;
  `);
  await dateiOeffnen(cdp, pfad);

  // Bereich "Notiz" ist Position 0 — sprachunabhaengig, s. abschnittUmfang.
  await click(cdp, ".transmute-scope-btn", 0);

  const manual = await click(cdp, ".transmute-manual-link");
  if (!manual) {
    record("Datei-Anwenden: Handpfad erreichbar", false, "Knopf „oder Regex selbst schreiben“ nicht gefunden");
    return;
  }
  await fill(cdp, ".transmute-regex", ALT);
  await fill(cdp, ".transmute-replacement-input", NEU);
  await cdp.evaluate("await new Promise((r) => setTimeout(r, 700)); return true;");

  const sprache = await panelSprache(cdp);
  const labelAnwenden = sprache === "de" ? "Anwenden" : "Apply";
  const labelReset = sprache === "de" ? "Zurücksetzen" : "Reset";

  await clickByText(cdp, ".transmute-actions", labelAnwenden);
  await cdp.evaluate("await new Promise((r) => setTimeout(r, 400)); return true;");

  const nachErstem = await dateiPufferInhalt(cdp, pfad);
  record(
    "Erstes Anwenden ersetzt beide Treffer in der Notiz",
    (nachErstem ?? "").includes(NEU) && !(nachErstem ?? "").includes(ALT),
    `„${nachErstem ?? "(nichts)"}"`,
  );

  const musterNoch = await prop<string>(cdp, ".transmute-regex", "value");
  const ersetzungNoch = await prop<string>(cdp, ".transmute-replacement-input", "value");
  record(
    "Regex bleibt nach Anwenden stehen, statt zu leeren",
    musterNoch === ALT && ersetzungNoch === NEU,
    `Muster „${musterNoch}", Ersetzung „${ersetzungNoch}"`,
  );

  // Aenderung dazwischen — ohne erneutes Pinnen ueber "Von Hand". Das Muster muss
  // mitwandern: "${ALT}" steht nach dem ersten Anwenden nicht mehr im Text, ein
  // unveraendertes Muster faende dort folgerichtig nichts mehr. Genau DAS ist der
  // Beleg dafuer, dass der gemerkte Textstand nach dem Anwenden nachgezogen wird
  // (sonst rechnete die Vorschau noch gegen den alten, laengst ersetzten Text).
  await fill(cdp, ".transmute-regex", NEU);
  await fill(cdp, ".transmute-replacement-input", "dritte Schreibweise");
  await cdp.evaluate("await new Promise((r) => setTimeout(r, 700)); return true;");
  await clickByText(cdp, ".transmute-actions", labelAnwenden);
  await cdp.evaluate("await new Promise((r) => setTimeout(r, 400)); return true;");

  const nachZweitem = await dateiPufferInhalt(cdp, pfad);
  record(
    "Zweites Anwenden mit Aenderung dazwischen greift ohne neues Pinnen",
    (nachZweitem ?? "").includes("dritte Schreibweise"),
    `„${nachZweitem ?? "(nichts)"}"`,
  );

  await clickByText(cdp, ".transmute-actions", labelReset);
  await cdp.evaluate("await new Promise((r) => setTimeout(r, 300)); return true;");
  const nochGepinnt = await exists(cdp, ".transmute-pinned");
  record("Zuruecksetzen leert die Runde bewusst", !nochGepinnt, nochGepinnt ? "Pinned-Hinweis noch da" : "weg");

  await cdp.evaluate(`
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(pfad)});
    if (f) await app.fileManager.trashFile(f);
    return true;
  `);
}

// --- Abschnitt: unvollstaendig gemessen --------------------------------------

/** Was nicht vollstaendig gemessen wurde, darf nicht geschrieben werden.
 *
 * Das Budget wird auf **-1** gesetzt, nicht auf 0: `runRule` prueft
 * `now() - start > budgetMs`, und ueber eine kleine Notiz vergeht **keine messbare
 * Millisekunde** — mit 0 ist der Vergleich `0 > 0` und damit falsch, der Lauf zaehlt als
 * vollstaendig. Gemessen im ersten Smoke-Durchlauf 2026-08-16, wo genau diese Annahme
 * den Pruefpunkt rot machte, ohne dass am Pruefling etwas fehlte. Mit -1 greift die
 * Schranke deterministisch bei Zeile 0. (Ueber die Einstellungen ist der Wert nicht
 * erreichbar: der Setter klemmt auf mindestens 200.) */
async function abschnittUnvollstaendig(cdp: Cdp): Promise<void> {
  await setPluginSetting(cdp, PLUGIN_ID, "budgetMs", -1);
  await click(cdp, ".transmute-compute");
  await cdp.evaluate("await new Promise((r) => setTimeout(r, 1500)); return true;");

  const zeilen = await count(cdp, ".transmute-file-row");
  const gesperrt = await prop<boolean>(cdp, ".transmute-file-check", "disabled");
  const hinweis = await exists(cdp, ".transmute-skipped-incomplete");

  if (zeilen === 0) {
    skipped("Unvollstaendig gemessene Datei ist gesperrt", "kein Treffer bei negativem Budget");
  } else {
    record(
      "Unvollstaendig gemessene Datei ist gesperrt",
      gesperrt === true,
      `disabled=${gesperrt}, Hinweiszeile=${hinweis}`,
    );
  }
  await setPluginSetting(cdp, PLUGIN_ID, "budgetMs", 2000);
}

// --- Abschnitt: Abbruch ------------------------------------------------------

/** Der Pruefpunkt, an dem `yieldToUi` haengt — und der einzige, der den Mechanismus
 *  wirklich misst statt seine Nebenwirkung.
 *
 *  **Warum nicht ueber die Uhr:** ein Lauf ueber tausend Notizen ist in ~200 ms durch,
 *  schneller als jeder Klick von aussen (erster Durchlauf 2026-08-16: der Punkt wurde
 *  dreimal uebersprungen, weil „warte 300 ms, dann klicke Abbrechen" nie einen laufenden
 *  Lauf antraf).
 *
 *  **Was stattdessen gemessen wird:** ob der Renderer waehrend des Laufs *atmet*. Der
 *  Treiber startet den Lauf und dreht daneben eine `setTimeout`-Schleife. `setTimeout`
 *  ist ein **Makrotask** — solange die Lese-Kette nur Mikrotasks erzeugt (und genau das
 *  tut `cachedRead`, wenn es aus dem Cache aufloest), kommt diese Schleife **nicht** dran.
 *  Runden > 0 waehrend des Laufs heisst also: es gibt echte Makrotask-Pausen, der Klick
 *  auf „Abbrechen" kann zugestellt werden. Runden = 0 heisst: der Knopf ist Dekoration.
 */
async function abschnittAbbruch(cdp: Cdp, kandidaten: number): Promise<void> {
  if (kandidaten < ABORT_MIN_KANDIDATEN) {
    skipped(
      "Renderer atmet waehrend des Laufs",
      `nur ${kandidaten} Kandidaten — zu wenig fuer eine belastbare Messung`,
    );
    return;
  }

  await fill(cdp, ".transmute-folder", "");
  // Ein teures Muster statt eines groesseren Vaults: `[a-z]` trifft in jeder Datei bis
  // zur Obergrenze und macht den Lauf sicher laenger als den Freigabe-Takt (250 ms).
  // Mit dem billigen Muster war der Lauf ueber 1057 Notizen in unter 250 ms durch —
  // dann gibt es gar kein Yield, und der Pruefpunkt haette Abwesenheit von Bedarf als
  // Defekt gemeldet.
  await fill(cdp, ".transmute-regex", "[a-z]");
  await cdp.evaluate("await new Promise((r) => setTimeout(r, 700)); return true;");

  // Fokus ZULETZT holen, unmittelbar vor der Messung: die beiden fill()-Aufrufe darueber
  // dauern zusammen ueber eine Sekunde, und in dieser Zeit holt sich das Terminal, aus
  // dem der Treiber laeuft, den Fokus zurueck.
  // `requireVisible` WIRFT, wenn das Fenster nicht nach vorn kommt — hier ist Abbruch
  // aber die falsche Reaktion: ein nicht messbarer Punkt wird uebersprungen, nicht rot
  // gemeldet. Ein Fehlschlag heisst „konnte nicht messen", nicht „Pruefling defekt".
  // Die dritte Stufe (`setAlwaysOnTop`) hilft hier sogar besonders: sie HAELT den
  // Vordergrund, statt ihn einmal herzustellen — und genau den verliert der Treiber
  // sonst ans Terminal, aus dem er laeuft.
  try {
    await requireVisible(cdp);
  } catch (fehler) {
    skipped("Renderer atmet waehrend des Laufs", `Fenster nicht nach vorn zu holen: ${(fehler as Error).message.split("\n")[0]}`);
    await fill(cdp, ".transmute-regex", ALT);
    await fill(cdp, ".transmute-folder", SMOKE_DIR);
    return;
  }

  const mess = await cdp.evaluate<{
    yields: number; runden: number; abortSichtbar: boolean; dauer: number; refMs: number;
    gestartet: boolean; hidden: boolean; zeilen: number; kopf: string; vorher: string; muster: string;
  }>(`
    // Eichmessung: laeuft die Timer-Kette in diesem Fenster normal? document.hidden
    // allein reicht als Kriterium nicht — es meldete false, waehrend die Kette
    // nachweislich auf 1 Hz stand (2026-08-16).
    const ref0 = performance.now();
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 10));
    const refMs = (performance.now() - ref0) / 3;

    // Den Mechanismus DIREKT zaehlen statt seine Nebenwirkung zu erraten: yieldToUi
    // ruft setTimeout(resolve, 0). Ueber die Nebenwirkung (laufen fremde Makrotasks?)
    // war der Punkt dreimal falsch — mal gedrosselt, mal war der Lauf zu kurz.
    let yields = 0;
    const orig = window.setTimeout;
    window.setTimeout = function (fn, ms, ...rest) {
      if (ms === 0) yields++;
      return orig.call(this, fn, ms, ...rest);
    };

    // Lage VOR dem Klick festhalten. Ohne sie ist „kein Lauf" nicht von „nichts zu tun"
    // zu unterscheiden — und das ist genau die Verwechslung, an der dieser Pruefpunkt
    // schon dreimal gescheitert ist.
    const kandEl = document.querySelector(".transmute-candidates");
    const vorher = kandEl ? kandEl.textContent.trim() : "(keine Kandidatenzeile)";
    const musterEl = document.querySelector(".transmute-regex");
    const muster = musterEl ? musterEl.value : "(kein Musterfeld)";

    const compute = document.querySelector(".transmute-compute");
    if (!compute || compute.disabled) {
      window.setTimeout = orig;
      return { yields: -1, runden: -1, abortSichtbar: false, dauer: 0, refMs, gestartet: false, hidden: document.hidden, vorher, muster };
    }

    const t0 = performance.now();
    compute.click();

    let runden = 0;
    let abortSichtbar = false;
    let gestartet = false;
    // ERST BEOBACHTEN, DANN EINGREIFEN.
    //
    // Hier stand bis zum 2026-09-02 ein abbrechen.click() in derselben Schleife, und zwar
    // beim ERSTEN Sichten des Knopfes. Gemessen ueber 12.010 Notizen war der nach 10 ms da —
    // die Messung toetete den Lauf also, bevor er die erste UI-Freigabe erreichen konnte
    // (die kommt fruehestens nach 250 ms), und meldete die selbst erzeugte Kuerze
    // anschliessend als „Lauf war nach 11 ms durch". Sie hat ihre eigene Einwirkung
    // gemessen. Der Abbruch-Klick gehoert deshalb NICHT hierher, sondern in den
    // Pruefpunkt darunter, der ihn ohnehin von aussen setzt.
    //
    // Die alte Begruendung („ein Klick von aussen kommt immer zu spaet") stammt aus einer
    // Zeit mit 1.057 Notizen und billigem Muster. Mit 12.010 Notizen und [a-z] laeuft der
    // Lauf Sekunden — lange genug fuer eine CDP-Runde.
    let laeuft = false;
    while (performance.now() - t0 < 20000) {
      // Der eigene Warte-Timer laeuft ueber die UNINSTRUMENTIERTE Fassung, sonst zaehlt
      // sich die Messung selbst mit.
      await new Promise((r) => orig.call(window, r, 10));
      laeuft = !!document.querySelector(".transmute-run");
      if (laeuft) gestartet = true;
      if (document.querySelector(".transmute-abort")) abortSichtbar = true;

      // Genug gesehen: der Mechanismus hat mindestens einmal freigegeben.
      if (gestartet && yields > 0 && performance.now() - t0 > 400) break;
      // Durch, bevor eine Freigabe noetig war — dann ist der Lauf zu kurz zum Messen.
      if (gestartet && !laeuft) break;
      // Nie angelaufen.
      if (!gestartet && performance.now() - t0 > 2000) break;
      runden++;
    }
    const dauer = performance.now() - t0;
    window.setTimeout = orig;
    // Mitberichten, WAS gelaufen ist: ohne das ist „0 Freigaben" nicht von „gar kein
    // Lauf" zu unterscheiden.
    const kopfEl = document.querySelector(".transmute-affected");
    return {
      yields, runden, abortSichtbar, dauer, refMs, gestartet, vorher, muster, hidden: document.hidden,
      zeilen: document.querySelectorAll(".transmute-file-row").length,
      kopf: kopfEl ? kopfEl.textContent.trim() : "(keine Zusammenfassung)",
    };
  `);

  if (mess.yields === -1) {
    skipped("Renderer atmet waehrend des Laufs", "Vorschau-Knopf war nicht bedienbar");
    await fill(cdp, ".transmute-regex", ALT);
    await fill(cdp, ".transmute-folder", SMOKE_DIR);
    return;
  }
  // Was gelaufen ist, gehoert IN die Uebersprungen-Meldung. Ohne Zeilen und
  // Zusammenfassung ist „zu kurz" nicht von „hat nichts getan" zu unterscheiden — und
  // genau diese Verwechslung hat den Punkt am 2026-09-02 stillgelegt.
  const lage = `vor dem Klick: „${mess.vorher}", Muster „${mess.muster}" — danach ${mess.zeilen} Dateizeilen,`
    + ` „${mess.kopf}"; ${mess.yields} UI-Freigaben in ${Math.round(mess.dauer)} ms,`
    + ` Fremdrunden ${mess.runden}, gestartet=${mess.gestartet}, abortSichtbar=${mess.abortSichtbar},`
    + ` Eichung ${Math.round(mess.refMs)} ms`;
  if (!mess.gestartet) {
    skipped(
      "Renderer atmet waehrend des Laufs",
      `Lauf ist in 2 s nicht angelaufen — der Vorschau-Klick hat keinen Lauf ausgeloest (${lage})`,
    );
  } else if (mess.dauer < 250) {
    skipped(
      "Renderer atmet waehrend des Laufs",
      `Lauf war nach ${Math.round(mess.dauer)} ms durch — unter dem Freigabe-Takt von 250 ms (${lage})`,
    );
  } else {
    // Bewertet wird der MECHANISMUS (gibt der Lauf die Oberflaeche frei?), nicht ob der
    // Messfaden zufaellig drankam — das ist eine Eigenschaft der Messung, nicht des
    // Prueflings.
    record(
      "Renderer atmet waehrend des Laufs",
      mess.yields > 0,
      `${mess.yields} UI-Freigaben in ${Math.round(mess.dauer)} ms, Abbrechen sichtbar=${mess.abortSichtbar}`
        + ` (Eichung ${Math.round(mess.refMs)} ms, hidden=${mess.hidden}, Fremdrunden ${mess.runden},`
        + ` Ergebnis: ${mess.zeilen} Dateizeilen, „${mess.kopf}")`,
    );
  }

  // Und der Klick muss den Lauf auch wirklich beenden.
  const laeuftNoch = await exists(cdp, ".transmute-abort");
  if (laeuftNoch) {
    const start = Date.now();
    await click(cdp, ".transmute-abort");
    const weg = await pollUntil<boolean>(
      cdp,
      `return document.querySelector(".transmute-run") ? null : true;`,
      8_000,
      200,
    );
    record(
      "Abbrechen beendet den Lauf",
      weg === true && Date.now() - start < 5_000,
      `Lauf endete ${Date.now() - start} ms nach dem Klick`,
    );
  } else {
    skipped("Abbrechen beendet den Lauf", "Lauf war beim Klick bereits fertig");
  }

  await fill(cdp, ".transmute-regex", ALT);
  await fill(cdp, ".transmute-folder", SMOKE_DIR);
}

// --- Abschnitt: Einstellungs-Setter ------------------------------------------

/** Die Stelle, an der 0.5.0 fast danebengelegen haette: der Setter des
 *  Einstellungs-Tabs las die neue Bereichs-Variante nicht zurueck und haette sie
 *  still auf „Ganze Notiz" gesetzt. Typecheck und 401 Tests waren dabei gruen. */
async function abschnittSetter(cdp: Cdp): Promise<void> {
  const ergebnis = await cdp.evaluate<string | null>(`
    // Plugin-Tabs liegen in pluginTabs, nicht in settingTabs — dort stehen nur die Kern-Tabs.
    const alle = [...(app.setting?.settingTabs ?? []), ...(app.setting?.pluginTabs ?? [])];
    const tab = alle.find((t) => t.id === ${JSON.stringify(PLUGIN_ID)});
    if (!tab || typeof tab.setControlValue !== "function") return null;
    tab.setControlValue("defaultScope", "vault");
    await new Promise((r) => setTimeout(r, 300));
    return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.defaultScope;
  `);
  if (ergebnis === null) {
    skipped("Bereich „Vault\" ueberlebt den Einstellungs-Setter", "Settings-Tab nicht greifbar");
    return;
  }
  record(
    "Bereich „Vault\" ueberlebt den Einstellungs-Setter",
    ergebnis === "vault",
    `gespeichert: „${ergebnis}"`,
  );

  // Und ueberlebt er auch das Neuladen? Das prueft den Lade-Pfad (mergeSettings).
  const nachReload = await cdp.evaluate<string>(`
    await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
    await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
    await new Promise((r) => setTimeout(r, 800));
    return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.defaultScope;
  `);
  record(
    "Bereich „Vault\" ueberlebt das Neuladen des Plugins",
    nachReload === "vault",
    `nach Reload: „${nachReload}"`,
  );

  // Die Einstellung zu pruefen ist die STRUKTURELLE Haelfte — sie kann gruen sein, waehrend
  // die Sache falsch ist. Genau das war sie: `onOpen` rief `refreshCandidates()` nicht, der
  // gespeicherte Bereich „Vault" wurde also korrekt geladen und das Panel behauptete
  // trotzdem „Keine Notiz passt zu diesem Bereich" fuer den ganzen Vault (2026-09-02).
  // Deshalb hier die WIRKUNG: nach dem Reload muss eine Zahl dastehen, kein Leer-Text.
  const kandidatenzeile = await pollUntil<string>(
    cdp,
    `
      for (const l of app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})) l.detach();
      await app.workspace.getRightLeaf(false).setViewState({ type: ${JSON.stringify(VIEW_TYPE)}, active: true });
      await new Promise((r) => setTimeout(r, 600));
      const el = document.querySelector(".transmute-candidates");
      return el ? el.textContent.trim() : null;
    `,
    15_000,
    1_000,
  );
  const zahl = /\d/.test(kandidatenzeile ?? "");
  record(
    "Frisch geoeffnetes Panel kennt die Kandidaten sofort",
    zahl,
    `Kandidatenzeile: „${kandidatenzeile ?? "(keine)"}"`,
  );
}

// --- Abschnitt: llm-lab --------------------------------------------------------

/**
 * Ein eigener HTTP-Server statt des konfigurierten Endpunkts — derselbe Grund wie bei
 * koda-agent Punkt 40/41: ein Smoke, der an einem echten Modell haengt, misst das Modell
 * mit statt die Meldestrecke. `requestUrl` (der Transport dieses Plugins, `obsidian/http.ts`)
 * umgeht CORS — die OPTIONS/CORS-Antwort ist trotzdem eingebaut (REGISTRY GUI-Smoke-Zeile,
 * Befund koda), defensiv fuer den Fall, dass der Renderer den Request je ueber `fetch`
 * schickt statt ueber `requestUrl`.
 */
async function startFakeEndpoint(
  draft: { regex: string; flags: string; replacement: string; explanation: string },
): Promise<{ url: string; close: () => Promise<void>; chatCalls: () => number; lastModel: () => string }> {
  let chatCalls = 0;
  let lastModel = "";
  const server: Server = createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      });
      res.end();
      return;
    }
    if (req.method === "POST" && req.url?.includes("/v1/chat/completions") === true) {
      // Modell mitschneiden: ein Lauf „ging durch" belegt nicht, WELCHES Modell ankam.
      const teile: Buffer[] = [];
      req.on("data", (c: Buffer) => teile.push(c));
      req.on("end", () => {
        chatCalls += 1;
        try { lastModel = String((JSON.parse(Buffer.concat(teile).toString("utf8")) as { model?: unknown }).model ?? ""); } catch { lastModel = "?"; }
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(draft) }, finish_reason: "stop" }],
        }));
      });
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(
      req.url?.includes("/v1/models") === true
        ? JSON.stringify({ data: [{ id: "smoke-model", object: "model" }] })
        : JSON.stringify({ ok: true }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }),
    chatCalls: () => chatCalls,
    lastModel: () => lastModel,
  };
}

/**
 * llm-lab-Meldestrecke (Konsumenten-Seite) — Task „llm-lab als Konsument anschliessen".
 * Echter Roundtrip: `TransmuteSession.generate()` gegen den Stub-Endpunkt oben, mit
 * eingehaengtem llm-lab-Stub. Geprueft wird NICHT, ob ein echtes llm-lab die Zeile
 * speichert (das ist dessen Smoke) — nur, dass transmute ueberhaupt meldet und mit
 * welchen Feldern (feature, turnId, promptTemplate, Nachrichten nur system/user/assistant).
 *
 * Ein Stub statt eines echten Lab, aus demselben Grund wie in koda-agents Treiber: die
 * Zusage ist "wir rufen readLabApi(app)?.log(...) mit diesen Feldern", nicht "das Lab
 * verhaelt sich richtig".
 */
async function abschnittLlmLab(cdp: Cdp): Promise<void> {
  const labVorher = await cdp.evaluate<boolean>(`return !!app.plugins.plugins["llm-lab"];`);
  if (labVorher) {
    skipped(
      "llm-lab-Meldestrecke (Konsumenten-Seite)",
      "ein llm-lab-Eintrag existiert bereits (echtes Plugin oder Rest eines abgebrochenen Laufs); Stub wuerde ihn ueberschreiben",
    );
    return;
  }

  const fake = await startFakeEndpoint({ regex: "foo", flags: "", replacement: "bar", explanation: "e" });
  const vorEndpoints = await cdp.evaluate<unknown>(
    `return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.endpoints;`,
  );
  try {
    await cdp.evaluate(`
      window.__transmuteLabSeen = [];
      app.plugins.plugins["llm-lab"] = {
        __transmuteSmokeStub: true,
        api: {
          apiVersion: 4,
          status: () => ({ apiVersion: 4, recording: true }),
          log: (input) => { window.__transmuteLabSeen.push(input); return "smoke-" + window.__transmuteLabSeen.length; },
        },
      };
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.endpoints = [{ url: ${JSON.stringify(fake.url)} }];
      await p.saveSettings();
      // resolver.resolve() cacht den ersten erreichbaren Endpunkt fuer die Session-Laufzeit
      // (EndpointResolver-Kopfkommentar). Hat ein frueherer Abschnitt (Modell-Liste laden,
      // Settings-Tab) bereits aufgeloest — z. B. auf den echten Default ":1234" — wuerde
      // dieser Cache den Stub-Endpunkt sonst stillschweigend ignorieren und die Anfrage
      // ginge an einen echten, moeglicherweise langsamen/inkompatiblen Server: „generating"
      // haengt dann unbegrenzt, ohne dass der Stub je einen Request sieht (gemessen an
      // genau diesem Punkt, Welle 7).
      p.resolver.invalidate();
      // Direkter Aufruf der Sitzung — derselbe Pfad, den der Generieren-Knopf im Panel
      // ausloest (view.ts::generate() ruft nichts anderes). Kein DOM-Umweg noetig: eine
      // turnId misst der Port, keine Tastatureingabe.
      void p.sessionInstance.generate("Smoke-Test: ersetze foo", "foo bar");
      return true;
    `);

    const gemeldet = await pollUntil<{
      feature: string; model: string; endpointUrl: string; content: string;
      latencyMs: number; turnId: string; promptTemplate: string;
      messages: { role: string; content: string }[];
    }>(
      cdp,
      `
        const seen = window.__transmuteLabSeen || [];
        return seen.length > 0 ? seen[0] : null;
      `,
      15_000,
    );
    const ok =
      gemeldet !== null
      && gemeldet.feature === "rule:apply"
      && gemeldet.endpointUrl === fake.url
      && gemeldet.latencyMs >= 0
      && typeof gemeldet.turnId === "string" && gemeldet.turnId !== ""
      && gemeldet.promptTemplate !== ""
      && Array.isArray(gemeldet.messages)
      && gemeldet.messages.some((m) => m.role === "user" && m.content.includes("Smoke-Test"))
      && !gemeldet.messages.some((m) => (m as { role: string }).role !== "system" && (m as { role: string }).role !== "user" && (m as { role: string }).role !== "assistant");
    const detail = gemeldet
      ? `feature „${gemeldet.feature}“ · model „${gemeldet.model}“ · turnId ${gemeldet.turnId.slice(0, 12)}… · `
        + `promptTemplate ${gemeldet.promptTemplate.length} Z. · Nachrichten ${gemeldet.messages.length} (nur system/user/assistant)`
      : "kein log()-Aufruf innerhalb 15s";
    record("llm-lab-Meldestrecke (Konsumenten-Seite): feature/turnId/promptTemplate/Nachrichten korrekt gemeldet", ok, detail);
  } finally {
    await fake.close();
    await cdp.evaluate(`
      delete app.plugins.plugins["llm-lab"];
      delete window.__transmuteLabSeen;
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.endpoints = ${JSON.stringify(vorEndpoints)};
      await p.saveSettings();
      p.resolver.invalidate();
      return true;
    `).catch(() => undefined);
  }
}

// --- Abschnitt: LLM Endpoint Manager ---------------------------------------------

const MANAGER_PLUGIN_ID = "llm-endpoint-manager";
const MANAGER_DEFAULT_MODEL = "mgr-default-smoke";
const MANAGER_CHOICE_MODEL = "mgr-choice-smoke";
const LOCAL_MODEL = "lokal-smoke";
const MANAGED_TEXT = ["Endpunkte kommen vom LLM Endpoint Manager", "Endpoints come from the LLM Endpoint Manager"];

/** Haengt eine FAKE-API des Managers ein. `findEndpointManager()` prueft nur die FORM
 *  (version === 1 + alle Methoden), keine Herkunft. Einen vorgefundenen Eintrag parkt der
 *  Renderer selbst auf `window` (eine CDP-Rundreise ueber Node verliert Funktionen) und
 *  setzt ihn beim Abbau wieder ein — ein echter Manager im Vault bleibt so unangetastet. */
async function fakeManagerEin(cdp: Cdp, url: string): Promise<void> {
  await cdp.evaluate(`
    if (!("__smokeVorherManager" in window)) window.__smokeVorherManager = app.plugins.plugins[${JSON.stringify(MANAGER_PLUGIN_ID)}] ?? null;
    const ep = { id: "fake-mgr-ep", label: "Fake Manager Endpoint", url: ${JSON.stringify(url)}, provider: "openai", capabilities: ["chat"], defaultModel: ${JSON.stringify(MANAGER_DEFAULT_MODEL)}, enabled: true, hasSecret: false };
    // config.model traegt wie beim echten Manager ebenfalls den Standard — sonst waere die
    // Vorrangregel „Nutzerwahl schlaegt Standard" (M2b) ohne Wirkung gruen.
    const geloest = { id: ep.id, label: ep.label, config: { url: ${JSON.stringify(url)}, model: ${JSON.stringify(MANAGER_DEFAULT_MODEL)} }, defaultModel: ${JSON.stringify(MANAGER_DEFAULT_MODEL)} };
    app.plugins.plugins[${JSON.stringify(MANAGER_PLUGIN_ID)}] = { api: {
      version: 1,
      list: () => [ep],
      get: (id) => (id === ep.id ? ep : null),
      resolve: async () => geloest,
      materialize: async (id) => (id === ep.id ? geloest : { error: "not-found" }),
      models: async (id) => (id === ep.id ? [${JSON.stringify(MANAGER_DEFAULT_MODEL)}, ${JSON.stringify(MANAGER_CHOICE_MODEL)}] : { error: "not-found" }),
      importEndpoints: async (eps) => ({ added: [], merged: [], skipped: eps.map((e) => e.url) }),
      on: () => () => {},
    } };
    return true;
  `);
}

async function fakeManagerAus(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    const id = ${JSON.stringify(MANAGER_PLUGIN_ID)};
    if ("__smokeVorherManager" in window) {
      const vorher = window.__smokeVorherManager;
      if (vorher === null) delete app.plugins.plugins[id]; else app.plugins.plugins[id] = vorher;
      delete window.__smokeVorherManager;
    } else delete app.plugins.plugins[id];
    return true;
  `);
}

/** Text und Zeilenzahl des Einstellungs-Tabs, gezeichnet in dessen eigenen (abgehaengten)
 *  Container — `display()` ist der Fallback-Renderer, derselbe Walker wie im Fenster, nur ohne
 *  das Fenster selbst (das ab 1.13 ein eigener Renderer ist). Null, wenn der Tab fehlt. */
async function einstellungenText(cdp: Cdp): Promise<{ text: string; lokaleZeilen: number } | null> {
  return cdp.evaluate<{ text: string; lokaleZeilen: number } | null>(`
    const tabs = app.setting?.pluginTabs ?? [];
    const tab = tabs.find((x) => x.id === ${JSON.stringify(PLUGIN_ID)});
    if (!tab) return null;
    tab.display();
    return { text: tab.containerEl.textContent ?? "", lokaleZeilen: tab.containerEl.querySelectorAll(".transmute-ep-status").length };
  `);
}

/** Erzeugt einen Lauf (dieselbe Sitzung wie der Generieren-Knopf) und wartet auf den Aufruf. */
async function laufAnstossen(cdp: Cdp, fake: { chatCalls: () => number }): Promise<boolean> {
  const vorher = fake.chatCalls();
  await cdp.evaluate(`
    const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    void p.sessionInstance.generate("Smoke-Test: ersetze foo", "foo bar");
    return true;
  `);
  const ende = Date.now() + 15_000;
  while (Date.now() < ende) {
    if (fake.chatCalls() > vorher) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** M1–M3: Manager an → Einstellungen zeigen den Baustein, der Lauf geht an den Manager-Endpunkt
 *  mit dem Standardmodell; die Nutzerwahl schlaegt den Standard; Manager aus → lokale Liste und
 *  lokales Modell. Zwei Stub-Server, damit der lokale Fall nicht an einem echten LM Studio
 *  haengt („nichts gemessen" statt „geprueft"). */
async function abschnittManager(cdp: Cdp): Promise<void> {
  const REST = [
    "M1 Einstellungen zeigen den Manager statt der lokalen Liste",
    "M2 Lauf nutzt den Manager-Endpunkt und dessen Standardmodell",
    "M2b Die Modellwahl des Nutzers schlaegt den Standard des Endpunkts",
    "M3 Manager aus: lokale Liste in den Einstellungen und im Lauf",
  ];
  if (await cdp.evaluate<boolean>(`return !!app.plugins.plugins[${JSON.stringify(MANAGER_PLUGIN_ID)}];`)) {
    for (const n of REST) skipped(n, "ein llm-endpoint-manager ist im Vault aktiv; die Fake-API wuerde ihn verdecken");
    return;
  }
  const draft = { regex: "foo", flags: "", replacement: "bar", explanation: "e" };
  const mgr = await startFakeEndpoint(draft);
  const lokal = await startFakeEndpoint(draft);
  const vor = await cdp.evaluate<{ endpoints: unknown; choice: unknown; model: string }>(
    `const s = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings; return { endpoints: s.endpoints, choice: s.choice, model: s.model };`,
  );
  try {
    await fakeManagerEin(cdp, mgr.url);
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.choice = {};
      // Der lokale Weg zeigt auf den zweiten Stub, mit eigenem Modell — er darf im Manager-Fall
      // nie angefasst werden.
      p.settings.endpoints = [{ url: ${JSON.stringify(lokal.url)} }];
      p.settings.model = ${JSON.stringify(LOCAL_MODEL)};
      await p.saveSettings();
      p.resolver.invalidate();
      return true;
    `);

    const mit = await einstellungenText(cdp);
    if (mit === null) {
      skipped(REST[0]!, "kein Einstellungs-Tab unter app.setting.pluginTabs gefunden");
    } else {
      const da = MANAGED_TEXT.some((x) => mit.text.includes(x));
      record(REST[0]!, da && mit.lokaleZeilen === 0, `Manager-Text ${da ? "da" : "fehlt"}, ${mit.lokaleZeilen} lokale Endpunkt-Zeilen`);
    }

    const okM2 = await laufAnstossen(cdp, mgr);
    record(REST[1]!, okM2 && mgr.lastModel() === MANAGER_DEFAULT_MODEL && lokal.chatCalls() === 0,
      `Manager-Stub ${mgr.chatCalls()} Aufruf(e), Modell „${mgr.lastModel()}“ (erwartet „${MANAGER_DEFAULT_MODEL}“); lokaler Stub ${lokal.chatCalls()} Aufruf(e) (erwartet 0)`);

    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.choice = { model: ${JSON.stringify(MANAGER_CHOICE_MODEL)} };
      await p.saveSettings();
      return true;
    `);
    const okM2b = await laufAnstossen(cdp, mgr);
    record(REST[2]!, okM2b && mgr.lastModel() === MANAGER_CHOICE_MODEL,
      `Manager-Stub sah Modell „${mgr.lastModel()}“ (erwartet „${MANAGER_CHOICE_MODEL}“)`);

    // Zurueck auf lokal: choice leeren, sonst wuerde M3 ein altes Manager-Modell lesen und
    // an der falschen Stelle rot.
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.choice = {};
      await p.saveSettings();
      return true;
    `);
    await fakeManagerAus(cdp);
    await cdp.evaluate(`app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].resolver.invalidate(); return true;`);
    const ohne = await einstellungenText(cdp);
    const okM3 = await laufAnstossen(cdp, lokal);
    const zeigtLokal = ohne !== null && !MANAGED_TEXT.some((x) => ohne.text.includes(x)) && ohne.lokaleZeilen > 0;
    record(REST[3]!, zeigtLokal && okM3 && lokal.lastModel() === LOCAL_MODEL,
      `Einstellungen: ${ohne === null ? "kein Tab" : `${ohne.lokaleZeilen} lokale Zeilen, Manager-Text ${MANAGED_TEXT.some((x) => ohne.text.includes(x)) ? "noch da" : "weg"}`}; `
      + `lokaler Stub ${lokal.chatCalls()} Aufruf(e), Modell „${lokal.lastModel()}“ (erwartet „${LOCAL_MODEL}“)`);
  } finally {
    await fakeManagerAus(cdp).catch(() => undefined);
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.endpoints = ${JSON.stringify(vor.endpoints)};
      p.settings.choice = ${JSON.stringify(vor.choice)};
      p.settings.model = ${JSON.stringify(vor.model)};
      await p.saveSettings();
      p.resolver.invalidate();
      return true;
    `).catch(() => undefined);
    await mgr.close();
    await lokal.close();
  }
}

/** H1: Die Hilfe-Zeile ist die ERSTE Zeile im Einstellungs-Tab (UI-STANDARD §8), mit Text-Knopf
 *  und bug-Icon. Gezeichnet ueber `display()`, den Fallback-Renderer derselben Definitionen. */
async function abschnittHilfe(cdp: Cdp): Promise<void> {
  const r = await cdp.evaluate<{ tab: boolean; name: string; buttons: number; bug: boolean } | null>(`
    const tab = (app.setting?.pluginTabs ?? []).find((x) => x.id === ${JSON.stringify(PLUGIN_ID)});
    if (!tab) return null;
    tab.display();
    const first = tab.containerEl.querySelector(".setting-item");
    if (!first) return { tab: true, name: "", buttons: 0, bug: false };
    return {
      tab: true,
      name: first.querySelector(".setting-item-name")?.textContent ?? "",
      buttons: first.querySelectorAll("button").length,
      bug: first.querySelector(".clickable-icon svg.bug, .clickable-icon [data-icon='bug'], .clickable-icon .lucide-bug") !== null,
    };
  `);
  if (r === null) { skipped("H1 Hilfe-Zeile ist die erste Zeile der Einstellungen", "kein Einstellungs-Tab unter app.setting.pluginTabs gefunden"); return; }
  const ok = (r.name === "Help" || r.name === "Hilfe") && r.buttons === 1 && r.bug;
  record("H1 Hilfe-Zeile ist die erste Zeile der Einstellungen", ok, `erste Zeile „${r.name}“, ${r.buttons} Text-Knopf, bug-Icon ${r.bug ? "da" : "fehlt"}`);
}

// --- Abschnitt: i18n ---------------------------------------------------------

/** Sprache des Panels — fuer die Knoepfe, deren Beschriftung gelesen werden muss. */
async function panelSprache(cdp: Cdp): Promise<"de" | "en"> {
  const roh = await cdp.evaluate<string>(
    `return document.documentElement.lang || (window.localStorage && localStorage.getItem("language")) || "en";`,
  );
  return roh.startsWith("de") ? "de" : "en";
}

/** Ein fehlender Uebersetzungs-Schluessel ist in Obsidian NICHT leer: `t()` faellt auf
 *  den Schluessel zurueck, und `view.scope.vault` sieht im Panel aus wie ein String.
 *  Gesucht wird deshalb nach dem Muster, nicht nach einer Wortliste. */
async function abschnittI18n(cdp: Cdp): Promise<void> {
  const roh = await cdp.evaluate<string>(`
    const panel = document.querySelector(".transmute-panel");
    if (!panel) return "";
    const treffer = (panel.innerText.match(/\\b(view|set|error|status)\\.[a-zA-Z][a-zA-Z.]+/g) || []);
    return [...new Set(treffer)].join(", ");
  `);
  record("Panel zeigt keinen rohen Uebersetzungs-Schluessel", roh === "", roh === "" ? "sauber" : `gefunden: ${roh}`);
}

// --- Ablauf ------------------------------------------------------------------

/**
 * Ein Abschnitt, der mittendrin wirft, hinterlaesst eine **vierte** Kategorie: seine
 * restlichen Pruefpunkte sind weder gruen noch rot noch uebersprungen — sie werden nie
 * angelegt. Eine Bilanz, die ueber `checks` summiert, zaehlt sie folglich gar nicht und
 * meldet „N/N gruen"; gemeint ist „alles, was ich geschafft habe, war gruen".
 *
 * Der Absturz ist dabei laut (Stacktrace, Exit-Code), steht aber UNTER der Bilanzzeile —
 * und gelesen wird die Bilanz. Deshalb faengt jeder Abschnitt seine eigenen Ausnahmen und
 * macht daraus einen ROTEN Pruefpunkt, statt sie nach oben durchzureichen.
 *
 * Uebernommen aus vault-crews (Lesson 2026-09-02, `f174737`): dort meldete der Treiber
 * „20/20 gemessene Pruefpunkte gruen", waehrend die drei Punkte, wegen derer der Abschnitt
 * existierte, nie liefen. Dieses Repo war eines der neun ohne solchen Fang.
 */
async function abschnitt(name: string, lauf: () => Promise<void>): Promise<void> {
  try {
    await lauf();
  } catch (fehler) {
    const grund = fehler instanceof Error ? fehler.message.split("\n")[0] : String(fehler);
    record(`Abschnitt „${name}" laeuft durch`, false, `abgebrochen: ${grund}`);
  }
}

async function main(): Promise<void> {
  // attachTo statt Cdp.attach: Obsidian gibt dem Einstellungen-Fenster denselben
  // Vault-Namen im Titel, ein Titel-Filter waere also mehrdeutig (und sprachabhaengig).
  // Das Kriterium ist die Sache selbst — nur das Hauptfenster traegt einen Workspace.
  const cdp = await attachTo("workspace", PORT, VAULT);
  if (!cdp) throw new Error(`Kein Obsidian-Hauptfenster auf Port ${PORT}${VAULT ? ` fuer Vault ${VAULT}` : ""}.`);

  // Vorwerte AUSSERHALB des try: sonst haengt die Wiederherstellung daran, dass der
  // Lauf sauber zu Ende geht — und genau dann tut er es nicht.
  let vorwerte: { budgetMs: number; confirmThreshold: number; defaultScope: string } | null = null;

  try {
    // Fenster nach vorn — ueber die ZENTRALE Fassung, nicht ueber eine eigene.
    //
    // Hier stand bis zum 2026-09-02 ein lokales `fensterNachVorn`: `bringToFront` plus
    // `osascript activate`, dreimal, danach Abbruch. Das ist die aeltere Linie, die
    // niemand nachgezogen hat — `requireVisible` eskaliert seit dem 2026-08-24 ueber
    // `show()/moveTop()/focus()` bis `setAlwaysOnTop`, und genau die zweite Stufe traegt
    // den haeufigsten Alltagsfall: ein Fenster, das ein anderes VOLLSTAENDIG verdeckt.
    // Gemessen an diesem Repo am 2026-09-02: bei vier offenen Obsidian-Fenstern brach die
    // lokale Fassung ab („Fenster bleibt im Hintergrund"), waehrend nichts kaputt war.
    //
    // Zweiter Unterschied, der denselben Lauf killt: die lokale Fassung verlangte
    // `document.hasFocus()`. Das ist strenger als noetig — laeuft der Treiber aus einem
    // Terminal, hat das Fenster den Tastaturfokus nicht, obwohl es sichtbar ist und der
    // DOM einwandfrei misst. `requireVisible` prueft `visibilityState`, und das ist die
    // Bedingung, an der die Timer-Drosselung tatsaechlich haengt.
    await requireVisible(cdp);

    const aktiv = await cdp.evaluate<boolean>(
      `return !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];`,
    );
    if (!aktiv) throw new Error(`Plugin „${PLUGIN_ID}" ist in diesem Vault nicht aktiv.`);

    // Laeuft dieser Lauf gegen den eigenen Stand? `manifest.version` ist dafuer strukturell
    // blind — Store-Build und Repo-Build tragen dieselbe Nummer. Am 2026-08-30 standen
    // deshalb 69 von 150 gruenen Pruefpunkten einer ganzen Runde auf unbelegtem Code, und
    // der 25/25-Lauf dieses Repos vom 28.08. war einer davon.
    //
    // Der Pfad kommt aus der LAUFENDEN Instanz, nicht aus einer Konvention: der Treiber
    // dockt per --vault an ein beliebiges Fenster an, ein konfigurierter Pfad pruefte
    // sonst eine Datei, die mit dem Lauf nichts zu tun hat (Lesson 2026-09-02).
    const ort = await cdp.evaluate<{ basePath: string; configDir: string }>(`
      return { basePath: app.vault.adapter.basePath, configDir: app.vault.configDir };
    `);
    const herkunft = requireEigenerBuild(
      join(ort.basePath, ort.configDir, "plugins", PLUGIN_ID, "main.js"),
      join(process.cwd(), "main.js"),
    );
    console.log(`Build im Vault: ${herkunft.art} (sha1 ${"sha1" in herkunft ? herkunft.sha1.slice(0, 12) : "?"}…)`);

    vorwerte = await cdp.evaluate(`
      const s = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings;
      return { budgetMs: s.budgetMs, confirmThreshold: s.confirmThreshold, defaultScope: s.defaultScope };
    `);

    // Schwelle unter die Zahl der Buehnen-Notizen: der Bestaetigungsdialog soll kommen.
    await setPluginSetting(cdp, PLUGIN_ID, "confirmThreshold", 3);

    await buehneAufbauen(cdp);
    await closeExtraLeaves(cdp);
    await panelOeffnen(cdp);

    const offen = await cdp.evaluate<number>(
      `return app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)}).length;`,
    );
    record("Panel laesst sich oeffnen", offen > 0, `${offen} Panel-Blatt/Blaetter`);
    if (offen === 0) throw new Error("Panel nicht offen — die weiteren Punkte messen sonst nichts.");

    // Obsidian indexiert einen frisch geoeffneten Vault asynchron: der erste Durchlauf
    // sah 1065 von 4002 Notizen. Warten, bis die Zahl steht — sonst misst der
    // Abbruch-Punkt an einem Viertel des Vaults und ist zu schnell durch.
    let kandidaten = 0;
    for (let i = 0; i < 30; i++) {
      const jetzt = await cdp.evaluate<number>(`return app.vault.getMarkdownFiles().length;`);
      if (jetzt === kandidaten && jetzt > 0) break;
      kandidaten = jetzt;
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.log(`Vault: ${kandidaten} Notizen`);

    await abschnitt("Umfang", () => abschnittUmfang(cdp));
    // Die Vorschau ist das Tor zu drei weiteren Abschnitten — ihr Ergebnis wird gebraucht,
    // ein Absturz darf es aber nicht zu `true` machen.
    let vorschau = false;
    await abschnitt("Vorschau", async () => { vorschau = await abschnittVorschau(cdp); });
    if (vorschau) {
      let undo = false;
      await abschnitt("Anwenden", async () => { undo = await abschnittAnwenden(cdp); });
      if (undo) await abschnitt("Rueckgaengig", () => abschnittRueckgaengig(cdp));
      await abschnitt("Unvollstaendig", () => abschnittUnvollstaendig(cdp));
    }
    await abschnitt("Datei-Anwenden", () => abschnittDateiAnwenden(cdp));
    await abschnitt("Abbruch", () => abschnittAbbruch(cdp, kandidaten));
    await abschnitt("Setter", () => abschnittSetter(cdp));
    await abschnitt("llm-lab", () => abschnittLlmLab(cdp));
    await abschnitt("Manager", () => abschnittManager(cdp));
    await abschnitt("Hilfe", () => abschnittHilfe(cdp));
    await abschnitt("i18n", () => abschnittI18n(cdp));
  } finally {
    // Nimmt zurueck, was `requireVisible` in seiner letzten Stufe gesetzt haben kann —
    // ohne den Aufruf klebt das Fenster nach dem Lauf weiter ueber allem anderen.
    await releaseAlwaysOnTop(cdp);
    if (vorwerte) {
      await setPluginSetting(cdp, PLUGIN_ID, "budgetMs", vorwerte.budgetMs);
      await setPluginSetting(cdp, PLUGIN_ID, "confirmThreshold", vorwerte.confirmThreshold);
      await setPluginSetting(cdp, PLUGIN_ID, "defaultScope", vorwerte.defaultScope);
    }
    if (!KEEP) {
      await buehneAbbauen(cdp);
      // Die Snapshots dieses Laufs gehoeren nicht in den Vault des Nutzers.
      await cdp.evaluate(`
        const root = app.vault.configDir + "/plugins/${PLUGIN_ID}/snapshots";
        if (await app.vault.adapter.exists(root)) await app.vault.adapter.rmdir(root, true);
        return true;
      `);
    }

    const rot = checks.filter((c) => c.zustand === "rot");
    const uebersprungen = checks.filter((c) => c.zustand === "uebersprungen");
    const gruen = checks.filter((c) => c.zustand === "gruen");
    console.log(
      `\n${gruen.length} grün · ${uebersprungen.length} übersprungen · ${rot.length} rot`
      + ` (von ${checks.length} Prüfpunkten)`,
    );
    for (const c of rot) console.log(`  ✗ ${c.name} — ${c.detail}`);
    // Uebersprungene mit ausgeben: ein Punkt, der nicht gemessen wurde, ist eine offene
    // Frage — und offene Fragen gehoeren in die Schlusszeile, nicht nur ins Protokoll.
    for (const c of uebersprungen) console.log(`  · ${c.name} — ${c.detail}`);
    cdp.close();
    if (rot.length > 0) process.exitCode = 1;
  }
}

await main();
