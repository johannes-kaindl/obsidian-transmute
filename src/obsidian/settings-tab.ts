import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import type TransmutePlugin from "../main";
import type { PresetDef, ScopeKind } from "../core/settings";
import { t } from "../vendor/kit/i18n";
import { renderSettingDefinitions, settingBodyHost, refreshSettingsTab } from "../vendor/kit-obsidian/settings_walker";
import { getLang } from "../vendor/kit/i18n";
import { githubHelpUrls, helpSettingDefinition } from "../vendor/kit-obsidian/help-setting";

type ControlDef = {
  type: "text" | "textarea" | "toggle" | "dropdown" | "number";
  key: string;
  options?: Record<string, string>;
  placeholder?: string;
  min?: number;
};

type ItemDef = { name?: string; desc?: string; control?: ControlDef; render?: (setting: Setting) => void };
type GroupDef = { type?: string; heading?: string; items?: ItemDef[] };

/**
 * Deklarativer Settings-Tab (Obsidian ≥ 1.13: getSettingDefinitions). display() walkt
 * DIESELBEN Definitionen imperativ als Fallback fuer aeltere Versionen — eine Wahrheit,
 * zwei Renderer. Muster: markdown-presentation/src/settings.ts.
 *
 * Keine einklappbaren Sektionen (PROF-OBS-06 [MUST NOT]): sie schliessen die deklarative
 * API aus und kosten dauerhaft die Settings-Suche. Sektionen laufen ueber heading.
 */
