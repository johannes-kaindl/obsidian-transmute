# Transmute

> [🇬🇧 English](https://git.jkaindl.de/jkaindl/obsidian-transmute/src/branch/main/README.md) · 🇩🇪 Deutsch

**Beschreibe in normaler Sprache, was ersetzt werden soll — ein lokales LLM schreibt die Regex, du prüfst jeden Treffer, bevor irgendetwas geschrieben wird.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](https://git.jkaindl.de/jkaindl/obsidian-transmute/src/branch/main/LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](https://git.jkaindl.de/jkaindl/obsidian-transmute/src/branch/main/LICENSE-DOCS)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/obsidian-transmute?gitea_url=https%3A%2F%2Fgit.jkaindl.de&label=release)](https://git.jkaindl.de/jkaindl/obsidian-transmute/releases)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.8.7%2B%20·%20desktop%20%26%20mobile-7c3aed)

<p align="center"><img src="https://git.jkaindl.de/jkaindl/obsidian-transmute/raw/branch/main/docs/images/preview.png" width="600" alt="Das Transmute-Panel neben einer Notiz: Muster, Ersetzung und jeder Treffer mit Vorher- und Nachher-Zeile, jeder einzeln abwählbar"></p>

## Funktionen

- **Suchen & Ersetzen in natürlicher Sprache.** Tippe, was sich ändern soll (z. B. „Daten von TT.MM.JJJJ in JJJJ-MM-TT umwandeln"), und ein lokales OpenAI-kompatibles LLM macht daraus eine JavaScript-Regex, ein Ersetzungsmuster und eine Ein-Satz-Erklärung in Klartext, was das Muster trifft.
- **Vorschau, bevor irgendetwas geschrieben wird.** Jeder Treffer wird zeilenweise vorher/nachher gezeigt, mit eigener Checkbox. Nichts ändert sich in der Notiz, bis du **„Anwenden"** klickst — und nur die angehakten Treffer werden geschrieben.
- **Kein eigenes Undo-System nötig.** Das Anwenden schreibt über den Editor, die Änderung landet also in Obsidians eigenem Undo-Stack — **Cmd+Z macht sie in einem Schritt rückgängig**, genau wie jede andere Bearbeitung.
- **Iteratives Nachschärfen.** Nicht ganz richtig? Tippe eine Anschluss-Anweisung wie „aber nicht in Codeblöcken" und klicke **„Nachschärfen"** — das Plugin schickt den Gesprächsverlauf *und* die bisher gefundenen echten Treffer zurück ans Modell, damit es sieht, was falsch lief.
- **Bereichs-Kontrolle.** Läuft auf der ganzen Notiz oder auf der aktuellen Auswahl; der Standard ist in den Einstellungen konfigurierbar.

<img src="https://git.jkaindl.de/jkaindl/obsidian-transmute/raw/branch/main/docs/images/vault-scope.png" width="512" alt="Bereich „Ganzer Vault“, nach Ordner gefiltert, mit den Treffern nach Datei gruppiert und einer aufgeklappten Datei">

- **Modellagnostisch per Design.** Es ist nirgends ein Modellname hartkodiert. Die Modell-Liste wird live aus `GET /v1/models` des Endpunkts gelesen; leer gelassen entscheidet der Server, welches geladene Modell genutzt wird.
- **Geordnete Endpunkt-Fallback-Liste.** Mehrere OpenAI-kompatible Server konfigurieren; das Plugin probiert sie der Reihe nach und nutzt den ersten erreichbaren, mit Ein-Klick-Presets für LM Studio und Ollama und einem Erreichbarkeits-Status pro Zeile.
- **Reasoning-Modelle korrekt behandelt.** `<think>`-Blöcke werden abgetrennt, bevor die JSON-Antwort geparst wird, und wo der Server es unterstützt, wird Reasoning aktiv unterdrückt — Thinker-Modelle antworten dadurch schneller und die Gedankenkette landet nicht in der Notiz.
- **Das Muster selbst bearbeiten.** Regex, Ersetzung und Flags sind direkt im Panel editierbar, und die Vorschau rechnet nach einer kurzen Tippause neu. Eine von Hand geänderte Regel wird ein eigener Verlaufseintrag („Bearbeitet"), die Fassung des Modells bleibt also erhalten und ist einen Klick entfernt. `g` wird angezeigt, aber nicht angeboten — es ist immer an, und ein Schalter, der nichts schaltet, wäre eine Lüge.

<img src="https://git.jkaindl.de/jkaindl/obsidian-transmute/raw/branch/main/docs/images/rule-editor.png" width="512" alt="Muster, Ersetzung und Flags als editierbare Felder, darunter der aufgeklappte Regex-Spickzettel">

- **Ein außer Kontrolle geratenes Muster kann den Editor nicht blockieren.** Jedes erzeugte Muster wird von einer statischen Heuristik geprüft (verschachtelte Quantoren, quantifizierte Alternation, unbegrenzte Rückreferenzen) — **bevor** es überhaupt läuft; die Ausführung selbst ist zusätzlich durch ein Zeitbudget pro Zeile begrenzt.
- **Tolerant gegenüber unsauberer Modell-Ausgabe.** Die Antwort des Modells wird nachsichtig geparst — Code-Fences werden entfernt, das erste balancierte JSON-Objekt wird extrahiert — und bei einem Parse- oder Validierungsfehler geht genau ein Retry mit dem konkreten Fehler zurück ans Modell, bevor eine klare Fehlermeldung erscheint.
- **Zweisprachige Oberfläche.** Englisch ist kanonisch; die Oberfläche folgt Obsidians Spracheinstellung und liefert eine vollständige deutsche Übersetzung.

### Im Detail

Transmute schließt eine Lücke, die Obsidian offen lässt: Die eingebaute Suche ist read-only, und die bestehenden Regex-Plugins (Regex Find/Replace, Search and Replace Regex, Apply Patterns) setzen alle voraus, dass man bereits weiß, wie man eine Regex schreibt. Transmute lässt die Änderung stattdessen in eigenen Worten beschreiben. Ein Ribbon-Icon (`replace`, Label „Transmute") und der Command **„Open panel"** öffnen ein Panel in der Sidebar: Bereich wählen, Änderung beschreiben, **„Erzeugen"** klicken — das Muster des Modells wird kompiliert, auf katastrophales Backtracking geprüft und gegen den Text ausgeführt — nie blind. Die gefundenen Treffer werden hervorgehoben angezeigt; einzelne Treffer an- oder abwählen (oder **„Alle auswählen"** / **„Keinen auswählen"** nutzen), die Anweisung beliebig oft nachschärfen, und erst schreiben, wenn alles passt.

## Voraussetzungen

- **Obsidian 1.8.7+** (Desktop oder Mobile).
- **Ein OpenAI-kompatibler lokaler Server** (z. B. [LM Studio](https://lmstudio.ai) oder [Ollama](https://ollama.com)) mit einem geladenen Chat-fähigen Modell. Neu bei lokalen LLMs? Die **[Anleitung für den lokalen LLM-Aufbau](https://uplink.jkaindl.de/llm-setup)** führt einmal komplett durch Server, Modell und mobilen Zugriff. Endpunkt und Modell werden in den Plugin-Einstellungen konfiguriert — nichts verlässt die Maschine.

## Installation

### Community-Plugins (empfohlen)

**Transmute** in **Einstellungen → Community-Plugins → Durchsuchen** suchen, dann **Installieren** und **Aktivieren**.

<img src="https://git.jkaindl.de/jkaindl/obsidian-transmute/raw/branch/main/docs/images/settings.png" width="600" alt="Die Plugin-Einstellungen: die Endpunkt-Liste mit Erreichbarkeits-Status je Zeile, Modellwahl und die Verhaltens-Optionen">


### Manuell

`main.js`, `manifest.json` und `styles.css` aus dem [letzten Release](https://git.jkaindl.de/jkaindl/obsidian-transmute/releases) nach `<vault>/.obsidian/plugins/transmute/` legen, dann unter **Settings → Community plugins** aktivieren.

### From source

```bash
git clone https://git.jkaindl.de/jkaindl/obsidian-transmute
cd obsidian-transmute
npm install
npm run build   # → main.js
```

Danach `main.js`, `manifest.json` und `styles.css` nach `<vault>/.obsidian/plugins/transmute/` kopieren und Obsidian neu laden.

## Verwendung

1. Das Plugin auf den lokalen Server ausrichten (siehe [Konfiguration](#konfiguration) weiter unten) und sicherstellen, dass ein Modell geladen ist.
2. Auf das Ribbon-Icon **„Transmute"** klicken (oder den Command **„Open panel"** ausführen), um das Panel in der Sidebar zu öffnen.
3. Einen Bereich wählen: **„Ganze Notiz"** oder **„Auswahl"**.
4. Die Änderung im Anweisungsfeld beschreiben, z. B. *„Daten von TT.MM.JJJJ in JJJJ-MM-TT umwandeln"*, und **„Erzeugen"** klicken.
5. Die Vorschau prüfen: das erzeugte Muster, seine Klartext-Erklärung, und jeder Treffer mit Vorher/Nachher-Zeile und Checkbox. Alles abwählen, was nicht gewünscht ist, oder **„Alle auswählen"** / **„Keinen auswählen"** nutzen.
6. Nicht ganz richtig? Eine Anschluss-Anweisung im Nachschärf-Feld eintippen (z. B. *„aber nicht in Codeblöcken"*) und **„Nachschärfen"** klicken — das Modell sieht die vorherigen Runden und die tatsächlich erzeugten Treffer.
7. **„Anwenden"** klicken. Nur die angehakten Treffer werden geschrieben, und die Änderung landet in Obsidians normalem Undo-Stack — **Cmd+Z** macht sie in einem Schritt rückgängig.

### Konfiguration

**Einstellungen → Community-Plugins → Transmute** öffnen. Die Einstellungen sind unter **„Connection"** und **„Behaviour"** gruppiert.

| Einstellung | Default | Wirkung |
|---|---|---|
| **Endpoints** | `["http://127.0.0.1:1234"]` | Geordnete Liste OpenAI-kompatibler Server, der Reihe nach probiert; der erste erreichbare wird genutzt. Ein-Klick-Presets für LM Studio und Ollama, dazu ein Erreichbarkeits-Status pro Zeile und ein „Verbindungen testen"-Button. |
| **Model** | `""` (leer) | Welches Modell angefragt wird. Leer lässt den Server entscheiden, welches geladene Modell genutzt wird. Ein Dropdown wird aus `/v1/models` des aktiven Endpunkts gefüllt; über den Reload-Button aktualisierbar. |
| **Request timeout (ms)** | `120000` | Wie lange auf die Antwort des Modells gewartet wird, bevor abgebrochen wird. |
| **Default scope** | `file` (Ganze Notiz) | Mit welchem Bereich eine neue Regel startet — „Ganze Notiz" oder „Auswahl". Pro Lauf im Panel umschaltbar. |
| **Text sample sent to the model** | `2000` (Zeichen) | Wie viel Text des Bereichs zusammen mit der Anweisung mitgeschickt wird, damit das Modell sieht, worauf es trifft. |
| **Time budget for running the pattern (ms)** | `2000` | Ein Muster, das beim zeilenweisen Durchlauf länger als dieses Budget läuft, wird abgebrochen; die bis dahin gefundenen Treffer werden mit einem Hinweis angezeigt. |
| **Ask reasoning models to skip thinking** | `true` | Schickt Reasoning-Unterdrückungs-Parameter an den Endpunkt (und trennt `<think>`-Blöcke aus der Antwort ohnehin ab) — Reasoning-fähige lokale Modelle antworten dadurch schneller und zuverlässiger. |

**Endpoint-Tipp:** die Base-URL **ohne** abschließendes `/v1` eintragen — der Client hängt `/v1` selbst an (ein abschließendes `/v1` wird ohnehin automatisch entfernt, beide Formen funktionieren also).

## Funktionsweise

Transmute schickt die Anweisung plus eine Textprobe des gewählten Bereichs an `/v1/chat/completions` des konfigurierten Endpunkts und verlangt genau ein JSON-Objekt — `regex`, `flags`, `replacement`, `explanation` — nie Prosa. Die Antwort wird nachsichtig geparst (Code-Fences und ein eventueller `<think>`-Block werden entfernt, das erste balancierte JSON-Objekt wird extrahiert), und bei einem Parse- oder Validierungsfehler geht genau ein Retry mit dem konkreten Fehler zurück ans Modell.

Bevor das erzeugte Muster überhaupt läuft, prüft eine statische Heuristik es auf Konstrukte, die katastrophales Backtracking auslösen können — verschachtelte Quantoren, quantifizierte Alternation über identische Zweige, unbegrenzte Rückreferenzen — und lehnt es mit einem Klartext-Grund ab, wenn es riskant aussieht. Ein Muster, das die Prüfung besteht, wird danach zeilenweise gegen den Bereichstext ausgeführt, unter einem konfigurierbaren Zeitbudget; mehrzeilige Muster (ein `s`/`m`-Flag oder ein literales `\n` im Muster) laufen stattdessen einmal gegen den ganzen Text, weil ein Zeitbudget nur zwischen diskreten Schritten Sinn ergibt.

In die Notiz wird erst geschrieben, wenn **„Anwenden"** geklickt wird. Dann werden nur die angehakten Treffer angewendet — in umgekehrter Reihenfolge, damit frühere Ersetzungen nie die Offsets späterer verschieben —, und das Ergebnis wird über Obsidians Editor-API geschrieben (`editor.replaceRange`), was die Änderung erst auf den normalen Undo-Stack bringt.

## Handbuch

Die vollständige Dokumentation folgt dem [Diátaxis](https://diataxis.fr)-Rahmenwerk — siehe [docs/manual/index.md](https://git.jkaindl.de/jkaindl/obsidian-transmute/src/branch/main/docs/manual/index.md):

- **Tutorial** — von null bis zur ersten angewendeten Ersetzung.
- **How-to-Guides** — aufgabenorientierte Rezepte (mehrere Endpunkte, eine Regel nachschärfen, rückgängig machen, eine „unsicheres Muster"-Fehlermeldung behandeln).
- **Reference** — Einstellungen, Commands, Fehlermeldungen, der JSON-Vertrag.
- **Explanation** — warum Vorschau-vor-Anwendung der Kern des Designs ist, warum es kein eigenes Snapshot-System gibt, und warum der Sicherheits-Guard ohne Web-Worker auskommt.

Release-Notizen im [Changelog](https://git.jkaindl.de/jkaindl/obsidian-transmute/src/branch/main/CHANGELOG.md).

## Verwandtes

**[ksawl/obsidian-alchemist](https://github.com/ksawl/obsidian-alchemist)** teilt die Alchemie-/Transmutations-Bildsprache, deckt aber ein anderes Feld ab: ein allgemeines Vault-Hygiene-Toolkit. Transmute ist eng auf eine Sache fokussiert — eine Anweisung in natürlicher Sprache in eine geprüft angewendete Regex-Ersetzung zu verwandeln — und erhebt keinen Anspruch, Vault-Hygiene allgemein abzudecken.

## Mitwirken

Beiträge sind willkommen. Bitte [CONTRIBUTING.md](https://git.jkaindl.de/jkaindl/obsidian-transmute/src/branch/main/CONTRIBUTING.md) für den Workflow lesen (testgetrieben, `main` immer grün, Feature-Arbeit in `feat/<name>`, Conventional Commits) sowie [AGENTS.md](https://git.jkaindl.de/jkaindl/obsidian-transmute/src/branch/main/AGENTS.md) für Architektur und Modul-Konventionen. Das kanonische Repository liegt auf [Forgejo](https://git.jkaindl.de/jkaindl/obsidian-transmute); GitHub (`johannes-kaindl/obsidian-transmute`) ist ein Mirror.

## Lizenz

- **Code:** [AGPL-3.0-or-later](https://git.jkaindl.de/jkaindl/obsidian-transmute/src/branch/main/LICENSE). Eine kommerzielle Dual-License ist auf Anfrage verfügbar, falls die AGPL-Copyleft nicht passt.
- **Dokumentation und Text:** [CC BY-SA 4.0](https://git.jkaindl.de/jkaindl/obsidian-transmute/src/branch/main/LICENSE-DOCS).

Copyright © 2026 Johannes Kaindl.
