/**
 * GUI-Smoke-Treiber — faehrt die Pruefpunkte aus `docs/SMOKE.md` gegen ein **laufendes**
 * Obsidian statt von Hand.
 *
 * Warum getrackt (CORE-TEST-02 b): 0.5.0 schreibt erstmals in Dateien, die in keinem
 * Editor offen sind. Genau dort hilft weder ein Unit-Test (der Vault ist gemockt) noch
 * Obsidians Undo-Stack. Die drei Releases davor haben ihre echten Fehler samt und sonders
 * im GUI-Durchlauf gefunden und keinen einzigen im Gate.
 *
 * Der Treiber kommt **ohne LLM aus**: die Regel wird ueber den Handpfad gesetzt
 * („oder Regex selbst schreiben"). Ein Smoke, der an einem Modell haengt, misst das
 * Modell mit.
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

// --- Abschnitt: i18n ---------------------------------------------------------

/** Sprache des Panels — fuer die Knoepfe, deren Beschriftung gelesen werden muss. */
async function panelSprache(cdp: Cdp): Promise<"de" | "en"> {
  const roh = await cdp.evaluate<string>(`return window.localStorage.getItem("language") || "en";`);
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
    await abschnitt("Abbruch", () => abschnittAbbruch(cdp, kandidaten));
    await abschnitt("Setter", () => abschnittSetter(cdp));
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
