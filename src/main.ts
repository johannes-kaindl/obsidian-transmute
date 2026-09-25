import { Plugin, getLanguage, type WorkspaceLeaf } from "obsidian";
import { RuleClient, type CompleteResult } from "./core/llm/client";
import { TransmuteSession, type CompleteFeature } from "./core/session";
import { DEFAULT_SETTINGS, loadSettings, MAX_HITS, type TransmuteSettings } from "./core/settings";
import type { ChatMessage } from "./core/types";
import "./core/i18n/strings";
import { pickLang, setLang, t } from "./vendor/kit/i18n";
import type { EndpointConfig } from "./vendor/kit/endpoint_config";
import { findEndpointManager } from "./vendor/kit-obsidian/endpoint-source";
import { EndpointResolver } from "./obsidian/endpoint";
import { obsidianTransport, pingEndpoint } from "./obsidian/http";
import { readLabApi } from "./obsidian/lab";
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
      { manager: () => findEndpointManager(this.app), choice: () => this.settings.choice },
    );

    this.client = new RuleClient(obsidianTransport, () => ({
      endpoint: this.activeEndpoint.url,
      apiKey: this.activeEndpoint.apiKey,
      model: this.activeModel(),
      timeoutMs: this.settings.timeoutMs,
      suppressReasoning: this.settings.suppressReasoning,
    }));

    this.sessionInstance = new TransmuteSession(
      {
        complete: async (messages, feature, turnId) => {
          // Endpunkt einmal pro Session aufloesen, nicht pro Anfrage.
          const resolved = await this.resolver.resolve();
          if (resolved !== null) this.activeEndpoint = resolved;
          // Der Manager entscheidet allein — kein stiller Rueckfall auf einen alten Endpunkt.
          // Ein fehlender Schluessel liegt im Manager-Plugin, nicht in der lokalen Liste.
          else if (this.resolver.last?.kind === "manager") {
            return { ok: false, error: t(this.resolver.last.reason === "secret-missing" ? "error.secretMissing" : "error.managerNoEndpoint") } satisfies CompleteResult;
          }
          const endpoint = this.activeEndpoint;
          const started = Date.now();
          const res = await this.client.complete(messages);
          this.reportToLab({
            feature,
            model: this.activeModel(),
            endpointUrl: endpoint.url,
            apiKey: endpoint.apiKey,
            messages,
            result: res,
            latencyMs: Date.now() - started,
            turnId,
            promptTemplate: messages.find((m) => m.role === "system")?.content ?? "",
            contextPaths: this.currentNotePath(),
          });
          return res;
        },
        now: () => performance.now(),
        newTurnId: () => window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      () => ({ sampleChars: this.settings.sampleChars, budgetMs: this.settings.budgetMs, maxHits: MAX_HITS }),
    );

    this.registerView(
      VIEW_TYPE_TRANSMUTE,
      (leaf: WorkspaceLeaf) =>
        new TransmuteView(leaf, {
          session: () => this.sessionInstance,
          defaultScope: () => this.settings.defaultScope,
          showTargetField: () => this.settings.showTargetField,
          listModels: async () => {
            await this.reloadModels();
            return this.knownModels;
          },
          // Im Manager-Fall ist `settings.model` nur der Rueckfall fuer die lokale Liste — die
          // Modellwahl gehoert dann in `choice`, sonst aendert das Panel-Feld nichts.
          getModel: () => (findEndpointManager(this.app) !== null ? (this.settings.choice.model ?? "") : this.settings.model),
          setModel: (model: string) => {
            if (findEndpointManager(this.app) !== null) this.settings.choice = { ...this.settings.choice, model: model || undefined };
            else this.settings.model = model;
            void this.saveSettings();
          },
          getSuppressReasoning: () => this.settings.suppressReasoning,
          setSuppressReasoning: (value: boolean) => {
            this.settings.suppressReasoning = value;
            void this.saveSettings();
          },
          runOptions: () => ({
            sampleChars: this.settings.sampleChars,
            budgetMs: this.settings.budgetMs,
            maxHits: MAX_HITS,
          }),
          confirmThreshold: () => this.settings.confirmThreshold,
          snapshotKeep: () => this.settings.snapshotKeep,
          getPresets: () => this.settings.presets,
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

  private activeEndpoint: EndpointConfig = { url: "" };

  /** Modell fuer den naechsten Aufruf: mit Manager die aufgeloeste Schreibweise (Wahl →
   *  Standard des Endpunkts, Alias aufgeloest), sonst die lokale Einstellung wie bisher. */
  private activeModel(): string {
    const last = this.resolver.last;
    return last?.kind === "manager" ? last.sentModel : this.settings.model;
  }

  /** Die zurzeit bearbeitete Notiz, falls eine offen ist — fail-open: bleibt leer, greift
   *  der Ordner-Filter im Lab einfach nicht (llm-lab plugin_api.ts, contextPaths-Kommentar,
   *  Muster koda-agent). */
  private currentNotePath(): string[] {
    const path = this.app.workspace.getActiveFile()?.path;
    return path !== undefined ? [path] : [];
  }

  /** Meldet einen LLM-Aufruf ans llm-lab, falls installiert. Fire-and-forget und darf
   *  einen Lauf nie mitreissen — Muster koda-agent 004e329/vault-rag `reportToLab`. */
  private reportToLab(input: {
    feature: CompleteFeature;
    model: string;
    endpointUrl: string;
    apiKey?: string;
    messages: ChatMessage[];
    result: CompleteResult;
    latencyMs: number;
    turnId: string;
    promptTemplate: string;
    contextPaths: string[];
  }): void {
    try {
      const api = readLabApi(this.app);
      if (api === null) return;
      const id: unknown = api.log({
        plugin: "transmute",
        feature: input.feature,
        model: input.model,
        endpointUrl: input.endpointUrl,
        messages: input.messages,
        content: input.result.ok ? input.result.content : "",
        ...(input.result.ok && input.result.reasoning !== null ? { reasoning: input.result.reasoning } : {}),
        ...(input.result.ok && input.result.truncated ? { finishReason: "length" } : {}),
        latencyMs: input.latencyMs,
        ...(input.result.ok ? {} : { error: input.result.error }),
        ...(input.apiKey ? { secrets: [input.apiKey] } : {}),
        ...(input.contextPaths.length > 0 ? { contextPaths: input.contextPaths } : {}),
        ...(input.promptTemplate !== "" ? { promptTemplate: input.promptTemplate } : {}),
        turnId: input.turnId,
      });
      // Vertrag: log() gibt synchron eine id zurueck — ein fremdes Plugin bekommt trotzdem
      // keinen blinden Vorschuss (Muster vault-rag/koda-agent).
      void Promise.resolve(id).catch(() => undefined);
    } catch { /* Telemetrie darf einen Lauf nie mitreissen. */ }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async reloadModels(): Promise<void> {
    // Mit Manager entscheidet er allein; der lokale Rueckfall gilt nur ohne ihn.
    const managed = findEndpointManager(this.app) !== null;
    const resolved = (await this.resolver.resolve()) ?? (managed ? undefined : this.settings.endpoints[0]);
    if (!resolved || resolved.url.trim().length === 0) {
      this.knownModels = [];
      return;
    }
    this.knownModels = await this.client.listModels(resolved);
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
