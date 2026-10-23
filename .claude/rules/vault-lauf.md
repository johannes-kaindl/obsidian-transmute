---
paths:
  - "src/core/vault/**"
  - "src/obsidian/vault-io.ts"
  - "src/obsidian/snapshot-io.ts"
  - "src/obsidian/editor-io.ts"
  - "scripts/gui-smoke.ts"
  - "tests/vault-*.test.ts"
---

# Vault-weiter Lauf — Schleife, Freigabe, Drift-Schutz

Gotchas zum Lauf über viele Notizen: UI-Freigabe, Fortschritt, atomares Schreiben und die Messung der Freigabe im GUI-Smoke.

- **Ein vault-weiter Lauf ohne `yieldToUi` hat einen Abbrechen-Knopf, der nichts tut.** `cachedRead` löst oft aus dem Cache auf und erzeugt nur einen Mikrotask — der Renderer kommt nie zum Zeichnen und stellt den Klick nie zu. Der Fortschrittszähler muss auf demselben Zeit-Gate feuern (250 ms), nicht pro Datei, sonst steht er bei großen Notizen und sieht aus wie ein Freeze. Muster geerbt aus `apple-health/src/core/pipeline.ts`.

- **Fortschritt und UI-Freigabe gehören ans Ende JEDER Schleifeniteration** — nie hinter ein `continue`. In `runOverFiles` lagen sie hinter dem Zweig für „zu viele Treffer", und ein Muster wie `[a-z]` reißt die Obergrenze in *jeder* Datei: die Oberfläche wurde ausgerechnet im teuersten Fall nie freigegeben (GUI-Smoke 2026-08-16, 403 grüne Unit-Tests sahen es nicht). Zwei Regressionstests decken beide Ausprägungen ab.

- **Der Drift-Schutz gehört in den `vault.process`-Callback**, nicht davor: dort liegt der frische Inhalt vor, und read-modify-write ist atomar. Verglichen wird die **Treffermenge** (`sameHits`), nie der Text — ein Linter, der `updated:` ins Frontmatter schreibt, verschiebt jeden Offset (Regression 0.2.0).

- **`metadataCache.getTags()` gibt es in den offiziellen Typen nicht.** Die Tag-Liste für die Vervollständigung wird aus den Datei-Caches gesammelt (`allTags` in `vault-io.ts`). Undokumentierte APIs sind im Store-Review ein Befund, keine Abkürzung.

- **Der GUI-Smoke misst die UI-Freigabe direkt** (instrumentiertes `setTimeout`), nicht über ihre Nebenwirkung. Drei Anläufe über „laufen fremde Makrotasks?" waren irreführend: Chromium drosselt Timer in einem `hidden` Fenster auf 1 Hz — das ergibt exakt „0 Runden in 998 ms" und sieht aus wie eine Arbeitslast. `document.hidden` allein taugt nicht als Wächter (meldete false, während die Kette stand); der Prüfpunkt **eicht** die Timer-Kette und meldet seine Bedingungen mit.
