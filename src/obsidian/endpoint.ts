// Muster: vim-dojo/src/llm/endpointResolver.ts. Das Kit macht bewusst genau einen
// Resolver-Durchlauf und ueberlaesst Caching dem Aufrufer — das hier ist der Aufrufer.
// Ein lokaler Endpunkt wandert mit dem Netz (localhost am Schreibtisch, LAN-IP unterwegs),
// deshalb einmal pro Session aufloesen statt vor jeder Anfrage neu zu pingen.
import { resolveActiveEndpoint } from "../vendor/kit/endpoint";

export class EndpointResolver {
  private cached: string | null = null;
  /** Laufender Resolve, geteilt — damit gleichzeitige Aufrufer nicht mehrfach pingen. */
  private pending: Promise<string | null> | null = null;

  constructor(
    private readonly getEndpoints: () => string[],
    private readonly ping: (endpoint: string) => Promise<boolean>,
  ) {}

  /** Erster erreichbarer Endpunkt, sonst null. Gecacht bis invalidate().
   *  Ein Fehlschlag wird NICHT gecacht — der naechste Versuch probiert erneut. */
  async resolve(): Promise<string | null> {
    if (this.cached !== null) return this.cached;
    if (this.pending) return this.pending;
    this.pending = resolveActiveEndpoint(this.getEndpoints(), this.ping)
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
