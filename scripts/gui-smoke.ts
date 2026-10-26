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
 * Zweitinstanz mit eigenem Profil und eigenem Port, nie die regulaere Instanz (kein `quit`,
 * kein Neustart fremder Fenster). `--port` ist Pflicht.
 *
 * ```bash
 * UD=/tmp/obs-test-obsidian-transmute; mkdir -p "$UD"
 * lsof -nP -iTCP:<port> -sTCP:LISTEN; pgrep -f "user-data-dir=$UD"      # beides leer
 * cp ~/Library/Application\ Support/obsidian/obsidian-*.asar "$UD"/      # aktuelle Version
 * # $UD/obsidian.json: {"vaults":{"nt":{"path":"$STAGING_VAULTS_DIR/obsidian-transmute","ts":1,"open":true}},"language":"en"}
 * python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label obsidian-transmute --intent "GUI-Smoke" --exclusive focus --port <port> --ttl 300
 * OBSIDIAN_PLUGIN_DIR="$STAGING_VAULTS_DIR/obsidian-transmute/.obsidian/plugins/transmute" npm run deploy
 * /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$UD" --remote-debugging-port=<port> &
 * npm run smoke:gui -- --port <port>
 * python3 ~/.claude/hooks/obsidian-cdp-lock.py release
 * ```
 *
 * Vertrauensdialog, Restricted Mode und Aktivierung erledigt `bereiteInstanzVor` im Treiber.
 * Je Messlauf ein frischer Prozess; der erste Lauf nach einer Profilanlage ist ein Aufwaermlauf.
 * Flags: `--vault <name>` (Default `obsidian-transmute`), `--keep`, `--halten <ms>` (Haltedauer zwischen Press und Release),
 * `--klick-gegenprobe` (es wird NICHT geklickt; jeder klickabhaengige Punkt muss rot oder „nichts gemessen“ werden, nie gruen).
 * Klicks laufen ueber EINEN Weg (`klicke`, echter Mausklick); Ctrl-C raeumt ueber das Abbruch-Modul der Bruecke auf.
 *
 * Exit 0 gruen/uebersprungen, 1 bei Rot oder „nichts gemessen", 2 bei Abbruch.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { attachTo, beimAbbruch, bereiteInstanzVor, Cdp, entferneFakeManager, installFakeManager, closeExtraLeaves, istAbgebrochen, klicke, notices, pollUntil, releaseAlwaysOnTop, requireVisible, schliesseEinstellungen, setPluginSetting }
  from "../../tools/obsidian-cdp/cdp.js";
import { boxOf, capture } from "../../tools/obsidian-cdp/shot.js";
import { startLlmStub } from "../../tools/obsidian-cdp/llm-stub.js";
import { createBilanz, parseArgs, runDriver, Vorbedingung } from "../../tools/obsidian-cdp/bilanz.js";
import { requireEigenerBuild } from "../../tools/obsidian-cdp/vault.js";
import { LAB_API_VERSION } from "../src/vendor/kit-obsidian/lab-client";

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
const STUB_CLOSE_FRIST_MS = 5_000;

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.value("port") ?? "");
const VAULT = args.value("vault") ?? "obsidian-transmute";
const KEEP = args.has("keep");

// --- Pruefpunkte -------------------------------------------------------------

/** Soll-Liste je Abschnitt — der Nenner der Bilanz (CORE-TEST-19). Ein Punkt, der nie
 *  aufgezeichnet wird (Abschnitt abgebrochen, Vorbedingung fehlt), zaehlt als „nichts gemessen"
 *  und setzt Exit 1; er erscheint nie als gruen. Zweig-Alternativen eines Punkts tragen
 *  denselben Namen. */
const ABSCHNITTE: Record<string, readonly string[]> = {
  Umfang: [
    "Bereich Vault zeigt den Umfangs-Block",
    "Kandidatenzahl nennt Treffer und Gesamtzahl",
    "Ordner-Filter grenzt ein",
    "Leerer Umfang meldet sich als solcher",
    "Vorschau-Knopf ist bei leerem Umfang gesperrt",
  ],
  Vorschau: [
    "Vorschau listet betroffene Dateien",
    "Dateien starten eingeklappt",
    "Zusammenfassung nennt Dateien und Treffer",
    "Aufklappen zeigt die Treffer der Datei",
    "Teilweise gewaehlte Datei zeigt den Teil-Zustand",
  ],
  Anwenden: [
    "Bestaetigungsdialog erscheint ueber der Schwelle",
    "Anwendung meldet ihr Ergebnis",
    "Die Ersetzung steht wirklich in der Datei",
    "Snapshot liegt auf der Platte",
    "Rueckgaengig-Knopf steht bereit",
  ],
  Rueckgaengig: [
    "Unveraenderte Datei wird wiederhergestellt",
    "Seither bearbeitete Datei bleibt unangetastet",
    "Uebersprungene Datei wird benannt",
  ],
  Unvollstaendig: ["Unvollstaendig gemessene Datei ist gesperrt"],
  "Datei-Anwenden": [
    "Erstes Anwenden ersetzt beide Treffer in der Notiz",
    "Regex bleibt nach Anwenden stehen, statt zu leeren",
    "Zweites Anwenden mit Aenderung dazwischen greift ohne neues Pinnen",
    "Zuruecksetzen fragt nach, Abbrechen laesst die Runde stehen",
    "Zuruecksetzen leert die Runde bewusst",
  ],
  Hub: [
    "T1 Hub-Leiste: zwei Tabs, Icons gerendert, Arbeitsbereich aktiv",
    "T2 Bibliothek listet die gespeicherte Regel mit Ausfuehren-Knopf",
    "T3 Ausfuehren wechselt in den Arbeitsbereich und setzt die Regel",
  ],
  Abbruch: ["Renderer atmet waehrend des Laufs", "Abbrechen beendet den Lauf"],
  Setter: [
    "Bereich „Vault\" ueberlebt den Einstellungs-Setter",
    "Bereich „Vault\" ueberlebt das Neuladen des Plugins",
    "Frisch geoeffnetes Panel kennt die Kandidaten sofort",
  ],
  "llm-lab": ["llm-lab-Meldestrecke (Konsumenten-Seite): feature/turnId/promptTemplate/Nachrichten korrekt gemeldet"],
  Verbindung: [
    "V1 Schwaerzung: der Transport sieht den Platzhalter, die Regel kommt im Original an",
    "V2 Schluessel wandert in den Schluesselbund und erreicht den Server trotzdem",
    "V3 Anfrage: ohne Stream, Temperatur 0, ohne Denken",
    "V4 Schwaerzung mit PEM: das JSON bleibt gueltig, das mehrzeilige Original ist da",
  ],
  Gemma: ["K1 Gemma-Stub: Denken ohne Oeffner vor <channel|> im Antworttext, die Regel ist die Antwort, nicht ein Entwurf aus dem Denken"],
  Linkschutz: ["LK1 Link-Waechter: ein gekappter Link im Denktext sieht aus wie Text (Farbe, Unterstrich, Zeiger, Icon), ein Link mit Ziel bleibt ein Link"],
  Manager: [
    "M1 Einstellungen zeigen den Manager statt der lokalen Liste",
    "M2 Lauf nutzt den Manager-Endpunkt und dessen Standardmodell",
    "M2b Die Modellwahl des Nutzers schlaegt den Standard des Endpunkts",
    "M3 Manager aus: lokale Liste in den Einstellungen und im Lauf",
    "M4 Abgeschalteter Wunsch-Endpunkt: die Meldung nennt den Manager-Grund",
  ],
  "Apple Intelligence": [
    "S1 Fake-Manager liefert den Apple-Endpunkt nur bei Opt-in",
    "S2 Dropdown zeigt „Apple Intelligence (on-device)“",
    "S3 Wahl → Quelle traegt transport shortcuts",
    "S4 Lauf oeffnet die shortcuts://-URL mit dem gefalteten Prompt",
    "S5 Zeitueberschreitung des Kurzbefehls zeigt die Kurzbefehl-Meldung",
  ],
  Claude: [
    "CL1 Fake-Manager mit Anbieter anthropic: der Endpunkt kommt nur mit Opt-in, das Plugin waehlt ihn",
    "CL2 Lauf gegen den Claude-Stub: Messages-API mit Schluessel, kein temperature im Body, override-dropped in Letzte Anfrage, die Regel kommt zurueck",
    "CL3 Fehler der API (529 overloaded): der Lauf endet im Fehlerzustand mit der Meldung der API",
  ],
  Hilfe: ["H1 Hilfe-Zeile ist die erste Zeile der Einstellungen"],
  Denken: [
    "D1 Denk-Knopf (Kit-Baustein) schaltet die Stufe des Modus structured und zeigt den Zustand",
    "D2 Modell ohne „aus“ (gpt-oss): das Label nennt „lowest level“ samt Hinweis im aria-label statt „Thinking off“, der Knopf bleibt bedienbar",
  ],
  Modellzeile: [
    "MZ1 Modellzeile im Panel (Fake-Manager, zwei Modelle): Liste, Standard-Modell im Namen von Automatisch, ein Wechsel schreibt choice.model, Automatisch leert sie",
    "MZ2 Ein Voll-Draw (draw() der View, wie beim Phasenwechsel) laesst die Zeile stehen: dasselbe Element, Fokus und Wahl bleiben (Gegenprobe: ein Feld im gezeichneten Bereich wird ersetzt)",
    "MZ3 Die Zeile ist waehrend der Erzeugung gesperrt und danach wieder bedienbar",
    "MZ4 Der Denk-Knopf in der Zeile folgt der Quelle: Claude via Manager nennt die niedrigste Stufe mit dem Grund, ein lokales Modell ohne bekannte Familie bleibt bei „Thinking off“",
  ],
  "Globales Modell": [
    "G1 Altwert wandert in die Zeile, kein globales Modell in den Einstellungen",
    "G2 Panel-Modellwahl (ueber das Dropdown der Modellzeile) schreibt in die aktive Zeile, Automatisch leert sie",
  ],
  i18n: ["Panel zeigt keinen rohen Uebersetzungs-Schluessel"],
};
const PUNKTE: readonly string[] = ["Panel laesst sich oeffnen", ...Object.values(ABSCHNITTE).flat()];

const bilanz = createBilanz({ punkte: PUNKTE });

/** gruen/rot. Ein Name ausserhalb von `PUNKTE` wirft — Tippfehlerschutz der Soll-Liste. */
function record(name: string, passed: boolean, detail: string): void {
  bilanz.record(name, passed, detail);
}

/** Nicht anwendbar in dieser Lage (Lauf schon fertig, Budget) — zaehlt als uebersprungen, Exit 0. */
function skipped(name: string, reason: string): void {
  bilanz.skipped(name, reason);
}

/** Gegenstand nicht erreicht (Vorbedingung, Zugang, fremder Zustand) — „nichts gemessen", Exit 1. */
function unmeasured(name: string, reason: string): void {
  bilanz.unmeasured(name, reason);
}

