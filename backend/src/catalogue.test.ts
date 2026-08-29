import { afterEach, describe, expect, test } from "bun:test";
import type { Fetched } from "./http.ts";
import {
  observeSitemap,
  productUrlsFromSitemap,
  sitemapsDeclaredIn,
} from "./catalogue";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Serves only the URLs given; everything else 404s, as a real host would. */
function serve(pages: Record<string, string>): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    asked.push(url);
    const body = pages[url];
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(body, { status: 200, headers: { "content-type": "application/xml" } });
  }) as typeof fetch;
  return asked;
}

const urlset = (...locs: string[]) =>
  `<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;

describe("productUrlsFromSitemap", () => {
  test("uses the sitemap robots.txt declares when /sitemap.xml is absent", async () => {
    // Bose's shape: no /sitemap.xml, but robots names sitemap_index.xml.
    serve({
      "https://shop.test/robots.txt":
        "User-agent: *\nSitemap: https://shop.test/sitemap_index.xml\n",
      "https://shop.test/sitemap_index.xml": urlset("https://shop.test/sitemap_0-product.xml"),
      "https://shop.test/sitemap_0-product.xml": urlset(
        "https://shop.test/products/one",
        "https://shop.test/products/two",
      ),
    });

    expect(await productUrlsFromSitemap("https://shop.test", "")).toEqual([
      "https://shop.test/products/one",
      "https://shop.test/products/two",
    ]);
  });

  test("still finds /sitemap.xml when robots declares nothing", async () => {
    serve({
      "https://shop.test/robots.txt": "User-agent: *\nDisallow:\n",
      "https://shop.test/sitemap.xml": urlset("https://shop.test/products/one"),
    });

    expect(await productUrlsFromSitemap("https://shop.test", "")).toEqual([
      "https://shop.test/products/one",
    ]);
  });

  test("falls back to /sitemap.xml when robots.txt itself 404s", async () => {
    serve({ "https://shop.test/sitemap.xml": urlset("https://shop.test/products/one") });

    expect(await productUrlsFromSitemap("https://shop.test", "")).toEqual([
      "https://shop.test/products/one",
    ]);
  });

  test("an explicit override still wins over robots", async () => {
    const asked = serve({
      "https://shop.test/robots.txt":
        "Sitemap: https://shop.test/sitemap_index.xml\n",
      "https://shop.test/mine.xml": urlset("https://shop.test/products/mine"),
    });

    expect(await productUrlsFromSitemap("https://shop.test", "/mine.xml")).toEqual([
      "https://shop.test/products/mine",
    ]);
    // The override is explicit, so robots is not worth a request.
    expect(asked.some((u) => u.endsWith("/robots.txt"))).toBe(false);
  });

  test("tries the next declared sitemap when the first yields nothing", async () => {
    serve({
      "https://shop.test/robots.txt":
        "Sitemap: https://shop.test/empty.xml\nSitemap: https://shop.test/real.xml\n",
      "https://shop.test/empty.xml": urlset(),
      "https://shop.test/real.xml": urlset("https://shop.test/products/one"),
    });

    expect(await productUrlsFromSitemap("https://shop.test", "")).toEqual([
      "https://shop.test/products/one",
    ]);
  });

  test("returns nothing, without throwing, when the host serves neither", async () => {
    serve({});
    expect(await productUrlsFromSitemap("https://shop.test", "")).toEqual([]);
  });

  test("trusts a sitemap the site itself names as products, whatever the url shape", async () => {
    // Bose's real shape: /p/... paths, which no /products/ pattern matches.
    // The child sitemap is called product, so its contents are products.
    serve({
      "https://shop.test/robots.txt": "Sitemap: https://shop.test/sitemap_index.xml\n",
      "https://shop.test/sitemap_index.xml": urlset(
        "https://shop.test/sitemap_0-product.xml",
        "https://shop.test/sitemap_1-category.xml",
      ),
      "https://shop.test/sitemap_0-product.xml": urlset(
        "https://shop.test/p/product-sets/SET-A.html",
        "https://shop.test/p/headphones/QC-45.html",
      ),
    });

    expect(await productUrlsFromSitemap("https://shop.test", "")).toEqual([
      "https://shop.test/p/product-sets/SET-A.html",
      "https://shop.test/p/headphones/QC-45.html",
    ]);
  });

  test("still filters a mixed sitemap that is not declared as products", async () => {
    serve({
      "https://shop.test/sitemap.xml": urlset(
        "https://shop.test/products/one",
        "https://shop.test/about",
        "https://shop.test/blog/post",
      ),
    });

    expect(await productUrlsFromSitemap("https://shop.test", "")).toEqual([
      "https://shop.test/products/one",
    ]);
  });

  test("ignores a Sitemap: line that is not a usable url", async () => {
    serve({
      "https://shop.test/robots.txt": "Sitemap:\nSitemap: not a url\n",
      "https://shop.test/sitemap.xml": urlset("https://shop.test/products/one"),
    });

    expect(await productUrlsFromSitemap("https://shop.test", "")).toEqual([
      "https://shop.test/products/one",
    ]);
  });
});

describe("sitemapsDeclaredIn", () => {
  test("reads every Sitemap line, in the order the site gave them", () => {
    expect(
      sitemapsDeclaredIn(
        "User-agent: *\nSitemap: https://shop.test/a.xml\nDisallow: /admin\nSitemap: https://shop.test/b.xml\n",
        "https://shop.test",
      ),
    ).toEqual(["https://shop.test/a.xml", "https://shop.test/b.xml"]);
  });

  test("is case and whitespace insensitive, as robots.txt is in practice", () => {
    expect(sitemapsDeclaredIn("  SITEMAP:   /s.xml  ", "https://shop.test")).toEqual([
      "https://shop.test/s.xml",
    ]);
  });

  test("resolves a relative path against the store origin", () => {
    expect(sitemapsDeclaredIn("Sitemap: /deep/s.xml", "https://shop.test")).toEqual([
      "https://shop.test/deep/s.xml",
    ]);
  });

  test("skips a Sitemap line with no value", () => {
    expect(sitemapsDeclaredIn("Sitemap:\nSitemap: /ok.xml", "https://shop.test")).toEqual([
      "https://shop.test/ok.xml",
    ]);
  });

  test("keeps a junk value as a relative path rather than throwing", () => {
    // new URL() resolves almost anything against an origin, so junk becomes a
    // path that simply 404s and falls through to the next candidate. Cheaper
    // than validating, and it cannot lose a real sitemap listed after it.
    expect(sitemapsDeclaredIn("Sitemap: ::::\nSitemap: /ok.xml", "https://shop.test")).toEqual([
      "https://shop.test/::::",
      "https://shop.test/ok.xml",
    ]);
  });

  test("returns nothing for a robots.txt that declares none", () => {
    expect(sitemapsDeclaredIn("User-agent: *\nDisallow:", "https://shop.test")).toEqual([]);
  });
});

test("observes exact non-category URL membership from a complete urlset", async () => {
  const result = await observeSitemap(
    "https://example.com",
    "",
    async (url) => fetched(url, 200, [
      "<urlset>",
      "<url><loc>https://example.com/items/primary</loc></url>",
      "<url><loc>https://example.com/help</loc></url>",
      "</urlset>",
    ].join("")),
  );

  expect(result.observedUrls).toContain("https://example.com/items/primary");
  expect(result.complete).toBe(true);
});

test("does not claim complete membership when a sitemap child fails", async () => {
  const result = await observeSitemap(
    "https://example.com",
    "",
    async (url) => url.endsWith("/sitemap.xml")
      ? fetched(url, 200, [
          "<sitemapindex>",
          "<sitemap><loc>https://example.com/one.xml</loc></sitemap>",
          "<sitemap><loc>https://example.com/two.xml</loc></sitemap>",
          "</sitemapindex>",
        ].join(""))
      : url.endsWith("/one.xml")
        ? fetched(url, 200, "<urlset><url><loc>https://example.com/items/primary</loc></url></urlset>")
        : fetched(url, 500, ""),
  );

  expect(result.observedUrls).toContain("https://example.com/items/primary");
  expect(result.complete).toBe(false);
});

function fetched(url: string, status: number, body: string): Fetched {
  return {
    url,
    status,
    ok: status >= 200 && status < 300,
    body,
    error: null,
    finalUrl: url,
    truncated: false,
  };
}
