# AGENTS.md

Orientierung für KI-Agenten (Claude Code, Codex, …) und Mitwirkende an diesem Repository.
Workspace-weite Standards (comply-or-explain): siehe [`../../_docs/CONVENTIONS.md`](../../_docs/CONVENTIONS.md).

**Profil:** `ts-node` · `obsidian-plugin`.

**Stand 2026-07-27: 0.2.0 im Community-Store, 0.3.0 in Arbeit.** Der Kit-first-Befund
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

## Kit-first-Befund (Sondierung 2026-07-25 — vor dem ersten Commit machen, nicht danach)

Die Kit-first-Regel des Dachs (`../AGENTS.md`) ist hier ungewöhnlich ertragreich: **fast der
gesamte LLM-Unterbau und der Diff-Kern existieren bereits im Ökosystem.** Neu zu bauen ist im
Wesentlichen die Regex-Domäne (Prompt, Validierung, Scope-Auflösung, Snapshot/Undo).

**Übernehmen (vendoren aus `obsidian-kit`, `src/vendor/kit/`):**

| Bedarf | Quelle | Status |
|---|---|---|
| Endpoint normalisieren / aktiven auflösen / Liste parsen | `obsidian-kit/pure` → `endpoint.ts` (`normalizeEndpoint`/`resolveActiveEndpoint`/`parseEndpointList`) | im Kit @0.3.0 |
| Endpunkt-Diagnose (refused/unknown-host/timeout/not-an-llm-api) + Presets | `obsidian-kit/pure` → `endpoint_diagnostics.ts` (`classifyEndpointStatus`/`validateEndpointInput`/`ENDPOINT_PRESETS`) | im Kit @0.5.0 |
| Settings-Merge (`loadData` → Defaults) | `obsidian-kit/pure` → `settings.ts` (`mergeSettings`) | im Kit @0.4.0 |
| i18n (EN kanonisch, EN/DE) | `obsidian-kit/pure` → `i18n.ts` | im Kit — PROF-OBS-07 ist Pflicht |
| Reasoning-Suppression + `<think>`-Split (die lokalen Qwen3.6 sind Thinker) | `obsidian-kit/pure` → `reasoning.ts`, `think-splitter.ts` | im Kit @0.6.0 |
| Kontextlängen-Info | `obsidian-kit/pure` → `model-context.ts` | im Kit |

### Endpoint-Management: das reifste Paket übernehmen, nicht neu bauen

Der Endpunkt-Teil ist im Ökosystem **ausgereift** — er wird als Ganzes übernommen. Best-of aus
zwei Repos (beide gehören zum „guten Schnitt": pure Model-Datei + schmaler Host-Vertrag +
injizierte Probe):

- **UI + pure Editor-Logik → `yijing-oracle`** (jüngster Stand, 0.3.0/2026-07-16):
  `src/obsidian/settings/endpoint-list.ts` (`buildEndpointList`, 106 Zeilen: Zeile je Endpunkt +
  Adder-Leerzeile, Status-Icon pro Zeile mit Form **und** Farbe **und** `aria-label` (WCAG 1.4.1),
  Warn-Icon aus `validateEndpointInput`, Trash-Button, Preset-Buttons, aktiv-Marker aus der Probe)
  + `src/core/settings/endpoint-editor-model.ts` (`applyEndpointEdit`/`activeIndexFromStatuses`/
  `statusKindKey`/`warnRuleKey`, pure). **Warum yijing und nicht vault-crews:** yijing ist die
  i18n-fähige Fassung — `statusKindKey`/`warnRuleKey` liefern Übersetzungs-Keys statt Text. Das
  Kit-Feld `EndpointStatus.klartext` ist **hart deutsch** und würde in einem EN/DE-Plugin bei
  englischer Oberfläche deutschen Text zeigen.
- **Laufzeit-Auflösung → `vim-dojo`:** `src/llm/endpointResolver.ts` (`EndpointResolver` —
  Session-Cache + geteilter In-flight-Promise, fehlgeschlagene Resolves werden *nicht* gecacht;
  das Kit macht bewusst nur einen Resolver-Durchlauf und überlässt Caching dem Aufrufer),
  `endpointProbe.ts` (Probe → Status **+ Modell-Liste in einem Zug**) und `modelList.ts`
  (`extractModelIds`, robust gegen kaputte `data`-Arrays) — letzteres ist die Quelle für das
  Modell-Dropdown und damit die technische Basis der Modellagnostik.
- **Nicht kopieren:** `vault-rag/src/settings.ts` `buildEndpointList` und
  `image-to-markdown/src/settings.ts` (inline) — Copy-Paste-Zweig, die pure Logik liegt dort im
  Modul, das `obsidian` importiert, Tests ziehen die DOM-Schicht mit.
- **Zwei Gotchas, die zum Muster gehören:** Commit auf **`blur`**, nicht `onChange` (sonst hängt
  der Adder jeden Tastendruck als eigene Zeile an: `h`, `ht`, `htt`, …) — und Handler dürfen den
  Render-Index nicht festhalten, sondern lösen Zeilen über ihren **Wert** auf (ein Blur-Commit
  einer anderen Zeile mutiert die Liste synchron, bevor der Klick-Handler läuft).

Mit der Übernahme wird transmute das **3. Exemplar des guten Schnitts** → im nächsten
`/drift-audit` ist die Kit-Extraktion des Zeilen-Editors zu bewerten (Registry nennt dafür
9 offene Generalisierungen; **nicht** nebenbei mitmachen, das ist ein eigenes Vorhaben).

**Übernehmen (aus Nachbar-Plugins kopieren — Registry-Katalog, nicht Kit):**

