import type { HostLookup } from "./security.ts";
import { assertPublicHttpUrl } from "./security.ts";
import type { FetchedDocument } from "./snapshot.ts";

export type HttpTransport = (input: string, init?: RequestInit) => Promise<Response>;

interface RateLimitOptions {
  minIntervalMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const USER_AGENT = "Happy2Agent/1.0 (+https://happy2.example/agent)";

export class OriginFetcher {
  readonly #origin: string;
  readonly #lookup: HostLookup;
  readonly #transport: HttpTransport;
  readonly #rateLimit: RateLimitOptions;
  #nextStart = 0;
  #gate: Promise<void> = Promise.resolve();

  constructor(
    origin: string,
    lookup: HostLookup,
    transport: HttpTransport = fetch,
    rateLimit: RateLimitOptions = {
      minIntervalMs: 100,
      now: () => performance.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
  ) {
    this.#origin = new URL(origin).origin;
    this.#lookup = lookup;
    this.#transport = transport;
    this.#rateLimit = rateLimit;
  }

  async get(rawUrl: string, signal?: AbortSignal): Promise<FetchedDocument> {
    let url = await this.#allowedUrl(rawUrl, "request");
    const started = performance.now();

    for (let redirects = 0; redirects <= 5; redirects += 1) {
      await this.#waitForSlot();
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

  async #waitForSlot(): Promise<void> {
    const turn = this.#gate.then(async () => {
      const delay = Math.max(0, this.#nextStart - this.#rateLimit.now());
      if (delay > 0) await this.#rateLimit.sleep(delay);
      this.#nextStart = this.#rateLimit.now() + this.#rateLimit.minIntervalMs;
    });
    this.#gate = turn.catch(() => undefined);
    await turn;
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
