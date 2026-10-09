import { Plugin, getLanguage, type WorkspaceLeaf } from "obsidian";
import { toCompleteResult, type CompleteResult } from "./core/llm/client";
import { TransmuteSession, type CompleteFeature } from "./core/session";
import { DEFAULT_SETTINGS, loadSettings, MAX_HITS, type TransmuteSettings } from "./core/settings";
import type { ChatMessage } from "./core/types";
import "./core/i18n/strings";
import { getLang, pickLang, setLang, t } from "./vendor/kit/i18n";
import { onLevelFor, thinkingFor } from "./vendor/kit/sampling-profiles";
import { findEndpointManager } from "./vendor/kit-obsidian/endpoint-source";
import { createLlmConnection, type LlmConnection, type LlmResult } from "./vendor/kit-obsidian/llm-connection";
import { createShortcutsChatTransport, requestUrlTransport } from "./vendor/kit-obsidian/chat-transport";
import { createShortcutsBridge, type ShortcutsBridge } from "./vendor/kit-obsidian/shortcuts-bridge";
import { logToLab } from "./vendor/kit-obsidian/lab-client";
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
  /** Die ganze LLM-Anbindung: Endpunkt-Quelle, Modellliste, Anfrage-Parameter, Client, Settings-Abschnitte. */
  llm!: LlmConnection;
  /** Bruecke zu Apples on-device-Modell (Kurzbefehl) — im Konsumenten gebaut, der Manager-Vertrag exponiert keine. */
  private shortcutsBridge!: ShortcutsBridge;
  private labMismatchWarned = false;
  private sessionInstance!: TransmuteSession;

  async onload(): Promise<void> {
    setLang(pickLang(safeGetLanguage()));
    this.settings = loadSettings(await this.loadData());

    this.shortcutsBridge = createShortcutsBridge(this, { protocolAction: "transmute-shortcut" });
    this.llm = createLlmConnection({
      app: this.app,
      pluginId: this.manifest.id,
      caller: "transmute",
      capability: "chat",
      // Die Antwort ist ein JSON-Vertrag (Regel, Ersetzung, Erklaerung): Modus „structured“.
      mode: "structured",
      // Ohne Stream, wie bisher: `requestUrl` (Hauptprozess, kein Origin, keine CORS-Weigerung) statt
      // des XHR-Streams; der Kurzbefehl (Apple Intelligence) liefert ohnehin eine volle Completion.
      stream: false,
      // Die Antwort wird als JSON aus `content` geparst: ein geschwaerzter, mehrzeiliger Platzhalter
      // (PEM) muss JSON-escaped zurueckkommen, sonst waere das JSON nach der Restaurierung ungueltig.
      restoreContent: "json",
      transports: {
        http: requestUrlTransport,
        fallback: "none",
        shortcuts: (shortcut) => createShortcutsChatTransport({ bridge: this.shortcutsBridge, shortcut }),
      },
      // „Am Limit ohne Text“ ist hier eine eigene Fehlerart (error.truncatedEmpty), kein Ergebnis.
      truncated: "error",
      lang: () => getLang(),
      getSettings: () => ({
        endpoints: this.settings.endpoints,
        choice: this.settings.choice,
        model: this.settings.model,
        request: this.settings.request,
      }),
      // Erst in die Settings schreiben, dann speichern: die Endpunkt-Liste liest ihre Zeilen danach zurueck.
      persist: (patch) => {
        Object.assign(this.settings, patch);
        return this.saveSettings();
      },
    });

    this.sessionInstance = new TransmuteSession(
      {
        complete: async (messages, feature, turnId) => {
          const started = Date.now();
          // Eine Regel soll bei gleicher Eingabe gleich ausfallen: Temperatur 0 je Aufruf, das Profil gaebe 0.1.
          const r = await this.llm.complete({ messages }, { overrides: { temperature: 0 } });
          const res = this.toResult(r);
          this.reportToLab({
            feature,
            result: res,
            source: r.source,
            messages,
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
          listModels: async () => (await this.llm.models({ force: true })).models,
          // Im Manager-Fall ist `settings.model` nur der Rueckfall fuer die lokale Liste — die
          // Modellwahl gehoert dann in `choice`, sonst aendert das Panel-Feld nichts.
          getModel: () => (findEndpointManager(this.app) !== null ? (this.settings.choice.model ?? "") : this.settings.model),
          setModel: (model: string) => {
            if (findEndpointManager(this.app) !== null) this.settings.choice = { ...this.settings.choice, model: model || undefined };
            else this.settings.model = model;
            void this.saveSettings();
          },
          // Der Schalter im Panel bedient die Denkstufe des Modus „structured“ (Settings → Request):
          // aus = „off“, an = die zuletzt gewaehlte Stufe.
          getSuppressReasoning: () => thinkingFor(this.settings.request, "structured") === "off",
          setSuppressReasoning: (value: boolean) => {
            const req = this.settings.request;
            const current = thinkingFor(req, "structured");
            if (current !== "off") req.lastOnLevel.structured = current;
            req.thinking.structured = value ? "off" : onLevelFor(req, "structured");
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

  /** `LlmResult` der Verbindung → `CompleteResult`. Ohne Endpunkt: mit Manager nennt die Meldung den
   *  Manager (Schluessel fehlt oder kein nutzbarer Endpunkt), ohne ihn die lokale Liste. */
  private toResult(r: LlmResult): CompleteResult {
    const shortcuts = r.source.transport === "shortcuts";
    if (!r.ok && r.kind === "no-endpoint" && !shortcuts) {
      if (r.source.kind === "manager") {
        return { ok: false, error: t(r.detail === "secret-missing" ? "error.secretMissing" : "error.managerNoEndpoint") };
      }
      return { ok: false, error: t("error.noEndpoint") };
    }
    return toCompleteResult(r, shortcuts);
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
    result: CompleteResult;
    source: LlmResult["source"];
    messages: ChatMessage[];
    latencyMs: number;
    turnId: string;
    promptTemplate: string;
    contextPaths: string[];
  }): void {
    const apiKey = input.source.config?.apiKey;
    const lab = logToLab(this.app, {
      plugin: "transmute",
      feature: input.feature,
      model: input.source.sentModel || input.source.model,
      endpointUrl: input.source.config?.url ?? "",
      messages: input.messages,
      content: input.result.ok ? input.result.content : "",
      ...(input.result.ok && input.result.reasoning !== null ? { reasoning: input.result.reasoning } : {}),
      ...(input.result.ok && input.result.truncated ? { finishReason: "length" } : {}),
      latencyMs: input.latencyMs,
      ...(input.result.ok ? {} : { error: input.result.error }),
      ...(apiKey ? { secrets: [apiKey] } : {}),
      ...(input.contextPaths.length > 0 ? { contextPaths: input.contextPaths } : {}),
      ...(input.promptTemplate !== "" ? { promptTemplate: input.promptTemplate } : {}),
      turnId: input.turnId,
    });
    // Ein Lab, das da ist, aber nicht antwortet wie erwartet (andere apiVersion), sah bisher aus
    // wie „kein Lab“ — einmal je Sitzung melden.
    if (!lab.ok && lab.reason === "version-mismatch" && !this.labMismatchWarned) {
      this.labMismatchWarned = true;
      console.warn(`Transmute: ${lab.detail} — Aufzeichnung im Lab ist aus`);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
