import { expect, test } from "bun:test";
import type { Fetched } from "./http.ts";
import { observeSitemap } from "./catalogue.ts";

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
