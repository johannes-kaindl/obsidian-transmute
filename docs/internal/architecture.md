# Architektur von obsidian-transmute

Aufbau des Plugins, zum Nachschlagen. Was beim Arbeiten beißt, steht im Kern der `AGENTS.md` und in `.claude/rules/`; das Warum in `decisions.md`.

## Schichten und Verzeichnisse

Der Kern `src/core/` ist rein (Regel im Kern der `AGENTS.md`); die Adapter in `src/obsidian/` und `src/main.ts` importieren `obsidian`.

```
src/
├── main.ts           Plugin-Einstieg, verdrahtet Kern und Adapter (this.llm = createLlmConnection)
├── core/
│   ├── llm/          prompt · response (Regel/Diagnose lesen, JSON aus code-kit llm-json) · client
│   ├── regex/        compile (allowRisky) · execute (Zeitbudget + maxHits) · guard · guard-types ·
│   │                 probe (Kanarienvogel) · relax (Lockerungs-Sonden) · evaluate ← der EINE Ausführungspfad
│   ├── vault/        scope (Kandidaten) · run (Lauf) · selection (zwei Ebenen) · snapshot · apply ·
│   │                 sample · state · labels — alles pure, IO injiziert
│   ├── presets/      eingebaute Presets (remove-newlines)
│   ├── i18n/         strings (EN kanonisch, DE)
│   ├── anchor.ts     sameMatches (gleiche Ersetzungen in Vorschau und Anwendung)
│   ├── cheatsheet.ts statische Regex-Referenz (Syntax verbatim, Text als i18n-Key)
│   ├── types.ts      gemeinsame Typen (Regel-Entwurf, Treffer, …)
│   ├── session.ts    Zustandsmaschine inkl. Handpfad
│   └── settings.ts   Typ + defaults (mergeSettings aus dem Kit) · MAX_HITS
├── obsidian/         settings-tab · view · view-render · vault-render · editor-io · vault-io ·
│                     snapshot-io · confirm-modal
├── vendor/kit/       gevendorte Kit-Module (pure) — nie von Hand ändern
└── vendor/kit-obsidian/  gevendorte Kit-Module, die `obsidian` importieren — nie von Hand ändern
```

Der Struktur-Vertrag zum Modell (JSON, einmaliger Retry) und die Safety-Bausteine (Backtracking-Guard, Warnschwelle, Snapshot) stehen im Kern der `AGENTS.md` bzw. in `.claude/rules/llm-anbindung.md`.
