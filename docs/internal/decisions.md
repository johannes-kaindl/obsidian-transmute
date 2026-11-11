# Entscheidungen in obsidian-transmute — das Warum

Verdichtete Design-Essenz zu den Regeln im Kern (`AGENTS.md`) und in `.claude/rules/`. Die Herleitungen liegen im Cockpit des Maintainers (CORE-META-14). Vor dem Übernehmen einer Altentscheidung gilt Johannes' Regel: Grund aufsuchen, messen, ob er heute trägt, Ergebnis melden.

## Kit-first-Befund (Sondierung 2026-07-25)

Die Sondierung vom 2026-07-25 war ungewöhnlich ertragreich: fast der gesamte LLM-Unterbau kam fertig aus dem Ökosystem, neu gebaut wurde im Wesentlichen die Regex-Domäne. Übernommen:

- **Vendored aus den Kits** (nie von Hand ändern): die vollständige, aktuelle Liste steht in `tools/kit-sync.json` und `src/vendor/kit/VENDOR.json`; vendort wird mit `node ../tools/kit-sync/kit-sync.mjs`. Eigene Ordner für Module, die `obsidian` importieren (`src/vendor/kit-obsidian/`): `obsidian/clipboard.ts` trägt einen Querimport auf `pure/clipboard` und beide Schichten haben eine `clipboard.ts` (Basenamen-Kollision). `tests/vendor/kit/obsidian-mock.ts` ist der Obsidian-Mock, gestempelt aus dem Kit-Tag; `tests/__mocks__/obsidian.ts` re-exportiert nur. Die `*_CSS`-Konstanten der Kit-Module stehen wortgleich in `styles.css`; `tests/kit-css.test.ts` bewacht das.
- **Aus Nachbar-Plugins übernommen:** Endpoint-Zeilen-Editor + pure Editor-Model (`yijing-oracle`), EndpointResolver/Probe/Modell-Liste (`vim-dojo`), Chat-Response-Auswertung (`vault-crews`), `raceTimeout` (`local-image-generator`, heute im Kit als `withTimeout`), Inline-`eslint-disable`-Gate (`markdown-presentation`), `debrief-lab`-Muster für Prompt-Tuning (`vim-dojo`).
- **Neu gebaut (kein Vorbild im Ökosystem):** NL→Regex-Prompt + Antwort-Validierung · Regex-Ausführung mit Backtracking-Guard (`evaluate()`) · Scope-Auflösung · Snapshot/Undo.

Die vollständige Sondierung (Quellen-Abwägungen, Registry-Zähler, Gotcha-Herleitungen) liegt im Cockpit (`$VAULT/25_Coding/obsidian-transmute/`). Für neue Vorhaben gilt weiterhin: erst Kit-first (`../AGENTS.md` + `../REGISTRY.md`), dann bauen.

## Abgrenzung nach außen

**Abgrenzung nach außen:** `ksawl/obsidian-alchemist` bewegt sich im selben Bildfeld (Alchemie/Transmutation, „vault hygiene"), deckt aber Vault-Hygiene allgemein ab — nicht NL→Regex-Replace. Explizit benennen, nicht ignorieren.

## Modellagnostisch, mit dem was lokal da ist (Entscheidung Johannes 2026-07-25)

Kein Modell wird für dieses Plugin nachgeladen, kein Modellname wird hartkodiert. Die Spec-Frage „4-bit vs. 8-bit“ ist damit gegenstandslos. Referenzumgebung war die LM-Studio-Instanz auf `:1234` (Bestand 2026-07-25: `qwen/qwen3.6-35b-a3b`, der Spec-Kandidat und als MoE schnell, `qwen/qwen3.6-27b`, `google/gemma-4-31b-qat`, `google/gemma-4-26b-a4b-qat`, `gemma-4-e4b`, `gemma-4-e2b`). Weitere Endpunkte bleiben über die Endpunkt-Liste ansprechbar. Die verbleibende empirische Frage — hält der NL→Regex-Prompt über mehrere der vorhandenen Modelle? — ist eine Mess-, keine Entscheidungsaufgabe (Werkzeug: `npm run lab:diagnose`, `debrief-lab`-Muster aus vim-dojo).

## Repo, Lizenz, Release

- **Repo-Slug bleibt `obsidian-transmute`** (konsistent mit `obsidian-letterhead`/`obsidian-paperize`); manifest-`id` `transmute`, Anzeigename „Transmute“. Der Store verbietet „Obsidian“ im *Plugin*-Namen, nicht im Repo-Namen.
- **Lizenz: AGPL-3.0 (`LICENSE`) + CC BY-SA 4.0 (`LICENSE-DOCS`)** — Workspace-Konsistenz.
- **Release über das zentrale `../tools/release/`**, nicht über eine kopierte `release.mjs` (Lesson vom 2026-07-25: die vendorte Variante pushte Tag-zuerst und löste auf einem leeren Remote keinen Workflow aus). Einrichtung über den Dach-Skill `plugin-release-setup`; Branch und Tag nach GitHub nur über `release.mjs` (Regel im Dach).

## Ein Lint-Kern statt zweier Spiegel

Ein separates `lint:portal` gibt es seit 2026-08-13 nicht mehr: der template-verwaltete `eslint.config.mjs`-Kern **ist** der Store-Scanner-Spiegel, lokale Abweichungen stehen sichtbar in `eslint.overrides.mjs`. Ein zweiter, handgepflegter Spiegel war genau die Drift-Quelle, die er abfangen sollte.

## Rückfrage bei ungültiger Antwort: Kit-Baustein, kein Retry bei Endpunktfehlern (Welle 32, 2026-11-11)

- **Die Rückfrage kommt aus code-kit `answer-retry`** (Einzelpin 0.63.0, `askUntilValid` mit `maxRetries: 1`), nicht aus einer eigenen Schleife: dieselbe Schleife stand dreimal (transmute, slide-deck, vault-crews), Owner-Task im code-kit-Cockpit. Der Wortlaut „Your previous answer was not valid: …“ folgt dem Kit; der Schluss „Answer again with a single valid JSON object and nothing else.“ ist `RETRY_INSTRUCTION` in `src/core/llm/prompt.ts`.
- **Ein Endpunktfehler, ein Kurzbefehl-Fehler und eine leer abgeschnittene Antwort werden nicht wiederholt.** Vorher lief jeder Fehlschlag von `ask` in die Rückfrage; das Kit wiederholt nur ungültige Antworten, weil ein zweiter Aufruf Serverzustand und Token-Grenze nicht ändert. Gemessen am Smoke-Punkt CL3 (529 des Anthropic-Stubs): zwei Anfragen am Stub vorher, eine nachher. `Attempt` trägt dafür `retry`; die Anzeige behält Meldungsschlüssel und Rohantwort.
- **Warum nicht auf Endpunktfehler wiederholen, falls ein kurzer Aussetzer gemeint war:** das wäre Sache des Transports (Backoff), nicht der Antwortprüfung, und würde beim Opt-in Claude (`529`) Last erzeugen.
