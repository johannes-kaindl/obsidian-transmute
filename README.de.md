# Transmute

> [🇬🇧 English](https://github.com/johannes-kaindl/obsidian-transmute/blob/main/README.md) · 🇩🇪 Deutsch

**Beschreibe in normaler Sprache, was ersetzt werden soll — ein lokales LLM schreibt die Regex, du prüfst jeden Treffer, bevor irgendetwas geschrieben wird.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](https://github.com/johannes-kaindl/obsidian-transmute/blob/main/LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](https://github.com/johannes-kaindl/obsidian-transmute/blob/main/LICENSE-DOCS)
[![Release](https://img.shields.io/github/v/release/johannes-kaindl/obsidian-transmute?label=release)](https://github.com/johannes-kaindl/obsidian-transmute/releases)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.8.7%2B%20·%20desktop%20%26%20mobile-7c3aed)

<p align="center"><img src="https://raw.githubusercontent.com/johannes-kaindl/obsidian-transmute/main/docs/images/preview.png" width="600" alt="Das Transmute-Panel neben einer Notiz: Muster, Ersetzung und jeder Treffer mit Vorher- und Nachher-Zeile, jeder einzeln abwählbar"></p>

## Funktionen

- **Suchen & Ersetzen in natürlicher Sprache.** Beschreibe die Änderung in eigenen Worten; ein lokales OpenAI-kompatibles LLM macht daraus einen regulären Ausdruck, eine Ersetzung und eine Klartext-Erklärung.
- **Vorschau, bevor irgendetwas geschrieben wird.** Jeder Treffer wird vorher/nachher mit eigener Checkbox gezeigt — nur die angehakten werden geschrieben.
- **Ein Undo-Schritt.** Das Anwenden läuft über den Editor, **Cmd+Z** macht es in einem Schritt rückgängig.
- **Nachschärfen.** Mit einer Anschluss-Anweisung wie „aber nicht in Codeblöcken“ weiterarbeiten.
- **Bereichs-Kontrolle:** ganze Notiz oder Auswahl, der Standard ist einstellbar.
- **Modellagnostisch.** Kein Modellname ist hartkodiert, Endpunkte lokal oder gehostet, Reasoning-Modelle werden behandelt.
- **Sicher gegen ausufernde Muster.** Erzeugte Muster prüft eine statische Heuristik, bevor sie laufen.
- **Zweisprachige Oberfläche** (Englisch, Deutsch).

Alle Funktionen im Einzelnen: [Funktionen und Verwendung](https://github.com/johannes-kaindl/obsidian-transmute/blob/main/docs/manual/features-and-usage.de.md).

## Voraussetzungen

- **Obsidian 1.8.7+** (Desktop oder Mobile).
- **Ein OpenAI-kompatibler lokaler Server** (z. B. [LM Studio](https://lmstudio.ai) oder [Ollama](https://ollama.com)) mit einem geladenen Chat-fähigen Modell. Neu bei lokalen LLMs? Die **[Anleitung für den lokalen LLM-Aufbau](https://uplink.jkaindl.de/llm-setup)** führt einmal komplett durch Server, Modell und mobilen Zugriff. Endpunkt und Modell werden in den Plugin-Einstellungen konfiguriert — nichts verlässt die Maschine.

## Installation

### Community-Plugins (empfohlen)

**Transmute** in **Einstellungen → Community-Plugins → Durchsuchen** suchen, dann **Installieren** und **Aktivieren**.

<img src="https://raw.githubusercontent.com/johannes-kaindl/obsidian-transmute/main/docs/images/settings.png" width="600" alt="Die Plugin-Einstellungen: die Endpunkt-Liste mit Erreichbarkeits-Status je Zeile, Modellwahl und die Verhaltens-Optionen">


### Manuell

`main.js`, `manifest.json` und `styles.css` aus dem [letzten Release](https://github.com/johannes-kaindl/obsidian-transmute/releases) nach `<vault>/.obsidian/plugins/transmute/` legen, dann unter **Settings → Community plugins** aktivieren.

### From source

```bash
git clone https://git.jkaindl.de/jkaindl/obsidian-transmute
cd obsidian-transmute
npm install
npm run build   # → main.js
```

Danach `main.js`, `manifest.json` und `styles.css` nach `<vault>/.obsidian/plugins/transmute/` kopieren und Obsidian neu laden.

## Verwendung

1. Das Plugin auf den lokalen Server ausrichten und ein Modell laden — Endpunkt und Modell stehen unter **Einstellungen → Community-Plugins → Transmute** (siehe die [Einstellungs-Tabelle](https://github.com/johannes-kaindl/obsidian-transmute/blob/main/docs/manual/features-and-usage.de.md#konfiguration)).
2. Das Panel über das Ribbon-Icon **„Transmute“** oder den Command **„Open panel“** öffnen.
3. Einen Bereich wählen: **„Ganze Notiz“** oder **„Auswahl“**.
4. Die Änderung beschreiben, z. B. *„Daten wie 26.09.2026 in 2026-09-26 umwandeln“*, und **„Vorschau“** klicken.
5. Die Treffer prüfen, Unerwünschtes abwählen, bei Bedarf nachschärfen.
6. **„Anwenden“** klicken — **Cmd+Z** macht es in einem Schritt rückgängig.

Der ganze Weg und alle Einstellungen: [Funktionen und Verwendung](https://github.com/johannes-kaindl/obsidian-transmute/blob/main/docs/manual/features-and-usage.de.md).

## Konfiguration

**Einstellungen → Community-Plugins → Transmute** öffnen; die Einstellungen sind unter **„Connection“** und **„Behaviour“** gruppiert. Die ersten, die du anfasst:

- **Endpoints** — geordnete Liste OpenAI-kompatibler Server (lokal oder gehostet, je mit optionalem API-Schlüssel); der erste erreichbare wird genutzt. Ist das Plugin **LLM Endpoint Manager** installiert, kommen Endpunkte und Schlüssel von dort. Die Basis-URL ohne abschließendes `/v1` eintragen.
- **Model** — leer lässt den Server das geladene Modell wählen; ein Dropdown wird aus `/v1/models` des Endpunkts gefüllt.
- **Request timeout (ms)** — wie lange auf die Antwort des Modells gewartet wird (Standard `120000`).
- **Default scope** — „Ganze Notiz“, „Auswahl“ oder „Ganzer Vault“.
- **Reasoning-Modelle bitten, das Denken zu überspringen** — standardmäßig an.

Alle Einstellungen mit Standardwert und Wirkung: [Einstellungs-Tabelle](https://github.com/johannes-kaindl/obsidian-transmute/blob/main/docs/manual/features-and-usage.de.md#konfiguration).

## Funktionsweise

Transmute schickt die Anweisung plus eine Textprobe des gewählten Bereichs an `/v1/chat/completions` des konfigurierten Endpunkts und verlangt genau ein JSON-Objekt — `regex`, `flags`, `replacement`, `explanation` — nie Prosa. Die Antwort wird nachsichtig geparst (Code-Fences und ein eventueller `<think>`-Block werden entfernt, das erste balancierte JSON-Objekt wird extrahiert), und bei einem Parse- oder Validierungsfehler geht genau ein Retry mit dem konkreten Fehler zurück ans Modell.

Bevor das erzeugte Muster überhaupt läuft, prüft eine statische Heuristik es auf Konstrukte, die katastrophales Backtracking auslösen können — verschachtelte Quantoren, quantifizierte Alternation über identische Zweige, unbegrenzte Rückreferenzen — und lehnt es mit einem Klartext-Grund ab, wenn es riskant aussieht. Ein Muster, das die Prüfung besteht, wird danach zeilenweise gegen den Bereichstext ausgeführt, unter einem konfigurierbaren Zeitbudget; mehrzeilige Muster (ein `s`/`m`-Flag oder ein literales `\n` im Muster) laufen stattdessen einmal gegen den ganzen Text, weil ein Zeitbudget nur zwischen diskreten Schritten Sinn ergibt.

In die Notiz wird erst geschrieben, wenn **„Anwenden"** geklickt wird. Dann werden nur die angehakten Treffer angewendet — in umgekehrter Reihenfolge, damit frühere Ersetzungen nie die Offsets späterer verschieben —, und das Ergebnis wird über Obsidians Editor-API geschrieben (`editor.replaceRange`), was die Änderung erst auf den normalen Undo-Stack bringt.

## Dokumentation

Neu hier? Fang mit [Getting started](https://github.com/johannes-kaindl/obsidian-transmute/blob/main/docs/manual/tutorial.md) an. Etwas funktioniert nicht? Siehe [Troubleshooting](https://github.com/johannes-kaindl/obsidian-transmute/blob/main/docs/troubleshooting.md). Der [Dokumentations-Index](https://github.com/johannes-kaindl/obsidian-transmute/blob/main/docs/README.md) listet alles auf; er folgt dem [Diátaxis](https://diataxis.fr)-Rahmenwerk (die Doku selbst ist englisch):

- **Tutorial** — von null bis zur ersten angewendeten Ersetzung.
- **How-to-Guides** — aufgabenorientierte Rezepte (mehrere Endpunkte, eine Regel nachschärfen, rückgängig machen, eine „unsicheres Muster"-Fehlermeldung behandeln).
- **Reference** — Einstellungen, Commands, Fehlermeldungen, der JSON-Vertrag.
- **Explanation** — warum Vorschau-vor-Anwendung der Kern des Designs ist, warum es kein eigenes Snapshot-System gibt, und warum der Sicherheits-Guard ohne Web-Worker auskommt.

Release-Notizen im [Changelog](https://github.com/johannes-kaindl/obsidian-transmute/blob/main/CHANGELOG.md).

## Verwandtes

**[ksawl/obsidian-alchemist](https://github.com/ksawl/obsidian-alchemist)** teilt die Alchemie-/Transmutations-Bildsprache, deckt aber ein anderes Feld ab: ein allgemeines Vault-Hygiene-Toolkit. Transmute ist eng auf eine Sache fokussiert — eine Anweisung in natürlicher Sprache in eine geprüft angewendete Regex-Ersetzung zu verwandeln — und erhebt keinen Anspruch, Vault-Hygiene allgemein abzudecken.

## Mitwirken

Beiträge sind willkommen. Bitte [CONTRIBUTING.md](https://github.com/johannes-kaindl/obsidian-transmute/blob/main/CONTRIBUTING.md) für den Workflow lesen (testgetrieben, `main` immer grün, Feature-Arbeit in `feat/<name>`, Conventional Commits) sowie [AGENTS.md](https://github.com/johannes-kaindl/obsidian-transmute/blob/main/AGENTS.md) für Architektur und Modul-Konventionen. Das kanonische Repository liegt auf [Forgejo](https://git.jkaindl.de/jkaindl/obsidian-transmute); GitHub (`johannes-kaindl/obsidian-transmute`) ist ein Mirror.

## Lizenz

- **Code:** [AGPL-3.0-or-later](https://github.com/johannes-kaindl/obsidian-transmute/blob/main/LICENSE). Eine kommerzielle Dual-License ist auf Anfrage verfügbar, falls die AGPL-Copyleft nicht passt.
- **Dokumentation und Text:** [CC BY-SA 4.0](https://github.com/johannes-kaindl/obsidian-transmute/blob/main/LICENSE-DOCS).

Copyright © 2026 Johannes Kaindl.
