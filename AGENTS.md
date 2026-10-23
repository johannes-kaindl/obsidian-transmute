# AGENTS.md

Orientierung für KI-Agenten (Claude Code, Codex, …) und Mitwirkende an diesem Repository. Workspace-weite Standards (comply-or-explain): siehe [`../../workspace/_docs/CONVENTIONS.md`](../../workspace/_docs/CONVENTIONS.md).

**Profil:** `ts-node` · `obsidian-plugin`.

## Project character

**Projekt:** `transmute` (manifest-`id`) — Obsidian-Plugin für **Suchen & Ersetzen per Regex, ohne Regex schreiben zu müssen**. Nutzer:in beschreibt in natürlicher Sprache, was ersetzt werden soll; ein **lokales** LLM übersetzt das in Regex + Ersetzungsmuster + Klartext-Erklärung; das Plugin zeigt einen Diff-Preview; erst nach Bestätigung wird angewendet (Datei / Selektion / vault-weit gefiltert). Autor: Johannes Kaindl.

**Warum es existiert:** Vault-weites Suchen & Ersetzen kann Obsidian nativ nicht (die Sidebar-Suche ist read-only). Die bestehenden Regex-Plugins (Regex Find/Replace, Search and Replace Regex, Apply Patterns) setzen Regex-Kenntnis voraus; die bestehenden AI-Plugins erzeugen Text oder beantworten Fragen, übersetzen aber keine Absicht in eine anwendbare Ersetzungsregel.

**Das Produkt ist nicht „LLM generiert Regex", sondern Vertrauen in die Anwendung.** Diese sechs Punkte sind der Kern der Differenzierung — wer hier kürzt, kürzt das Produkt weg:

1. **Preview/Diff vor Anwendung** — zeilenweise, mit Highlighting, nie blind.
2. **Regex im Klartext erklärt** — ein Satz, was die Regex trifft.
3. **Dry-Run + Undo/Snapshot** — jede Anwendung ist rückholbar, auch vault-weit.
4. **Iteratives Nachschärfen** — „aber nicht in Codeblöcken" ohne Neustart.
5. **Scope-Kontrolle** — Datei / Selektion / Vault, gefiltert nach Tag, Pfad, Frontmatter.
6. **Lokales LLM als Default** — privacy-first (LM Studio / MLX / Ollama), Cloud optional.

**Modellagnostik ist Pflicht, kein Nice-to-have** (wie in allen Schwester-Plugins): nirgends ein hartkodierter Modellname, kein Feature, das nur ein Server kann. Der JSON-Vertrag, das Auslesen der Modell-Liste und der Umgang mit Reasoning-Modellen stehen in `.claude/rules/llm-anbindung.md`.

**Nicht-Ziele (MVP-Scope-Grenzen):** kein RAG/semantische Suche · keine allgemeine Vault-Hygiene-Suite · keine Chat-Oberfläche als Hauptinterface · kein „Apply ohne Preview" in v0.1.

## Architecture principles

