import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import type TransmutePlugin from "../main";
import type { ScopeKind } from "../core/settings";
import { t } from "../vendor/kit/i18n";
import { renderSettingDefinitions, settingBodyHost, refreshSettingsTab } from "../vendor/kit/settings_walker";
import { buildEndpointList } from "./settings/endpoint-list";
import { probeEndpoint } from "./http";

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
    const defs: GroupDef[] = [
      {
        type: "group",
        heading: t("set.groupConnection"),
        items: [
          {
            name: t("set.endpoints"),
            desc: t("set.endpointsDesc"),
            render: (setting) => {
              this.renderEndpoints(setting);
            },
          },
          {
            name: t("set.model"),
            desc: t("set.modelDesc"),
            render: (setting) => {
              this.renderModel(setting);
            },
          },
          { name: t("set.timeout"), desc: t("set.timeoutDesc"), control: { type: "number", key: "timeoutMs", min: 1000 } },
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
          { name: t("set.snapshotKeep"), desc: t("set.snapshotKeepDesc"), control: { type: "number", key: "snapshotKeep", min: 0 } },
          { name: t("set.suppressReasoning"), desc: t("set.suppressReasoningDesc"), control: { type: "toggle", key: "suppressReasoning" } },
          { name: t("set.showTargetField"), desc: t("set.showTargetFieldDesc"), control: { type: "toggle", key: "showTargetField" } },
        ],
      },
    ];
    return defs as unknown as SettingDefinitionItem[];
  }

  private renderEndpoints(setting: Setting): void {
    buildEndpointList(settingBodyHost(setting), {
      list: this.plugin.settings.endpoints,
      setList: (next) => {
        this.plugin.settings.endpoints = next;
      },
      probe: (ep) => probeEndpoint(ep, 5000),
      commit: () => {
        void this.plugin.saveSettings().then(() => {
          this.plugin.resolver.invalidate();
          this.refreshUi();
        });
      },
    });
  }

  private renderModel(setting: Setting): void {
    const host = settingBodyHost(setting);
    const row = new Setting(host).setName(t("set.model")).setDesc(t("set.modelDesc"));
    row.addDropdown((d) => {
      d.addOption("", t("set.modelAuto"));
      for (const id of this.plugin.knownModels) d.addOption(id, id);
      d.setValue(this.plugin.settings.model);
      d.onChange((value) => {
        this.plugin.settings.model = value;
        void this.plugin.saveSettings();
      });
    });
    row.addExtraButton((b) =>
      b
        .setIcon("refresh-cw")
        .setTooltip(t("set.modelReload"))
        .onClick(() => {
          void this.plugin.reloadModels().then(() => {
            this.refreshUi();
          });
        }),
    );
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
      case "model":
        return s.model;
      case "timeoutMs":
        return s.timeoutMs;
      case "defaultScope":
        return s.defaultScope;
      case "sampleChars":
        return s.sampleChars;
      case "budgetMs":
        return s.budgetMs;
      case "confirmThreshold":
        return s.confirmThreshold;
      case "snapshotKeep":
        return s.snapshotKeep;
      case "suppressReasoning":
        return s.suppressReasoning;
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
      case "model":
        s.model = String(value);
        break;
      case "timeoutMs":
        s.timeoutMs = Math.max(1000, asInt(s.timeoutMs));
        break;
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
      case "snapshotKeep":
        s.snapshotKeep = Math.max(0, asInt(s.snapshotKeep));
        break;
      case "suppressReasoning":
        s.suppressReasoning = Boolean(value);
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