- **Diff-Kern** — `image-to-markdown/src/diff.ts` (`diffLines`/`groupHunks`/`applySelection`, pure,
  TDD) + `diff_modal.ts` (Hunk-Checkboxen). Das ist **exakt** der Preview/Selektiv-Apply-Bedarf aus
  Punkt 1. Registry führt es als Kit-Kandidat mit n=1 — **transmute wird das 2. Exemplar**, also bei
  Übernahme Registry-Zeile hochzählen und Kit-Extraktion bewerten. `applySelection` liefert den
  *fertigen Body* (nicht boolean) — dieses Vertragsdetail ist load-bearing.
- **Nicht-Streaming-Chat-Antwort auswerten** — `vault-crews/src/core/chat-response.ts`
  (`extractChatContent`/`isContextOverflow`/`extractErrorMessage`). Transmute braucht **eine
  strukturierte JSON-Antwort, kein Streaming** — das ist der richtige Baustein, nicht `parseSSE`.
- **Obsidian-freier LLM-Client** — `yijing-oracle/src/obsidian/chat-client.ts`: `ChatClient` mit
  **injiziertem `httpGet`/`httpPost`** → in Node ohne obsidian-Mock testbar. Muster übernehmen.
- **Bestätigungs-Modal** — Registry-Zeile mit 4 Exemplaren (`vault-crews`, `vault-rag`,
  `finance-ledger`, `kuro-gamification`). Nimm die **Promise-Fassade** (`confirmAction(): Promise<boolean>`)
  aus `finance-ledger/src/ui/promptModal.ts`. Zwei Details, die beim Neubau fehlen: `finish()` nullt
  den Callback (sonst doppelte Auflösung) und `onClose() → finish(false)` (sonst hängt das Promise
  bei Esc).
- **Endpoint-Zeilen-Editor (Settings)** — guter Schnitt: `vault-crews/src/obsidian/settings.ts`
  `buildListEditor` + pure `endpoint-editor-model.ts` (bzw. `yijing-oracle`, `vim-dojo`). **Nicht**
  von `vault-rag`/`image-to-markdown` kopieren (Copy-Paste-Zweig, pure Logik im obsidian-Modul).
  Gotcha: Commit auf **`blur`**, nicht `onChange` — sonst hängt jeder Tastendruck eine Zeile an.
- **Timeout um `requestUrl`** — `Promise.race`+`setTimeout` (`requestUrl` kennt weder timeout noch
  abort). Registry: `local-image-generator/src/core/timeout.ts` `raceTimeout`, 4. Instanz.
- **Prompt-Tuning ohne Rebuild** — `vim-dojo/scripts/debrief-lab.mjs` (CLI gegen den lokalen
  Endpoint, editierbare Persona-Datei + Samples). Für die NL→Regex-Prompt-Iteration ist das der
  Weg; nicht über Plugin-Rebuilds tunen.
- **Inline-`eslint-disable`-Gate** — `markdown-presentation/scripts/check-no-inline-disables.mjs`
  als erster Schritt von `npm run lint` (der Store wertet ein disable einer `obsidianmd/*`-Regel als
  Error; hat anderswo zwei Wartungs-Releases gekostet).

**Neu zu bauen (kein Vorbild im Ökosystem):** NL→Regex-Prompt + Antwort-Schema-Validierung ·
Regex-Ausführung mit Backtracking-Guard · Scope-Resolver (Tag/Pfad/Frontmatter → Dateiliste) ·
Snapshot/Undo-Stack über mehrere Dateien.

**Pflicht nach dem Bauen:** Registry-Einträge im Dach (`../REGISTRY.md`) für die neuen
nicht-trivialen Bausteine — v.a. Snapshot/Undo und der Backtracking-Guard sind für jedes
schreibende Plugin interessant.

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

Noch keine — `package.json` existiert nicht. Beim Scaffolding den Dach-Standard übernehmen
(Vorlage: `image-to-markdown`, `yijing-oracle`):

```bash
npm run dev / build / deploy      # esbuild watch · prod-Bundle · Copy ins Vault-Plugin-Verzeichnis
npm run lint                      # check-no-inline-disables + eslint --max-warnings 0
npm test                          # vitest run
npm run typecheck                 # tsc --noEmit (separat von vitest)
npm run check:pure                # src/core darf `obsidian` nicht importieren
npm run gate                      # alles zusammen
```

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
- **`makeFakeEl()` aus dem Obsidian-Mock kennt kein `querySelector`.** Der Mock ist ein aus
  fünf Plugins gepflegtes Superset und wird nicht lokal erweitert — die Suche liegt in
  `tests/helpers/dom.ts` (`findByClass`/`findAllByTag`).
- **`data.json`** ist git-ignored (Obsidian-persistierte Konfig), **`main.js`** ist Build-Artefakt.
- **Release-CI ist GitHub-only** (`.github/` wird von Codeberg/Forgejo ignoriert).

## Offene Entscheidungen

Aus `docs/transmute-repo-spec.md` §9 — nach Workspace-Standard bereits **entschieden**:

- **Repo-Slug bleibt `obsidian-transmute`** (konsistent mit `obsidian-letterhead`/`obsidian-paperize`);
  manifest-`id` `transmute`, Anzeigename „Transmute". Der Store verbietet „Obsidian" im *Plugin*-Namen,
  nicht im Repo-Namen. **Noch zu prüfen:** ob die id `transmute` im Community-Store frei ist.
- **Hosting: Codeberg = `origin`/Quelle, GitHub = Push-Mirror** (CORE-GIT-01). Release über das
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