export class TransmuteSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: TransmutePlugin,
  ) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    // Hilfe-Zeile (UI-STANDARD §8): ERSTES Element, vor jeder Gruppe. Repo-Name, nicht Plugin-ID.
    const help = helpSettingDefinition({
      ...githubHelpUrls("obsidian-transmute"),
      texts: {
        name: t("help.name"),
        desc: t("help.desc"),
        openDocs: t("help.openDocs"),
        reportIssue: t("help.reportIssue"),
      },
    });
    const defs: (GroupDef | typeof help)[] = [
      help,
      {
        type: "group",
        heading: t("set.groupConnection"),
        items: [
          // Endpunkte, Modell, Anfrage-Abschnitt (Sampling, Denken): alles aus der Kit-Verbindung.
          // Eigener Host, weil die Verbindung ihren Container bei jedem Neuzeichnen leert.
          {
            render: (setting) => {
              this.renderConnection(setting);
            },
          },
        ],
      },
      {
        type: "group",
        heading: t("set.groupBehaviour"),
        items: [
          {
            name: t("set.scope"),
            desc: t("set.scopeDesc"),
            control: {
              type: "dropdown",
              key: "defaultScope",
              options: {
                file: t("view.scope.file"),
                selection: t("view.scope.selection"),
                vault: t("view.scope.vault"),
              },
            },
          },
          { name: t("set.sampleChars"), desc: t("set.sampleCharsDesc"), control: { type: "number", key: "sampleChars", min: 200 } },
          { name: t("set.budgetMs"), desc: t("set.budgetMsDesc"), control: { type: "number", key: "budgetMs", min: 200 } },
          { name: t("set.confirmThreshold"), desc: t("set.confirmThresholdDesc"), control: { type: "number", key: "confirmThreshold", min: 1 } },
          { name: t("set.showTargetField"), desc: t("set.showTargetFieldDesc"), control: { type: "toggle", key: "showTargetField" } },
        ],
      },
      {
        type: "group",
        heading: t("set.groupPresets"),
        items: [
          {
            name: t("set.presets"),
            desc: t("set.presetsDesc"),
            render: (setting) => {
              this.renderPresets(setting);
            },
          },
        ],
      },
    ];
    return defs as unknown as SettingDefinitionItem[];
  }

  /**
   * Presets-Liste: Name + Muster + Flags + Ersetzung, eine Zeile je Preset.
   *
   * Commit bei Aenderung direkt ins Array (kein eigener Zwischenzustand) — ein
   * vollstaendiger Redraw passiert nur bei Hinzufuegen/Loeschen, nicht bei jedem
   * Tastendruck (sonst verliert das Feld unter dem Cursor Fokus und Undo-Stack).
   */
  private renderPresets(setting: Setting): void {
    const host = settingBodyHost(setting);
    const list = host.createDiv({ cls: "transmute-preset-list" });

    const renderRow = (preset: PresetDef): void => {
      const row = new Setting(list).setName(preset.name.length > 0 ? preset.name : t("set.presetUnnamed"));
      row.addText((c) =>
        c
          .setPlaceholder(t("set.presetName"))
          .setValue(preset.name)
          .onChange((value) => {
            preset.name = value;
            void this.plugin.saveSettings();
          }),
      );
      row.addText((c) =>
        c
          .setPlaceholder(t("set.presetPattern"))
          .setValue(preset.regex)
          .onChange((value) => {
            preset.regex = value;
            void this.plugin.saveSettings();
          }),
      );
      row.addText((c) =>
        c
          .setPlaceholder(t("set.presetFlags"))
          .setValue(preset.flags)
          .onChange((value) => {
            preset.flags = value;
            void this.plugin.saveSettings();
          }),
      );
      row.addText((c) =>
        c
          .setPlaceholder(t("set.presetReplacement"))
          .setValue(preset.replacement)
          .onChange((value) => {
            preset.replacement = value;
            void this.plugin.saveSettings();
          }),
      );
      row.addExtraButton((b) =>
        b
          .setIcon("trash-2")
          .setTooltip(t("set.presetDelete"))
          .onClick(() => {
            this.plugin.settings.presets = this.plugin.settings.presets.filter((p) => p.id !== preset.id);
            void this.plugin.saveSettings().then(() => this.refreshUi());
          }),
      );
    };

    for (const preset of this.plugin.settings.presets) renderRow(preset);

    new Setting(host).addButton((b) =>
      b
        .setButtonText(t("set.presetAdd"))
        .onClick(() => {
          this.plugin.settings.presets = [
            ...this.plugin.settings.presets,
            { id: `preset-${Date.now()}-${this.plugin.settings.presets.length}`, name: "", regex: "", flags: "", replacement: "" },
          ];
          void this.plugin.saveSettings().then(() => this.refreshUi());
        }),
    );
  }

  private renderConnection(setting: Setting): void {
    const host = settingBodyHost(setting);
    // Zwei Geschwister: die Verbindung leert ihren Container bei jedem Neuzeichnen, der Hinweis darf das nicht verlieren.
    const connectionEl = host.createDiv({ cls: "transmute-connection" });
    const hintEl = host.createDiv({ cls: "transmute-connection-hint" });
    this.plugin.llm.renderSettings(connectionEl, { lang: getLang() });
    // Der Kurzbefehl-Hinweis haengt an der aufgeloesten Quelle (asynchron, die Verbindung merkt sie sich) und folgt
    // einer Wahl im offenen Tab: die Verbindung zeichnet ihren Container nach jeder Wahl neu, daran haengt der Beobachter.
    const updateHint = (): void => {
      void this.plugin.llm.resolve().then((src) => {
        if (!hintEl.isConnected) return;
        hintEl.empty();
        if (src.transport === "shortcuts") new Setting(hintEl).setDesc(t("src.appleHint"));
      }).catch(() => undefined);
    };
    updateHint();
    if (typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(() => {
        if (!hintEl.isConnected) { observer.disconnect(); return; }
        updateHint();
      });
      observer.observe(connectionEl, { childList: true });
    }
  }

  /** Die Verbindung haelt Modell-Listen fuer den Tab — beim Schliessen verwerfen. */
  hide(): void {
    this.plugin.llm.hideSettings();
  }

  /** Auf ≥1.13 rendert das Framework deklarativ und ruft display() nie. */
  display(): void {
    this.renderImperative();
  }

  private refreshUi(): void {
    refreshSettingsTab(this, () => this.renderImperative());
  }

  private cleanupPrevious: () => void = () => {};

  private renderImperative(): void {
    this.cleanupPrevious();
    const { containerEl } = this;
    containerEl.empty();
    this.cleanupPrevious = renderSettingDefinitions(
      containerEl,
      this.getSettingDefinitions(),
      this,
      this.app,
    );
  }

  getControlValue(key: string): string | number | boolean | undefined {
    const s = this.plugin.settings;
    switch (key) {
      case "defaultScope":
        return s.defaultScope;
      case "sampleChars":
        return s.sampleChars;
      case "budgetMs":
        return s.budgetMs;
      case "confirmThreshold":
        return s.confirmThreshold;
      case "showTargetField":
        return s.showTargetField;
      default:
        return undefined;
    }
  }

  setControlValue(key: string, value: unknown): void {
    const s = this.plugin.settings;
    const asInt = (fallback: number): number => {
      const parsed = Number.parseInt(String(value), 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    switch (key) {
      case "defaultScope": {
        // Vollstaendig ueber die Union gehen: ein Vergleich auf eine einzelne Variante
        // laesst jede spaeter hinzugekommene still auf "file" zurueckfallen.
        const wanted = String(value);
        const known: ScopeKind[] = ["file", "selection", "vault"];
        s.defaultScope = known.find((k) => k === wanted) ?? "file";
        break;
      }
      case "sampleChars":
        s.sampleChars = Math.max(200, asInt(s.sampleChars));
        break;
      case "budgetMs":
        s.budgetMs = Math.max(200, asInt(s.budgetMs));
        break;
      case "confirmThreshold":
        s.confirmThreshold = Math.max(1, asInt(s.confirmThreshold));
        break;
        break;
      case "showTargetField":
        s.showTargetField = Boolean(value);
        break;
      default:
        return;
    }
    void this.plugin.saveSettings();
  }
}
