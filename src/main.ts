import { Plugin, getLanguage, type WorkspaceLeaf } from "obsidian";
import { RuleClient } from "./core/llm/client";
import { TransmuteSession } from "./core/session";
import { DEFAULT_SETTINGS, loadSettings, type TransmuteSettings } from "./core/settings";
import "./core/i18n/strings";
import { pickLang, setLang } from "./vendor/kit/i18n";
import { EndpointResolver } from "./obsidian/endpoint";
import { obsidianTransport, pingEndpoint } from "./obsidian/http";
import { TransmuteSettingTab } from "./obsidian/settings-tab";
import { TransmuteView, VIEW_TYPE_TRANSMUTE } from "./obsidian/view";

/** getLanguage() gibt es ab Obsidian 1.8 — defensiv gewrappt, damit eine fehlende oder
 *  umbenannte API nie den onload sprengt (Muster: apple-health). */
function safeGetLanguage(): string | null {
  try {
    return getLanguage();
  } catch {
    return null;
  }
}

export default class TransmutePlugin extends Plugin {
  settings: TransmuteSettings = DEFAULT_SETTINGS;
  resolver!: EndpointResolver;
  knownModels: string[] = [];
  private client!: RuleClient;
  private sessionInstance!: TransmuteSession;

  async onload(): Promise<void> {
    setLang(pickLang(safeGetLanguage()));
    this.settings = loadSettings(await this.loadData());

    this.resolver = new EndpointResolver(
      () => this.settings.endpoints,
      (endpoint) => pingEndpoint(endpoint, 5000),
    );

    this.client = new RuleClient(obsidianTransport, () => ({
      endpoint: this.activeEndpoint,
      model: this.settings.model,
      timeoutMs: this.settings.timeoutMs,
      suppressReasoning: this.settings.suppressReasoning,
    }));

    this.sessionInstance = new TransmuteSession(
      {
        complete: async (messages) => {
          // Endpunkt einmal pro Session aufloesen, nicht pro Anfrage.
          const resolved = await this.resolver.resolve();
          if (resolved !== null) this.activeEndpoint = resolved;
          return this.client.complete(messages);
        },
        now: () => performance.now(),
      },
      () => ({ sampleChars: this.settings.sampleChars, budgetMs: this.settings.budgetMs }),
    );

    this.registerView(
      VIEW_TYPE_TRANSMUTE,
      (leaf: WorkspaceLeaf) =>
        new TransmuteView(leaf, {
          session: () => this.sessionInstance,
          defaultScope: () => this.settings.defaultScope,
        }),
    );

    this.addRibbonIcon("replace", "Transmute", () => {
      void this.activatePanel();
    });

    // Ohne Default-Hotkey, ID ohne Plugin-Praefix, sentence-case (PROF-OBS-14).
    this.addCommand({
      id: "open-panel",
      name: "Open panel",
      callback: () => {
        void this.activatePanel();
      },
    });

    this.addSettingTab(new TransmuteSettingTab(this.app, this));
  }

  /** Kein Leaf-Detach hier (PROF-OBS-13) — Obsidian raeumt registrierte Views selbst ab. */
  onunload(): void {
    // nichts zu tun
  }

  private activeEndpoint = "";

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async reloadModels(): Promise<void> {
    const endpoint = (await this.resolver.resolve()) ?? this.settings.endpoints[0] ?? "";
    if (endpoint.length === 0) {
      this.knownModels = [];
      return;
    }
    this.knownModels = await this.client.listModels(endpoint);
  }

  private async activatePanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TRANSMUTE);
    if (existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf === null) return;
    await leaf.setViewState({ type: VIEW_TYPE_TRANSMUTE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
}
