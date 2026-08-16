# Aufnahme-Vertrag — Bilder für die README

Was jedes Bild zeigen **muss**, damit es seinen Zweck erfüllt. Die Bilder entstehen mit
`npm run shots` gegen ein laufendes Obsidian; die Vorlage dafür liegt in `fixture/`.

Der Bild-Standard (Klassen, Breiten, Budgets, Einbettungsform) ist **zentral** und wird
hier nicht wiederholt: `_docs/readme/readme-spec.json`, Block `images`. Geprüft mit
`npm run shots:check`.

## Grundsätze für diese Aufnahmen

- **Aufnahmesprache Englisch.** `README.md` ist die kanonische Fassung, und `README.de.md`
  bettet dieselben Bilder ein.
- **Beispieldaten generisch.** Erfundene Firmen (*Acme Consulting*, *Globex*), keine
  echten Namen, Nummern oder Adressen — die Bilder gehen mit dem Repo um die Welt.
- **Nur dieses Plugin aktiv.** Sonst malen fremde Ribbon-Icons in jedes Bild.
- **Kein Modell nötig.** Alle Bilder entstehen über den Handpfad („or write the pattern
  yourself"). Ein Aufnahmelauf, der an einem laufenden LLM hängt, ist nicht reproduzierbar
  — und die Bilder sollen das *Werkzeug* zeigen, nicht die Tagesform eines Modells.
  Ausnahme ist bewusst keine: die Klartext-Erklärung des Modells erscheint im Panel an
  derselben Stelle wie eine selbst geschriebene und ist dort im Vertrag beschrieben.

## Bilder

| Datei | Klasse | referenziert von | muss zeigen |
|---|---|---|---|
| `preview.png` | `hero` | README (Hero) | Das Panel neben einer offenen Notiz, mit **fertiger Vorschau**: Muster, Ersetzung, Trefferzahl und mindestens zwei Treffer mit Vorher-/Nachher-Zeile. Das ist die Kernaussage des Plugins — nichts wird geschrieben, bevor man es gesehen hat. |
| `vault-scope.png` | `feature` | README (§ Scope) | Bereich **„Whole vault"** mit den drei Filterfeldern (Folder · Tag · Property), der Zeile „N of M notes" und der **zweistufigen Trefferliste**: Dateizeilen mit Trefferzahl, davon **eine aufgeklappt**. Belegt, dass auch ein vault-weiter Lauf vor dem Schreiben gezeigt wird. |
| `rule-editor.png` | `feature` | README (§ Edit the pattern) | Die editierbaren Felder (Muster, Ersetzung, Flags) **und den aufgeklappten Spickzettel**. Zeigt den Lernpfad: das Muster ist kein Orakel, sondern ein Formular. |
| `settings.png` | `feature` | README (§ Configuration) | Den Einstellungs-Tab mit der **Endpunkt-Zeile samt Erreichbarkeits-Status** („in use"), den Ein-Klick-Voreinstellungen (LM Studio · Ollama) und den Verhaltens-Optionen. Zeigt, dass die Endpunkt-Kette konfigurierbar ist und ihren Zustand meldet. |

## Reproduktion

```bash
npm run shots -- --setup          # Fixture-Vault bauen
# Obsidian neu starten, Vault "transmute-shots" öffnen
npm run shots -- --only preview
```

Ein Bild pro Obsidian-Start ist der sichere Weg (Zustandsreste). Der Treiber stellt je
Bild seine Voraussetzungen selbst her und räumt Blätter auf.

## Befunde aus der Aufnahme

Eine Bebilderung ist nebenbei ein Audit — sie legt Zustände nebeneinander, die sonst
niemand zusammen ansieht:

- **`README.de.md` fehlte der Feature-Punkt „Das Muster selbst bearbeiten" ganz.** Aufgefallen
  ist es, weil `rule-editor.png` keine Stelle hatte, an die es gehört hätte. Punkt ergänzt
  (2026-08-16). Die deutsche Fassung hinkt der englischen also stellenweise hinterher —
  beim nächsten README-Durchgang ganz vergleichen, nicht nur die neue Zeile nachziehen.
- **Die Aufnahme braucht ein Fenster von höchstens 949 px Höhe** (Bildschirmgrenze des
  Aufnahmegeräts). Beim ersten Versuch war das Fenster im **Vollbild**, `setSize` wurde
  stillschweigend geschluckt, und der Hero schnitt die Aktionsknöpfe ab — also genau die
  Aussage „nichts wird geschrieben, bevor du es gesehen hast". Der Treiber holt das
  Fenster jetzt erst aus dem Vollbild und meldet die tatsächliche Größe.

## Offen

*(Fehlt am Ende ein Bild, steht es hier mit Begründung — nicht stillschweigend
gestrichen. `shots:check` meldet es dann bei jedem Lauf.)*

Derzeit nichts offen — alle vier Bilder sind aufgenommen und eingebettet.
