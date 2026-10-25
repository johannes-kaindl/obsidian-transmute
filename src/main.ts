import { Plugin, getLanguage, type WorkspaceLeaf } from "obsidian";
import { toCompleteResult, type CompleteResult } from "./core/llm/client";
import { TransmuteSession, type CompleteFeature } from "./core/session";
import { DEFAULT_SETTINGS, loadSettings, MAX_HITS, type TransmuteSettings } from "./core/settings";
import type { ChatMessage } from "./core/types";
import "./core/i18n/strings";
import { getLang, pickLang, setLang, t } from "./vendor/kit/i18n";
import { onLevelFor, thinkingFor, withThinkingLevel } from "./vendor/kit/sampling-profiles";
import { noEndpointText, resolveLlmConnectionStrings } from "./vendor/kit-obsidian/llm-connection-strings";
import { createLlmConnection, type LlmConnection, type LlmResult } from "./vendor/kit-obsidian/llm-connection";
import { redactExchange } from "./vendor/kit-obsidian/chat-client";
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
    const stored: unknown = await this.loadData();
    this.settings = loadSettings(stored);
    // Das globale Modell ist in die Zeilen gewandert (loadSettings): einmal speichern, damit der Altschluessel
    // aus der data.json verschwindet.
    if (typeof stored === "object" && stored !== null && "model" in stored) await this.saveSettings();

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
        // Opt-in auf Claude: ein Manager-Endpunkt mit provider „anthropic“ wird dem Plugin angeboten, die Anfrage geht an die
        // Messages-API von Anthropic (über `http` oben, ohne Strom). Ohne diese Zeile sieht das Plugin keinen.
        anthropic: true,
      },
      // „Am Limit ohne Text“ ist hier eine eigene Fehlerart (error.truncatedEmpty), kein Ergebnis.
      truncated: "error",
      lang: () => getLang(),
      getSettings: () => ({
        endpoints: this.settings.endpoints,
        choice: this.settings.choice,
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
          // Auf Claude entfaellt das: die API lehnt `temperature` ab (Modelle ab 4.7), der Kit sendet den Wert dort nicht und
          // meldet ihn in „Letzte Anfrage“ als `override-dropped`. Dort gilt die Absicht „gleiche Eingabe, gleiche Regel“ nicht.
          const r = await this.llm.complete({ messages }, { overrides: { temperature: 0 } });
          const res = this.toResult(r);
          this.reportToLab({
            feature,
            result: res,
            source: r.source,
            messages,
            latencyMs: Date.now() - started,
            turnId,
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
          // Die Verbindung gehoert der Modellzeile (Kit): Liste, Wahl (mit Manager `choice.model`, ohne Manager das Modell der aktiven Zeile;
          // „Server waehlt“ ist `setModel("")`) und die Familie fuer den Denk-Knopf.
          llm: this.llm,
          // Der Denk-Knopf bedient die Denkstufe des Modus „structured“ (Settings → Request): aus = „off“, an = die zuletzt gewaehlte Stufe.
          thinking: {
            current: () => thinkingFor(this.settings.request, "structured"),
            onLevel: () => onLevelFor(this.settings.request, "structured"),
            setLevel: async (level) => {
              this.settings.request = withThinkingLevel(this.settings.request, "structured", level);
              await this.saveSettings();
            },
          },
          runOptions: () => ({
            sampleChars: this.settings.sampleChars,
            budgetMs: this.settings.budgetMs,
            maxHits: MAX_HITS,
          }),
          confirmThreshold: () => this.settings.confirmThreshold,
          getPresets: () => this.settings.presets,
        }),
    );

    this.addRibbonIcon("replace", t("main.ribbon"), () => {
      void this.activatePanel();
    });

    // Ohne Default-Hotkey, ID ohne Plugin-Praefix, sentence-case (PROF-OBS-14).
    this.addCommand({
      id: "open-panel",
      name: t("main.openPanel"),
      callback: () => {
        void this.activatePanel();
      },
    });
    this.addCommand({
      id: "reset-panel",
      name: t("main.resetPanel"),
      checkCallback: (checking) => {
        const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_TRANSMUTE)[0]?.view;
        if (!(view instanceof TransmuteView)) return false;
        if (!checking) void view.resetWithConfirm();
        return true;
      },
    });

    this.addSettingTab(new TransmuteSettingTab(this.app, this));
  }

  /** Kein Leaf-Detach hier (PROF-OBS-13) — Obsidian raeumt registrierte Views selbst ab. */
  onunload(): void {
    // nichts zu tun
  }

  /** `LlmResult` der Verbindung → `CompleteResult`. Ohne Endpunkt: mit Manager nennt die Meldung den Grund, den der
   *  Manager meldet (Kit-Text je Code: kein Endpunkt, Wahl weg, abgeschaltet, Schluessel fehlt, nicht erreichbar), ohne
   *  ihn die lokale Liste. */
  private toResult(r: LlmResult): CompleteResult {
    const shortcuts = r.source.transport === "shortcuts";
    if (!r.ok && r.kind === "no-endpoint" && !shortcuts) {
      // Quelle Manager: der Text zum Grund; lokale Liste: der Kit-Text (Kit 0.61.0 `noEndpointText`).
      return { ok: false, error: noEndpointText(resolveLlmConnectionStrings({ lang: getLang() }), r.source, r.detail) };
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
    contextPaths: string[];
  }): void {
    const apiKey = input.source.config?.apiKey;
    // Das Lab bekommt den GESENDETEN Text (Platzhalter), nicht die Originale — das Log soll dem Draht entsprechen.
    const sent = redactExchange({
      messages: input.messages,
      answer: input.result.ok ? input.result.content : "",
      reasoning: input.result.ok ? input.result.reasoning : null,
    });
    const promptTemplate = sent.messages.find((m) => m.role === "system")?.content ?? "";
    const lab = logToLab(this.app, {
      plugin: "transmute",
      feature: input.feature,
      model: input.source.sentModel || input.source.model,
      endpointUrl: input.source.config?.url ?? "",
      messages: sent.messages,
      content: sent.answer,
      ...(sent.reasoning !== null ? { reasoning: sent.reasoning } : {}),
      ...(input.result.ok && input.result.truncated ? { finishReason: "length" } : {}),
      latencyMs: input.latencyMs,
      ...(input.result.ok ? {} : { error: input.result.error }),
      ...(apiKey ? { secrets: [apiKey] } : {}),
      ...(input.contextPaths.length > 0 ? { contextPaths: input.contextPaths } : {}),
      ...(promptTemplate !== "" ? { promptTemplate } : {}),
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
