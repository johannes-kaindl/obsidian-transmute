---
paths:
  - "src/obsidian/view.ts"
  - "src/obsidian/view-render.ts"
  - "src/obsidian/vault-render.ts"
  - "tests/view-*.test.ts"
  - "tests/vault-render*.test.ts"
  - "tests/helpers/**"
  - "tests/render-outcome.test.ts"
  - "tests/settings-help.test.ts"
---

# Panel und View — Hub, Teil-Draw, Test-DOM

Gotchas zum Panel (Hub aus dem Kit, dreigeteilter Körper) und zu seinen Tests.

- **Das Panel ist ein Hub aus dem Kit (`buildHubInto`, seit 0.13.0) mit zwei Tabs: „Arbeitsbereich“ (`work`) und „Bibliothek“ (`library`, die Presets als Listen-Zeilen mit Ausführen-Knopf, `renderLibrary`).** Der Hub wird einmal in `onOpen` gebaut (`buildHub` in `view.ts`); `draw()` zeichnet nur in den Container des Arbeitsbereichs, die Bibliothek zeichnet bei jedem Öffnen des Tabs neu (die Presets verwaltet der Settings-Tab, es gibt kein zweites Datenmodell). Ausführen aus der Bibliothek geht über `onLoadPreset` und wechselt danach mit `hub.setTab("work")` — und zeichnet vorher voll neu, weil `editRule` nur „edit“ meldet und die Regel-Felder sonst leer blieben. `HUB_CSS` steht wortgleich in `styles.css`.

- **Der Panel-Körper (im Arbeitsbereich) ist dreigeteilt** (`.transmute-history` / `.transmute-rule` / `.transmute-outcome`). `renderPanel` zeichnet alles, `renderOutcome` nur die äußeren beiden — die Regel-Felder bleiben stehen, weil ein `root.empty()` unter dem Cursor Fokus, Cursorposition und den Undo-Stack des Feldes mitnimmt. Welcher Weg dran ist, sagt die Session über `onChange(state, reason)`.

- **Was in den `.transmute-rule`-Container gerendert wird, altert.** Der Container ist vom Teil-Draw ausgenommen — dort gehört nur hinein, was sich beim Tippen *nicht* ändern darf (die Felder selbst, der Spickzettel). Jede abgeleitete Anzeige (`/muster/flags`, Erklärung, Treffer) gehört in `.transmute-outcome`. Beides ist schon einmal falsch herum gewesen.

- **Der Umfangs-Block gehört in den Panel-Rumpf, nicht in `.transmute-rule`.** Den Regel-Container gibt es erst im Preview-Zustand — der Umfang wird aber *vorher* gewählt.

- **Handler nicht als Referenz weiterreichen** (`onFilter: handlers.onFilter`): das bricht am `unbound-method`-Lint. Arrow-Wrapper verwenden.

- **Während eines Laufs wird die Trefferliste nicht gezeichnet** (`renderVaultBody`). Der Fortschritt feuert im 250-ms-Takt; jedes Zeichnen baute die komplette Liste neu — bei 11.770 Dateien teurer als der Lauf selbst.

- **`makeFakeEl()` aus dem Obsidian-Mock kennt kein `querySelector`.** Der Mock ist ein aus fünf Plugins gepflegtes Superset und wird nicht lokal erweitert — die Suche liegt in `tests/helpers/dom.ts` (`findByClass`/`findAllByTag`).