- **PROF-OBS-03/04 — reiner Kern ohne `obsidian`-Import.** Alles, was Regex, Diff, Scope-Auswahl, Prompt-Bau und Antwort-Parsing macht, gehört nach `src/core/` und ist in Node ohne DOM-Mock testbar. Nur `main.ts`, Settings-Tab, Views/Modals und die HTTP-/Vault-Adapter importieren `obsidian`. Ein `check:pure`-Gate (Vorbild `yijing-oracle`) nagelt das fest.
- **Safety ist Architektur, nicht Feature:** Catastrophic-Backtracking-Guard mit hartem Timeout pro Regex-Ausführung · Warnschwelle vor vault-weiten Änderungen (konfigurierbar, „betrifft 340 Dateien — sicher?") · Snapshot der betroffenen Dateien vor jeder Anwendung nach `<configDir>/plugins/transmute/snapshots/<Zeitstempel>/`.
- **Vendored Kit-Module** unter `src/vendor/` nie von Hand ändern; vendort wird mit `node ../tools/kit-sync/kit-sync.mjs` (Pins und Liste in `tools/kit-sync.json`).

## Commands

```bash
npm run dev / build / deploy      # esbuild watch · prod-Bundle (tsc + esbuild) · Copy nach $OBSIDIAN_PLUGIN_DIR
npm run lint                      # check-no-inline-disables + eslint src --max-warnings 0
npm test                          # check-no-abs-paths + check-no-nul-bytes + vitest run
npm run typecheck                 # tsc --noEmit (dazu: typecheck:test, typecheck:scripts)
npm run check:pure                # scripts/check-pure.mjs — src/core darf `obsidian` nicht importieren
npm run gate                      # lint + alle Typechecks + test + check:pure + build
npm run smoke:gui -- --port <port>   # GUI-Smoke gegen eine Zweitinstanz (Rezept im Kopf von scripts/gui-smoke.ts)
npm run lab:diagnose              # Diagnose-Lab gegen den lokalen Endpoint (scripts/diagnose-lab.ts)
npm run release / version-bump / preflight   # delegieren ans zentrale ../tools/release/ (Dach)
```

## Conventions

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **TDD** (`superpowers:test-driven-development`): der reine Kern wird test-first gebaut. Regex-Executor und Scope-Resolver ohne Tests sind nicht abnahmefähig.
- **Tests:** vitest; Obsidian-Mock aus `obsidian-kit/testing` (Skill `obsidian-plugin-test-pattern`). `npx tsc --noEmit` separat laufen lassen (vitest ≠ tsc).
- **i18n:** nutzersichtbare Strings via `t()`, EN kanonisch, EN/DE (PROF-OBS-07). Die Endpunkt-Texte (Status, Rolle, Anfrage-Abschnitt) kommen seit Welle 15 aus den zweisprachigen Kit-Texten von `renderSettings({ lang })`; eigene Statuskeys gibt es nicht mehr.
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt. **Nur berührte Dateien stagen.** Trailer bei substanziellem AI-Beitrag: `Co-Authored-By: <Modell> <noreply@anthropic.com>`.
- **Nie absolute Pfade außerhalb des Repos in Repo-Dateien** — Platzhalter (`$VAULT/…`) verwenden.

## Gotchas

- **`obsidianmd/ui/sentence-case` prüft String-Literale, keine Variablen.** Syntax, die kein UI-Text ist (Regex-Flags, Muster), gehört in ein `<code>` und den Literalwert in eine benannte Konstante — **kein** Inline-`disable`, das bricht am Gate.
- **Eine additive Union-Erweiterung braucht die Suche nach ihren Konsumenten.** `ScopeKind` um `"vault"` zu erweitern ließ Typecheck und Tests grün — der Setter im Settings-Tab (`String(value) === "selection" ? … : "file"`) hätte die neue Variante still auf `file` zurückgesetzt. Derselbe Mechanismus wie beim `unauthorized`-Bug in 0.4.0.
- **Eine Warnung im `eslint src`-Lauf bricht das Gate** (PROF-TS-05: `--max-warnings 0`), weil `eslint` bei Warnungen Exit 0 gibt, der Store-Scanner sie aber als Befund meldet; die `sentence-case`-Regel hatte den Flag-Knopf `g` angemahnt und stand grün im Gate (2026-07-27).

## Context index

- Bevor du den Modellaufruf, die Verbindung, Antworten oder den Prompt änderst: `.claude/rules/llm-anbindung.md`.
- Bevor du die Regex-Ausführung (`evaluate()` ist der EINE Ausführungspfad, dazu Guard, Probe, Lockerung), Presets oder die Diagnose änderst: `.claude/rules/regex-ausfuehrung.md`.
- Bevor du das Panel, den Hub oder die Teil-Draws änderst oder DOM-Tests schreibst: `.claude/rules/panel-und-view.md`.
- Bevor du den vault-weiten Lauf, Snapshot, Drift-Schutz oder die UI-Freigabe änderst: `.claude/rules/vault-lauf.md`.
- Vor Änderungen am Aufbau (Verzeichnisse, Schichten, Struktur-Vertrag zum Modell): `docs/internal/architecture.md`.
- Bevor du eine Altentscheidung übernimmst (Kit-first-Befund, Modellagnostik, Lizenz, Release): `docs/internal/decisions.md`.
- Vor einem GUI-Smoke: `docs/SMOKE.md`; Obsidian-Instanz, Lock, Treiber und Staging-Vaults stehen als Pfadregeln im Dach unter `../.claude/rules/`.

## Memory

- **Cockpit:** `$VAULT/25_Coding/obsidian-transmute/` (Stand, Tasks, Session-Log, Entscheidungen — mnemetisches Substrat/SSOT). **SDD-Artefakte (Spec/Plan) liegen dort unter `_SDD/`, nicht im Repo** (CORE-META-14) — das Repo behält die verdichtete Design-Essenz in `docs/internal/` und im CHANGELOG.

## UI-Abweichungen

Keine. Die eigene Endpunkt-Liste (`endpoint-list`) ist mit dem Verbindungs-Tausch der Welle 15 entfallen; Endpunkte, Modell und Anfrage-Abschnitt kommen aus `createLlmConnection.renderSettings`.

## Abweichungen von der Leitkonvention

Keine.
