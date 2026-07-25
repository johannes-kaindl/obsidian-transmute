import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import type TransmutePlugin from "../main";
import type { ScopeKind } from "../core/settings";
import { t } from "../vendor/kit/i18n";
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
              options: { file: t("view.scope.file"), selection: t("view.scope.selection") },
            },
          },
          { name: t("set.sampleChars"), desc: t("set.sampleCharsDesc"), control: { type: "number", key: "sampleChars", min: 200 } },
          { name: t("set.budgetMs"), desc: t("set.budgetMsDesc"), control: { type: "number", key: "budgetMs", min: 200 } },
          { name: t("set.suppressReasoning"), desc: t("set.suppressReasoningDesc"), control: { type: "toggle", key: "suppressReasoning" } },
        ],
      },
    ];
    return defs as unknown as SettingDefinitionItem[];
  }

  /** Der Walker uebergibt genau eine Setting-Zeile, unsere Bloecke zeichnen mehrere.
   *  settingEl traegt Obsidians setting-item-Klasse (flex-Row mit genau zwei Kindern) —
   *  ohne das Strippen wuerden verschachtelte Zeilen zu flex-Kindern statt zu stapeln. */
  private hostFor(setting: Setting): HTMLElement {
    setting.settingEl.empty();
    setting.settingEl.removeClass("setting-item");
    setting.settingEl.addClass("transmute-settings-host");
    return setting.settingEl;
  }

  private renderEndpoints(setting: Setting): void {
    buildEndpointList(this.hostFor(setting), {
      list: this.plugin.settings.endpoints,
      setList: (next) => {
        this.plugin.settings.endpoints = next;
      },
      probe: (endpoint) => probeEndpoint(endpoint, 5000),
      commit: () => {
        void this.plugin.saveSettings().then(() => {
          this.plugin.resolver.invalidate();
          this.refreshUi();
        });
      },
    });
  }

  private renderModel(setting: Setting): void {
    const host = this.hostFor(setting);
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
    // update() gibt es erst ab 1.13 — Feature-Check statt Cast auf eine unbekannte API.
    const self = this as unknown as { update?: () => void };
    if (typeof self.update === "function") self.update();
    else this.renderImperative();
  }

  /** Walkt DIESELBEN Definitionen mit der klassischen Setting-API. */
  private renderImperative(): void {
    const { containerEl } = this;
    containerEl.empty();

    for (const raw of this.getSettingDefinitions()) {
      const group = raw as unknown as GroupDef;
      if (group.type !== "group") continue;
      if (group.heading !== undefined) new Setting(containerEl).setName(group.heading).setHeading();

      for (const item of group.items ?? []) {
        const setting = new Setting(containerEl);
        if (item.name !== undefined) setting.setName(item.name);
        if (item.desc !== undefined) setting.setDesc(item.desc);
        if (item.render) {
          item.render(setting);
          continue;
        }
        const control = item.control;
        if (!control) continue;
        this.renderControl(setting, control);
      }
    }
  }

  private renderControl(setting: Setting, control: ControlDef): void {
    const value = this.getControlValue(control.key);
    const current = value === undefined ? "" : String(value);
    switch (control.type) {
      case "dropdown":
        setting.addDropdown((d) => {
          for (const [key, label] of Object.entries(control.options ?? {})) d.addOption(key, label);
          d.setValue(current);
          d.onChange((value) => {
            this.setControlValue(control.key, value);
          });
        });
        break;
      case "toggle":
        setting.addToggle((toggle) => {
          toggle.setValue(value === true);
          toggle.onChange((value) => {
            this.setControlValue(control.key, value);
          });
        });
        break;
      case "number":
        setting.addText((text) => {
          text.inputEl.type = "number";
          text.setValue(current);
          text.onChange((value) => {
            this.setControlValue(control.key, value);
          });
        });
        break;
      default:
        setting.addText((text) => {
          text.setValue(current);
          if (control.placeholder !== undefined) text.setPlaceholder(control.placeholder);
          text.onChange((value) => {
            this.setControlValue(control.key, value);
          });
        });
    }
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
      case "suppressReasoning":
        return s.suppressReasoning;
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
      case "defaultScope":
        s.defaultScope = String(value) === "selection" ? "selection" : ("file" satisfies ScopeKind);
        break;
      case "sampleChars":
        s.sampleChars = Math.max(200, asInt(s.sampleChars));
        break;
      case "budgetMs":
        s.budgetMs = Math.max(200, asInt(s.budgetMs));
        break;
      case "suppressReasoning":
        s.suppressReasoning = Boolean(value);
        break;
      default:
        return;
    }
    void this.plugin.saveSettings();
  }
}
