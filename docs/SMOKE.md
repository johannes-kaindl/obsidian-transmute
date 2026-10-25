# GUI-Smoke — obsidian-transmute

Die Prüfpunkte laufen **gegen ein laufendes Obsidian**, nicht gegen einen Mock
(CORE-TEST-02 b). Was hier steht, ist der Teil, den die 405 vitest-Tests strukturell nicht
sehen können: die Naht zwischen Plugin und Host — echtes DOM, echter Vault, echte
Dateien, echter Event-Loop.

Der Treiber kommt **ohne LLM aus**: die Regel wird über den Handpfad („oder Regex selbst
schreiben") gesetzt. Ein Smoke, der an einem Modell hängt, misst das Modell mit.

## Fahren

Der Smoke läuft in einer **Zweitinstanz** mit eigenem Profil und eigenem Port; die reguläre Instanz wird nie beendet oder neu gestartet. `--port` ist Pflicht, und der Lauf braucht den Lock für den eigenen Port.

```bash
UD=/tmp/obs-test-obsidian-transmute; mkdir -p "$UD"
lsof -nP -iTCP:<port> -sTCP:LISTEN; pgrep -f "user-data-dir=$UD"      # beides leer
cp ~/Library/Application\ Support/obsidian/obsidian-<version>.asar "$UD"/
# $UD/obsidian.json: {"vaults":{"nt":{"path":"<Vault>","ts":<ms>,"open":true}},"language":"en"}
# <Vault> = $STAGING_VAULTS_DIR/obsidian-transmute (Default-Name des Treibers) oder ein Wegwerf-Vault:
npm run lab:vault -- --out ./test-vault --notes 12000   # nur beim ersten Mal
OBSIDIAN_PLUGIN_DIR="<Vault>/.obsidian/plugins/transmute" npm run deploy
python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label obsidian-transmute --intent "GUI-Smoke" --exclusive focus --port <port> --ttl 300
/Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$UD" --remote-debugging-port=<port> &
npm run smoke:gui -- --port <port> [--vault <Vault-Name>]
python3 ~/.claude/hooks/obsidian-cdp-lock.py release
```

Zwei Schalter für Klick-Punkte: `--halten <ms>` hält die Maustaste zwischen Press und Release; `--klick-gegenprobe` klickt nicht, dann muss jeder klickabhängige Punkt rot oder „nichts gemessen“ werden (gemessen 2026-10-14: 29 grün, 6 rot, 15 nichts gemessen). Der Undo-Abschnitt bleibt dabei „nichts gemessen“, weil Anwenden ohne Klick kein Undo anbietet; sein Punkt verlangt zusätzlich den ersetzten Zustand vor dem Klick und ist deshalb nie trivial grün. Ctrl-C räumt über das Abbruch-Modul der Brücke auf (Einstellungen zurück, Bühne weg, Fake-Manager aus, Bilanz, Exit 130).

Vertrauensdialog, eingeschränkter Modus und Aktivierung erledigt der Treiber (`bereiteInstanzVor`). Je Messlauf ein frischer Prozess; der erste Lauf nach einer Profilanlage ist ein Aufwärmlauf. Die Bilanz hat vier Zustände (grün · rot · übersprungen · nichts gemessen); Rot und „nichts gemessen" setzen Exit 1, ein Abbruch Exit 2. Der Nenner ist die Soll-Liste `ABSCHNITTE` im Treiber.

**Nur EIN Obsidian-Fenster offen lassen.** Bei mehreren Fenstern bringt `activate` das
falsche nach vorn, und Chromium drosselt Timer in `hidden` Seiten auf 1 Hz — jede
Zeitmessung wird dann Unsinn. Der Treiber prüft das und bricht mit klarer Meldung ab,
statt still falsch zu messen.

Der Wegwerf-Vault ist git-ignoriert und jederzeit neu erzeugbar. **12.000 Notizen sind
kein Übermut:** darunter ist der vault-weite Lauf schneller als der 250-ms-Freigabe-Takt,
und der wichtigste Prüfpunkt (unten) hat dann nichts zu messen.

**Der Deploy-Schritt ist nicht optional, und der Treiber verlässt sich nicht darauf.** Vor
dem ersten Prüfpunkt vergleicht er die `main.js` im Vault per sha1 mit der frisch gebauten
im Repo (`requireEigenerBuild` aus der zentralen Brücke) und bricht ab, wenn sie
auseinanderfallen — bei einer Store-Installation ebenso wie bei einem alten Deploy.

Der Grund ist ein gemessener Fehlschlag, kein Vorsichtsprinzip: `manifest.version` ist für
diese Frage **strukturell blind**, weil Store-Build und Repo-Build dieselbe Nummer tragen.
Am 2026-08-30 standen deshalb workspace-weit 69 von 150 grünen Prüfpunkten auf unbelegtem
Code — der 25/25-Lauf dieses Repos vom 28.08. war einer davon. Den Pfad holt der Treiber
aus der **laufenden** Instanz (`app.vault.adapter.basePath`), nicht aus einer Konvention:
er dockt per `--vault` an ein beliebiges Fenster an, und ein konfigurierter Pfad prüfte
sonst eine Datei, die mit dem Lauf nichts zu tun hat.

## Prüfpunkte (nach Bereichen)

| Bereich | Was gemessen wird |
|---|---|
| Umfang | Umfangs-Block erscheint · Kandidatenzahl · Ordner-Filter grenzt ein · leerer Umfang meldet sich als eigener Fall · Vorschau-Knopf dann gesperrt |
| Vorschau | Handpfad ohne Modell · Dateiliste · **eingeklappt startend** · Zusammenfassung · Aufklappen · Tri-State bei teilweiser Auswahl |
| Anwenden | Bestätigungsdialog über der Schwelle · Ergebnismeldung · **die Ersetzung steht wirklich in der Datei** · Snapshot auf der Platte · Rückgängig-Knopf |
| Rückgängig | unveränderte Datei wird hergestellt · **seither bearbeitete Datei bleibt unangetastet** · übersprungene Datei wird benannt |
| Hub | Tab-Leiste mit zwei Tabs, Icons gerendert · Bibliothek listet die Regel mit Ausführen-Knopf · **Ausführen wechselt in den Arbeitsbereich und füllt die Felder** |
| Grenzen | unvollständig gemessene Datei ist gesperrt |
| Event-Loop | **Renderer atmet während des Laufs** (s. u.) |
| Einstellungen | Bereich „Vault" überlebt Setter **und** Neuladen |
| i18n | kein roher Übersetzungs-Schlüssel im Panel |
| Claude (CL1–CL3) | der Claude-Eintrag des Managers kommt nur mit Opt-in und das Plugin wählt ihn · Lauf gegen den Anthropic-Stub: `x-api-key`, `anthropic-version`, `model`, `max_tokens`, **kein `temperature` im Body**, `override-dropped` in „Letzte Anfrage“ · 529 `overloaded_error` endet im Fehlerzustand mit der Meldung der API |
| Modellzeile (MZ1–MZ4, G2) | die Zeile des Kits (`.okit-model-bar`) steht **über** dem Arbeitsbereich: Fake-Manager mit zwei Modellen → Liste, *Automatic (<Standard-Modell>)*, ein Wechsel schreibt `choice.model`, *Automatic* leert es (MZ1) · ein Voll-Draw (`draw()` der View, ohne Klick, weil ein Mausklick den Fokus selbst nimmt) lässt dasselbe Element, Fokus und Wahl stehen, das Anweisungsfeld im gezeichneten Bereich wird dabei ersetzt (MZ2) · während der Erzeugung gesperrt, danach bedienbar (MZ3, Stub mit 2,5 s Verzögerung) · Denk-Knopf: Claude via Manager „Thinking: lowest level“ mit dem Grund im `aria-label`, lokales Modell ohne Familie „Thinking off“ (MZ4) · G2 wählt über das Dropdown der Zeile in die aktive Zeile (lokaler Stub mit zwei Modellen), *Automatic* leert sie. Das Panel-Blatt wird vor jedem Öffnen geschlossen (`closeExtraLeaves` trifft es nicht, es trüge die Liste vom Öffnen). Grenze: der Fake-Manager trägt keine Familie je Endpunkt, „Familie aus der Quelle statt aus dem Modellnamen“ ist am Fake nicht messbar (der Unit-Test der View hat es mit einem Namen ohne Familie) |

### Der Prüfpunkt, um den es eigentlich geht

**„Renderer atmet während des Laufs"** zählt, wie oft der Lauf `setTimeout(…, 0)` aufruft —
also die UI-Freigabe **direkt**, nicht ihre Nebenwirkung. Drei Anläufe über die Nebenwirkung
(„laufen fremde Makrotasks?") waren allesamt irreführend: einmal maß die Drosselung mit,
zweimal war der Lauf schlicht kürzer als der Freigabe-Takt. Der Punkt eicht deshalb zuerst
die Timer-Kette des Fensters und meldet die Bedingungen im Ergebnis mit.

## Durchläufe

### 2026-10-25 — Obsidian 1.14.5, Welle 26 (Pin obsidian-kit 0.69.1 / code-kit 0.36.0, Claude-Opt-in) · **56 grün · 0 rot · 2 übersprungen · 0 nichts gemessen von 58**

Vorher (Baseline, Pin 0.61.0/0.34.0, Staging-Vault `obsidian-transmute` neu mit `lab:vault --notes 400` angelegt): 53 grün · 0 rot · 1 übersprungen · 1 nichts gemessen von 55. Die zwei Punkte „Renderer atmet“ und „Abbrechen“ sind im 400-Notizen-Vault nicht messbar (der Lauf ist nach 65 bis 92 ms durch, unter dem Freigabe-Takt von 250 ms) und kamen in den späteren Läufen als „übersprungen“, im ersten Baseline-Lauf als „nichts gemessen“; wie vor Welle 20 zwei Übersprungene, kein Befund am Plugin. Neu sind CL1–CL3 (Abschnitt `Claude`): der Fake-Manager mit `transport: "anthropic"` und der Anthropic-Modus des zentralen Stubs. CL2 liest „Letzte Anfrage“ aus `display()` des Einstellungs-Tabs (`.okit-request-deviation`): „Request values not sent, the model does not accept them: temperature.“ CL3 braucht zwei 529-Antworten, denn der Client wiederholt bei 5xx einmal; mit nur einer kam die Regel durch und der Punkt war rot (Treiberfehler, behoben).

Gegenprobe, jeder Punkt einzeln rot gemacht: (A) falscher Schlüssel im Fake-Manager → CL2 und CL3 rot (`invalid x-api-key`); (B) keine 529-Antwort → CL3 rot, CL1/CL2 grün; (C) `anthropic: true` aus dem Build entfernt, gebaut und deployt, frischer Prozess → CL1, CL2, CL3 rot (Backend `unknown`, 0 Anfragen am Stub, CL3 meldet „has no usable endpoint“). Danach Build und Treiber wie vorher.

### 2026-10-12 — Obsidian 1.14.4, Welle 20 (B2: Pin obsidian-kit 0.59.0, Brücke `fc71211`) · **48 grün · 0 rot · 2 übersprungen von 50**

Vorher (B1, Pin 0.57.0): 48/0/2/0 von 50. Keine Verschiebung; die Detailzeilen aller V-, M-, S-, llm-lab-, H- und G-Punkte sind bis auf die turnId identisch. `ENDPOINT_LIST_CSS` in `styles.css` neu kopiert (der Treiber prüft die Endpunkt-Zeile nicht über Kindselektoren). `settings.png` neu aufgenommen.

### 2026-10-12 — Obsidian 1.14.4, Welle 20 (B1: zentraler LLM-Stub und Fake-Manager, Brücke `fc71211`) · **48 grün · 0 rot · 2 übersprungen von 50**

Der eigene HTTP-Server des Treibers (`startFakeEndpoint`) ist eine dünne Hülle über `startLlmStub`, der Fake-Manager des Abschnitts „Manager“ kommt aus `installFakeManager`/`entferneFakeManager`. Gleiche Lage wie vorher (Port 9392, frischer Prozess), Bilanz unverändert; die Detailzeilen aller V-, M-, S- und llm-lab-Punkte sind bis auf die turnId identisch. Ein erster Lauf zeigte „Renderer atmet“ als nichts gemessen („Lauf ist in 2 s nicht angelaufen“, Abschnitt vor jedem Stub); zwei Wiederholungen mit frischem Prozess lagen wieder bei „übersprungen: Lauf nach 110 ms durch“. Der Apple-Fake (zwei Endpunkte, Transport `shortcuts`) bleibt lokal, weil `FakeEndpunkt` weder `transport` noch `shortcut` noch den `list`-Filter `transports` kennt.

### 2026-10-12 — Obsidian 1.14.4, Welle 20 (Bibliothek-Tab im Hub) · **48 grün · 0 rot · 2 übersprungen von 50**

Vorher (frischer Prozess nach Aufwärmlauf, Port 9392): 45 grün · 0 rot · 2 übersprungen von 47. Neu sind die drei Hub-Punkte T1–T3; sonst hat sich nichts verschoben (die zwei Übersprungenen sind weiter „Renderer atmet“/„Abbrechen“: der Lauf war nach 83 ms durch). Der erste Lauf mit T3 war **rot** (Muster- und Ersetzungsfeld leer nach „Ausführen“): `editRule` meldet „edit“ und zeichnet die Regel-Felder nicht neu; das gab es schon bei der alten Preset-Knopfzeile. Behoben mit einem Voll-Draw vor dem Tab-Wechsel, Unit-Test mit Mutationsprobe in beide Richtungen.

### 2026-10-09 — Obsidian 1.14.4, Welle 15 (Verbindungs-Tausch auf `createLlmConnection`) · **43 grün · 0 rot · 1 übersprungen von 44**

Vorher (frischer Prozess nach Aufwärmlauf): 39 grün · 0 rot · 1 übersprungen von 40. Der Aufwärmlauf im selben Fenster direkt nach dem Vertrauensdialog zeigte 31 grün · 5 rot (Bestätigungsdialog, Anwenden, Snapshot, Rückgängig) und zählt nicht. Neu sind V1–V4: V1 der Transport sieht den Platzhalter statt `Bearer …`, die Regel kommt im Original an (der Fake-Endpunkt spiegelt den Platzhalter in `regex`), V2 der Schlüssel steht nach `resolve({ force: true })` nicht mehr in `data.json` (stattdessen `secretId`) und erreicht den Server trotzdem als `Authorization`-Kopf, V3 die Anfrage trägt `stream: false` und `temperature: 0`, V4 derselbe Weg mit einem mehrzeiligen PEM-Block, `JSON.parse` gelingt und das Original ist da.

Gegenprobe: mit `restoreContent: "text"` statt `"json"` ist V4 **rot** (`JSON.parse: Bad control character in string literal`), V1–V3 bleiben grün. Der Treiber ruft `p.llm.invalidate()` und `p.llm.resolve()` statt der alten `p.resolver`/`isShortcutsEndpoint()`. Der eine übersprungene Punkt („Renderer atmet“) ist der Vorbestand der Baseline.

### 2026-10-01 — Obsidian 1.14.3, Welle 14 (Apple-Intelligence-Endpunkt) · **39 grün · 0 rot · 1 übersprungen von 40**

Vorher (frischer Prozess nach Aufwärmlauf): 34 grün · 0 rot · 1 übersprungen von 35. Neu sind S1–S5: S1 der Fake-Manager liefert den Apple-Endpunkt nur bei Opt-in (misst den Fake selbst), S2 das Dropdown zeigt „Apple Intelligence (on-device)“, S3 die Wahl macht `isShortcutsEndpoint()` wahr und der Hinweis zu den Grenzen steht im Tab, S4 ein Lauf öffnet die `shortcuts://`-URL mit dem Namen und dem Nutzertext (`window.open` **vor** dem Anstoß gestubbt, im `finally` zurückgebaut), S5 die Zeitüberschreitung (Kurzbefehl-Frist 3 s, kein Callback) endet im Fehlerzustand mit dem Schlüssel `error.shortcut.timeout`.

Gegenprobe: ohne `transports: ["http", "shortcuts"]` im Settings-Tab sind S2–S5 **rot** (35 grün · 4 rot), S1 bleibt grün. Ein echter Rundlauf (die Kurzbefehle-App antwortet) ist nur am Gerät möglich und bewusst kein Prüfpunkt. Der eine übersprungene Punkt („Renderer atmet“) ist der Vorbestand der Baseline.

### 2026-08-16 — Obsidian 1.13.7, Vault mit 12.002 Notizen · **25/25**

Erster Lauf des Treibers. **Zwei echte Fehler gefunden, die 403 grüne Unit-Tests nicht
sahen** — beide an derselben Stelle: dem Versprechen, dass ein vault-weiter Lauf
abbrechbar ist.

1. **Die UI-Freigabe stand hinter einem `continue`.** In `runOverFiles` lagen Fortschritt
   und `yieldToUi` am Schleifenende — hinter dem `continue` für „zu viele Treffer". Ein
   Muster wie `[a-z]` reißt die Obergrenze in *jeder* Datei, also wurde die Oberfläche
   **nie** freigegeben: ausgerechnet im teuersten Fall war der Abbrechen-Knopf Dekoration.
   Behoben durch eine `else`-Kette ohne `continue`; zwei Regressionstests
   (`vault-run.test.ts`) decken beide Ausprägungen ab (Obergrenze, unlesbare Datei).
2. **Jeder Fortschritt zeichnete die komplette Trefferliste neu.** Bei 11.770 betroffenen
   Dateien kostet das mehr als der Lauf selbst und blockiert genau die Oberfläche, die der
   Fortschritt informieren soll. `renderVaultBody` lässt die Liste während des Laufs jetzt
   weg — inhaltlich ohnehin richtig, solange es kein vollständiges Ergebnis gibt.

**Gegenprobe** (zweimal gefahren, der Schritt, der den Smoke gültig macht):

| Ausgebaut | Erwartet rot | Gemessen |
|---|---|---|
| `yieldToUi` im Lauf-Aufruf | „Renderer atmet" | **24/25** — genau dieser Punkt, 0 statt 1 Freigabe |
| Schutz in `restoreSnapshot` | „bearbeitete Datei bleibt unangetastet" + „übersprungene wird benannt" | **23/25** — genau diese zwei |

Übersprungen: **„Abbrechen beendet den Lauf"** — ein Klick von außen kommt bei diesen
Laufzeiten immer zu spät. Der Mechanismus dahinter ist über die UI-Freigabe abgedeckt; der
Klickpfad selbst bleibt Handarbeit.

Nicht automatisiert (bewusst): ob die Liste *gut aussieht*, ob Abstände stimmen, ob sich
das Aufklappen flüssig anfühlt. Dafür bleibt die Hand-Runde.
