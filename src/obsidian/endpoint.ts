// Muster: vim-dojo/src/llm/endpointResolver.ts. Das Kit macht bewusst genau einen
// Resolver-Durchlauf und ueberlaesst Caching dem Aufrufer — das hier ist der Aufrufer.
// Ein lokaler Endpunkt wandert mit dem Netz (localhost am Schreibtisch, LAN-IP unterwegs),
// deshalb einmal pro Session aufloesen statt vor jeder Anfrage neu zu pingen.
import { resolveActiveEndpointConfig, type EndpointConfig } from "../vendor/kit/endpoint_config";

export class EndpointResolver {
  private cached: EndpointConfig | null = null;
  /** Laufender Resolve, geteilt — damit gleichzeitige Aufrufer nicht mehrfach pingen. */
  private pending: Promise<EndpointConfig | null> | null = null;

  constructor(
    private readonly getEndpoints: () => EndpointConfig[],
    private readonly ping: (cfg: EndpointConfig) => Promise<boolean>,
  ) {}

  /** Erster erreichbarer Endpunkt samt seinem Schluessel, sonst null. Gecacht bis invalidate().
   *  Ein Fehlschlag wird NICHT gecacht — der naechste Versuch probiert erneut. */
  async resolve(): Promise<EndpointConfig | null> {
    if (this.cached !== null) return this.cached;
    if (this.pending) return this.pending;
    this.pending = resolveActiveEndpointConfig(this.getEndpoints(), this.ping)
      .then((ep) => {
        this.cached = ep;
        return ep;
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