/** Setzt jeden noch nicht aufgezeichneten Punkt des Abschnitts auf „nichts gemessen". */
function offeneUnmeasured(abschnittName: string, grund: string): void {
  const da = new Set(bilanz.eintraege().map((p) => p.name));
  for (const n of ABSCHNITTE[abschnittName] ?? []) if (!da.has(n)) unmeasured(n, grund);
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

/** Klick-Modus (`--halten <ms>`, `--klick-gegenprobe`), gesetzt in `main`. EIN Klick-Weg: kein Prüfpunkt klickt am Modus vorbei,
 *  sonst griffe die Gegenprobe nur bei der Hälfte (README der Brücke § Klick-Modus). */
const KLICK = args.klickModus();

/** Echter Mausklick über `klicke` (Lage, Haltedauer, Gegenprobe). `false` heißt: Ziel nicht im DOM oder unsichtbar — ein
 *  Werkzeugproblem, das der Aufrufer als „Knopf nicht gefunden“ meldet; in der Gegenprobe ist ein vorhandenes Ziel `true`,
 *  obwohl nicht geklickt wurde (die abhängigen Punkte müssen dann rot werden). */
async function klickAusdruck(cdp: Cdp, ausdruck: string): Promise<boolean> {
  const r = await klicke(cdp, ausdruck, KLICK);
  if (!r.ok) console.log(`  ${r.hinweis}`);
  await new Promise((res) => setTimeout(res, 250));
  return r.ok;
}

async function click(cdp: Cdp, selector: string, index = 0): Promise<boolean> {
  return klickAusdruck(cdp, `document.querySelectorAll(${JSON.stringify(selector)})[${index}]`);
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
  return klickAusdruck(cdp, `[...(document.querySelector(${JSON.stringify(root)})?.querySelectorAll("button") ?? [])]
    .find((b) => b.textContent.trim() === ${JSON.stringify(label)})`);
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
  const ok = await klickAusdruck(cdp, `[...document.querySelectorAll(".transmute-scope-btn")]
    .find((b) => b.textContent.trim() === ${JSON.stringify(label)})`);
  await new Promise((r) => setTimeout(r, 350));
  return ok;
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
    throw new Vorbedingung("Knopf „oder Regex selbst schreiben“ nicht gefunden");
  }
  await fill(cdp, ".transmute-regex", ALT);
  await fill(cdp, ".transmute-replacement-input", NEU);
  await cdp.evaluate("await new Promise((r) => setTimeout(r, 700)); return true;");

  const berechnet = await click(cdp, ".transmute-compute");
  if (!berechnet) {
    throw new Vorbedingung("Knopf „Vorschau berechnen“ fehlt");
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

  // Vorbedingung des Punkts: die Datei steht im ERSETZTEN Zustand. Ohne sie ist „ALT steht wieder drin“ trivial wahr (der
  // Endzustand ist auch der Ausgangszustand) und der Punkt bliebe grün, selbst wenn Anwenden nie lief — die Falle der
  // Klick-Gegenprobe (Task „GUI-Smoke braucht eine Klick-Gegenprobe“, Befund json-editor). Die Gegenprobe selbst stoppt schon
  // am Tor (`abschnittAnwenden` liefert dann kein Undo, dieser Abschnitt läuft nicht → „nichts gemessen“, nie grün).
  const vorUndo = await notizText(cdp, 0);
  const ersetzt = (vorUndo ?? "").includes(NEU) && !(vorUndo ?? "").includes(ALT);

  await click(cdp, ".transmute-undo");
  await cdp.evaluate("await new Promise((r) => setTimeout(r, 1200)); return true;");

  const wieder = await notizText(cdp, 0);
  record(
    "Unveraenderte Datei wird wiederhergestellt",
    ersetzt && (wieder ?? "").includes(ALT) && !(wieder ?? "").includes(NEU),
    `vorher ersetzt: ${ersetzt}; danach enthaelt „${ALT}": ${(wieder ?? "").includes(ALT)}`,
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
    throw new Vorbedingung("Knopf „oder Regex selbst schreiben“ nicht gefunden");
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

  // Mit Vorschau fragt „Reset“ nach (Funktions-Inventur): erst Abbrechen (Gegenprobe: die Runde bleibt), dann Bestaetigen.
  const modalKlick = (label: string): Promise<boolean> => clickByText(cdp, ".modal-container", label);
  await clickByText(cdp, ".transmute-actions", labelReset);
  await cdp.evaluate("await new Promise((r) => setTimeout(r, 300)); return true;");
  const fragtNach = await exists(cdp, ".modal-container .modal-button-container");
  const abgebrochen = fragtNach && (await modalKlick(sprache === "de" ? "Abbrechen" : "Cancel"));
  await cdp.evaluate("await new Promise((r) => setTimeout(r, 300)); return true;");
  const nachAbbruchGepinnt = await exists(cdp, ".transmute-pinned");
  record("Zuruecksetzen fragt nach, Abbrechen laesst die Runde stehen", fragtNach && abgebrochen && nachAbbruchGepinnt,
    `Rueckfrage ${fragtNach ? "da" : "FEHLT"}, Abbrechen ${abgebrochen ? "geklickt" : "nicht geklickt"}, Pinned-Hinweis ${nachAbbruchGepinnt ? "noch da" : "WEG"}`);

  await clickByText(cdp, ".transmute-actions", labelReset);
  await cdp.evaluate("await new Promise((r) => setTimeout(r, 300)); return true;");
  await modalKlick(labelReset);
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
    skipped("Abbrechen beendet den Lauf", `nur ${kandidaten} Kandidaten — kein laufender Lauf zum Abbrechen`);
    return;
  }

  // Abschnitt Datei-Anwenden endet im Bereich „Notiz" und mit „Zuruecksetzen": das Panel hat
  // dann weder Kandidatenzeile noch Musterfeld, „Vorschau berechnen" ist nicht da. Bereich
  // „Vault" (Position 2, sprachunabhaengig) und den Handpfad wiederherstellen.
  await click(cdp, ".transmute-scope-btn", 2);
  await cdp.evaluate("await new Promise((r) => setTimeout(r, 400)); return true;");
  await fill(cdp, ".transmute-folder", "");
  if (!(await exists(cdp, ".transmute-regex"))) await click(cdp, ".transmute-manual-link");
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
    const grund = `Fenster nicht nach vorn zu holen: ${(fehler as Error).message.split("\n")[0]}`;
    unmeasured("Renderer atmet waehrend des Laufs", grund);
    unmeasured("Abbrechen beendet den Lauf", grund);
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
      return { yields: -1, runden: -1, abortSichtbar: false, dauer: 0, refMs, gestartet: false, hidden: document.hidden, vorher, muster, zeilen: -1, kopf: !compute ? "Knopf fehlt" : "Knopf gesperrt" };
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
    unmeasured("Renderer atmet waehrend des Laufs", `Vorschau-Knopf war nicht bedienbar (${mess.kopf}; Muster „${mess.muster}"; Kandidaten: ${mess.vorher})`);
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
    unmeasured(
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
    unmeasured("Bereich „Vault\" ueberlebt den Einstellungs-Setter", "Settings-Tab nicht greifbar");
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
 * mit statt die Meldestrecke. `requestUrl` (Transport der Verbindung: `requestUrlTransport` aus dem Kit)
 * umgeht CORS — die OPTIONS/CORS-Antwort ist trotzdem eingebaut (REGISTRY GUI-Smoke-Zeile,
 * Befund koda), defensiv fuer den Fall, dass der Renderer den Request je ueber `fetch`
 * schickt statt ueber `requestUrl`.
 */
async function startFakeEndpoint(
  draft: { regex: string; flags: string; replacement: string; explanation: string },
  opts: { echoPlaceholder?: boolean } = {},
): Promise<{ url: string; close: () => Promise<void>; chatCalls: () => number; lastModel: () => string; lastBody: () => string; lastAuth: () => string }> {
  // Der zentrale Stub (Welle 20): `stream:false` bekommt JSON, die Pfade sind streng (alles
  // ausser GET /v1/models und POST /v1/chat/completions ist 404 — der alte Server antwortete auf
  // jeden fremden Pfad mit 200 {"ok":true}).
  const stub = await startLlmStub({
    models: ["smoke-model"],
    antwort: (anfrage) => {
      // Schwaerzung: das Modell sieht Platzhalter `[redacted-<art>-<n>]`; spiegelt es einen in `regex`
      // zurueck, muss das Plugin das Original sehen (umkehrbar).
      const platzhalter = opts.echoPlaceholder === true ? /\[redacted-[a-z-]+-\d+\]/.exec(anfrage.body)?.[0] : undefined;
      return { text: JSON.stringify(platzhalter !== undefined ? { ...draft, regex: platzhalter } : draft) };
    },
  });
  return {
    url: stub.url,
    // Mit Frist: laeuft sie ab, ist der Abschnitt „nichts gemessen“ (Vorbedingung), kein stilles
    // Haengen (Verdacht fuer „Smoke haengt nach M3“).
    close: async () => {
      let timer: NodeJS.Timeout | undefined;
      const frist = new Promise<"frist">((resolve) => { timer = setTimeout(() => { resolve("frist"); }, STUB_CLOSE_FRIST_MS); });
      const zu = stub.stop().then(() => "zu" as const);
      const ende = await Promise.race([zu, frist]);
      clearTimeout(timer);
      if (ende === "frist") throw new Vorbedingung(`Stub-Server schloss nicht binnen ${STUB_CLOSE_FRIST_MS} ms`);
    },
    chatCalls: () => stub.zaehler().chat,
    // Modell mitschneiden: ein Lauf „ging durch" belegt nicht, WELCHES Modell ankam.
    lastModel: () => {
      const letzte = stub.letzte("chat");
      if (!letzte) return "";
      return letzte.json === null ? "?" : String((letzte.json as { model?: unknown }).model ?? "");
    },
    lastBody: () => stub.letzte("chat")?.body ?? "",
    lastAuth: () => String(stub.letzte("chat")?.header.authorization ?? ""),
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
    unmeasured(
      ABSCHNITTE["llm-lab"]![0]!,
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
          // Die Version kommt aus dem Client, den der Stub prueft — eine eigene Zahl altert mit ihm (Lesson 2026-09-25).
          apiVersion: ${LAB_API_VERSION},
          status: () => ({ apiVersion: ${LAB_API_VERSION}, recording: true }),
          log: (input) => { window.__transmuteLabSeen.push(input); return "smoke-" + window.__transmuteLabSeen.length; },
        },
      };
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.endpoints = [{ url: ${JSON.stringify(fake.url)} }];
      await p.saveSettings();
      // Die Verbindung merkt sich die Aufloesung des lokalen Endpunkts bis invalidate(). Hat ein
      // frueherer Abschnitt (Modell-Liste laden, Settings-Tab) bereits aufgeloest — z. B. auf den
      // echten Default ":1234" —, wuerde dieser Merker den Stub-Endpunkt sonst stillschweigend
      // ignorieren und die Anfrage ginge an einen echten, moeglicherweise langsamen/inkompatiblen
      // Server: „generating" haengt dann unbegrenzt, ohne dass der Stub je einen Request sieht
      // (gemessen an genau diesem Punkt, Welle 7).
      p.llm.invalidate();
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
      p.llm.invalidate();
      return true;
    `).catch(() => undefined);
  }
}

// --- Abschnitt: Gemma-Kanal (Welle 23) -------------------------------------------

/** G1 — gemma-4 auf LM Studio ignoriert „none“ und schreibt sein Denken OHNE Oeffner in den Antworttext, beendet es mit `<channel|>`
 *  (gemessen 2026-10-14). Transmute fragt ohne Stream und liest die Regel als JSON aus dem Antworttext; ohne den Kanal-Leser im
 *  Chat-Client (Kit 0.60.3) steht das Denken vor dem JSON, und die Regel scheitert. Der Stub spielt das Format nach.
 *  Auf dem Stand vor der Hebung ist dieser Punkt rot — die Gegenprobe: das Denken enthaelt einen verworfenen JSON-Entwurf, den ein Leser ohne Kanal-Erkennung als Regel nimmt. */
async function abschnittGemma(cdp: Cdp): Promise<void> {
  const NAME = ABSCHNITTE.Gemma![0]!;
  const MODELL = "google/gemma-4-e4b";
  const DENKEN = "The user wants me to replace foo with bar.\nA first draft: {\"regex\":\"fo+\",\"flags\":\"\",\"replacement\":\"baz\",\"explanation\":\"draft\"}\nNo, that is too broad. I will write the final rule as JSON.";
  const draft = { regex: "foo", flags: "", replacement: "bar", explanation: "e" };
  const stub = await startLlmStub({ models: [MODELL], antwort: () => ({ text: `${DENKEN}<channel|>${JSON.stringify(draft)}`, model: MODELL }) });
  const vor = await cdp.evaluate<unknown>(`return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.endpoints;`);
  try {
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.endpoints = [{ url: ${JSON.stringify(stub.url)}, model: ${JSON.stringify(MODELL)} }];
      await p.saveSettings();
      p.llm.invalidate();
      await p.llm.resolve({ force: true });
      void p.sessionInstance.generate("Smoke: ersetze foo", "foo bar");
      return true;
    `);
    const fertig = await pollUntil<{ phase: string; regex: string | null; fehler: string }>(
      cdp,
      `
        const st = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].sessionInstance.state;
        if (st.phase === "preview") return { phase: st.phase, regex: st.versions[st.active].rule.regex, fehler: "" };
        if (st.phase === "error") return { phase: st.phase, regex: null, fehler: String(st.error ?? st.message ?? "").slice(0, 120) };
        return null;
      `,
      15_000,
    );
    record(NAME, fertig !== null && fertig.phase === "preview" && fertig.regex === "foo",
      fertig === null ? "keine Antwort innerhalb 15s" : `Phase ${fertig.phase}, Regel „${fertig.regex ?? "(Fehler)"}“${fertig.fehler !== "" ? ` · ${fertig.fehler}` : ""}`);
  } finally {
    await stub.stop().catch(() => undefined);
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.endpoints = ${JSON.stringify(vor)};
      await p.saveSettings();
      p.llm.invalidate();
      return true;
    `).catch(() => undefined);
  }
}

// --- Abschnitt: Linkschutz (Welle 28) ---------------------------------------------

/** Der Denktext des Modells geht durch `neutralizeModelMarkdown` und den DOM-Waechter (`renderMarkdownGuarded`, `.transmute-reasoning-body`). Der Waechter
 *  nimmt einem gefaehrlichen Link das `href`, laesst aber Klasse und Pfeil stehen: ohne die zwei Regeln der Kopie von `STREAM_AREA_CSS` (Kit 0.72.0, hier mit
 *  eigenem Vorfahren) sieht der Link weiter aus wie einer und tut nichts. Gemessen im echten Renderer am echten Weg (Gemma-Stub: Denktext vor `<channel|>`). */
async function abschnittLinkschutz(cdp: Cdp): Promise<void> {
  const NAME = ABSCHNITTE.Linkschutz![0]!;
  const MODELL = "google/gemma-4-e4b";
  const DENKEN = "Ich pruefe [gekappt](javascript:alert(1)) und [Ziel](https://example.org/x) und rechne dann.";
  const draft = { regex: "foo", flags: "", replacement: "bar", explanation: "e" };
  const stub = await startLlmStub({ models: [MODELL], antwort: () => ({ text: `${DENKEN}<channel|>${JSON.stringify(draft)}`, model: MODELL }) });
  const vor = await cdp.evaluate<unknown>(`return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.endpoints;`);
  try {
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.endpoints = [{ url: ${JSON.stringify(stub.url)}, model: ${JSON.stringify(MODELL)} }];
      await p.saveSettings();
      p.llm.invalidate();
      await p.llm.resolve({ force: true });
      void p.sessionInstance.generate("Smoke: ersetze foo", "foo bar");
      return true;
    `);
    const roh = await pollUntil<string>(
      cdp,
      `
        const st = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].sessionInstance.state;
        if (st.phase === "error") return JSON.stringify({ fehler: String(st.error ?? st.message ?? "").slice(0, 120) });
        if (st.phase !== "preview") return null;
        const zone = document.querySelector(".transmute-reasoning-body");
        if (!zone || zone.querySelectorAll("a").length < 2) return null;
        const werte = (a) => { const c = getComputedStyle(a); return { href: a.getAttribute("href"), text: a.textContent, color: c.color, deko: c.textDecorationLine, zeiger: c.cursor, bild: c.backgroundImage, rechts: c.paddingRight }; };
        return JSON.stringify({ eltern: getComputedStyle(zone).color, links: [...zone.querySelectorAll("a")].map(werte) });
      `,
      15_000,
    );
    if (roh === null) { unmeasured(NAME, "der Denktext mit zwei Links kam nicht in `.transmute-reasoning-body` an (Vorschau nie erreicht oder Denktext leer)"); return; }
    const d = JSON.parse(roh) as { fehler?: string; eltern?: string; links?: { href: string | null; text: string; color: string; deko: string; zeiger: string; bild: string; rechts: string }[] };
    if (d.fehler !== undefined || d.eltern === undefined || d.links === undefined) { unmeasured(NAME, `Lauf endete im Fehler: ${d.fehler ?? "?"}`); return; }
    const gekappt = d.links.find((l) => l.text === "gekappt");
    const ziel = d.links.find((l) => l.text === "Ziel");
    if (!gekappt || !ziel) { unmeasured(NAME, `Links im Denktext: ${JSON.stringify(d.links.map((l) => l.text))}`); return; }
    const wieText = gekappt.href === null && gekappt.color === d.eltern && gekappt.deko === "none" && gekappt.zeiger !== "pointer" && gekappt.bild === "none" && gekappt.rechts === "0px";
    const bleibtLink = ziel.href !== null && (ziel.deko !== "none" || ziel.color !== d.eltern || ziel.zeiger === "pointer");
    record(NAME, wieText && bleibtLink,
      `gekappt (href ${gekappt.href}): Farbe ${gekappt.color} (Text ${d.eltern}), Linie ${gekappt.deko}, Zeiger ${gekappt.zeiger}, Icon ${gekappt.bild === "none" ? "keins" : "DA"}, Abstand ${gekappt.rechts} · mit Ziel (Gegenprobe): Farbe ${ziel.color}, Linie ${ziel.deko}, Zeiger ${ziel.zeiger}`);
  } finally {
    await stub.stop().catch(() => undefined);
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.endpoints = ${JSON.stringify(vor)};
      await p.saveSettings();
      p.llm.invalidate();
      return true;
    `).catch(() => undefined);
  }
}

// --- Abschnitt: Verbindung (Welle 15) -------------------------------------------

/** Die Kit-Verbindung traegt drei Zusagen, die kein Unit-Test beruehrt: (V1) Schwaerzung — der
 *  Transport sieht den Platzhalter, die Regel des Plugins das Original; (V2) der Schluessel liegt
 *  im Schluesselbund, nicht in data.json, und kommt trotzdem als Authorization-Kopf an; (V3) die
 *  Anfrage geht ohne Stream, mit Temperatur 0 und im Modus „structured“ (kein Denken). */
async function abschnittVerbindung(cdp: Cdp): Promise<void> {
  const NAMEN = [
    "V1 Schwaerzung: der Transport sieht den Platzhalter, die Regel kommt im Original an",
    "V2 Schluessel wandert in den Schluesselbund und erreicht den Server trotzdem",
    "V3 Anfrage: ohne Stream, Temperatur 0, ohne Denken",
    "V4 Schwaerzung mit PEM: das JSON bleibt gueltig, das mehrzeilige Original ist da",
  ] as const;
  const TOKEN = "Bearer Zk3QpWv8LmN2xY7aTb5RcD9e";
  const fake = await startFakeEndpoint({ regex: "foo", flags: "", replacement: "bar", explanation: "e" }, { echoPlaceholder: true });
  const vor = await cdp.evaluate<{ endpoints: unknown }>(
    `const s = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings; return { endpoints: s.endpoints };`,
  );
  try {
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.endpoints = [{ url: ${JSON.stringify(fake.url)}, apiKey: "smoke-secret-key-12345" }];
      await p.saveSettings();
      p.llm.invalidate();
      await p.llm.resolve({ force: true });
      void p.sessionInstance.generate("Smoke: ersetze das Token", "Kopfzeile\\nAuthorization: ${TOKEN}\\nFusszeile");
      return true;
    `);
    const fertig = await pollUntil<{ phase: string; regex: string | null }>(
      cdp,
      `
        const st = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].sessionInstance.state;
        if (st.phase === "preview") return { phase: st.phase, regex: st.versions[st.active].rule.regex };
        if (st.phase === "error") return { phase: st.phase, regex: null };
        return null;
      `,
      15_000,
    );
    const body = fake.lastBody();
    const tokenWert = TOKEN.slice("Bearer ".length);
    record(
      NAMEN[0],
      fertig !== null && fertig.regex === TOKEN && !body.includes(tokenWert) && /\[redacted-[a-z-]+-\d+\]/.test(body),
      fertig === null ? "keine Antwort innerhalb 15s"
        : `Transport-Body ${body.includes(tokenWert) ? "TRAEGT DAS TOKEN" : "ohne Token"}, Platzhalter ${/\[redacted-/.test(body) ? "da" : "FEHLT"}; Regel „${fertig.regex ?? "(Fehler)"}“ ${fertig.regex === TOKEN ? "= Original" : "!= Original"}`,
    );

    const daten = await cdp.evaluate<string>(
      `return await app.vault.adapter.read(app.vault.configDir + "/plugins/" + ${JSON.stringify(PLUGIN_ID)} + "/data.json");`,
    );
    const klartextWeg = !daten.includes("smoke-secret-key-12345");
    record(
      NAMEN[1],
      klartextWeg && daten.includes("secretId") && fake.lastAuth() === "Bearer smoke-secret-key-12345",
      `data.json ${klartextWeg ? "ohne" : "MIT"} Klartext-Schluessel, secretId ${daten.includes("secretId") ? "da" : "FEHLT"}; Authorization-Kopf am Server: ${fake.lastAuth() === "Bearer smoke-secret-key-12345" ? "ok" : `„${fake.lastAuth()}“`}`,
    );

    let b: Record<string, unknown> = {};
    try { b = JSON.parse(body) as Record<string, unknown>; } catch { /* unten gemeldet */ }
    const denken = b.reasoning_effort ?? b.chat_template_kwargs ?? b.enable_thinking ?? b.think ?? "(kein Feld)";
    // V4 — direkt ueber die Verbindung (derselbe Aufruf wie die Sitzung): ein PEM-Block geht als Platzhalter
    // hinaus; die Antwort spiegelt ihn in `regex`. Ohne `restoreContent: "json"` kaeme der Block mit echten
    // Zeilenumbruechen in einen JSON-String zurueck — `JSON.parse` risse.
    const PEM = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\nabcdefghijklmnopqrstuvwxyz0123456789ABCD\n-----END PRIVATE KEY-----";
    const pem = await cdp.evaluate<{ ok: boolean; regex: string | null; fehler: string | null; body: string }>(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const r = await p.llm.complete({ messages: [{ role: "user", content: "Schluessel:\\n" + ${JSON.stringify(PEM)} }] }, { overrides: { temperature: 0 } });
      if (!r.ok) return { ok: false, regex: null, fehler: r.kind + ": " + r.detail, body: "" };
      try { return { ok: true, regex: JSON.parse(r.content).regex, fehler: null, body: "" }; }
      catch (e) { return { ok: false, regex: null, fehler: "JSON.parse: " + e.message, body: r.content.slice(0, 120) }; }
    `);
    const pemBody = fake.lastBody();
    record(
      NAMEN[3],
      pem.ok && pem.regex === PEM && !pemBody.includes("MIIEvQIBADANBgkq") && /\[redacted-[a-z-]+-\d+\]/.test(pemBody),
      pem.ok
        ? `Transport-Body ${pemBody.includes("MIIEvQIBADANBgkq") ? "TRAEGT DEN SCHLUESSEL" : "ohne Schluessel"}; Regel ${pem.regex === PEM ? "= Original (mehrzeilig)" : "!= Original"}`
        : `Aufruf/Parse gescheitert: ${pem.fehler ?? "?"} ${pem.body}`,
    );

    record(NAMEN[2], b.stream === false && b.temperature === 0, `stream=${String(b.stream)}, temperature=${String(b.temperature)}, Denk-Feld: ${JSON.stringify(denken)}`);
  } finally {
    await fake.close();
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.endpoints = ${JSON.stringify(vor.endpoints)};
      await p.saveSettings();
      p.llm.invalidate();
      p.sessionInstance.reset?.();
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
  // Zentraler Fake-Manager. `configModel: "default"`: `config.model` traegt wie beim echten Manager
  // den Standard — sonst waere die Vorrangregel „Nutzerwahl schlaegt Standard“ (M2b) ohne Wirkung gruen.
  await installFakeManager(cdp, {
    pluginId: MANAGER_PLUGIN_ID,
    endpunkte: [{
      id: "fake-mgr-ep", label: "Fake Manager Endpoint", url,
      models: [MANAGER_DEFAULT_MODEL, MANAGER_CHOICE_MODEL], defaultModel: MANAGER_DEFAULT_MODEL, configModel: "default",
    }],
  });
}

/** Stellt den vorgefundenen Slot wieder her — ein echter Manager im Vault bleibt unangetastet. */
async function fakeManagerAus(cdp: Cdp): Promise<void> {
  await entferneFakeManager(cdp, { pluginId: MANAGER_PLUGIN_ID });
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
    return { text: tab.containerEl.textContent ?? "", lokaleZeilen: tab.containerEl.querySelectorAll(".okit-ep-status").length };
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
    "M4 Abgeschalteter Wunsch-Endpunkt: die Meldung nennt den Manager-Grund",
  ];
  if (await cdp.evaluate<boolean>(`return !!app.plugins.plugins[${JSON.stringify(MANAGER_PLUGIN_ID)}];`)) {
    for (const n of REST) unmeasured(n, "ein llm-endpoint-manager ist im Vault aktiv; die Fake-API wuerde ihn verdecken");
    return;
  }
  const draft = { regex: "foo", flags: "", replacement: "bar", explanation: "e" };
  const mgr = await startFakeEndpoint(draft);
  const lokal = await startFakeEndpoint(draft);
  const vor = await cdp.evaluate<{ endpoints: unknown; choice: unknown }>(
    `const s = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings; return { endpoints: s.endpoints, choice: s.choice };`,
  );
  try {
    await fakeManagerEin(cdp, mgr.url);
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.choice = {};
      // Der lokale Weg zeigt auf den zweiten Stub, mit eigenem Modell — er darf im Manager-Fall
      // nie angefasst werden.
      p.settings.endpoints = [{ url: ${JSON.stringify(lokal.url)}, model: ${JSON.stringify(LOCAL_MODEL)} }];
      await p.saveSettings();
      p.llm.invalidate();
      return true;
    `);

    const mit = await einstellungenText(cdp);
    if (mit === null) {
      unmeasured(REST[0]!, "kein Einstellungs-Tab unter app.setting.pluginTabs gefunden");
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
    await cdp.evaluate(`app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].llm.invalidate(); return true;`);
    const ohne = await einstellungenText(cdp);
    const okM3 = await laufAnstossen(cdp, lokal);
    const zeigtLokal = ohne !== null && !MANAGED_TEXT.some((x) => ohne.text.includes(x)) && ohne.lokaleZeilen > 0;
    record(REST[3]!, zeigtLokal && okM3 && lokal.lastModel() === LOCAL_MODEL,
      `Einstellungen: ${ohne === null ? "kein Tab" : `${ohne.lokaleZeilen} lokale Zeilen, Manager-Text ${MANAGED_TEXT.some((x) => ohne.text.includes(x)) ? "noch da" : "weg"}`}; `
      + `lokaler Stub ${lokal.chatCalls()} Aufruf(e), Modell „${lokal.lastModel()}“ (erwartet „${LOCAL_MODEL}“)`);

    // M4 — der Nutzer hat einen Endpunkt gewaehlt, der im Manager inzwischen abgeschaltet ist. Der Manager antwortet nur
    // „no-endpoint“; den genaueren Grund („disabled“) haelt die Aufloesung der ausdruecklichen Wahl fest (obsidian-kit 0.60.0).
    // Die Meldung ist der Kit-Text je Code, nicht mehr „der Manager hat keinen nutzbaren Endpunkt“.
    await installFakeManager(cdp, {
      pluginId: MANAGER_PLUGIN_ID,
      endpunkte: [{ id: "fake-aus-ep", label: "Fake Abgeschaltet", url: mgr.url, models: [MANAGER_DEFAULT_MODEL], defaultModel: MANAGER_DEFAULT_MODEL, enabled: false }],
    });
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.choice = { endpointId: "fake-aus-ep" };
      await p.saveSettings();
      p.llm.invalidate();
      void p.sessionInstance.generate("Smoke-Test: ersetze foo", "foo bar");
      return true;
    `);
    const meldung = await pollUntil<string>(cdp, `
      const st = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].sessionInstance.state;
      return st.phase === "error" ? String(st.args[0] ?? "") : "";
    `, 15_000, 250);
    const zeigtGrund = meldung !== null && /switched off|abgeschaltet/.test(meldung);
    record(REST[4]!, zeigtGrund, `Meldung: „${meldung ?? "(keine)"}“`);
  } finally {
    await fakeManagerAus(cdp).catch(() => undefined);
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.endpoints = ${JSON.stringify(vor.endpoints)};
      p.settings.choice = ${JSON.stringify(vor.choice)};
      await p.saveSettings();
      p.llm.invalidate();
      return true;
    `).catch(() => undefined);
    try {
      await mgr.close();
    } finally {
      await lokal.close();
    }
  }
}

