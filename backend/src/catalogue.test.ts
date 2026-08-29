import { afterEach, describe, expect, test } from "bun:test";
import type { Fetched } from "./http.ts";
import {
  isProductUrl,
  observeSitemap,
  productUrlsFromSitemap,
  sitemapsDeclaredIn,
} from "./catalogue";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * Serves only the URLs given; everything else 404s, as a real host would.
 *
 * A `Uint8Array` body is served as-is with no `content-encoding`, which is how
 * a real host serves a `.xml.gz` sitemap — the bytes arrive compressed and
 * `fetch` does not unwrap them.
 */
function serve(pages: Record<string, string | Uint8Array>): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    asked.push(url);
    const body = pages[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    return typeof body === "string"
      ? new Response(body, { status: 200, headers: { "content-type": "application/xml" } })
      : new Response(body.buffer as ArrayBuffer, {
          status: 200,
          headers: { "content-type": "application/gzip" },
        });
  }) as typeof fetch;
  return asked;
}

/** A sitemap as a real host serves it gzipped: raw bytes, no content-encoding. */
const gz = (xml: string): Uint8Array => Bun.gzipSync(new TextEncoder().encode(xml));

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

/**
 * Shapes taken from live stores. Each of these returned zero products before
 * the traversal was widened, which killed the run at "no products could be
 * discovered" — so each one is a regression test for a store, not a hypothetical.
 */
describe("productUrlsFromSitemap — index shapes real stores use", () => {
  test("descends an index whose children say pdp rather than product", () => {
    // Nike: sitemap-v2-pdp-index.xml, 62 children, none spelled "product".
    serve({
      "https://shop.test/robots.txt":
        "Sitemap: https://shop.test/sitemap-us-help.xml\nSitemap: https://shop.test/sitemap-v2-pdp-index.xml\n",
      "https://shop.test/sitemap-us-help.xml": urlset("https://shop.test/help/a/free-shipping"),
      "https://shop.test/sitemap-v2-pdp-index.xml": urlset(
        ...Array.from({ length: 62 }, (_, i) => `https://shop.test/sitemap-v2-pdp-${i}.xml`),
      ),
      "https://shop.test/sitemap-v2-pdp-0.xml": urlset(
        "https://shop.test/gb/t/impossiblysoft-cardigan-klvlqAn7",
        "https://shop.test/gb/t/impossiblysoft-hoodie-fGn2g0Dy",
      ),
    });

    return expect(productUrlsFromSitemap("https://shop.test", "")).resolves.toContain(
      "https://shop.test/gb/t/impossiblysoft-cardigan-klvlqAn7",
    );
  });

  test("trusts opaquely named children when the index itself names products", async () => {
    // Target: sitemap_pdp-index.xml.gz, children named sitemap_00-0001.xml.gz.
    // Only the parent says what they are, so trust has to travel downward.
    serve({
      "https://shop.test/robots.txt": "Sitemap: https://shop.test/sitemap_pdp-index.xml\n",
      "https://shop.test/sitemap_pdp-index.xml": urlset(
        ...Array.from({ length: 12 }, (_, i) => `https://shop.test/sitemap_00-000${i}.xml`),
      ),
      // Deliberately a shape no product-url pattern recognises.
      "https://shop.test/sitemap_00-0000.xml": urlset(
        "https://shop.test/x/campus-hoodie/-/A-1000000076",
      ),
    });

    expect(await productUrlsFromSitemap("https://shop.test", "")).toContain(
      "https://shop.test/x/campus-hoodie/-/A-1000000076",
    );
  });

  test("follows an index two levels down to reach the leaves", async () => {
    // Chewy: sitemap_index -> pdp-sitemap_index -> pdp_1 -> the products.
    serve({
      "https://shop.test/robots.txt": "Sitemap: https://shop.test/sitemap_index.xml\n",
      "https://shop.test/sitemap_index.xml": urlset(
        "https://shop.test/brand-sitemap_index.xml",
        "https://shop.test/pdp-sitemap_index.xml",
      ),
      "https://shop.test/pdp-sitemap_index.xml": urlset("https://shop.test/pdp_1.xml"),
      "https://shop.test/pdp_1.xml": urlset("https://shop.test/frisco-wicker-dog/dp/323026"),
    });

    expect(await productUrlsFromSitemap("https://shop.test", "")).toEqual([
      "https://shop.test/frisco-wicker-dog/dp/323026",
    ]);
  });

  test("never mistakes a nested sitemap for a product", async () => {
    // John Lewis: products.xml lists products-00.xml.gz, which is a sitemap.
    // Returning those as products sends the crawler off to parse gzip as HTML.
    serve({
      "https://shop.test/robots.txt": "Sitemap: https://shop.test/siteindex.xml\n",
      "https://shop.test/siteindex.xml": urlset("https://shop.test/sitemap/products.xml"),
      "https://shop.test/sitemap/products.xml": urlset(
        "https://shop.test/sitemap/products-00.xml.gz",
      ),
      "https://shop.test/sitemap/products-00.xml.gz": gz(
        urlset("https://shop.test/whistles-camilla-trousers/p5966220"),
      ),
    });

    const found = await productUrlsFromSitemap("https://shop.test", "");
    expect(found).toEqual(["https://shop.test/whistles-camilla-trousers/p5966220"]);
    expect(found.some((u) => u.includes(".xml"))).toBe(false);
  });

  test("reads a sitemap the host serves gzipped", async () => {
    // Best Buy and Chewy both serve raw gzip with no content-encoding, so
    // res.text() hands back binary and every <loc> in it is invisible.
    serve({
      "https://shop.test/robots.txt": "Sitemap: https://shop.test/sitemaps_pdp.xml\n",
      "https://shop.test/sitemaps_pdp.xml": urlset("https://shop.test/sitemaps_pdp.0000.xml.gz"),
      "https://shop.test/sitemaps_pdp.0000.xml.gz": gz(
        urlset("https://shop.test/site/martinlogan-speaker/5657301.p"),
      ),
    });

    expect(await productUrlsFromSitemap("https://shop.test", "")).toEqual([
      "https://shop.test/site/martinlogan-speaker/5657301.p",
    ]);
  });

  test("finds the product child inside an index of thousands", async () => {
    // IKEA: one sitemap.xml with 2,173 children, the products among them
    // spelled prod-et-EE_1.xml.
    serve({
      "https://shop.test/robots.txt": "Sitemap: https://shop.test/sitemap.xml\n",
      "https://shop.test/sitemap.xml": urlset(
        ...Array.from({ length: 300 }, (_, i) => `https://shop.test/cat-${i}.xml`),
        "https://shop.test/prod-et-EE_1.xml",
      ),
      "https://shop.test/prod-et-EE_1.xml": urlset(
        "https://shop.test/ee/et/p/zebrasaev-laelamp-10522481/",
      ),
    });

    expect(await productUrlsFromSitemap("https://shop.test", "")).toEqual([
      "https://shop.test/ee/et/p/zebrasaev-laelamp-10522481/",
    ]);
  });

  test("prefers a sitemap named for products over one merely listed first", async () => {
    // robots.txt order is not a ranking. Nike lists a help sitemap first; a
    // single product-shaped url in an early sitemap must not win the run.
    serve({
      "https://shop.test/robots.txt":
        "Sitemap: https://shop.test/pages.xml\nSitemap: https://shop.test/product-sitemap.xml\n",
      "https://shop.test/pages.xml": urlset("https://shop.test/p/about-us"),
      "https://shop.test/product-sitemap.xml": urlset(
        "https://shop.test/products/one",
        "https://shop.test/products/two",
      ),
    });

    expect(await productUrlsFromSitemap("https://shop.test", "")).toEqual([
      "https://shop.test/products/one",
      "https://shop.test/products/two",
    ]);
  });
});

