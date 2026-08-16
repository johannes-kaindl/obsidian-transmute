# GUI-Smoke — obsidian-transmute

Die Prüfpunkte laufen **gegen ein laufendes Obsidian**, nicht gegen einen Mock
(CORE-TEST-02 b). Was hier steht, ist der Teil, den die 405 vitest-Tests strukturell nicht
sehen können: die Naht zwischen Plugin und Host — echtes DOM, echter Vault, echte
Dateien, echter Event-Loop.

Der Treiber kommt **ohne LLM aus**: die Regel wird über den Handpfad („oder Regex selbst
schreiben") gesetzt. Ein Smoke, der an einem Modell hängt, misst das Modell mit.

## Fahren

```bash
osascript -e 'tell application "Obsidian" to quit'
open -a Obsidian --args --remote-debugging-port=9222
npm run lab:vault -- --out ./test-vault --notes 12000   # nur beim ersten Mal
OBSIDIAN_PLUGIN_DIR="$PWD/test-vault/.obsidian/plugins/transmute" npm run deploy
npm run smoke:gui -- --vault test-vault
```

**Nur EIN Obsidian-Fenster offen lassen.** Bei mehreren Fenstern bringt `activate` das
falsche nach vorn, und Chromium drosselt Timer in `hidden` Seiten auf 1 Hz — jede
Zeitmessung wird dann Unsinn. Der Treiber prüft das und bricht mit klarer Meldung ab,
statt still falsch zu messen.

Der Wegwerf-Vault ist git-ignoriert und jederzeit neu erzeugbar. **12.000 Notizen sind
kein Übermut:** darunter ist der vault-weite Lauf schneller als der 250-ms-Freigabe-Takt,
und der wichtigste Prüfpunkt (unten) hat dann nichts zu messen.

## Prüfpunkte (25)

| Bereich | Was gemessen wird |
|---|---|
| Umfang | Umfangs-Block erscheint · Kandidatenzahl · Ordner-Filter grenzt ein · leerer Umfang meldet sich als eigener Fall · Vorschau-Knopf dann gesperrt |
| Vorschau | Handpfad ohne Modell · Dateiliste · **eingeklappt startend** · Zusammenfassung · Aufklappen · Tri-State bei teilweiser Auswahl |
| Anwenden | Bestätigungsdialog über der Schwelle · Ergebnismeldung · **die Ersetzung steht wirklich in der Datei** · Snapshot auf der Platte · Rückgängig-Knopf |
| Rückgängig | unveränderte Datei wird hergestellt · **seither bearbeitete Datei bleibt unangetastet** · übersprungene Datei wird benannt |
| Grenzen | unvollständig gemessene Datei ist gesperrt |
| Event-Loop | **Renderer atmet während des Laufs** (s. u.) |
| Einstellungen | Bereich „Vault" überlebt Setter **und** Neuladen |
| i18n | kein roher Übersetzungs-Schlüssel im Panel |

### Der Prüfpunkt, um den es eigentlich geht

**„Renderer atmet während des Laufs"** zählt, wie oft der Lauf `setTimeout(…, 0)` aufruft —
also die UI-Freigabe **direkt**, nicht ihre Nebenwirkung. Drei Anläufe über die Nebenwirkung
(„laufen fremde Makrotasks?") waren allesamt irreführend: einmal maß die Drosselung mit,
zweimal war der Lauf schlicht kürzer als der Freigabe-Takt. Der Punkt eicht deshalb zuerst
die Timer-Kette des Fensters und meldet die Bedingungen im Ergebnis mit.

## Durchläufe

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