// --- Abschnitt: Apple-Intelligence-Endpunkt ---------------------------------------

const APPLE_ENDPOINT_ID = "fake-apple";
const APPLE_LABEL = "Apple Intelligence (on-device)";
const APPLE_SHORTCUT = "Smoke Apple LLM";
/** Kurz, damit der Timeout-Pfad (S5) in Sekunden laeuft — die Client-Frist richtet sich nach ihr (+10 s). */
const APPLE_SHORTCUT_TIMEOUT_MS = 3000;

/** Fake-Manager mit ZWEI Endpunkten (HTTP und Apple, Transport `shortcuts`) über den zentralen Baustein der Brücke.
 *  Dessen `list(filter)` filtert wie der echte Manager nach `filter.transports` mit Default `["http"]` (Spiegel von
 *  llm-endpoint-manager `list-ops.ts`) — S1 misst das am Fake selbst, damit S2 nicht gruen wird, ohne dass das Opt-in
 *  je gebraucht wurde. */
async function fakeAppleManagerEin(cdp: Cdp, httpUrl: string): Promise<void> {
  await installFakeManager(cdp, {
    pluginId: MANAGER_PLUGIN_ID,
    endpunkte: [
      { id: "fake-http", label: "Fake HTTP Endpoint", url: httpUrl, models: [MANAGER_DEFAULT_MODEL], defaultModel: MANAGER_DEFAULT_MODEL, configModel: "default" },
      { id: APPLE_ENDPOINT_ID, label: APPLE_LABEL, url: "apple-shortcuts://on-device", transport: "shortcuts", shortcut: { name: APPLE_SHORTCUT, timeoutMs: APPLE_SHORTCUT_TIMEOUT_MS } },
    ],
  });
}

