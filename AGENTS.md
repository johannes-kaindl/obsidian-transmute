# AGENTS.md

Orientierung für KI-Agenten (Claude Code, Codex, …) und Mitwirkende an diesem Repository.
Workspace-weite Standards (comply-or-explain): siehe [`../../_docs/CONVENTIONS.md`](../../_docs/CONVENTIONS.md).

**Profil:** `ts-node` · `obsidian-plugin`.

**Stand 2026-07-29: 0.3.0 im Community-Store, 0.4.0 in Arbeit.** Der Kit-first-Befund
unten beschreibt, was übernommen wurde — er bleibt als Begründungs-Kontext stehen. Für
neue Vorhaben gilt weiterhin: erst Kit-first-Sondierung, dann `superpowers:brainstorming`
→ Spec → Plan → TDD.

## Project character

**Projekt:** `transmute` (manifest-`id`) — Obsidian-Plugin für **Suchen & Ersetzen per Regex,
ohne Regex schreiben zu müssen**. Nutzer:in beschreibt in natürlicher Sprache, was ersetzt
werden soll; ein **lokales** LLM übersetzt das in Regex + Ersetzungsmuster + Klartext-Erklärung;
das Plugin zeigt einen Diff-Preview; erst nach Bestätigung wird angewendet (Datei / Selektion /
vault-weit gefiltert). Autor: Johannes Kaindl.

**Warum es existiert:** Vault-weites Suchen & Ersetzen kann Obsidian nativ nicht (die Sidebar-Suche
ist read-only). Die bestehenden Regex-Plugins (Regex Find/Replace, Search and Replace Regex,
Apply Patterns) setzen Regex-Kenntnis voraus; die bestehenden AI-Plugins erzeugen Text oder
beantworten Fragen, übersetzen aber keine Absicht in eine anwendbare Ersetzungsregel.

**Das Produkt ist nicht „LLM generiert Regex", sondern Vertrauen in die Anwendung.**
Diese sechs Punkte sind der Kern der Differenzierung — wer hier kürzt, kürzt das Produkt weg:

1. **Preview/Diff vor Anwendung** — zeilenweise, mit Highlighting, nie blind.
2. **Regex im Klartext erklärt** — ein Satz, was die Regex trifft.
3. **Dry-Run + Undo/Snapshot** — jede Anwendung ist rückholbar, auch vault-weit.
4. **Iteratives Nachschärfen** — „aber nicht in Codeblöcken" ohne Neustart.
5. **Scope-Kontrolle** — Datei / Selektion / Vault, gefiltert nach Tag, Pfad, Frontmatter.
6. **Lokales LLM als Default** — privacy-first (LM Studio / MLX / Ollama), Cloud optional.

**Modellagnostik ist Pflicht, kein Nice-to-have** (wie in allen Schwester-Plugins): nirgends ein
hartkodierter Modellname, kein Feature, das nur ein Server kann. Konkret:

- Das Modell kommt **aus der Modell-Liste des Endpunkts** (`GET /v1/models` → `extractModelIds`),
  nie aus einer Konstante. Default = leer/erstes verfügbares, nicht „qwen…".
- **Kein `response_format: json_schema`-Zwang** — das können LM Studio, Ollama und MLX
  unterschiedlich gut. Der JSON-Vertrag wird über den *Prompt* hergestellt und **tolerant geparst**
  (Code-Fences strippen, erstes balanciertes JSON-Objekt nehmen), plus genau ein Retry mit dem
  Fehler zurück ans Modell.
- **Reasoning-Modelle mitdenken:** die lokal vorhandenen Qwen3.6 sind Thinker. `<think>`-Blöcke
  müssen **vor** dem JSON-Parsen abgetrennt werden (Kit `think-splitter.ts`), und wo der Server es
  unterstützt, wird Reasoning unterdrückt (Kit `reasoning.ts` `suppressParams`) — Regex-Generierung
  braucht keine sichtbare Gedankenkette.
- Ein Modell, das den Vertrag nicht hält, ist ein **Fehlerpfad mit klarer Meldung**, kein Crash.