describe("isProductUrl", () => {
  test("recognises the product path shapes stores actually ship", () => {
    // Every one of these is a live product url; none matches /products?/.
    for (const url of [
      "https://shop.test/products/one", // Shopify
      "https://shop.test/gb/t/impossiblysoft-cardigan-klvlqAn7", // Nike
      "https://shop.test/p/campus-hoodie/-/A-1000000076", // Target
      "https://shop.test/ip/Great-Value-Milk/10450114", // Walmart
      "https://shop.test/site/martinlogan-speaker/5657301.p", // Best Buy
      "https://shop.test/frisco-wicker-dog/dp/323026", // Chewy
      "https://shop.test/whistles-camilla-trousers/p5966220", // John Lewis
      "https://shop.test/ee/et/p/zebrasaev-laelamp-10522481/", // IKEA
      "https://shop.test/p/product-sets/SET-PHS-CC.html", // Bose
    ]) {
      expect(isProductUrl(url)).toBe(true);
    }
  });

  test("rejects the pages that sit beside products in the same sitemap", () => {
    for (const url of [
      "https://shop.test/about",
      "https://shop.test/blog/post",
      "https://shop.test/help/a/free-shipping", // Nike help
      "https://shop.test/gb/w/mens-shoes-1qb5j", // Nike category
      "https://shop.test/gb/a/how-to-run-faster", // Nike article
      "https://shop.test/s/1+gallon+mason+jars", // Target search
      "https://shop.test/c/tequila-grocery/-/N-0091p", // Target category
      "https://shop.test/browse/arts-crafts/brown-fabric", // Walmart browse
      "https://shop.test/sitemap_0-product.xml", // a sitemap, not a product
      "https://shop.test/sitemap/products-00.xml.gz",
      "https://shop.test/p", // a bare token with nothing under it
    ]) {
      expect(isProductUrl(url)).toBe(false);
    }
  });
});