/** S1–S5: Auswahl im Baustein, Transportwahl, Kurzbefehl-URL, Fehlerpfad. Ein echter Rundlauf (die
 *  Kurzbefehle-App antwortet) ist nur am Geraet moeglich — ehrliche Grenze, kein Pruefpunkt;
 *  `window.open` ist gestubbt, damit die Zweitinstanz die App nie oeffnet. */
async function abschnittApple(cdp: Cdp): Promise<void> {
  const NAMEN = [
    "S1 Fake-Manager liefert den Apple-Endpunkt nur bei Opt-in",
    "S2 Dropdown zeigt „Apple Intelligence (on-device)“",
    "S3 Wahl → Quelle traegt transport shortcuts",
    "S4 Lauf oeffnet die shortcuts://-URL mit dem gefalteten Prompt",
    "S5 Zeitueberschreitung des Kurzbefehls zeigt die Kurzbefehl-Meldung",
  ];
  if (await cdp.evaluate<boolean>(`return !!app.plugins.plugins[${JSON.stringify(MANAGER_PLUGIN_ID)}];`)) {
    for (const n of NAMEN) unmeasured(n, "ein llm-endpoint-manager ist im Vault aktiv; die Fake-API wuerde ihn verdecken");
    return;
  }
  const http = await startFakeEndpoint({ regex: "foo", flags: "", replacement: "bar", explanation: "e" });
  const vor = await cdp.evaluate<{ endpoints: unknown; choice: unknown }>(
    `const s = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings; return { endpoints: s.endpoints, choice: s.choice };`,
  );
  let stubGesetzt = false;
  try {
    await fakeAppleManagerEin(cdp, http.url);
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.choice = {};
      await p.saveSettings();
      p.llm.invalidate();
      return true;
    `);
    const listen = await cdp.evaluate<{ ohne: string[]; mit: string[] }>(`
      const api = app.plugins.plugins[${JSON.stringify(MANAGER_PLUGIN_ID)}].api;
      return { ohne: api.list({ capability: "chat" }).map((e) => e.id), mit: api.list({ capability: "chat", transports: ["http", "shortcuts"] }).map((e) => e.id) };
    `);
    record(NAMEN[0]!, listen.ohne.length === 1 && !listen.ohne.includes(APPLE_ENDPOINT_ID) && listen.mit.includes(APPLE_ENDPOINT_ID),
      `ohne Opt-in ${JSON.stringify(listen.ohne)}, mit Opt-in ${JSON.stringify(listen.mit)}`);

    // S2/S3 — der Baustein bietet Apple an (transports-Option); Wahl wie ein Nutzer: Dropdown setzen, change ausloesen
    // Der Tab wird wie von einem Nutzer geoeffnet (sichtbar, am Dokument): ein `display()` auf einem abgehaengten
    // Container misst einen Tab, den es so nie gibt — der Hinweis haengt an `isConnected`.
    const optionen = await cdp.evaluate<string[] | null>(`
      app.setting.open();
      app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
      await new Promise((r) => setTimeout(r, 800));
      const tab = (app.setting?.pluginTabs ?? []).find((x) => x.id === ${JSON.stringify(PLUGIN_ID)});
      if (!tab) return null;
      return [...tab.containerEl.querySelectorAll("select option")].map((o) => o.textContent || "");
    `);
    if (optionen === null) {
      unmeasured(NAMEN[1]!, "kein Einstellungs-Tab unter app.setting.pluginTabs gefunden");
      unmeasured(NAMEN[2]!, "kein Einstellungs-Tab unter app.setting.pluginTabs gefunden");
    } else {
      record(NAMEN[1]!, optionen.some((o) => o.includes(APPLE_LABEL)), `Optionen: ${JSON.stringify(optionen)}`);
      const hinweis = await cdp.evaluate<{ ok: boolean; vorher: boolean }>(`
        const tab = (app.setting?.pluginTabs ?? []).find((x) => x.id === ${JSON.stringify(PLUGIN_ID)});
        const sel = [...tab.containerEl.querySelectorAll("select")].find((s) => [...s.options].some((o) => (o.textContent || "").includes(${JSON.stringify(APPLE_LABEL)})));
        if (!sel) return { ok: false, vorher: false };
        const vorher = (tab.containerEl.textContent || "").includes("4096");
        const opt = [...sel.options].find((o) => (o.textContent || "").includes(${JSON.stringify(APPLE_LABEL)}));
        sel.value = opt.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const istKurzbefehl = async () => (await p.llm.resolve()).transport === "shortcuts";
        for (let i = 0; i < 32 && !(await istKurzbefehl()); i += 1) await new Promise((r) => setTimeout(r, 250));
        return { ok: await istKurzbefehl(), vorher };
      `);
      // Der Hinweis folgt der Wahl im OFFENEN Tab (kein erneutes Oeffnen): warten, nicht raten.
      const hinweisDa = hinweis.ok && Boolean(await pollUntil<boolean>(cdp, `
        const tab = (app.setting?.pluginTabs ?? []).find((x) => x.id === ${JSON.stringify(PLUGIN_ID)});
        return (tab.containerEl.textContent || "").includes("4096");
      `, 5_000, 250));
      const diag = hinweisDa ? "" : JSON.stringify(await cdp.evaluate(`
        const tab = (app.setting?.pluginTabs ?? []).find((x) => x.id === ${JSON.stringify(PLUGIN_ID)});
        const h = tab.containerEl.querySelector(".transmute-connection-hint");
        return { hintEl: !!h, connected: h ? h.isConnected : null, kinder: h ? h.children.length : null, tabVerbunden: tab.containerEl.isConnected };
      `));
      record(NAMEN[2]!, hinweis.ok && hinweisDa && !hinweis.vorher, hinweis.ok
        ? `Quelle traegt transport shortcuts; Hinweis zur Grenze im offenen Tab: ${hinweisDa ? "da" : "FEHLT " + diag} (vor der Wahl: ${hinweis.vorher ? "schon da" : "nicht da"})`
        : "Quelle blieb HTTP — die Dropdown-Wahl kam nicht an");
      await schliesseEinstellungen(cdp);
    }

    // S4/S5 — ein Lauf. `window.open`-Stub VOR dem Anstoss, Rueckbau im finally.
    await cdp.evaluate(`
      window.__smokeOpenUrls = [];
      window.__smokeOrigOpen = window.open;
      window.open = (u) => { window.__smokeOpenUrls.push(String(u)); return null; };
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      void p.sessionInstance.generate("Smoke-Test: ersetze foo", "foo bar");
      return true;
    `);
    stubGesetzt = true;
    const url = await pollUntil<{ u: string }>(cdp, `const u = window.__smokeOpenUrls[0]; return u ? { u } : null;`, 15_000, 250);
    const dekodiert = url ? decodeURIComponent(url.u) : "";
    record(NAMEN[3]!, url !== null && url.u.startsWith("shortcuts://") && dekodiert.includes(APPLE_SHORTCUT) && dekodiert.includes("foo bar"),
      url ? `${url.u.slice(0, 60)}… (${url.u.length} Zeichen), Name ${dekodiert.includes(APPLE_SHORTCUT) ? "da" : "fehlt"}, Nutzertext ${dekodiert.includes("foo bar") ? "da" : "fehlt"}` : "window.open wurde nicht aufgerufen");

    const ende = await pollUntil<{ phase: string; key: string }>(cdp, `
      const st = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].sessionInstance.state;
      return st.phase === "error" ? { phase: st.phase, key: st.messageKey } : null;
    `, 60_000, 500);
    record(NAMEN[4]!, ende !== null && ende.key.startsWith("error.shortcut."), ende ? `Phase ${ende.phase}, Meldungsschluessel ${ende.key}` : "Sitzung erreichte keinen Fehlerzustand");
  } catch (e) {
    for (const n of NAMEN) {
      unmeasured(n, `Messung abgebrochen: ${(e as Error).message}`);
    }
  } finally {
    if (stubGesetzt) {
      await cdp.evaluate(`window.open = window.__smokeOrigOpen; delete window.__smokeOrigOpen; delete window.__smokeOpenUrls; return true;`).catch(() => undefined);
    }
    await fakeManagerAus(cdp).catch(() => undefined);
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.endpoints = ${JSON.stringify(vor.endpoints)};
      p.settings.choice = ${JSON.stringify(vor.choice)};
      await p.saveSettings();
      p.llm.invalidate();
      return true;
    `).catch(() => undefined);
    await http.close();
  }
}

