---
paths:
  - "src/core/regex/**"
  - "src/core/session.ts"
  - "src/core/presets/**"
  - "tests/guard.test.ts"
  - "tests/evaluate.test.ts"
  - "tests/relax.test.ts"
  - "tests/probe.test.ts"
  - "tests/session.test.ts"
  - "tests/session-diagnose.test.ts"
---

# Regex-Ausführung — ein Pfad, Guard und Muster

Gotchas zu `evaluate()`, zum Backtracking-Guard, zu Presets und zur Diagnose.

- **`evaluate()` ist der einzige Ort, an dem kompiliert und ausgeführt wird** — Modell-Pfad, Handbearbeitung und Revalidierung vor dem Schreiben gehen alle hindurch. Drei getrennte Stellen würden auseinanderlaufen; genau so ist in 0.2.0 die Anzeige von der Ausführung abgedriftet. Wer einen vierten Ausführungsweg braucht, baut ihn **nicht** daneben.

- **Obsidian verbietet Web-Worker** im Renderer (gleiche Wurzel wie der Draco-/`AsyncUnzipInflate`-Befund bei `3d-codeblocks`/`apple-health`). **Das trifft den Backtracking-Guard direkt:** der naheliegende „Regex im Worker mit Kill-Switch" aus der Spec ist so **nicht** umsetzbar. Deshalb gibt es die Regex-Analyse *vor* der Ausführung (`guard.ts`, Redos-Heuristik auf dem Pattern) und den Zeit-Budget-Check zwischen den Zeilen (`execute.ts`), statt einen laufenden Match abzubrechen.

- **Ein Muster, das den Leerstring trifft** (`a*`, `\b`, `^`), liefert einen Treffer pro Position, jeden mit der vollen Zeile in `before`/`after`. `collect()` schiebt `lastIndex` korrekt vor, es hängt also nicht — aber ohne `maxHits` (500) wären das Tausende DOM-Zeilen bei jedem Tastendruck.

- **Das Zeitbudget in `runRule` greift nur ZWISCHEN Zeilen.** Ein einzelner entgleister Match auf *einer* Zeile kommt nie zurück, und Obsidian kann ihn nicht abbrechen (keine Web-Worker). Deshalb läuft vor einer Risiko-Freigabe `probeRisky()` — dasselbe Muster auf 20 Zeichen, mit Zeitmessung. **Ohne diesen Kanarienvogel ist jede Freigabe ein Knopf, der das Fenster einfriert** (real eingetreten, GUI-Durchlauf 2026-07-27).

- **Ein Reparaturvorschlag, der dem Muster gleicht, wird verworfen** (`session.diagnose`). Kleine Modelle geben genau das nicht treffende Muster zurück; ein Knopf, der nichts ändert, sieht wie ein Ausweg aus.

- **Eine gelockerte Fassung eines Musters darf nie ausgeführt werden, ohne durch `evaluate()` zu gehen.** Die Sonden in `relax.ts` lockern genau eine Bedingung und laufen mit demselben Zeitbudget, derselben Obergrenze und ohne Risiko-Freigabe. Eine Lockerung, die der Guard ablehnt, meldet **nichts** — ein fehlender Befund ist immer harmloser als ein ausgeführtes Muster, das niemand geprüft hat.

- **`[\b]` ist ein Backspace, kein Wortgrenzen-Anker**, und `[^abc]` beginnt nicht mit einem Zeilenanker. Wer Muster per Text umbaut, muss Zeichenklassen kennen, sonst entsteht ein anderes Muster als das geschriebene.

- **Das eingebaute Preset „Zeilenumbrueche in Absaetzen entfernen" (`src/core/presets/remove-newlines.ts`) erkennt nur ZWEI benachbarte Zeilen, kein „bin ich innerhalb eines Codeblocks" ueber mehrere Zeilen hinweg.** Die Fence-Zeilen selbst (` ``` `) bleiben stehen, Zeilen DAZWISCHEN wuerden trotzdem zusammengezogen, weil eine zustandslose Regex das nicht unterscheiden kann. Bewusst in Kauf genommen — die Pflicht-Vorschau vor jeder Anwendung (Differenzierungspunkt 1) faengt genau diesen Fall auf, bevor geschrieben wird.
