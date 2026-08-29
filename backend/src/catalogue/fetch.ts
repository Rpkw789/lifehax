import type { HostLookup } from "./security.ts";
import { assertPublicHttpUrl } from "./security.ts";
import type { FetchedDocument } from "./snapshot.ts";

export type HttpTransport = (input: string, init?: RequestInit) => Promise<Response>;

const USER_AGENT = "Happy2Agent/1.0 (+https://happy2.example/agent)";

export class OriginFetcher {
  readonly #origin: string;
  readonly #lookup: HostLookup;
  readonly #transport: HttpTransport;

  constructor(origin: string, lookup: HostLookup, transport: HttpTransport = fetch) {
    this.#origin = new URL(origin).origin;
    this.#lookup = lookup;
    this.#transport = transport;
  }

  async get(rawUrl: string, signal?: AbortSignal): Promise<FetchedDocument> {
    let url = await this.#allowedUrl(rawUrl, "request");
    const started = performance.now();

    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const response = await this.#transport(url.href, {
        method: "GET",
        redirect: "manual",
        signal,
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.1",
          "user-agent": USER_AGENT,
        },
      });
      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("redirect response had no location");
        url = await this.#allowedUrl(new URL(location, url).href, "redirect");
        continue;
      }
      return {
        url: url.href,
        status: response.status,
        body: await response.text(),
        contentType: response.headers.get("content-type") ?? "",
        durationMs: Math.max(0, Math.round(performance.now() - started)),
      };
    }
    throw new Error("too many redirects");
  }

  async #allowedUrl(rawUrl: string, kind: "request" | "redirect"): Promise<URL> {
    const url = await assertPublicHttpUrl(rawUrl, this.#lookup);
    if (url.origin !== this.#origin) {
      throw new Error(kind === "redirect" ? "redirect left the submitted origin" : "request left the submitted origin");
    }
    return url;
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
