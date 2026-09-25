// Muster: vim-dojo/src/llm/endpointResolver.ts, seit 0.6.0 ueber die Quellenwahl des Kits
// (endpoint-source, obsidian-kit 0.41.1). Das Kit macht bewusst genau einen Resolver-Durchlauf
// und ueberlaesst Caching dem Aufrufer — das hier ist der Aufrufer.
// Ein lokaler Endpunkt wandert mit dem Netz (localhost am Schreibtisch, LAN-IP unterwegs),
// deshalb einmal pro Session aufloesen statt vor jeder Anfrage neu zu pingen. Der Manager-Pfad
// wird dagegen NIE gecacht: der LLM Endpoint Manager cached sich selbst, und er kann jederzeit
// installiert, deaktiviert oder umgestellt werden.
import type { EndpointConfig } from "../vendor/kit/endpoint_config";
import {
  resolveEndpointSource,
  type EndpointChoice,
  type EndpointSourceResult,
  type LlmEndpointManagerApi,
} from "../vendor/kit/endpoint-source";

export type ResolverSource = {
  /** Bei JEDEM Aufruf frisch gelesen (findEndpointManager) — null, wenn nicht installiert. */
  manager: () => LlmEndpointManagerApi | null;
  choice: () => EndpointChoice;
};

const CALLER = "transmute";

export class EndpointResolver {
  private cached: EndpointConfig | null = null;
  /** Laufender Resolve, geteilt — damit gleichzeitige Aufrufer nicht mehrfach pingen. */
  private pending: Promise<EndpointConfig | null> | null = null;
  /** Ergebnis des letzten Durchlaufs (Quelle, Modell, Grund) — null vor dem ersten. */
  last: EndpointSourceResult | null = null;

  constructor(
    private readonly getEndpoints: () => EndpointConfig[],
    private readonly ping: (cfg: EndpointConfig) => Promise<boolean>,
    private readonly source?: ResolverSource,
  ) {}

  /** Erster erreichbarer Endpunkt samt seinem Schluessel, sonst null. Lokal gecacht bis
   *  invalidate(); ein Fehlschlag wird NICHT gecacht — der naechste Versuch probiert erneut. */
  async resolve(): Promise<EndpointConfig | null> {
    const manager = this.source?.manager() ?? null;
    if (manager === null && this.cached !== null) return this.cached;
    if (this.pending) return this.pending;
    // Eine Modellwahl des Managers gilt nur dort: nach dem Entfernen des Managers darf ein
    // altes `choice.model` das Modell der lokalen Einstellungen nicht still uebersteuern.
    const choice = manager !== null ? this.source?.choice() : undefined;
    this.pending = resolveEndpointSource(
      {
        manager,
        local: this.getEndpoints(),
        capability: "chat",
        caller: CALLER,
        ...(choice !== undefined ? { choice } : {}),
      },
      this.ping,
    )
      .then((r) => {
        this.last = r;
        if (r.kind === "local") this.cached = r.config;
        return r.config;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  invalidate(): void {
    this.cached = null;
  }
}