/** CL1–CL3 — Claude (Anthropic API) ueber den LLM Endpoint Manager (Kit 0.62.0, Opt-in `transports.anthropic` in `src/main.ts`).
 *  Gegenstelle: der zentrale LLM-Stub im Anthropic-Modus (Messages-API; geprueft werden `x-api-key`, `anthropic-version`, `model`,
 *  `max_tokens`). Kein Aufruf an api.anthropic.com, kein Schluessel, kein Modell. Der Weg ist ohne Strom (`stream: false`, Antwort als
 *  eine Nachricht). Der Fake-Manager liefert den Claude-Eintrag in `list()` und `resolve()` nur, wenn der Aufrufer `transports` mit
 *  `anthropic` verlangt; entfernt man den Opt-in aus `main.ts`, sieht das Plugin ihn nie (CL1 rot). */
const CLAUDE_MODELL = "claude-haiku-5-5";
const CLAUDE_SCHLUESSEL = "sk-ant-smoke-transmute";

async function abschnittClaude(cdp: Cdp): Promise<void> {
  const [CL1, CL2, CL3] = ABSCHNITTE.Claude as [string, string, string];
  if (await cdp.evaluate<boolean>(`return !!app.plugins.plugins[${JSON.stringify(MANAGER_PLUGIN_ID)}];`)) {
    for (const n of [CL1, CL2, CL3]) unmeasured(n, "ein llm-endpoint-manager ist im Vault aktiv; die Fake-API wuerde ihn verdecken");
    return;
  }
  const draft = { regex: "foo", flags: "", replacement: "bar", explanation: "e" };
  const stub = await startLlmStub({
    anbieter: "anthropic",
    schluessel: CLAUDE_SCHLUESSEL,
    models: [{ id: CLAUDE_MODELL, capabilities: { effort: { supported: true }, thinking: { types: { adaptive: { supported: true } } } } }],
    standard: { text: JSON.stringify(draft), model: CLAUDE_MODELL },
  });
  const vor = await cdp.evaluate<{ endpoints: unknown; choice: unknown }>(
    `const s = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings; return { endpoints: s.endpoints, choice: s.choice };`,
  );
  try {
    await installFakeManager(cdp, {
      pluginId: MANAGER_PLUGIN_ID,
      endpunkte: [{
        id: "fake-claude", label: "Claude API", url: stub.url, models: [CLAUDE_MODELL], defaultModel: CLAUDE_MODELL, configModel: "default",
        provider: "anthropic", backend: "anthropic", apiKey: CLAUDE_SCHLUESSEL, hasSecret: true, transport: "anthropic",
      }],
      invalidiere: [PLUGIN_ID],
    });
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.choice = {};
      await p.saveSettings();
      p.llm.invalidate();
      return true;
    `);

    // CL1 — `ohne`/`mit` messen nur den Filter des Fakes (Kontrolle am Fake); die Verdrahtung beweist `plugin.llm.source()`.
    const sicht = await cdp.evaluate<{ ohne: number; mit: number; quelle: string; modell: string; familie: string | null; backend: string }>(`
      const api = app.plugins.plugins[${JSON.stringify(MANAGER_PLUGIN_ID)}].api;
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.llm.invalidate();
      await p.llm.resolve({ force: true });
      const src = p.llm.source();
      return {
        ohne: api.list({ capability: "chat" }).length,
        mit: api.list({ capability: "chat", transports: ["http", "anthropic"] }).length,
        quelle: src.backendSource, modell: src.model, familie: src.family, backend: src.backend,
      };
    `);
    record(CL1, sicht.ohne === 0 && sicht.mit === 1 && sicht.quelle === "manager" && sicht.modell === CLAUDE_MODELL && sicht.backend === "anthropic" && sicht.familie === "claude",
      `Kontrolle am Fake: list() ohne transports ${sicht.ohne}, mit ["http","anthropic"] ${sicht.mit}; Plugin: Backend ${sicht.backend} (Quelle ${sicht.quelle}), Familie ${sicht.familie}, Modell ${sicht.modell}`);

    // CL2 — ein Lauf wie vom Generieren-Knopf; danach die Anfrage am Stub und „Letzte Anfrage“ in den Einstellungen.
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      void p.sessionInstance.generate("Smoke-Test: ersetze foo", "foo bar");
      return true;
    `);
    const ergebnis = await pollUntil<{ phase: string; regex: string | null }>(
      cdp,
      `const st = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].sessionInstance.state;
       if (st.phase === "preview") return { phase: st.phase, regex: st.versions[st.active].rule.regex };
       if (st.phase === "error") return { phase: st.phase, regex: null };
       return null;`,
      15_000,
      250,
    );
    const nachrichten = stub.anfragen().filter((a) => a.route === "messages");
    const letzte = nachrichten.at(-1);
    const body = (letzte?.json ?? {}) as Record<string, unknown>;
    const kopf = letzte?.header ?? {};
    const verboten = ["temperature", "top_p", "top_k", "min_p", "presence_penalty"].filter((k) => k in body);
    const abweichungen = await cdp.evaluate<string[] | null>(`
      const tab = (app.setting?.pluginTabs ?? []).find((x) => x.id === ${JSON.stringify(PLUGIN_ID)});
      if (!tab) return null;
      tab.display();
      return [...tab.containerEl.querySelectorAll(".okit-request-deviation")].map((e) => e.textContent || "");
    `);
    const sichtbar = abweichungen !== null && abweichungen.some((t) => /temperature/.test(t));
    const draht = nachrichten.length > 0 && kopf["x-api-key"] === CLAUDE_SCHLUESSEL && typeof kopf["anthropic-version"] === "string"
      && body.model === CLAUDE_MODELL && typeof body.max_tokens === "number" && verboten.length === 0;
    record(CL2, ergebnis !== null && ergebnis.phase === "preview" && ergebnis.regex === "foo" && draht && sichtbar,
      `Phase ${ergebnis?.phase ?? "keine Antwort"}, Regel „${ergebnis?.regex ?? "-"}“; Anfragen ${nachrichten.length}, x-api-key ${kopf["x-api-key"] === CLAUDE_SCHLUESSEL ? "ok" : "FALSCH"}, anthropic-version ${String(kopf["anthropic-version"])}, model ${String(body.model)}, max_tokens ${String(body.max_tokens)}, stream ${String(body.stream)}, verbotene Felder: ${verboten.length === 0 ? "keine" : verboten.join(",")}; Letzte Anfrage: ${abweichungen === null ? "kein Einstellungs-Tab" : sichtbar ? JSON.stringify(abweichungen.find((t) => /temperature/.test(t))) : `keine Abweichung zu temperature (${abweichungen.length} Zeile(n))`}`);

    // CL3 — die API antwortet 529 overloaded_error: der Lauf endet im Fehlerzustand mit deren Meldung.
    // Zwei gleiche Eintraege: ein Wiederholen des Clients (5xx) soll den Fehler nicht wegmachen; die Zahl der Anfragen steht im Detail.
    const fehler529 = { status: 529, fehler: "Overloaded", fehlerTyp: "overloaded_error" };
    stub.antworten([fehler529, fehler529]);
    const anfragenVorCL3 = stub.anfragen().filter((a) => a.route === "messages").length;
    // Die Sitzung steht nach CL2 noch in „preview“: ein Endzustand zaehlt erst, wenn er NACH diesem Anstoss entstanden ist
    // (Fehler, oder eine Vorschau mit mehr Versionen als vorher).
    const versionenVorher = await cdp.evaluate<number>(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      void p.sessionInstance.generate("Smoke-Test: ersetze foo noch einmal", "foo bar");
      return p.sessionInstance.state.phase === "preview" ? p.sessionInstance.state.versions.length : 0;
    `);
    const ende = await pollUntil<{ phase: string; key: string; args: string }>(
      cdp,
      `const st = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].sessionInstance.state;
       if (st.phase === "error") return { phase: st.phase, key: st.messageKey, args: (st.args ?? []).join(" | ") };
       if (st.phase === "preview" && st.versions.length > ${versionenVorher}) return { phase: st.phase, key: "", args: "" };
       return null;`,
      30_000,
      300,
    );
    record(CL3, ende !== null && ende.phase === "error" && /overload|529/i.test(`${ende.key} ${ende.args}`),
      ende === null ? "Sitzung erreichte keinen Endzustand" : `Phase ${ende.phase}, Schluessel ${ende.key || "-"}, Meldung ${JSON.stringify(ende.args.slice(0, 100))}, Anfragen am Stub ${stub.anfragen().filter((a) => a.route === "messages").length - anfragenVorCL3}`);
  } catch (e) {
    for (const n of [CL1, CL2, CL3]) if (!bilanz.eintraege().some((x) => x.name === n)) unmeasured(n, `Messung abgebrochen: ${(e as Error).message}`);
  } finally {
    await schliesseEinstellungen(cdp).catch(() => undefined);
    await fakeManagerAus(cdp).catch(() => undefined);
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.endpoints = ${JSON.stringify(vor.endpoints)};
      p.settings.choice = ${JSON.stringify(vor.choice)};
      await p.saveSettings();
      p.llm.invalidate();
      return true;
    `).catch(() => undefined);
    await stub.stop().catch(() => undefined);
  }
}

/** G1: Das globale Modell ist abgeloest (Welle 17). Ein Altwert in der data.json steht nach dem Laden in der
 *  Endpunkt-Zeile, der Altschluessel ist aus der Datei verschwunden, die Einstellungen kennen weder eine Zeile
 *  „Model“ noch die Zeilenoption „global model“. Gegenprobe: mit dem Build von vor Welle 17 schlaegt er fehl. */
