# Transmute — Repo Spec (CC Session Seed)

Status: Draft v0.1
Zweck: Seed-Dokument für eine Claude-Code-Session, die das Repo-Grundgerüst aufsetzt.

## 1. Elevator Pitch

Transmute ist ein Obsidian-Plugin, das Search & Replace per Regex zugänglich macht, ohne dass Nutzer:innen Regex selbst schreiben müssen. Man beschreibt in natürlicher Sprache, was ersetzt werden soll, ein LLM übersetzt das in eine Regex, das Plugin zeigt eine Vorschau (Diff) der betroffenen Stellen, und erst nach Bestätigung wird angewendet — in der aktuellen Datei, einer Selektion, oder vault-weit gefiltert nach Pfad/Tag.

## 2. Problem / Warum

- Vault-weites Suchen & Ersetzen ist in Obsidian nativ nicht möglich (nur Read-Only-Suche im Sidebar-Panel); das ist seit Jahren einer der meistdiskutierten Feature-Wünsche der Community.
- Bestehende Regex-Plugins (Regex Find/Replace, Search and Replace Regex, Apply Patterns) setzen alle voraus, dass man Regex-Syntax beherrscht.
- Bestehende AI-Plugins (Vault-Chat, Smart Templates, semantische Suche) generieren Text oder beantworten Fragen, aber keines übersetzt gezielt "Absicht" in eine anwendbare Suchen/Ersetzen-Regel.
- Verwandtes Projekt `ksawl/obsidian-alchemist` bewegt sich im selben Bildfeld (Alchemie/Transmutation, "vault hygiene"), deckt aber einen anderen Funktionsbereich ab (Daten-/Vault-Hygiene allgemein, nicht gezielt NL→Regex-Replace). Muss in README klar abgegrenzt werden.

## 3. Kern-Differenzierung (das muss sitzen)

Das eigentliche Produkt ist nicht "LLM generiert Regex", sondern **Vertrauen in die Anwendung**:

1. **Preview/Diff vor Anwendung** — zeilenweise, mit Highlighting, keine Blindanwendung.
2. **Regex im Klartext erklärt** — die generierte Regex wird nicht nur angezeigt, sondern in einem Satz erklärt ("matcht: ... in Zeilen, die mit ... beginnen").
3. **Dry-Run + Undo/Snapshot** — jede Anwendung ist rückholbar, auch vault-weit.
4. **Iteratives Nachschärfen** — Nutzer:in kann die Anfrage verfeinern ("aber nicht in Codeblöcken"), ohne von vorn zu beginnen.
5. **Scope-Kontrolle** — aktuelle Datei / Selektion / ganzer Vault / gefiltert nach Tag, Pfad, Frontmatter.
6. **Lokales LLM als Default** — Privacy-first, passt zum bestehenden MLX/LM-Studio-Stack; Cloud-Provider optional zuschaltbar.

## 4. Nicht-Ziele (Scope-Grenzen für MVP)

- Kein RAG / semantische Suche über den Vault (das machen andere Plugins bereits gut).
- Keine allgemeine "Vault-Hygiene"-Suite (Orphan-Detection, Tag-Clustering etc. — Abgrenzung zu obsidian-alchemist).
- Keine Chat-Oberfläche als Hauptinterface — Fokus bleibt der Such/Ersetzen-Workflow, LLM ist Mittel zum Zweck, nicht Feature.
- Kein automatisches "Apply ohne Preview"-Modus in v0.1 (kann später als Opt-in für vertraute Rules kommen).

## 5. User Flow (MVP)

1. Command Palette: "Transmute: New rule" oder Ribbon-Icon.
2. Eingabefeld: Freitext-Beschreibung (z. B. "alle Daten im Format DD.MM.YYYY zu YYYY-MM-DD umwandeln").
3. Scope wählen: aktuelle Datei / Selektion / Vault (mit optionalem Tag-/Pfad-Filter).
4. LLM generiert Regex + Ersetzungsmuster + Klartext-Erklärung.
5. Preview-Panel: Trefferliste mit Vorher/Nachher-Diff pro Fundstelle, Gesamtzahl Treffer.
6. Nutzer:in kann: bestätigen & anwenden / verfeinern (zurück zu Schritt 2 mit Kontext) / abbrechen.
7. Nach Anwendung: Snapshot/Undo-Option, Log-Eintrag (welche Regel, wie viele Treffer, wann).

## 6. Technische Architektur (Vorschlag)