**Abgrenzung nach außen (gehört so in die README):** `ksawl/obsidian-alchemist` bewegt sich im
selben Bildfeld (Alchemie/Transmutation, „vault hygiene"), deckt aber Vault-Hygiene allgemein ab
— nicht NL→Regex-Replace. Explizit benennen, nicht ignorieren.

**Nicht-Ziele (MVP-Scope-Grenzen):** kein RAG/semantische Suche · keine allgemeine
Vault-Hygiene-Suite · keine Chat-Oberfläche als Hauptinterface · kein „Apply ohne Preview" in v0.1.

## Kit-first-Befund (Ergebnis)

Die Sondierung vom 2026-07-25 war ungewöhnlich ertragreich: fast der gesamte LLM-Unterbau
kam fertig aus dem Ökosystem, neu gebaut wurde im Wesentlichen die Regex-Domäne. Übernommen:

- **Vendored aus `obsidian-kit`** (`src/vendor/kit/`, nie von Hand ändern): `endpoint.ts`,
  `endpoint_diagnostics.ts`, `i18n.ts`, `reasoning.ts`, `settings.ts`, `think-splitter.ts`.
- **Aus Nachbar-Plugins übernommen:** Endpoint-Zeilen-Editor + pure Editor-Model
  (`yijing-oracle`), EndpointResolver/Probe/Modell-Liste (`vim-dojo`), Chat-Response-Auswertung
  (`vault-crews`), `raceTimeout` (`local-image-generator`), Inline-`eslint-disable`-Gate
  (`markdown-presentation`), `debrief-lab`-Muster für Prompt-Tuning (`vim-dojo`).
- **Neu gebaut (kein Vorbild im Ökosystem):** NL→Regex-Prompt + Antwort-Validierung ·
  Regex-Ausführung mit Backtracking-Guard (`evaluate()`) · Scope-Auflösung · Snapshot/Undo.

Die vollständige Sondierung (Quellen-Abwägungen, Registry-Zähler, Gotcha-Herleitungen) liegt
im Cockpit (`$VAULT/25_Coding/obsidian-transmute/`). Für neue Vorhaben gilt weiterhin:
erst Kit-first (`../AGENTS.md` + `../REGISTRY.md`), dann bauen.

## Architecture principles (geplant)

**PROF-OBS-03/04 — reiner Kern ohne `obsidian`-Import.** Alles, was Regex, Diff, Scope-Auswahl,
Prompt-Bau und Antwort-Parsing macht, gehört nach `src/core/` und ist in Node ohne DOM-Mock
testbar. Nur `main.ts`, Settings-Tab, Views/Modals und die HTTP-/Vault-Adapter importieren
`obsidian`. Ein `check:pure`-Gate (Vorbild `yijing-oracle`) nagelt das fest.

```
src/
├── core/
│   ├── llm/          prompt · response (inkl. extractReasoning) · client
│   ├── regex/        compile (allowRisky) · execute (Zeitbudget + maxHits) ·
│   │                 guard · evaluate ← der EINE Ausführungspfad
│   ├── cheatsheet.ts statische Regex-Referenz (Syntax verbatim, Text als i18n-Key)
│   ├── session.ts    Zustandsmaschine inkl. Handpfad
│   └── settings.ts   Typ + defaults (mergeSettings aus dem Kit) · MAX_HITS
├── obsidian/         main · settings-tab · view · view-render · http · editor-io
└── vendor/kit/       gevendorte Kit-Module (pure) — nie von Hand ändern
```

**`evaluate()` ist der einzige Ort, an dem kompiliert und ausgeführt wird** — Modell-Pfad,
Handbearbeitung und Revalidierung vor dem Schreiben gehen alle hindurch. Drei getrennte
Stellen würden auseinanderlaufen; genau so ist in 0.2.0 die Anzeige von der Ausführung
abgedriftet. Wer einen vierten Ausführungsweg braucht, baut ihn **nicht** daneben.

**Der Panel-Körper ist dreigeteilt** (`.transmute-history` / `.transmute-rule` /
`.transmute-outcome`). `renderPanel` zeichnet alles, `renderOutcome` nur die äußeren
beiden — die Regel-Felder bleiben stehen, weil ein `root.empty()` unter dem Cursor Fokus,
Cursorposition und den Undo-Stack des Feldes mitnimmt. Welcher Weg dran ist, sagt die
Session über `onChange(state, reason)`.

**Struktur-Vertrag LLM:** Das Modell antwortet **JSON** (`regex`, `flags`, `replacement`,
`explanation`, `confidence`) — nicht Prosa. Ungültige Regex geht **einmal** mit dem Syntaxfehler
zurück ans Modell, danach Fehlermeldung an die Nutzer:in. Nie ungeprüft anwenden.

**Safety ist Architektur, nicht Feature:**
- Catastrophic-Backtracking-Guard mit hartem Timeout pro Regex-Ausführung.
- Warnschwelle vor vault-weiten Änderungen (konfigurierbar, „betrifft 340 Dateien — sicher?").
- Snapshot der betroffenen Dateien vor jeder Anwendung nach `.transmute/snapshots/<timestamp>/`.

## Commands

`package.json` trägt 15 Scripts — die wichtigsten:

```bash
npm run dev / build / deploy      # esbuild watch · prod-Bundle (tsc + esbuild) · Copy nach $OBSIDIAN_PLUGIN_DIR
npm run lint                      # check-no-inline-disables + eslint src --max-warnings 0
npm test                          # vitest run
npm run typecheck                 # tsc --noEmit (dazu: typecheck:test, typecheck:scripts)
npm run check:pure                # scripts/check-pure.mjs — src/core darf `obsidian` nicht importieren
npm run gate                      # lint + alle Typechecks + test + check:pure + build
npm run lab:diagnose              # Diagnose-Lab gegen den lokalen Endpoint (scripts/diagnose-lab.ts)
npm run release / version-bump / preflight   # delegieren ans zentrale ../tools/release/ (Dach)
```

(Dazu `lint:portal` — eslint mit `eslint.portal.config.mjs`.)

## Conventions

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **TDD** (`superpowers:test-driven-development`): der reine Kern wird test-first gebaut.
  Regex-Executor und Scope-Resolver ohne Tests sind nicht abnahmefähig.
- **Tests:** vitest; Obsidian-Mock aus `obsidian-kit/testing` (Skill `obsidian-plugin-test-pattern`).
  `npx tsc --noEmit` separat laufen lassen (vitest ≠ tsc).
- **UI:** `../UI-STANDARD.md` ist verbindlich (Obsidian-nativ first, ein Frontend pro Plugin, nur
  Theme-CSS-Variablen) — **vor** jeder View-/Modal-/Settings-Arbeit lesen.
- **i18n:** nutzersichtbare Strings via `t()`, EN kanonisch, EN/DE (PROF-OBS-07). Achtung: das
  Kit-Feld `EndpointStatus.klartext` ist **hart deutsch** → in i18n-Plugins eigene Statuskeys
  (`statusKindKey`-Muster aus `yijing-oracle`).
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt. **Nur berührte Dateien stagen.**
  Trailer bei substanziellem AI-Beitrag:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Gotchas (antizipiert — aus Nachbar-Plugins geerbt, bevor sie hier weh tun)

- **Endpoint mit `/v1`-Suffix:** `normalizeEndpoint()` strippt ein trailing `/v1`, sonst baut der
  Client `…/v1/v1/chat/completions`. **LM Studio antwortet auf falsche Pfade mit HTTP 200 + Fehler-Body**
  → `res.ok` true, Antwort leer, stiller Fehlschlag.
- **LM Studio ignoriert das `model`-Feld** → das tatsächliche Modell aus `response.model` lesen.
- **`requestUrl` kennt weder Timeout noch Abort** → eigener `Promise.race`-Wrapper.
- **Obsidian verbietet Web-Worker** im Renderer (gleiche Wurzel wie der Draco-/`AsyncUnzipInflate`-Befund
  bei `3d-codeblocks`/`apple-health`). **Das trifft den Backtracking-Guard direkt:** der naheliegende
  „Regex im Worker mit Kill-Switch" aus der Spec ist so **nicht** umsetzbar. Alternativen vor der
  Implementierung bewerten: Regex-Analyse *vor* der Ausführung (Redos-Heuristik auf dem Pattern) +
  Chunking mit Zeit-Budget-Check zwischen den Dateien, statt einen laufenden Match abzubrechen.
- **`eslint src` gibt bei Warnungen exit 0**, während der Store-Scanner sie als Befund
  meldet — deshalb läuft `lint` mit `--max-warnings 0` (2026-07-27; die `sentence-case`-Regel
  hatte den Flag-Knopf `g` angemahnt und stand grün im Gate).
- **`obsidianmd/ui/sentence-case` prüft String-Literale, keine Variablen.** Syntax, die
  kein UI-Text ist (Regex-Flags, Muster), gehört in ein `<code>` und den Literalwert in
  eine benannte Konstante — **kein** Inline-`disable`, das bricht am Gate.
- **Ein Muster, das den Leerstring trifft** (`a*`, `\b`, `^`), liefert einen Treffer pro
  Position, jeden mit der vollen Zeile in `before`/`after`. `collect()` schiebt `lastIndex`
  korrekt vor, es hängt also nicht — aber ohne `maxHits` (500) wären das Tausende
  DOM-Zeilen bei jedem Tastendruck.
- **Das Zeitbudget in `runRule` greift nur ZWISCHEN Zeilen.** Ein einzelner entgleister
  Match auf *einer* Zeile kommt nie zurück, und Obsidian kann ihn nicht abbrechen (keine
  Web-Worker). Deshalb läuft vor einer Risiko-Freigabe `probeRisky()` — dasselbe Muster auf
  20 Zeichen, mit Zeitmessung. **Ohne diesen Kanarienvogel ist jede Freigabe ein Knopf, der
  das Fenster einfriert** (real eingetreten, GUI-Durchlauf 2026-07-27).
- **Was in den `.transmute-rule`-Container gerendert wird, altert.** Der Container ist vom
  Teil-Draw ausgenommen — dort gehört nur hinein, was sich beim Tippen *nicht* ändern
  darf (die Felder selbst, der Spickzettel). Jede abgeleitete Anzeige (`/muster/flags`,
  Erklärung, Treffer) gehört in `.transmute-outcome`. Beides ist schon einmal
  falsch herum gewesen.
- **Die Antwortsprache ist eine Modellfrage, keine Promptfrage.** Gemessen 2026-07-30 mit
  `npm run lab:diagnose` (fünf Fälle, deutsche Oberfläche, Zielsprache ausdrücklich im
  Prompt): `qwen/qwen3.6-35b-a3b` antwortet **5 von 5** deutsch, `google/gemma-4-e2b`
  **4 von 5**. Ein 2B-Modell lässt eine Nebenbedingung fallen, während es gleichzeitig ein
  JSON-Format treffen muss — **nicht** am Prompt schrauben, sondern das Modell empfehlen.
- **Ein Reparaturvorschlag, der dem Muster gleicht, wird verworfen** (`session.diagnose`).
  Kleine Modelle geben genau das nicht treffende Muster zurück; ein Knopf, der nichts
  ändert, sieht wie ein Ausweg aus.
- **Eine gelockerte Fassung eines Musters darf nie ausgeführt werden, ohne durch
  `evaluate()` zu gehen.** Die Sonden in `relax.ts` lockern genau eine Bedingung und laufen
  mit demselben Zeitbudget, derselben Obergrenze und ohne Risiko-Freigabe. Eine Lockerung,
  die der Guard ablehnt, meldet **nichts** — ein fehlender Befund ist immer harmloser als
  ein ausgeführtes Muster, das niemand geprüft hat.
- **`[\b]` ist ein Backspace, kein Wortgrenzen-Anker**, und `[^abc]` beginnt nicht mit
  einem Zeilenanker. Wer Muster per Text umbaut, muss Zeichenklassen kennen, sonst entsteht
  ein anderes Muster als das geschriebene.
- **Ein leerer `content` bei gefülltem `reasoning` ist keine leere Modellantwort**, sondern
  ein Modell, das sein Token-Budget vollständig ins Denken gesteckt hat (gemessen: 512 von
  551 Tokens, qwen3.6 unter LM Studio). `suppressParams` schickt `reasoning_effort: "none"`,
  greift aber nur bei ausgeschaltetem Thinking-Schalter — deshalb hat der Fall eine eigene
  Meldung (`CompleteResult.thoughtOnly`).
- **`makeFakeEl()` aus dem Obsidian-Mock kennt kein `querySelector`.** Der Mock ist ein aus
  fünf Plugins gepflegtes Superset und wird nicht lokal erweitert — die Suche liegt in
  `tests/helpers/dom.ts` (`findByClass`/`findAllByTag`).
- **`data.json`** ist git-ignored (Obsidian-persistierte Konfig), **`main.js`** ist Build-Artefakt.
- **Release-CI ist GitHub-only** (`.github/` wird von Forgejo ignoriert).

## Offene Entscheidungen

Aus `docs/transmute-repo-spec.md` §9 — nach Workspace-Standard bereits **entschieden**:

- **Repo-Slug bleibt `obsidian-transmute`** (konsistent mit `obsidian-letterhead`/`obsidian-paperize`);
  manifest-`id` `transmute`, Anzeigename „Transmute". Der Store verbietet „Obsidian" im *Plugin*-Namen,
  nicht im Repo-Namen.
- **Hosting: Forgejo = `origin`/Quelle, GitHub = Push-Mirror** (CORE-GIT-01). Release über das
  **zentrale** `../tools/release/` (Dual-Push) — nicht `release.mjs` aus einem Nachbarn kopieren
  (offene Lesson vom 2026-07-25: die vendorte Variante pusht Tag-zuerst und triggert auf einem
  leeren Remote keinen Workflow). Einrichtung über den Dach-Skill `plugin-release-setup`.
- **Lizenz: AGPL-3.0 (`LICENSE`) + CC BY-SA 4.0 (`LICENSE-DOCS`)** — Workspace-Konsistenz.

- **Modellagnostisch, mit dem was lokal da ist** (Jay-Entscheidung 2026-07-25) — kein Modell wird
  für dieses Plugin nachgeladen, kein Modellname wird hartkodiert. Die Spec-Frage „4-bit vs. 8-bit"
  ist damit gegenstandslos: Referenz-Setup ist die vorhandene **LM-Studio-Instanz auf `:1234`**
  (Bestand 2026-07-25: `qwen/qwen3.6-35b-a3b` — der Spec-Kandidat, MoE also schnell —
  `qwen/qwen3.6-27b`, `google/gemma-4-31b-qat`, `google/gemma-4-26b-a4b-qat`, `gemma-4-e4b`,
  `gemma-4-e2b`; dazu Embeddings, für uns irrelevant). Ollama `:11434` hält nur ein
  Embedding-Modell, MLX `:8080` läuft nicht — beides bleibt trotzdem über die Endpunkt-Liste
  ansprechbar.

Offen für Jay:

- **Nichts Blockierendes.** Die verbleibende empirische Frage — hält der NL→Regex-Prompt über
  *mehrere* der vorhandenen Modelle? — ist eine Mess-, keine Entscheidungsaufgabe (TaskNote im
  Cockpit; Werkzeug: `debrief-lab`-Muster, Prompt-Tuning ohne Plugin-Rebuild).

## Dach-Kontext (obsidian-plugins)

Dieses Repo liegt unter dem Koordinations-Dach `obsidian-plugins/` (Elternverzeichnis) und ist ein
**eigenständiges Git-Repo** (PROF-OBS-09: kein Monorepo, eigener Release-Takt, Kit per git-Tag).
**Vor dem Lösen eines Problems:** `../AGENTS.md` (Kit-first-Regel) und `../REGISTRY.md`
(Lösungs-Registry) prüfen. **Vor jeder UI-Arbeit:** `../UI-STANDARD.md`.

**Cockpit:** `$VAULT/25_Coding/obsidian-transmute/` (Stand, Tasks, Session-Log, Entscheidungen —
mnemetisches Substrat/SSOT). **SDD-Artefakte (Spec/Plan) liegen dort unter `_SDD/`, nicht im Repo**
(CORE-META-14) — das Repo behält die verdichtete Design-Essenz hier und im CHANGELOG.
**Nie absolute Pfade außerhalb des Repos in Repo-Dateien** — Platzhalter (`$VAULT/…`) verwenden.