async function abschnittGlobalesModell(cdp: Cdp): Promise<void> {
  const NAME = "G1 Altwert wandert in die Zeile, kein globales Modell in den Einstellungen";
  const ALTWERT = "smoke-altmodell";
  const NAME2 = "G2 Panel-Modellwahl (ueber das Dropdown der Modellzeile) schreibt in die aktive Zeile, Automatisch leert sie";
  const pfad = `.obsidian/plugins/${PLUGIN_ID}/data.json`;
  const vor = await cdp.evaluate<string | null>(`
    return (await app.vault.adapter.exists(${JSON.stringify(pfad)})) ? await app.vault.adapter.read(${JSON.stringify(pfad)}) : null;
  `);
  try {
    const roh = vor === null ? {} : (JSON.parse(vor) as Record<string, unknown>);
    const alt = { ...roh, endpoints: [{ url: "http://127.0.0.1:1234" }], model: ALTWERT };
    const ergebnis = await cdp.evaluate<{ zeilenModell: unknown; hatAltschluessel: boolean; text: string; namen: string[] } | null>(`
      await app.vault.adapter.write(${JSON.stringify(pfad)}, ${JSON.stringify(JSON.stringify(alt))});
      await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
      await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const gespeichert = JSON.parse(await app.vault.adapter.read(${JSON.stringify(pfad)}));
      const tab = (app.setting?.pluginTabs ?? []).find((x) => x.id === ${JSON.stringify(PLUGIN_ID)});
      if (!tab) return null;
      tab.display();
      return { zeilenModell: p.settings.endpoints[0]?.model, hatAltschluessel: "model" in gespeichert || "model" in p.settings, text: tab.containerEl.textContent ?? "", namen: [...tab.containerEl.querySelectorAll(".setting-item-name")].map((n) => (n.textContent ?? "").trim()) };
    `);
    if (ergebnis === null) { unmeasured(NAME, "kein Einstellungs-Tab unter app.setting.pluginTabs gefunden"); return; }
    const keineOption = !/global model/i.test(ergebnis.text);
    const keineZeile = !ergebnis.namen.includes("Model");
    record(NAME, ergebnis.zeilenModell === ALTWERT && !ergebnis.hatAltschluessel && keineOption && keineZeile,
      `Zeilen-Modell „${String(ergebnis.zeilenModell)}“ (erwartet „${ALTWERT}“), Altschluessel ${ergebnis.hatAltschluessel ? "noch da" : "weg"}, Option „global model“ ${keineOption ? "weg" : "noch da"}, Zeile „Model“ ${keineZeile ? "weg" : "noch da"}`);
    // G2 ueber das Dropdown der Modellzeile (Kit): kein direkter `llm.setModel` mehr, der das Panel nie beruehrt haette.
    const stubG2 = await startLlmStub({ models: ["panel-wahl-smoke", "anderes-modell"] });
    try {
      await cdp.evaluate(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        p.settings.endpoints = [{ url: ${JSON.stringify(stubG2.url)}, model: "anderes-modell" }];
        p.settings.choice = {};
        await p.saveSettings();
        p.llm.invalidate();
        await p.llm.resolve({ force: true });
        return true;
      `);
      if (!(await zeileOeffnen(cdp, "panel-wahl-smoke"))) { record(NAME2, false, "Die Modellzeile mit den Modellen des Stubs kam in 10 s nicht ins Panel"); return; }
      await zeileWaehlen(cdp, "panel-wahl-smoke");
      const gewaehlt = await pollUntil<{ gewaehlt: unknown; inUse: string }>(cdp, `
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        return p.settings.endpoints[0]?.model === "panel-wahl-smoke" ? { gewaehlt: p.settings.endpoints[0].model, inUse: p.llm.modelInUse() } : null;
      `, 6_000, 200);
      await zeileWaehlen(cdp, "");
      const geleert = await pollUntil<{ geleert: unknown; inUseLeer: string; zeile: string }>(cdp, `
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        return (p.settings.endpoints[0]?.model ?? "") === "" ? { geleert: p.settings.endpoints[0]?.model, inUseLeer: p.llm.modelInUse(), zeile: document.querySelector(".okit-model-bar-select")?.value ?? "?" } : null;
      `, 6_000, 200);
      record(NAME2, gewaehlt !== null && gewaehlt.gewaehlt === "panel-wahl-smoke" && gewaehlt.inUse === "panel-wahl-smoke" && geleert !== null && geleert.zeile === "",
        `Zeile nach Wahl „${String(gewaehlt?.gewaehlt ?? "nicht umgestellt")}“, modelInUse „${gewaehlt?.inUse ?? "-"}“; nach Automatisch Zeile „${String(geleert?.geleert ?? "")}“, modelInUse „${geleert?.inUseLeer ?? "-"}“, Dropdown „${geleert?.zeile ?? "nicht umgestellt"}“`);
    } finally {
      await stubG2.stop().catch(() => undefined);
    }
  } finally {
    await cdp.evaluate(`
      await app.vault.adapter.write(${JSON.stringify(pfad)}, ${JSON.stringify(vor ?? "{}")});
      await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
      await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
      return true;
    `).catch(() => undefined);
  }
}

/** H1: Die Hilfe-Zeile ist die ERSTE Zeile im Einstellungs-Tab (UI-STANDARD §8), mit Text-Knopf
 *  und bug-Icon. Gezeichnet ueber `display()`, den Fallback-Renderer derselben Definitionen. */
/** D1: Der Denk-Knopf im Panel ist der Kit-Baustein; ein Klick schaltet `request.thinking.structured` von „off“ auf die
 *  gemerkte Stufe und zurueck, Label und `aria-pressed` folgen. Der Vorwert wird zurueckgesetzt. */
async function abschnittDenken(cdp: Cdp): Promise<void> {
  const NAME = "D1 Denk-Knopf (Kit-Baustein) schaltet die Stufe des Modus structured und zeigt den Zustand";
  await closeExtraLeaves(cdp);
  await panelOeffnen(cdp);
  const vorher = await cdp.evaluate<unknown>(`return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.request.thinking.structured ?? null;`);
  const zustand = (): Promise<{ da: boolean; pressed: string | null; label: string; stufe: string | null }> => cdp.evaluate(`
    const b = document.querySelector(".okit-thinking-toggle");
    const st = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.request.thinking.structured ?? null;
    return { da: !!b, pressed: b ? b.getAttribute("aria-pressed") : null, label: b ? b.textContent.trim() : "", stufe: st };
  `);
  try {
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.request.thinking.structured = "off";
      await p.saveSettings();
      return true;
    `);
    await bereichWaehlen(cdp, "Whole note");
    const aus = await zustand();
    if (!aus.da) { unmeasured(NAME, "kein .okit-thinking-toggle im Panel gefunden"); return; }
    await klickAusdruck(cdp, `document.querySelector(".okit-thinking-toggle")`);
    await new Promise((r) => setTimeout(r, 500));
    const an = await zustand();
    await klickAusdruck(cdp, `document.querySelector(".okit-thinking-toggle")`);
    await new Promise((r) => setTimeout(r, 500));
    const wieder = await zustand();
    record(NAME,
      aus.pressed === "false" && an.pressed === "true" && an.stufe !== "off" && wieder.pressed === "false" && wieder.stufe === "off",
      `aus: ${aus.pressed}/${aus.label}/${aus.stufe}; nach Klick: ${an.pressed}/${an.label}/${an.stufe}; nach zweitem Klick: ${wieder.pressed}/${wieder.label}/${wieder.stufe}`);
    await denkenOhneAus(cdp);
  } finally {
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      if (${JSON.stringify(vorher)} === null) delete p.settings.request.thinking.structured; else p.settings.request.thinking.structured = ${JSON.stringify(vorher)};
      await p.saveSettings();
      return true;
    `).catch(() => undefined);
  }
}

/** D2: Ein Modell der Familie gpt-oss kennt kein „aus“. Der Knopf bleibt wirksam (er wechselt zwischen der niedrigsten und der gewaehlten Stufe);
 *  das Label sagt „Thinking: lowest level“ (Text des Kits, `thinkingOffTexts`), der Grund steht im aria-label; es behauptet keine Sperre. Das Modell steht in der Endpunkt-Zeile, der Vorwert wird zurueckgesetzt. */
async function denkenOhneAus(cdp: Cdp): Promise<void> {
  const NAME = "D2 Modell ohne „aus“ (gpt-oss): das Label nennt „lowest level“ samt Hinweis im aria-label statt „Thinking off“, der Knopf bleibt bedienbar";
  const vor = await cdp.evaluate<string>(`return JSON.stringify(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.endpoints);`);
  const lese = (): Promise<{ da: boolean; label: string; aria: string; disabled: boolean; pressed: string | null }> => cdp.evaluate(`
    const b = document.querySelector(".okit-thinking-toggle");
    return { da: !!b, label: b ? b.textContent.trim() : "", aria: b ? (b.getAttribute("aria-label") ?? "") : "", disabled: b ? b.disabled : true, pressed: b ? b.getAttribute("aria-pressed") : null };
  `);
  try {
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.endpoints = p.settings.endpoints.map((e, i) => (i === 0 ? { ...e, model: "gpt-oss-20b" } : e));
      p.settings.request.thinking.structured = "off";
      await p.saveSettings();
      p.llm.invalidate();
      for (const l of app.workspace.getLeavesOfType("transmute-panel")) l.detach();
      return true;
    `);
    await panelOeffnen(cdp);
    await new Promise((r) => setTimeout(r, 600));
    const aus = await lese();
    if (!aus.da) { unmeasured(NAME, "kein .okit-thinking-toggle im Panel gefunden"); return; }
    // Abnahme am Bild (nicht Teil der Bilanz): die Modellzeile mit dem ehrlichen Label, Ablage ueber $SHOT_DIR.
    if (process.env.SHOT_DIR) {
      const box = await boxOf(cdp, ".transmute-model-host", 0);
      mkdirSync(process.env.SHOT_DIR, { recursive: true });
      writeFileSync(join(process.env.SHOT_DIR, "thinking-gpt-oss.png"), await capture(cdp, box ?? undefined));
    }
    await klickAusdruck(cdp, `document.querySelector(".okit-thinking-toggle")`);
    await new Promise((r) => setTimeout(r, 500));
    const an = await lese();
    const hinweis = aus.aria.startsWith("Thinking: lowest level.") && aus.aria.includes("can't be fully turned off");
    record(NAME, aus.label === "Thinking: lowest level" && hinweis && !aus.disabled && an.label === "Thinking on" && !an.disabled,
      `Ausgang „${aus.label}“ (gesperrt: ${aus.disabled}, aria-label „${aus.aria}“); nach Klick „${an.label}“ (gesperrt: ${an.disabled})`);
  } finally {
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.endpoints = JSON.parse(${JSON.stringify(vor)});
      await p.saveSettings();
      p.llm.invalidate();
      return true;
    `).catch(() => undefined);
  }
}

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
  if (r === null) { unmeasured("H1 Hilfe-Zeile ist die erste Zeile der Einstellungen", "kein Einstellungs-Tab unter app.setting.pluginTabs gefunden"); return; }
  const ok = (r.name === "Help" || r.name === "Hilfe") && r.buttons === 1 && r.bug;
  record("H1 Hilfe-Zeile ist die erste Zeile der Einstellungen", ok, `erste Zeile „${r.name}“, ${r.buttons} Text-Knopf, bug-Icon ${r.bug ? "da" : "fehlt"}`);
}

// --- Abschnitt: Hub ----------------------------------------------------------

/** Tab-Leiste und Bibliothek (0.13.0): der Hub wird einmal gebaut, die Bibliothek zeichnet beim
 *  Oeffnen neu. Die gespeicherten Regeln stellt der Treiber selbst (und gibt sie zurueck). */
async function abschnittHub(cdp: Cdp): Promise<void> {
  const pfad = `${SMOKE_DIR}/notiz-hub.md`;
  await cdp.evaluate(`
    const p = ${JSON.stringify(pfad)};
    const body = "Zeile mit ${ALT}.\\n";
    const vorhanden = app.vault.getAbstractFileByPath(p);
    if (vorhanden) await app.vault.modify(vorhanden, body);
    else await app.vault.create(p, body);
    return true;
  `);
  await dateiOeffnen(cdp, pfad);
  const vorher = await cdp.evaluate<unknown>(`return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.presets;`);
  try {
    await setPluginSetting(cdp, PLUGIN_ID, "presets", [{ id: "smoke-p", name: "Smoke-Regel", regex: ALT, flags: "g", replacement: NEU }]);
    // Bereich "Notiz" (Position 0) und zurueck in den Arbeitsbereich, falls ein Vorgaenger woanders stand.
    await click(cdp, ".okit-hub-tab[data-tab='work']");
    await click(cdp, ".transmute-scope-btn", 0);

    const leiste = await cdp.evaluate<{ tabs: string[]; icons: number[]; aktiv: string | null }>(`
      const tabs = [...document.querySelectorAll(".okit-hub-tab")];
      return {
        tabs: tabs.map((t) => t.getAttribute("data-tab") + ":" + (t.querySelector(".okit-hub-tab-label")?.textContent ?? "")),
        icons: tabs.map((t) => t.querySelector(".okit-hub-tab-icon")?.innerHTML.length ?? 0),
        aktiv: document.querySelector(".okit-hub-tab.is-active")?.getAttribute("data-tab") ?? null,
      };
    `);
    record(
      "T1 Hub-Leiste: zwei Tabs, Icons gerendert, Arbeitsbereich aktiv",
      leiste.tabs.length === 2 && leiste.icons.every((n) => n > 0) && leiste.aktiv === "work",
      `Tabs ${leiste.tabs.join(" | ")}; Icon-HTML-Laengen ${leiste.icons.join("/")}; aktiv ${leiste.aktiv}`,
    );

    await click(cdp, ".okit-hub-tab[data-tab='library']");
    const zeilen = await cdp.evaluate<{ aktiv: string | null; name: string; muster: string; knoepfe: number; sichtbar: boolean }>(`
      const row = document.querySelector(".transmute-library-row");
      const panel = document.querySelector(".transmute-library")?.closest(".okit-hub-panel");
      return {
        aktiv: document.querySelector(".okit-hub-tab.is-active")?.getAttribute("data-tab") ?? null,
        name: row?.querySelector(".transmute-library-name")?.textContent ?? "",
        muster: row?.querySelector(".transmute-library-pattern")?.textContent ?? "",
        knoepfe: row ? row.querySelectorAll("button").length : 0,
        sichtbar: !!panel && !panel.classList.contains("is-hidden"),
      };
    `);
    record(
      "T2 Bibliothek listet die gespeicherte Regel mit Ausfuehren-Knopf",
      zeilen.aktiv === "library" && zeilen.sichtbar && zeilen.name === "Smoke-Regel" && zeilen.muster === `/${ALT}/g` && zeilen.knoepfe === 1,
      `aktiv ${zeilen.aktiv}, sichtbar ${zeilen.sichtbar}, „${zeilen.name}“ ${zeilen.muster}, ${zeilen.knoepfe} Knopf`,
    );

    await click(cdp, ".transmute-library-row .transmute-preset-btn");
    await cdp.evaluate("await new Promise((r) => setTimeout(r, 700)); return true;");
    const danach = await cdp.evaluate<{ aktiv: string | null; regex: string | null; ersetzung: string | null }>(`
      return {
        aktiv: document.querySelector(".okit-hub-tab.is-active")?.getAttribute("data-tab") ?? null,
        regex: document.querySelector(".transmute-regex")?.value ?? null,
        ersetzung: document.querySelector(".transmute-replacement-input")?.value ?? null,
      };
    `);
    record(
      "T3 Ausfuehren wechselt in den Arbeitsbereich und setzt die Regel",
      danach.aktiv === "work" && danach.regex === ALT && danach.ersetzung === NEU,
      `aktiv ${danach.aktiv}, Muster „${danach.regex}“, Ersetzung „${danach.ersetzung}“`,
    );
  } finally {
    await setPluginSetting(cdp, PLUGIN_ID, "presets", vorher);
    await click(cdp, ".okit-hub-tab[data-tab='work']");
    await cdp.evaluate(`app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].sessionInstance.reset?.(); return true;`);
  }
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
    // Ein Abschnittsfehler ist kein Befund am Prueflings, sondern eine Messung, die nicht
    // stattgefunden hat: die noch offenen Punkte des Abschnitts zaehlen als „nichts gemessen".
    offeneUnmeasured(name, fehler instanceof Vorbedingung ? grund : `Abschnitt „${name}" abgebrochen: ${grund}`);
  }
}