```
transmute/
├── manifest.json
├── main.ts                    # Plugin-Entry, Command-Registrierung
├── src/
│   ├── settings.ts             # Settings-Tab: LLM-Provider, Default-Scope, Safety-Optionen
│   ├── llm/
│   │   ├── provider.ts         # Interface: NL → { regex, flags, replacement, explanation }
│   │   ├── providers/
│   │   │   ├── lmstudio.ts     # OpenAI-kompatibler lokaler Endpoint (LM Studio / MLX)
│   │   │   ├── ollama.ts
│   │   │   └── anthropic.ts    # optional, Cloud-Fallback
│   │   └── prompt-templates.ts
│   ├── regex/
│   │   ├── executor.ts         # sichere Ausführung, Timeout/Catastrophic-Backtracking-Guard
│   │   └── scope-resolver.ts   # Datei / Selektion / Vault+Filter → Liste betroffener Dateien
│   ├── ui/
│   │   ├── RuleModal.ts        # Eingabe-Modal
│   │   ├── PreviewView.ts      # Diff-Vorschau
│   │   └── HistoryView.ts      # Log vergangener Anwendungen
│   └── safety/
│       ├── snapshot.ts         # Vor Anwendung: Kopie betroffener Dateien / Undo-Stack
│       └── guards.ts           # z. B. Warnung bei > N betroffenen Dateien
└── tests/
```

### LLM-Provider-Abstraktion
- Gemeinsames Interface, das eine strukturierte Antwort erzwingt (JSON: `regex`, `flags`, `replacement`, `explanation`, `confidence`).
- Lokale Modelle (LM Studio / Ollama, OpenAI-kompatibel) als Default — Anschluss an bestehenden MLX-Stack (Qwen3.6-35B-A3B als Kandidat, ggf. via Touchstone vorab auf Regex-Aufgaben evaluieren).
- Retry-Logik bei ungültiger Regex (Syntax-Fehler zurück ans Modell geben, einmal nachbessern lassen, sonst Fehlermeldung an Nutzer:in).

### Safety-Guards
- Catastrophic-Backtracking-Schutz (Timeout pro Regex-Ausführung, z. B. via Worker mit Kill-Switch).
- Warnschwelle bei vault-weiten Änderungen (z. B. "Das betrifft 340 Dateien — sicher?").
- Snapshot-Mechanismus vor jeder Vault-weiten Anwendung (Kopie der betroffenen Dateien in `.transmute/snapshots/<timestamp>/`).

## 7. Settings (v0.1)

- LLM-Provider (Dropdown: LM Studio / Ollama / Anthropic API / custom OpenAI-kompatibel)
- Endpoint-URL + Modellname
- Default-Scope (Datei / Selektion / Vault)
- Snapshot-Aufbewahrung (Anzahl / Tage)
- Bestätigungsschwelle (ab wie vielen betroffenen Dateien nachfragen)

## 8. Roadmap

- **v0.1 (MVP)**: Single-Rule-Workflow wie in Abschnitt 5, lokales LLM, Datei/Selektion-Scope, Preview + Undo.
- **v0.2**: Vault-weiter Scope mit Tag-/Pfad-Filter, History-View, Snapshot-Management.
- **v0.3**: Regel-Sammlungen (mehrere Rules nacheinander anwenden, ähnlich Apply Patterns), gespeicherte/wiederverwendbare Rules.
- **v0.4**: Explain-Mode als eigenständiges Feature (bestehende Regex aus anderen Plugins erklären lassen), evtl. Batch-Vorschläge ("ich sehe X ähnliche Inkonsistenzen im Vault, soll ich die auch fixen?").

## 9. Offene Entscheidungen (für CC-Session zu klären)

- [ ] Namespace/Slug final: `obsidian-transmute-regex` oder `transmute-search-replace`? (Empfehlung: spezifisch genug, dass Repo-Name allein die Funktion erklärt, unabhängig vom Anzeigenamen "Transmute")
- [ ] Hosting: Codeberg (wie übrige Projekte) vs. GitHub (bessere Sichtbarkeit im Obsidian-Community-Plugin-Verzeichnis, das GitHub voraussetzt) — vermutlich GitHub nötig für offizielle Plugin-Liste, Codeberg als Mirror möglich.
- [ ] Lizenz: AGPL-3.0 für Code (Konsistenz mit übrigen Projekten), README/Docs unter CC BY-SA 4.0.
- [ ] Erstes Ziel-Modell für Touchstone-Evaluation der Regex-Qualität (Qwen3.6-35B-A3B 4-bit vs. 8-bit?).
- [ ] Manifest-`id` und Display-Name final festlegen (`transmute` als `id`, "Transmute" als Name).

## 10. Akzeptanzkriterien MVP (für erste CC-Session)

- [ ] Plugin lädt in Obsidian ohne Fehler, Command "Transmute: New rule" erscheint in Palette.
- [ ] NL-Eingabe → LLM-Call (lokal, LM Studio-Endpoint) → strukturierte Regex-Antwort.
- [ ] Ungültige Regex wird abgefangen, nicht auf Datei angewendet.
- [ ] Preview zeigt mind. Vorher/Nachher pro Treffer, keine Anwendung ohne explizite Bestätigung.
- [ ] Undo stellt Datei-Zustand vor Anwendung zuverlässig wieder her.
