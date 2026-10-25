---
paths:
  - "src/core/llm/**"
  - "src/main.ts"
  - "src/obsidian/settings-tab.ts"
  - "scripts/diagnose-lab.ts"
  - "tests/client.test.ts"
  - "tests/response.test.ts"
  - "tests/prompt.test.ts"
---

# LLM-Anbindung — Vertrag, Verbindung, Antworten

Gotchas zum Modellaufruf: Modellagnostik, der JSON-Vertrag, die Kit-Verbindung und das Verhalten lokaler Server.

- Das Modell kommt **aus der Modell-Liste des Endpunkts** (`GET /v1/models` → `extractModelIds`), nie aus einer Konstante. Default = leer/erstes verfügbares, nicht „qwen…".

- **Kein `response_format: json_schema`-Zwang** — das können LM Studio, Ollama und MLX unterschiedlich gut. Der JSON-Vertrag wird über den *Prompt* hergestellt und **tolerant geparst** (Code-Fences strippen, erstes balanciertes JSON-Objekt nehmen), plus genau ein Retry mit dem Fehler zurück ans Modell.

- **Reasoning-Modelle mitdenken:** die lokal vorhandenen Qwen3.6 sind Thinker. `<think>`-Blöcke müssen **vor** dem JSON-Parsen abgetrennt werden (Kit `think-splitter.ts`), und wo der Server es unterstützt, wird Reasoning unterdrückt (Kit `reasoning.ts` `suppressParams`) — Regex-Generierung braucht keine sichtbare Gedankenkette.

- Ein Modell, das den Vertrag nicht hält, ist ein **Fehlerpfad mit klarer Meldung**, kein Crash.

- **Struktur-Vertrag LLM:** Das Modell antwortet **JSON** (`regex`, `flags`, `replacement`, `explanation`, `confidence`) — nicht Prosa. Ungültige Regex geht **einmal** mit dem Syntaxfehler zurück ans Modell, danach Fehlermeldung an die Nutzer:in. Nie ungeprüft anwenden.

- **Die LLM-Anbindung ist `createLlmConnection` aus dem Kit (`this.llm` in `main.ts`, seit Welle 15), keine eigene Resolver-/Client-Schicht mehr.** Sie merkt sich die Auflösung des lokalen Endpunkts bis `llm.invalidate()` (der Manager wird nie gemerkt) — ein GUI-Smoke, der `settings.endpoints` zur Laufzeit auf einen Stub-Server umbiegt, ruft danach `p.llm.invalidate()`, sonst geht die Anfrage still an den alten Endpunkt und hängt in „generating“. Das Modell im Manager-Fall steht in `llm.complete(…).source.sentModel`, nicht in `settings.model`. Der Kurzbefehl-Endpunkt erkennt sich an `(await llm.resolve()).transport === "shortcuts"`. Transmute fragt `stream: false` über `requestUrlTransport` (`fallback: "none"`; der Standard wäre der XHR-Stream), im Modus `structured`, `truncated: "error"` und `restoreContent: "json"` (die Regel wird als JSON aus `content` geparst, ein geschwärzter mehrzeiliger Platzhalter wäre sonst ungültiges JSON). `temperature: 0` geht je Aufruf über `overrides` hinaus (die Regel „gleiche Eingabe, gleiche Regel“); der Anfrage-Abschnitt der Settings zeigt trotzdem die Profil-Temperatur des Modus. Das Panel-Schalterpaar „Denken“ bedient `settings.request.thinking.structured`. Der Abschnitt der Settings braucht einen eigenen Host-Container, weil die Verbindung ihn bei jedem Neuzeichnen leert (`renderConnection` in `settings-tab.ts`).

- **Endpoint mit `/v1`-Suffix:** `normalizeEndpoint()` strippt ein trailing `/v1`, sonst baut der Client `…/v1/v1/chat/completions`. **LM Studio antwortet auf falsche Pfade mit HTTP 200 + Fehler-Body** → `res.ok` true, Antwort leer, stiller Fehlschlag.

- **LM Studio ignoriert das `model`-Feld** → das tatsächliche Modell aus `response.model` lesen.

- **`requestUrl` kennt weder Timeout noch Abort** → eigener `Promise.race`-Wrapper.

- **Die Antwortsprache ist eine Modellfrage, keine Promptfrage.** Gemessen 2026-07-30 mit `npm run lab:diagnose` (fünf Fälle, deutsche Oberfläche, Zielsprache ausdrücklich im Prompt): `qwen/qwen3.6-35b-a3b` antwortet **5 von 5** deutsch, `google/gemma-4-e2b` **4 von 5**. Ein 2B-Modell lässt eine Nebenbedingung fallen, während es gleichzeitig ein JSON-Format treffen muss — **nicht** am Prompt schrauben, sondern das Modell empfehlen.

- **Ein leerer `content` bei gefülltem `reasoning` ist keine leere Modellantwort**, sondern ein Modell, das sein Token-Budget vollständig ins Denken gesteckt hat (gemessen: 512 von 551 Tokens, qwen3.6 unter LM Studio). `suppressParams` schickt `reasoning_effort: "none"`, greift aber nur bei ausgeschaltetem Thinking-Schalter — deshalb hat der Fall eine eigene Meldung (`CompleteResult.thoughtOnly`).
- **Claude ist ein Opt-in (Welle 26, 2026-10-25):** `anthropic: true` im `transports`-Objekt von `createLlmConnection` (`src/main.ts`); ohne die Zeile sieht das Plugin einen Manager-Endpunkt mit Anbieter `anthropic` nie. Test: `tests/main-claude.test.ts` (rot ohne die Zeile), im Renderer CL1–CL3 gegen den Anthropic-Stub. Folge auf Claude: das feste `temperature: 0` je Aufruf wird nicht gesendet (`override-dropped` in „Letzte Anfrage“), und Textprobe, Anweisungen und Regeln gehen an Anthropic; `SECURITY.md`, README und Handbuch sagen es und müssen mitziehen, wenn sich die Probe ändert. Der Client wiederholt eine 5xx-Antwort einmal: ein Fehler-Stub braucht zwei Antworten (CL3).