// --- Abschnitt: Modellzeile (Kit-Baustein im Panel) ---------------------------------------------------

const ZEILE_SELECT = ".okit-model-bar .okit-model-bar-select";

/** Panel frisch oeffnen (Blatt zu, neu auf) und warten, bis die Modellzeile `erwartet` als Option fuehrt. */
async function zeileOeffnen(cdp: Cdp, erwartet: string): Promise<boolean> {
  await closeExtraLeaves(cdp);
  // Das Panel-Blatt der Seitenleiste bleibt von `closeExtraLeaves` unberuehrt und traegt seine Liste vom Oeffnen: zu, damit ein frisches Panel
  // gegen den jetzigen Endpunkt baut (Gattung des Zustandslecks, slide-deck `d5bad02`; wie D2).
  await cdp.evaluate(`
    for (const l of app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})) l.detach();
    app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].llm.invalidate();
    return true;
  `);
  await panelOeffnen(cdp);
  const da = await pollUntil<boolean>(cdp, `
    const sel = document.querySelector(${JSON.stringify(ZEILE_SELECT)});
    return sel && [...sel.options].some((o) => o.value === ${JSON.stringify(erwartet)}) ? true : null;
  `, 10_000, 200);
  if (da !== true) {
    const stand = await cdp.evaluate<string>(`
      const sel = document.querySelector(${JSON.stringify(ZEILE_SELECT)});
      return JSON.stringify({ leaves: app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)}).length, host: !!document.querySelector(".transmute-model-host"),
        optionen: sel ? [...sel.options].map((o) => o.value) : null, erwartet: ${JSON.stringify(erwartet)} });
    `);
    console.log(`  Modellzeile nicht wie erwartet: ${stand}`);
  }
  return da === true;
}

/** Eine Option des Dropdowns waehlen, wie es ein Nutzer tut (Wert setzen, `change`). */
async function zeileWaehlen(cdp: Cdp, wert: string): Promise<void> {
  await cdp.evaluate(`
    const sel = document.querySelector(${JSON.stringify(ZEILE_SELECT)});
    sel.value = ${JSON.stringify(wert)};
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  `);
}

/** MZ1–MZ4: die Modellzeile im Panel (Kit `buildModelBar`). Die Zeile steht AUSSERHALB des Bereichs, den `renderPanel` bei jedem
 *  Voll-Draw leert (MZ2 misst das), ist waehrend der Erzeugung gesperrt (MZ3) und liest die Familie fuer den Denk-Knopf aus der
 *  Quelle, nicht aus dem Modellnamen (MZ4). Das Panel loest nur beim Oeffnen auf: nach jeder Aenderung am Manager Blatt zu und neu auf. */
