import assert from "node:assert/strict";
import test from "node:test";

import { assertPublicHttpUrl, assertSameOriginTarget } from "./security.ts";

const publicLookup = async () => ["203.0.113.10"];

test("assertSameOriginTarget accepts a public product on the submitted store", async () => {
  const result = await assertSameOriginTarget(
    "https://shop.example",
    "https://shop.example/items/alpha",
    publicLookup,
  );
  assert.equal(result.target.href, "https://shop.example/items/alpha");
});

test("assertSameOriginTarget rejects a product on another origin", async () => {
  await assert.rejects(
    assertSameOriginTarget(
      "https://shop.example",
      "https://other.example/items/alpha",
      publicLookup,
    ),
    /target product must use the store origin/,
  );
});

test("assertPublicHttpUrl rejects credentials and private network addresses", async () => {
  await assert.rejects(
    assertPublicHttpUrl("https://user:secret@shop.example", publicLookup),
    /must not contain credentials/,
  );
  await assert.rejects(
    assertPublicHttpUrl("http://internal.example", async () => ["10.0.0.4"]),
    /resolves to a private network address/,
  );
});