async function abschnittModellzeile(cdp: Cdp): Promise<void> {
  const [MZ1, MZ2, MZ3, MZ4] = ABSCHNITTE.Modellzeile!;
  const P = `app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]`;
  const draft = { regex: "foo", flags: "", replacement: "bar", explanation: "e" };
  const vor = await cdp.evaluate<{ endpoints: unknown; choice: unknown; request: unknown }>(`const s = ${P}.settings; return { endpoints: s.endpoints, choice: s.choice, request: s.request };`);
  const stellWieder = (): Promise<unknown> => cdp.evaluate(`
    const p = ${P};
    p.settings.endpoints = ${JSON.stringify(vor.endpoints)};
    p.settings.choice = ${JSON.stringify(vor.choice)};
    p.settings.request = ${JSON.stringify(vor.request)};
    await p.saveSettings();
    p.llm.invalidate();
    return true;
  `).catch(() => undefined);
  const stub = await startLlmStub({
    models: ["mz-a", "mz-b"], verzoegerungMs: 2500, standard: { text: JSON.stringify(draft) },
  });
  try {
    // ---- MZ1: Fake-Manager mit zwei Modellen
    await fakeManagerEin(cdp, stub.url);
    await cdp.evaluate(`${P}.settings.choice = {}; await ${P}.saveSettings(); ${P}.llm.invalidate(); return true;`);
    if (!(await zeileOeffnen(cdp, MANAGER_CHOICE_MODEL))) {
      record(MZ1, false, "Die Modellzeile mit den Modellen des Managers kam in 10 s nicht ins Panel");
    } else {
      const start = await cdp.evaluate<{ texte: string[]; werte: string[] }>(`
        const sel = document.querySelector(${JSON.stringify(ZEILE_SELECT)});
        return { texte: [...sel.options].map((o) => o.textContent), werte: [...sel.options].map((o) => o.value) };
      `);
      await zeileWaehlen(cdp, MANAGER_CHOICE_MODEL);
      const gewaehlt = await pollUntil<{ choice: unknown; inUse: string }>(cdp, `
        const p = ${P};
        return p.settings.choice?.model === ${JSON.stringify(MANAGER_CHOICE_MODEL)} ? { choice: p.settings.choice.model, inUse: p.llm.modelInUse() } : null;
      `, 6_000, 200);
      await zeileWaehlen(cdp, "");
      const leer = await pollUntil<{ choice: unknown }>(cdp, `
        const p = ${P};
        return (p.settings.choice?.model ?? "") === "" ? { choice: p.settings.choice?.model ?? "" } : null;
      `, 6_000, 200);
      const auto = start.texte[start.werte.indexOf("")] ?? "";
      record(MZ1,
        start.werte.includes(MANAGER_DEFAULT_MODEL) && start.werte.includes(MANAGER_CHOICE_MODEL) && auto.includes(MANAGER_DEFAULT_MODEL)
          && gewaehlt !== null && gewaehlt.inUse === MANAGER_CHOICE_MODEL && leer !== null,
        `Optionen ${JSON.stringify(start.texte)}; Automatisch „${auto}“; nach Wahl choice.model „${String(gewaehlt?.choice ?? "nicht gesetzt")}“ (modelInUse „${gewaehlt?.inUse ?? "-"}“); nach Automatisch choice.model „${String(leer?.choice ?? "nicht geleert")}“`);
    }
    await fakeManagerAus(cdp);

    // ---- MZ2 + MZ3: lokaler Endpunkt auf dem Stub
    await cdp.evaluate(`
      const p = ${P};
      p.settings.endpoints = [{ url: ${JSON.stringify(stub.url)}, model: "mz-a" }];
      p.settings.choice = {};
      await p.saveSettings();
      p.llm.invalidate();
      await p.llm.resolve({ force: true });
      return true;
    `);
    if (!(await zeileOeffnen(cdp, "mz-b"))) {
      for (const n of [MZ2, MZ3]) record(n!, false, "Die Modellzeile mit den Modellen des Stubs kam in 10 s nicht ins Panel");
    } else {
      // Sichtpruefung (Regel 12, nicht Teil der Bilanz): die Zeile hell und dunkel, in der breiten und der schmalen (280 px) Seitenleiste. Nur mit $SHOT_DIR.
      if (process.env.SHOT_DIR) {
        mkdirSync(process.env.SHOT_DIR, { recursive: true });
        const war = await cdp.evaluate<boolean>(`return document.body.classList.contains("theme-dark");`);
        for (const breite of [520, 280]) {
          await cdp.evaluate(`const r = app.workspace.rightSplit; if (r && typeof r.setSize === "function") r.setSize(${breite}); return true;`);
          await new Promise((r) => setTimeout(r, 500));
          for (const dunkel of [false, true]) {
            await cdp.evaluate(`document.body.classList.toggle("theme-dark", ${dunkel}); document.body.classList.toggle("theme-light", ${!dunkel}); return true;`);
            await new Promise((r) => setTimeout(r, 300));
            const box = await boxOf(cdp, `.workspace-leaf-content[data-type="${VIEW_TYPE}"]`, 8);
            if (box) writeFileSync(join(process.env.SHOT_DIR, `mz-${dunkel ? "dunkel" : "hell"}-${breite}.png`), await capture(cdp, box, 2));
          }
        }
        await cdp.evaluate(`document.body.classList.toggle("theme-dark", ${war}); document.body.classList.toggle("theme-light", ${!war}); return true;`);
      }
      // MZ2 — ein Voll-Draw: Bereich wechseln. Die Zeile markieren und fokussieren; ein Feld im gezeichneten Bereich als Gegenprobe markieren.
      await zeileWaehlen(cdp, "mz-b");
      await pollUntil<boolean>(cdp, `return ${P}.llm.modelInUse() === "mz-b" ? true : null;`, 6_000, 200);
      await cdp.evaluate(`
        const sel = document.querySelector(${JSON.stringify(ZEILE_SELECT)});
        sel.__mz2 = 1; sel.focus();
        document.querySelector(".transmute-instruction").__mz2 = 1;
        return true;
      `);
      // Der Voll-Draw kommt ohne Klick (ein echter Mausklick nimmt den Fokus selbst): `draw()` der View, wie bei jedem Phasenwechsel der Sitzung.
      await cdp.evaluate(`app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view.draw(); return true;`);
      await new Promise((r) => setTimeout(r, 400));
      const nachDraw = await cdp.evaluate<{ gleich: boolean; fokus: boolean; wert: string; feldErsetzt: boolean }>(`
        const sel = document.querySelector(${JSON.stringify(ZEILE_SELECT)});
        const feld = document.querySelector(".transmute-instruction");
        return { gleich: !!sel && sel.__mz2 === 1, fokus: !!sel && document.activeElement === sel, wert: sel?.value ?? "", feldErsetzt: !!feld && feld.__mz2 !== 1 };
      `);
      record(MZ2, nachDraw.gleich && nachDraw.fokus && nachDraw.wert === "mz-b" && nachDraw.feldErsetzt,
        `nach dem Voll-Draw: Zeile ${nachDraw.gleich ? "dasselbe Element" : "NEU GEBAUT"}, Fokus ${nachDraw.fokus ? "bleibt" : "VERLOREN"}, Wahl „${nachDraw.wert}“; Gegenprobe (Anweisungsfeld im gezeichneten Bereich): ${nachDraw.feldErsetzt ? "ersetzt, der Draw lief" : "NICHT ersetzt, der Draw lief nicht"}`);

      // MZ3 — ein Lauf mit 2,5 s Verzoegerung: waehrenddessen gesperrt, danach bedienbar.
      await cdp.evaluate(`void ${P}.sessionInstance.generate("Smoke-Test: ersetze foo", "foo bar"); return true;`);
      const waehrend = await pollUntil<{ phase: string; gesperrt: boolean; knopf: boolean }>(cdp, `
        const st = ${P}.sessionInstance.state;
        const sel = document.querySelector(${JSON.stringify(ZEILE_SELECT)});
        const rf = document.querySelector(".okit-model-bar-refresh");
        return st.phase === "generating" && sel ? { phase: st.phase, gesperrt: sel.disabled, knopf: !!rf && rf.disabled } : null;
      `, 6_000, 100);
      const danach = await pollUntil<{ phase: string; gesperrt: boolean }>(cdp, `
        const st = ${P}.sessionInstance.state;
        const sel = document.querySelector(${JSON.stringify(ZEILE_SELECT)});
        return st.phase !== "generating" && sel ? { phase: st.phase, gesperrt: sel.disabled } : null;
      `, 20_000, 200);
      record(MZ3, waehrend !== null && waehrend.gesperrt && waehrend.knopf && danach !== null && !danach.gesperrt,
        `waehrend der Erzeugung (${waehrend?.phase ?? "nie generating gesehen"}): Dropdown ${waehrend?.gesperrt ? "gesperrt" : "NICHT gesperrt"}, Neu laden ${waehrend?.knopf ? "gesperrt" : "NICHT gesperrt"}; danach (${danach?.phase ?? "kein Ende"}): ${danach === null ? "-" : danach.gesperrt ? "BLEIBT gesperrt" : "bedienbar"}`);
    }

    // ---- MZ4: Familie aus der Quelle (Claude via Manager, Modellname ohne Familie) gegen denselben Namen ohne Manager
    // Der Fake-Manager traegt keine Familie je Endpunkt (nur Anbieter und Backend): die Familie kommt hier aus dem Namen des Claude-Modells.
    // „Familie aus der Quelle, nicht aus dem Namen“ ist am Fake nicht messbar (Zeiger in der Abschlussmeldung); der Unit-Test der View hat es mit einem Namen ohne Familie.
    const ALIAS = CLAUDE_MODELL;
    const LOKAL = "mz-a";
    // Der Denk-Knopf zeichnet sich nach der ersten Aufloesung neu (Familie): `erwartet` wartet, bis das Label so lautet, sonst gilt der letzte Stand.
    const label = async (erwartet: string | null): Promise<{ label: string; aria: string } | null> => {
      const lies = (): Promise<{ label: string; aria: string } | null> => cdp.evaluate(`
        const b = document.querySelector(".okit-model-bar .okit-thinking-toggle");
        return b ? { label: (b.textContent ?? "").trim(), aria: b.getAttribute("aria-label") ?? "" } : null;
      `);
      let stand = await lies();
      for (let i = 0; i < 32 && (stand === null || (erwartet !== null && stand.label !== erwartet)); i++) {
        await new Promise((r) => setTimeout(r, 250));
        stand = await lies();
      }
      return stand;
    };
    const claude = await startLlmStub({
      anbieter: "anthropic", schluessel: CLAUDE_SCHLUESSEL,
      models: [{ id: ALIAS, capabilities: { effort: { supported: true }, thinking: { types: { adaptive: { supported: true } } } } }],
      standard: { text: JSON.stringify(draft), model: ALIAS },
    });
    let mitManager: { label: string; aria: string } | null = null;
    let ohneManager: { label: string; aria: string } | null = null;
    let zeileDa = true;
    try {
      await cdp.evaluate(`${P}.settings.request.thinking = { ...(${P}.settings.request.thinking ?? {}), structured: "off" }; await ${P}.saveSettings(); return true;`);
      await installFakeManager(cdp, {
        pluginId: MANAGER_PLUGIN_ID,
        endpunkte: [{
          id: "fake-claude", label: "Claude API", url: claude.url, models: [ALIAS], defaultModel: ALIAS, configModel: "default",
          provider: "anthropic", backend: "anthropic", apiKey: CLAUDE_SCHLUESSEL, hasSecret: true, transport: "anthropic",
        }],
        invalidiere: [PLUGIN_ID],
      });
      await cdp.evaluate(`${P}.settings.choice = {}; await ${P}.saveSettings(); ${P}.llm.invalidate(); await ${P}.llm.resolve({ force: true }); return true;`);
      zeileDa = await zeileOeffnen(cdp, ALIAS);
      if (zeileDa) {
        // Der Denk-Knopf zeichnet sich nach der Aufloesung neu (Familie): kurz warten, bis das Label steht.
        mitManager = await label("Thinking: lowest level");
      }
      await fakeManagerAus(cdp);
      await cdp.evaluate(`
        const p = ${P};
        p.settings.endpoints = [{ url: ${JSON.stringify(stub.url)}, model: ${JSON.stringify(LOKAL)} }];
        p.settings.choice = {};
        await p.saveSettings();
        p.llm.invalidate();
        await p.llm.resolve({ force: true });
        return true;
      `);
      if (await zeileOeffnen(cdp, LOKAL)) {
        // Gegenprobe: ohne Familie bleibt es bei „Thinking off“; die Zeit gibt der Aufloesung Gelegenheit, es zu aendern.
        await new Promise((r) => setTimeout(r, 1500));
        ohneManager = await label(null);
      } else zeileDa = false;
    } finally {
      await claude.stop().catch(() => undefined);
    }
    record(MZ4,
      zeileDa && mitManager !== null && mitManager.label === "Thinking: lowest level" && mitManager.aria.includes("can't be fully turned off")
        && ohneManager !== null && ohneManager.label === "Thinking off",
      `${zeileDa ? "" : "Die Modellzeile kam in 10 s nicht ins Panel. "}Claude via Manager, Modell „${ALIAS}“: „${mitManager?.label ?? "kein Knopf"}“ (aria-label „${(mitManager?.aria ?? "").slice(0, 70)}“); lokales Modell „${LOKAL}“ ohne Manager: „${ohneManager?.label ?? "kein Knopf"}“`);
  } catch (e) {
    for (const n of ABSCHNITTE.Modellzeile!) if (!bilanz.eintraege().some((x) => x.name === n)) unmeasured(n, `Messung abgebrochen: ${(e as Error).message}`);
  } finally {
    await fakeManagerAus(cdp).catch(() => undefined);
    await stellWieder();
    await stub.stop().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  // attachTo statt Cdp.attach: Obsidian gibt dem Einstellungen-Fenster denselben
  // Vault-Namen im Titel, ein Titel-Filter waere also mehrdeutig (und sprachabhaengig).
  // Das Kriterium ist die Sache selbst — nur das Hauptfenster traegt einen Workspace.
  if (!Number.isInteger(PORT) || PORT <= 0) {
    throw new Error("--port <port> ist Pflicht (Zweitinstanz, siehe Kopf dieser Datei); kein Standardport.");
  }
  const cdp = await attachTo("workspace", PORT, VAULT);
  if (!cdp) throw new Error(`Kein Obsidian-Hauptfenster auf Port ${PORT} fuer Vault ${VAULT}.`);

  // Vorwert AUSSERHALB des try: sonst haengt die Wiederherstellung daran, dass der Lauf sauber zu Ende geht — und genau dann
  // tut er es nicht. Es ist ein Schnappschuss ALLER Einstellungen (die Abschnitte stellen Endpunkte, Wahl und Schwellen um; eine
  // einzelne Zuruecknahme je Feld liesse bei einem Abbruch mitten in einem Abschnitt Reste stehen).
  let vorwerte: string | null = null;

  // Alles, was dieser Lauf am Wirt veraendert, raeumt EIN Schritt zurueck: der Normalweg im `finally` (`zustand.schliesse()`),
  // Ctrl-C/SIGTERM ueber das Abbruch-Modul der Brücke (Hauptzweig gesperrt, dieser Schritt darf noch senden, danach Bilanz, Exit
  // 130). Angemeldet VOR der ersten Mutation, idempotent, wartet im Abbruch nicht. Die Stub-Server auf der Node-Seite enden mit dem Prozess.
  const zustandZurueck = async (): Promise<void> => {
    await fakeManagerAus(cdp).catch(() => undefined);
    await cdp.evaluate(`
      if (window.__smokeOrigOpen) { window.open = window.__smokeOrigOpen; delete window.__smokeOrigOpen; delete window.__smokeOpenUrls; }
      return true;
    `).catch(() => undefined);
    await releaseAlwaysOnTop(cdp).catch(() => undefined);
    if (vorwerte !== null) {
      await cdp.evaluate(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        if (!p) return false;
        p.settings = JSON.parse(${JSON.stringify(vorwerte)});
        await p.saveSettings();
        p.llm?.invalidate?.();
        return true;
      `).catch(() => undefined);
    }
    if (!KEEP && vorwerte !== null) {
      await buehneAbbauen(cdp).catch(() => undefined);
      // Die Snapshots dieses Laufs gehoeren nicht in den Vault des Nutzers.
      await cdp.evaluate(`
        const root = app.vault.configDir + "/plugins/${PLUGIN_ID}/snapshots";
        if (await app.vault.adapter.exists(root)) await app.vault.adapter.rmdir(root, true);
        return true;
      `).catch(() => undefined);
    }
  };
  const zustand = beimAbbruch(zustandZurueck, "Smoke-Zustand zurücksetzen");

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

    // Vertrauensdialog, Restricted Mode und Aktivierung: ueber die zentrale Fassung. `pluginIds`
    // sind `manifest.id`s (hier `transmute`), `nurVault` der Name des Staging-Vaults.
    const vorbereitung = await bereiteInstanzVor(cdp, { pluginIds: [PLUGIN_ID], nurVault: VAULT, sprache: "en" });
    console.log(`Instanz: ${vorbereitung.hinweis}`);
    const aktiv = await cdp.evaluate<boolean>(
      `return !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];`,
    );
    if (!aktiv) throw new Error(`Plugin „${PLUGIN_ID}" ist in diesem Vault nicht aktiv (${vorbereitung.hinweis}).`);

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

    vorwerte = await cdp.evaluate<string>(`return JSON.stringify(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings);`);

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
    await abschnitt("Hub", () => abschnittHub(cdp));
    await abschnitt("Abbruch", () => abschnittAbbruch(cdp, kandidaten));
    await abschnitt("Setter", () => abschnittSetter(cdp));
    await abschnitt("llm-lab", () => abschnittLlmLab(cdp));
    await abschnitt("Verbindung", () => abschnittVerbindung(cdp));
    await abschnitt("Gemma", () => abschnittGemma(cdp));
    await abschnitt("Linkschutz", () => abschnittLinkschutz(cdp));
    await abschnitt("Manager", () => abschnittManager(cdp));
    await abschnitt("Apple Intelligence", () => abschnittApple(cdp));
    await abschnitt("Claude", () => abschnittClaude(cdp));
    await abschnitt("Hilfe", () => abschnittHilfe(cdp));
    await abschnitt("Denken", () => abschnittDenken(cdp));
    await abschnitt("Modellzeile", () => abschnittModellzeile(cdp));
    await abschnitt("Globales Modell", () => abschnittGlobalesModell(cdp));
    await abschnitt("i18n", () => abschnittI18n(cdp));
  } finally {
    // Nimmt zurueck, was dieser Lauf veraendert hat (auch `requireVisible` in seiner letzten Stufe) — derselbe Schritt wie beim Abbruch.
    await zustand.schliesse();
    // Nach einem Abbruch beendet das Modul den Prozess selbst (Bilanz, Exit 130).
    if (!istAbgebrochen()) {
      cdp.close();
      // Die Soll-Liste ist der Nenner; `abschluss()` setzt Exit 1 bei Rot oder „nichts gemessen".
      bilanz.abschluss();
    }
  }
}

runDriver(main);
