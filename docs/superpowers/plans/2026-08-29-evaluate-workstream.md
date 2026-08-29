# Evaluate Workstream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a `CheckResult` into a ranked `Finding[]` that passes `assertFindings`, serve it over HTTP, render it on Recommend, and add the results dashboard.

**Architecture:** Evaluate is a registry of pure rules. Each rule inspects one class of observed failure and returns a finding or `null`. An orchestrator runs every rule, ranks the survivors by how many agent runs they unblock, assigns ids from that order, and validates the result against the source document before returning it. No rule touches I/O, no rule calls a model, and every rule is a pure function of the `CheckResult` — so the whole workstream is testable against a committed fixture with no network and no Check implementation.

**Tech Stack:** Bun, Hono, TypeScript (strict), `bun:test`, `bun:sqlite`. Port 3201.

**Spec:** `docs/superpowers/specs/2026-08-29-happy2-design.md`

## Global Constraints

Copied from `AGENTS.md`. Every task's requirements implicitly include these.

- **No product category may appear in source code.** Not in a constant, prompt, enum, or production-read fixture. Attribute names come from the `attribute` field of `MISSING_ATTRIBUTE_EVIDENCE` entries at runtime. A grep for a category word in `backend/src/` is a failed review.
- **No model calls in this workstream.** Evaluate is entirely deterministic. There is no Anthropic SDK import anywhere in `backend/src/evaluate/`.
- **Every finding cites evidence.** `evidence` non-empty, every `references` path resolving, `addresses_failure_codes` non-empty and traceable to the runs in `derived_from`.
- **No headless browser.** No Playwright, Puppeteer, or Selenium dependency.
- **Never persist or log a brand's API key.** Not applicable to this lane, but do not add logging that echoes request bodies.
- TypeScript `strict`. Do not add `any` to move past a type error.
- Derived values are never stored. `priority` is array order; `shoppers_affected` is `derived_from.length`.

## Contracts and fixtures already on `main`

Do not modify these. They are shared with the Check workstream; changing one is a cross-team change per `docs/workstreams.md`.

| Path | Provides |
| --- | --- |
| `shared/contracts/check-result.ts` | `CheckResult`, `AgentRun`, `SiteAudit`, `TargetProduct`, `Brand`, `Outcome` |
| `shared/contracts/codes.ts` | `FAILURE_CODES`, `FailureCode`, `FailureEntry` |
| `shared/contracts/finding.ts` | `Finding`, `FindingEvidence`, `Recommendation`, `Severity`, `Surface`, `Effort`, `Owner` |
| `shared/contracts/validate.ts` | `validateCheckResult`, `assertCheckResult`, `ValidationError` |
| `shared/contracts/validate-findings.ts` | `validateFindings`, `assertFindings`, `resolvePath` |
| `shared/fixtures/check-result.example.json` | 6 agent runs: `ar_001`..`ar_006` |
| `shared/fixtures/findings.example.json` | 6 findings, `F001`..`F006` — the golden output |

### Failure codes observed in the example CheckResult

This mapping is what the rules must reproduce. Memorise it; every task refers back to it.

| Run | Failure codes |
| --- | --- |
| `ar_001` | `ACP_UNSUPPORTED`, `MISSING_ATTRIBUTE_EVIDENCE` (waterproof) |
| `ar_002` | `SHIPPING_INFO_NOT_FOUND`, `OUTRANKED_BY_COMPETITOR` |
| `ar_003` | `NOT_IN_SEARCH_RESULTS`, `NOT_IN_SITEMAP` |
| `ar_004` | `NO_LLMS_TXT`, `UCP_UNSUPPORTED` |
| `ar_005` | `PRICE_CLIENT_SIDE_ONLY`, `NO_OFFER_SCHEMA`, `MISSING_ATTRIBUTE_EVIDENCE` (waterproof) |
| `ar_006` | `AGENT_TIMEOUT` |

`AGENT_TIMEOUT` is infrastructure, not a brand problem. **No rule may emit a finding for it.** Task 7 tests this explicitly.

### Rules and the findings they produce

| Rule id | Finding | Severity | Codes | `derived_from` |
| --- | --- | --- | --- | --- |
| `protocol.manifest` | F001 | critical | `ACP_UNSUPPORTED`, `UCP_UNSUPPORTED` | `ar_001`, `ar_004` |
| `content.attributes` | F002 | high | `MISSING_ATTRIBUTE_EVIDENCE` | `ar_001`, `ar_005` |
| `discovery.sources` | F003 | critical | `NOT_IN_SITEMAP`, `NOT_IN_SEARCH_RESULTS` | `ar_003` |
| `structured.offer` | F004 | high | `PRICE_CLIENT_SIDE_ONLY`, `NO_OFFER_SCHEMA` | `ar_005` |
| `content.shipping` | F005 | medium | `SHIPPING_INFO_NOT_FOUND`, `OUTRANKED_BY_COMPETITOR` | `ar_002` |
| `protocol.llms_txt` | F006 | medium | `NO_LLMS_TXT` | `ar_004` |

Ids are assigned from rank order, not written by rules. Rank order is: `derived_from.length` descending, then severity (`critical` < `high` < `medium`), then `rule id` ascending. Verify against the table: F001 and F002 both have 2 runs and are separated by severity; F005 (`content.shipping`) precedes F006 (`protocol.llms_txt`) on the rule-id tie-break.

## File structure

| Path | Responsibility |
| --- | --- |
| `backend/src/evaluate/types.ts` | The `Rule` interface and `DraftFinding` alias |
| `backend/src/evaluate/helpers.ts` | Shared derivations over a `CheckResult` |
| `backend/src/evaluate/snippets.ts` | Snippet builders, all data-driven |
| `backend/src/evaluate/rules/discovery.ts` | `discovery.sources` |
| `backend/src/evaluate/rules/protocol.ts` | `protocol.manifest`, `protocol.llms_txt` |
| `backend/src/evaluate/rules/structured.ts` | `structured.offer` |
| `backend/src/evaluate/rules/content.ts` | `content.attributes`, `content.shipping` |
| `backend/src/evaluate/rules/index.ts` | The `RULES` registry |
| `backend/src/evaluate/rank.ts` | Ordering and id assignment |
| `backend/src/evaluate/evaluate.ts` | Orchestrator: run rules, rank, assert |
| `backend/src/http/errors.ts` | JSON error shape |
| `backend/src/http/evaluate.ts` | `POST /runs/:id/evaluate` |
| `backend/src/store/findings.ts` | `bun:sqlite` persistence for findings |
| `backend/src/index.ts` | Hono app wiring (modified) |

Tests are colocated as `*.test.ts` next to the file they cover.

---

### Task 1: Backend test harness and contract wiring

Nothing in this lane can be tested until the backend can import `shared/contracts` and run `bun test`. This task ends with a smoke test proving both fixtures load and validate.

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/tsconfig.json`
- Create: `backend/src/fixtures.ts`
- Test: `backend/src/fixtures.test.ts`

**Interfaces:**
- Consumes: `validateCheckResult`, `validateFindings` from `shared/contracts`
- Produces: `loadExampleCheckResult(): CheckResult`, `loadExampleFindings(): Finding[]`, and the `@contracts/*` import alias every later task uses

- [ ] **Step 1: Update `backend/package.json`**

The scaffold is still named `my-app` and has no test script.

```json
{
  "name": "happy2-backend",
  "private": true,
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.13.5"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 2: Update `backend/tsconfig.json` so `@contracts/*` resolves to the shared directory**

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun"],
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx",
    "noEmit": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@contracts/*": ["../shared/contracts/*"],
      "@fixtures/*": ["../shared/fixtures/*"]
    }
  },
  "include": ["src/**/*.ts", "../shared/**/*.ts"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `cd backend && bun install`
Expected: completes without error, creates `node_modules`.

- [ ] **Step 4: Write the failing test**

Create `backend/src/fixtures.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { validateCheckResult } from "@contracts/validate";
import { validateFindings } from "@contracts/validate-findings";
import { loadExampleCheckResult, loadExampleFindings } from "./fixtures";

describe("committed fixtures", () => {
  test("the example CheckResult is valid", () => {
    expect(validateCheckResult(loadExampleCheckResult())).toEqual([]);
  });

  test("the example findings are valid against it", () => {
    const source = loadExampleCheckResult();
    expect(validateFindings(loadExampleFindings(), source)).toEqual([]);
  });

  test("the example CheckResult has the six runs the rules are written against", () => {
    const ids = loadExampleCheckResult().agent_runs.map((r) => r.run_id);
    expect(ids).toEqual(["ar_001", "ar_002", "ar_003", "ar_004", "ar_005", "ar_006"]);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd backend && bun test src/fixtures.test.ts`
Expected: FAIL — `Cannot find module './fixtures'`.

- [ ] **Step 6: Write the minimal implementation**

Create `backend/src/fixtures.ts`:

```ts
/**
 * Loaders for the committed example documents.
 *
 * Evaluate is built against these rather than a live Check run, which is what
 * lets this workstream reach completion before Check exists.
 */

import type { CheckResult } from "@contracts/check-result";
import type { Finding } from "@contracts/finding";

import checkResult from "@fixtures/check-result.example.json";
import findings from "@fixtures/findings.example.json";

export function loadExampleCheckResult(): CheckResult {
  return structuredClone(checkResult) as unknown as CheckResult;
}

export function loadExampleFindings(): Finding[] {
  return structuredClone(findings) as unknown as Finding[];
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd backend && bun test src/fixtures.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 8: Verify typecheck is clean**

Run: `cd backend && bun run typecheck`
Expected: no output, exit 0.

- [ ] **Step 9: Commit**

```bash
git add backend/package.json backend/tsconfig.json backend/src/fixtures.ts backend/src/fixtures.test.ts
git commit -m "test: wire backend to shared contracts and fixtures"
```

---

### Task 2: Rule interface and shared helpers

Every rule needs the same three derivations: which runs reported a code, the union of run ids across several codes, and the distinct attribute names that were flagged as unevidenced. Writing them once keeps the rules to a dozen lines each.

**Files:**
- Create: `backend/src/evaluate/types.ts`
- Create: `backend/src/evaluate/helpers.ts`
- Test: `backend/src/evaluate/helpers.test.ts`

**Interfaces:**
- Consumes: `loadExampleCheckResult` from Task 1
- Produces:
  - `type DraftFinding = Omit<Finding, "finding_id">`
  - `interface Rule { readonly id: string; evaluate(source: CheckResult): DraftFinding | null }`
  - `wasReported(source: CheckResult, code: FailureCode): boolean`
  - `runIdsReporting(source: CheckResult, ...codes: FailureCode[]): string[]`
  - `missingAttributes(source: CheckResult): string[]`

- [ ] **Step 1: Write the failing test**

Create `backend/src/evaluate/helpers.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { loadExampleCheckResult } from "../fixtures";
import { missingAttributes, runIdsReporting, wasReported } from "./helpers";

const source = loadExampleCheckResult();

describe("wasReported", () => {
  test("is true for a code some run reported", () => {
    expect(wasReported(source, "NOT_IN_SITEMAP")).toBe(true);
  });

  test("is false for a code nobody reported", () => {
    expect(wasReported(source, "ROBOTS_BLOCKED")).toBe(false);
  });
});

describe("runIdsReporting", () => {
  test("unions several codes, in agent_runs order, without duplicates", () => {
    expect(runIdsReporting(source, "ACP_UNSUPPORTED", "UCP_UNSUPPORTED")).toEqual(["ar_001", "ar_004"]);
  });

  test("does not repeat a run that reported two of the codes", () => {
    expect(runIdsReporting(source, "PRICE_CLIENT_SIDE_ONLY", "NO_OFFER_SCHEMA")).toEqual(["ar_005"]);
  });
});

describe("missingAttributes", () => {
  test("collects distinct attribute names from MISSING_ATTRIBUTE_EVIDENCE", () => {
    expect(missingAttributes(source)).toEqual(["waterproof"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && bun test src/evaluate/helpers.test.ts`
Expected: FAIL — `Cannot find module './helpers'`.

- [ ] **Step 3: Write `backend/src/evaluate/types.ts`**

```ts
/**
 * The rule contract.
 *
 * A rule is a pure function of the CheckResult. It has no I/O, makes no model
 * call, and does not know its own priority — ids and ordering are assigned by
 * the orchestrator from rank, because priority is array order and stored
 * copies of derived values drift.
 */

import type { CheckResult } from "@contracts/check-result";
import type { Finding } from "@contracts/finding";

/** A finding before the orchestrator assigns its id from rank order. */
export type DraftFinding = Omit<Finding, "finding_id">;

export interface Rule {
  /** Stable identifier, also the deterministic tie-break in ranking. */
  readonly id: string;
  /** Returns null when this rule found nothing to say about the run. */
  evaluate(source: CheckResult): DraftFinding | null;
}
```

- [ ] **Step 4: Write `backend/src/evaluate/helpers.ts`**

```ts
/** Shared derivations over a CheckResult. Pure; no I/O. */

import type { CheckResult } from "@contracts/check-result";
import type { FailureCode } from "@contracts/codes";

/** Whether any run reported `code`. Guards a rule against claiming it. */
export function wasReported(source: CheckResult, code: FailureCode): boolean {
  return source.agent_runs.some((run) =>
    (run.outcome?.failure_codes ?? []).some((entry) => entry.code === code),
  );
}

/** Union of run ids reporting any of `codes`, in agent_runs order, deduplicated. */
export function runIdsReporting(source: CheckResult, ...codes: FailureCode[]): string[] {
  const wanted = new Set<string>(codes);
  return source.agent_runs
    .filter((run) => (run.outcome?.failure_codes ?? []).some((entry) => wanted.has(entry.code)))
    .map((run) => run.run_id);
}

/**
 * Distinct attribute names flagged as unevidenced, in first-seen order.
 *
 * These come from the data, never from a constant — that is what keeps the
 * rule category-agnostic.
 */
export function missingAttributes(source: CheckResult): string[] {
  const seen: string[] = [];
  for (const run of source.agent_runs) {
    for (const entry of run.outcome?.failure_codes ?? []) {
      if (entry.code === "MISSING_ATTRIBUTE_EVIDENCE" && entry.attribute && !seen.includes(entry.attribute)) {
        seen.push(entry.attribute);
      }
    }
  }
  return seen;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && bun test src/evaluate/helpers.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/evaluate/types.ts backend/src/evaluate/helpers.ts backend/src/evaluate/helpers.test.ts
git commit -m "feat: add rule contract and shared CheckResult derivations"
```

---

### Task 3: Snippet builders

Every finding carries a pasteable fix, and `validate-findings.ts` rejects an empty `snippet`. Building them from the source document rather than from string constants is what keeps them category-agnostic and correct for the brand being measured.

**Files:**
- Create: `backend/src/evaluate/snippets.ts`
- Test: `backend/src/evaluate/snippets.test.ts`

**Interfaces:**
- Consumes: `CheckResult` types
- Produces: `manifestSnippet()`, `attributeSnippet(attributes: string[])`, `offerSnippet(product: TargetProduct)`, `feedSnippet(audit: SiteAudit)`, `shippingSnippet()`, `llmsTxtSnippet(brand: Brand, audit: SiteAudit)` — all returning `string`

- [ ] **Step 1: Write the failing test**

Create `backend/src/evaluate/snippets.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { loadExampleCheckResult } from "../fixtures";
import {
  attributeSnippet,
  feedSnippet,
  llmsTxtSnippet,
  manifestSnippet,
  offerSnippet,
  shippingSnippet,
} from "./snippets";

const source = loadExampleCheckResult();

describe("attributeSnippet", () => {
  test("emits one property per attribute it is given", () => {
    const out = attributeSnippet(["waterproof", "weight_g"]);
    expect(out).toContain('"name": "waterproof"');
    expect(out).toContain('"name": "weight_g"');
  });

  test("names no attribute it was not given", () => {
    expect(attributeSnippet(["waterproof"])).not.toContain("weight_g");
  });

  test("returns non-empty output for an empty list, since the snippet is required", () => {
    expect(attributeSnippet([]).length).toBeGreaterThan(0);
  });
});

describe("offerSnippet", () => {
  test("uses the real price and currency from the target product", () => {
    const out = offerSnippet(source.target_product);
    expect(out).toContain("129.99");
    expect(out).toContain("USD");
  });

  test("falls back to a placeholder when price is absent", () => {
    const out = offerSnippet({ ...source.target_product, price: null });
    expect(out).toContain("priceCurrency");
    expect(out).not.toContain("null");
  });
});

describe("feedSnippet", () => {
  test("reports the real catalogue coverage", () => {
    const out = feedSnippet(source.site_audit);
    expect(out).toContain("40");
  });
});

describe("llmsTxtSnippet", () => {
  test("names the brand", () => {
    expect(llmsTxtSnippet(source.brand, source.site_audit)).toContain("Acme");
  });
});

describe("static snippets", () => {
  test("are non-empty", () => {
    expect(manifestSnippet().length).toBeGreaterThan(0);
    expect(shippingSnippet().length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && bun test src/evaluate/snippets.test.ts`
Expected: FAIL — `Cannot find module './snippets'`.

- [ ] **Step 3: Write `backend/src/evaluate/snippets.ts`**

```ts
/**
 * Fix payloads rendered on the Recommend screen.
 *
 * Built from the source document, never from category constants: the attribute
 * snippet lists exactly the attributes the run flagged, and the offer snippet
 * carries the brand's real price.
 */

import type { Brand, SiteAudit, TargetProduct } from "@contracts/check-result";

export function manifestSnippet(): string {
  return [
    "{",
    '  "version": "0.2",',
    '  "catalog": "/api/agent/catalog",',
    '  "search": "/api/agent/search",',
    '  "checkout": { "intent": "/api/agent/checkout", "guest": true },',
    '  "payment": ["card_token", "delegated_mandate"]',
    "}",
  ].join("\n");
}

export function attributeSnippet(attributes: string[]): string {
  if (attributes.length === 0) {
    return '"additionalProperty": []  // add one entry per attribute a buyer would filter on';
  }
  const rows = attributes
    .map((name) => `  { "@type": "PropertyValue", "name": ${JSON.stringify(name)}, "value": "" }`)
    .join(",\n");
  return `"additionalProperty": [\n${rows}\n]`;
}

export function offerSnippet(product: TargetProduct): string {
  const amount = product.price ? product.price.amount.toFixed(2) : "0.00";
  const currency = product.price ? product.price.currency : "USD";
  return [
    '"offers": {',
    '  "@type": "Offer",',
    `  "price": ${JSON.stringify(amount)},`,
    `  "priceCurrency": ${JSON.stringify(currency)},`,
    '  "availability": "https://schema.org/InStock"',
    "}",
  ].join("\n");
}

export function feedSnippet(audit: SiteAudit): string {
  const { products_listed, products_total } = audit.sitemap;
  return [
    "GET /feeds/products.xml",
    `  -> ${products_total}/${products_total} SKUs, updated hourly`,
    `  (sitemap currently lists ${products_listed} of ${products_total})`,
    "sitemap: include /products/* on publish hook",
  ].join("\n");
}

export function shippingSnippet(): string {
  return [
    '"shippingDetails": {',
    '  "@type": "OfferShippingDetails",',
    '  "shippingRate": { "@type": "MonetaryAmount", "value": "0.00", "currency": "USD" },',
    '  "deliveryTime": "1-3 business days"',
    "}",
  ].join("\n");
}

export function llmsTxtSnippet(brand: Brand, audit: SiteAudit): string {
  return [
    `# ${brand.name}`,
    "",
    "## Buying surfaces",
    `- [Product feed](/feeds/products.xml): all ${audit.sitemap.products_total} SKUs, hourly`,
    "",
    "## Policies",
    "- Returns: 30 days, unused, prepaid label",
    "- Shipping: 1-3 business days domestic",
  ].join("\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && bun test src/evaluate/snippets.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/evaluate/snippets.ts backend/src/evaluate/snippets.test.ts
git commit -m "feat: add data-driven snippet builders"
```

---

### Task 4: Discovery rule

The first real rule, and the template for the rest. It fires when agents could not retrieve the product at all — the most severe class of failure, because nothing downstream matters if you are never found.

**Files:**
- Create: `backend/src/evaluate/rules/discovery.ts`
- Test: `backend/src/evaluate/rules/discovery.test.ts`

**Interfaces:**
- Consumes: `Rule`, `DraftFinding` (Task 2); `runIdsReporting` (Task 2); `feedSnippet` (Task 3)
- Produces: `discoverySourcesRule: Rule` with `id === "discovery.sources"`

- [ ] **Step 1: Write the failing test**

Create `backend/src/evaluate/rules/discovery.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { loadExampleCheckResult } from "../../fixtures";
import { resolvePath } from "@contracts/validate-findings";
import { discoverySourcesRule } from "./discovery";

const source = loadExampleCheckResult();

describe("discovery.sources", () => {
  test("fires for the run that never retrieved the product", () => {
    const finding = discoverySourcesRule.evaluate(source);
    expect(finding).not.toBeNull();
    expect(finding!.derived_from).toEqual(["ar_003"]);
  });

  test("claims exactly the discovery codes that were observed", () => {
    const finding = discoverySourcesRule.evaluate(source)!;
    expect(finding.addresses_failure_codes.sort()).toEqual(["NOT_IN_SEARCH_RESULTS", "NOT_IN_SITEMAP"]);
  });

  test("every evidence reference resolves against the source", () => {
    const finding = discoverySourcesRule.evaluate(source)!;
    expect(finding.evidence.length).toBeGreaterThan(0);
    for (const entry of finding.evidence) {
      for (const ref of entry.references) {
        expect(resolvePath(source, ref)).toBeDefined();
      }
    }
  });

  test("carries a non-empty snippet", () => {
    expect(discoverySourcesRule.evaluate(source)!.recommendation.snippet.length).toBeGreaterThan(0);
  });

  test("returns null when no discovery code was reported", () => {
    const clean = loadExampleCheckResult();
    for (const run of clean.agent_runs) {
      run.outcome.failure_codes = run.outcome.failure_codes.filter(
        (e) => e.code !== "NOT_IN_SITEMAP" && e.code !== "NOT_IN_SEARCH_RESULTS",
      );
    }
    expect(discoverySourcesRule.evaluate(clean)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && bun test src/evaluate/rules/discovery.test.ts`
Expected: FAIL — `Cannot find module './discovery'`.

- [ ] **Step 3: Write `backend/src/evaluate/rules/discovery.ts`**

```ts
/** Agents could not retrieve the product at all. */

import type { CheckResult } from "@contracts/check-result";
import type { FailureCode } from "@contracts/codes";
import type { FindingEvidence } from "@contracts/finding";
import { runIdsReporting, wasReported } from "../helpers";
import { feedSnippet } from "../snippets";
import type { DraftFinding, Rule } from "../types";

const CODES: FailureCode[] = ["NOT_IN_SITEMAP", "NOT_IN_SEARCH_RESULTS"];

export const discoverySourcesRule: Rule = {
  id: "discovery.sources",

  evaluate(source: CheckResult): DraftFinding | null {
    const runIds = runIdsReporting(source, ...CODES);
    if (runIds.length === 0) return null;

    const observed = CODES.filter((code) => wasReported(source, code));

    const evidence: FindingEvidence[] = runIds.map((runId) => ({
      agent_run_id: runId,
      fact: "The agent never retrieved the product: it fetched none of our pages and the domain was absent from all results",
      references: [
        `agent_runs#${runId}.outcome.target_discovered`,
        `agent_runs#${runId}.outcome.our_pages_fetched`,
      ],
    }));

    const missing = source.site_audit.sitemap.missing_product_ids.length;
    if (missing > 0) {
      evidence.push({
        agent_run_id: null,
        fact: `${missing} of ${source.site_audit.sitemap.products_total} products are missing from sitemap.xml`,
        references: ["site_audit.sitemap.missing_product_ids", "site_audit.sitemap.products_listed"],
      });
    }

    return {
      severity: "critical",
      title: "Target product is absent from machine-readable discovery sources",
      evidence,
      derived_from: runIds,
      addresses_failure_codes: observed,
      recommendation: {
        action:
          "Regenerate the sitemap from the live catalog on publish and serve a machine-readable product feed at a stable URL",
        surface: "discoverability",
        effort: "low",
        owner: "seo",
        snippet_label: "Feed",
        snippet: feedSnippet(source.site_audit),
      },
    };
  },
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && bun test src/evaluate/rules/discovery.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/evaluate/rules/discovery.ts backend/src/evaluate/rules/discovery.test.ts
git commit -m "feat: add discovery.sources rule"
```

---

### Task 5: Protocol rules

Two rules, both about machine-readable surfaces the brand does not publish: the agent-commerce and UCP manifests, and `llms.txt`. They live in one file because they change together.

**Files:**
- Create: `backend/src/evaluate/rules/protocol.ts`
- Test: `backend/src/evaluate/rules/protocol.test.ts`

**Interfaces:**
- Consumes: `Rule`, `DraftFinding`, `runIdsReporting`, `manifestSnippet`, `llmsTxtSnippet`
- Produces: `protocolManifestRule: Rule` (`id === "protocol.manifest"`), `protocolLlmsTxtRule: Rule` (`id === "protocol.llms_txt"`)

- [ ] **Step 1: Write the failing test**

Create `backend/src/evaluate/rules/protocol.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { loadExampleCheckResult } from "../../fixtures";
import { resolvePath } from "@contracts/validate-findings";
import { protocolLlmsTxtRule, protocolManifestRule } from "./protocol";

const source = loadExampleCheckResult();

describe("protocol.manifest", () => {
  test("unions the runs that hit either protocol", () => {
    expect(protocolManifestRule.evaluate(source)!.derived_from).toEqual(["ar_001", "ar_004"]);
  });

  test("claims both protocol codes and rates the gap critical", () => {
    const finding = protocolManifestRule.evaluate(source)!;
    expect(finding.addresses_failure_codes.sort()).toEqual(["ACP_UNSUPPORTED", "UCP_UNSUPPORTED"]);
    expect(finding.severity).toBe("critical");
  });

  test("every evidence reference resolves", () => {
    for (const entry of protocolManifestRule.evaluate(source)!.evidence) {
      for (const ref of entry.references) expect(resolvePath(source, ref)).toBeDefined();
    }
  });

  test("returns null when both manifests are present", () => {
    const clean = loadExampleCheckResult();
    for (const run of clean.agent_runs) {
      run.outcome.failure_codes = run.outcome.failure_codes.filter(
        (e) => e.code !== "ACP_UNSUPPORTED" && e.code !== "UCP_UNSUPPORTED",
      );
    }
    expect(protocolManifestRule.evaluate(clean)).toBeNull();
  });
});

describe("protocol.llms_txt", () => {
  test("fires for the run that found no llms.txt", () => {
    const finding = protocolLlmsTxtRule.evaluate(source)!;
    expect(finding.derived_from).toEqual(["ar_004"]);
    expect(finding.addresses_failure_codes).toEqual(["NO_LLMS_TXT"]);
    expect(finding.severity).toBe("medium");
  });

  test("names the brand in its snippet", () => {
    expect(protocolLlmsTxtRule.evaluate(source)!.recommendation.snippet).toContain("Acme");
  });

  test("returns null when llms.txt was never flagged", () => {
    const clean = loadExampleCheckResult();
    for (const run of clean.agent_runs) {
      run.outcome.failure_codes = run.outcome.failure_codes.filter((e) => e.code !== "NO_LLMS_TXT");
    }
    expect(protocolLlmsTxtRule.evaluate(clean)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && bun test src/evaluate/rules/protocol.test.ts`
Expected: FAIL — `Cannot find module './protocol'`.

- [ ] **Step 3: Write `backend/src/evaluate/rules/protocol.ts`**

```ts
/** No machine-readable buying surface: manifests, and the curated site guide. */

import type { CheckResult } from "@contracts/check-result";
import type { FailureCode } from "@contracts/codes";
import { runIdsReporting, wasReported } from "../helpers";
import { llmsTxtSnippet, manifestSnippet } from "../snippets";
import type { DraftFinding, Rule } from "../types";

const MANIFEST_CODES: FailureCode[] = ["ACP_UNSUPPORTED", "UCP_UNSUPPORTED"];

export const protocolManifestRule: Rule = {
  id: "protocol.manifest",

  evaluate(source: CheckResult): DraftFinding | null {
    const runIds = runIdsReporting(source, ...MANIFEST_CODES);
    if (runIds.length === 0) return null;

    const observed = MANIFEST_CODES.filter((code) => wasReported(source, code));

    return {
      severity: "critical",
      title: "No agent-commerce manifest exists on either protocol",
      evidence: runIds.map((runId) => ({
        agent_run_id: runId,
        fact: "The protocol check failed, so the agent fell back to reading the storefront by pixels",
        references: [`agent_runs#${runId}.outcome.failure_codes`, "site_audit.agent_commerce", "site_audit.ucp"],
      })),
      derived_from: runIds,
      addresses_failure_codes: observed,
      recommendation: {
        action:
          "Publish a manifest describing your catalog, search and checkout intents so agents can skip the UI entirely",
        surface: "agent_protocol",
        effort: "high",
        owner: "platform",
        snippet_label: "/.well-known/agent-commerce",
        snippet: manifestSnippet(),
      },
    };
  },
};

export const protocolLlmsTxtRule: Rule = {
  id: "protocol.llms_txt",

  evaluate(source: CheckResult): DraftFinding | null {
    const runIds = runIdsReporting(source, "NO_LLMS_TXT");
    if (runIds.length === 0) return null;

    return {
      severity: "medium",
      title: "No llms.txt to guide models around the catalog",
      evidence: runIds.map((runId) => ({
        agent_run_id: runId,
        fact: "/llms.txt returned 404; the agent had no curated entry point and crawled blind",
        references: ["site_audit.llms_txt", `agent_runs#${runId}.outcome.failure_codes`],
      })),
      derived_from: runIds,
      addresses_failure_codes: ["NO_LLMS_TXT"],
      recommendation: {
        action: "Publish a curated site guide naming your buying surfaces, catalog structure and policies",
        surface: "discoverability",
        effort: "low",
        owner: "content",
        snippet_label: "llms.txt",
        snippet: llmsTxtSnippet(source.brand, source.site_audit),
      },
    };
  },
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && bun test src/evaluate/rules/protocol.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/evaluate/rules/protocol.ts backend/src/evaluate/rules/protocol.test.ts
git commit -m "feat: add protocol manifest and llms.txt rules"
```

---

### Task 6: Structured-data and content rules

The remaining three rules: the Offer/price gap, the unevidenced attributes, and the shipping gap that lost a comparison. The attributes rule is where the no-category constraint bites — its attribute names must come from the data.

**Files:**
- Create: `backend/src/evaluate/rules/structured.ts`
- Create: `backend/src/evaluate/rules/content.ts`
- Test: `backend/src/evaluate/rules/structured.test.ts`
- Test: `backend/src/evaluate/rules/content.test.ts`

**Interfaces:**
- Consumes: `Rule`, `DraftFinding`, `runIdsReporting`, `missingAttributes`, `offerSnippet`, `attributeSnippet`, `shippingSnippet`
- Produces: `structuredOfferRule: Rule` (`id === "structured.offer"`), `contentAttributesRule: Rule` (`id === "content.attributes"`), `contentShippingRule: Rule` (`id === "content.shipping"`)

- [ ] **Step 1: Write the failing tests**

Create `backend/src/evaluate/rules/structured.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { loadExampleCheckResult } from "../../fixtures";
import { resolvePath } from "@contracts/validate-findings";
import { structuredOfferRule } from "./structured";

const source = loadExampleCheckResult();

describe("structured.offer", () => {
  test("fires for the run that read the page and found no price", () => {
    const finding = structuredOfferRule.evaluate(source)!;
    expect(finding.derived_from).toEqual(["ar_005"]);
    expect(finding.severity).toBe("high");
  });

  test("claims both structured-data codes", () => {
    expect(structuredOfferRule.evaluate(source)!.addresses_failure_codes.sort()).toEqual([
      "NO_OFFER_SCHEMA",
      "PRICE_CLIENT_SIDE_ONLY",
    ]);
  });

  test("every evidence reference resolves", () => {
    for (const entry of structuredOfferRule.evaluate(source)!.evidence) {
      for (const ref of entry.references) expect(resolvePath(source, ref)).toBeDefined();
    }
  });

  test("its snippet carries the brand's real price", () => {
    expect(structuredOfferRule.evaluate(source)!.recommendation.snippet).toContain("129.99");
  });

  test("returns null when neither code was reported", () => {
    const clean = loadExampleCheckResult();
    for (const run of clean.agent_runs) {
      run.outcome.failure_codes = run.outcome.failure_codes.filter(
        (e) => e.code !== "NO_OFFER_SCHEMA" && e.code !== "PRICE_CLIENT_SIDE_ONLY",
      );
    }
    expect(structuredOfferRule.evaluate(clean)).toBeNull();
  });
});
```

Create `backend/src/evaluate/rules/content.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { loadExampleCheckResult } from "../../fixtures";
import { resolvePath } from "@contracts/validate-findings";
import { contentAttributesRule, contentShippingRule } from "./content";

const source = loadExampleCheckResult();

describe("content.attributes", () => {
  test("unions every run that flagged an unevidenced attribute", () => {
    expect(contentAttributesRule.evaluate(source)!.derived_from).toEqual(["ar_001", "ar_005"]);
  });

  test("takes attribute names from the data, not from a constant", () => {
    const withDifferentAttribute = loadExampleCheckResult();
    for (const run of withDifferentAttribute.agent_runs) {
      for (const entry of run.outcome.failure_codes) {
        if (entry.code === "MISSING_ATTRIBUTE_EVIDENCE") entry.attribute = "fragrance_free";
      }
    }
    const snippet = contentAttributesRule.evaluate(withDifferentAttribute)!.recommendation.snippet;
    expect(snippet).toContain("fragrance_free");
    expect(snippet).not.toContain("waterproof");
  });

  test("every evidence reference resolves", () => {
    for (const entry of contentAttributesRule.evaluate(source)!.evidence) {
      for (const ref of entry.references) expect(resolvePath(source, ref)).toBeDefined();
    }
  });

  test("returns null when no attribute was flagged", () => {
    const clean = loadExampleCheckResult();
    for (const run of clean.agent_runs) {
      run.outcome.failure_codes = run.outcome.failure_codes.filter(
        (e) => e.code !== "MISSING_ATTRIBUTE_EVIDENCE",
      );
    }
    expect(contentAttributesRule.evaluate(clean)).toBeNull();
  });
});

describe("content.shipping", () => {
  test("fires for the shipping-sensitive run that chose a competitor", () => {
    const finding = contentShippingRule.evaluate(source)!;
    expect(finding.derived_from).toEqual(["ar_002"]);
    expect(finding.severity).toBe("medium");
  });

  test("claims only codes that run actually reported", () => {
    expect(contentShippingRule.evaluate(source)!.addresses_failure_codes.sort()).toEqual([
      "OUTRANKED_BY_COMPETITOR",
      "SHIPPING_INFO_NOT_FOUND",
    ]);
  });

  test("returns null when shipping was never the problem", () => {
    const clean = loadExampleCheckResult();
    for (const run of clean.agent_runs) {
      run.outcome.failure_codes = run.outcome.failure_codes.filter(
        (e) => e.code !== "SHIPPING_INFO_NOT_FOUND",
      );
    }
    expect(contentShippingRule.evaluate(clean)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && bun test src/evaluate/rules/structured.test.ts src/evaluate/rules/content.test.ts`
Expected: FAIL — cannot find `./structured` and `./content`.

- [ ] **Step 3: Write `backend/src/evaluate/rules/structured.ts`**

```ts
/** Product facts exist but not in a form an agent can read. */

import type { CheckResult } from "@contracts/check-result";
import type { FailureCode } from "@contracts/codes";
import type { FindingEvidence } from "@contracts/finding";
import { runIdsReporting, wasReported } from "../helpers";
import { offerSnippet } from "../snippets";
import type { DraftFinding, Rule } from "../types";

const CODES: FailureCode[] = ["PRICE_CLIENT_SIDE_ONLY", "NO_OFFER_SCHEMA"];

export const structuredOfferRule: Rule = {
  id: "structured.offer",

  evaluate(source: CheckResult): DraftFinding | null {
    const runIds = runIdsReporting(source, ...CODES);
    if (runIds.length === 0) return null;

    const observed = CODES.filter((code) => wasReported(source, code));

    const evidence: FindingEvidence[] = runIds.map((runId) => ({
      agent_run_id: runId,
      fact: "The agent read the page and found no price; it is absent from served HTML and appears only after hydration",
      references: [
        `agent_runs#${runId}.observations.price_found`,
        "site_audit.client_side_price_product_ids",
      ],
    }));

    evidence.push({
      agent_run_id: null,
      fact: `Only ${source.site_audit.structured_data.products_with_offer} of ${source.site_audit.structured_data.products_total} products carry Offer data`,
      references: ["site_audit.structured_data.missing_offer_product_ids"],
    });

    return {
      severity: "high",
      title: "Price is injected client-side and no Offer schema is served",
      evidence,
      derived_from: runIds,
      addresses_failure_codes: observed,
      recommendation: {
        action: "Render price and availability into the initial HTML and emit a Product + Offer block server-side",
        surface: "structured_data",
        effort: "medium",
        owner: "web",
        snippet_label: "Offer block",
        snippet: offerSnippet(source.target_product),
      },
    };
  },
};
```

- [ ] **Step 4: Write `backend/src/evaluate/rules/content.ts`**

```ts
/** The facts are readable, but they do not persuade. */

import type { CheckResult } from "@contracts/check-result";
import type { FailureCode } from "@contracts/codes";
import { missingAttributes, runIdsReporting } from "../helpers";
import { attributeSnippet, shippingSnippet } from "../snippets";
import type { DraftFinding, Rule } from "../types";

export const contentAttributesRule: Rule = {
  id: "content.attributes",

  evaluate(source: CheckResult): DraftFinding | null {
    const runIds = runIdsReporting(source, "MISSING_ATTRIBUTE_EVIDENCE");
    if (runIds.length === 0) return null;

    return {
      severity: "high",
      title: "Product attributes are claimed in prose but carry no structured value",
      evidence: runIds.map((runId) => ({
        agent_run_id: runId,
        fact: "The agent flagged an attribute claim as unevidenced while a competitor stated it clearly",
        references: [
          `agent_runs#${runId}.outcome.failure_codes`,
          "catalogue_snapshot.target_field_sources",
        ],
      })),
      derived_from: runIds,
      addresses_failure_codes: ["MISSING_ATTRIBUTE_EVIDENCE"],
      recommendation: {
        action: "Emit one additionalProperty per attribute a buyer would filter on, server-side",
        surface: "structured_data",
        effort: "low",
        owner: "web",
        snippet_label: "Product JSON-LD",
        snippet: attributeSnippet(missingAttributes(source)),
      },
    };
  },
};

const SHIPPING_CODES: FailureCode[] = ["SHIPPING_INFO_NOT_FOUND", "OUTRANKED_BY_COMPETITOR"];

export const contentShippingRule: Rule = {
  id: "content.shipping",

  evaluate(source: CheckResult): DraftFinding | null {
    const runIds = runIdsReporting(source, "SHIPPING_INFO_NOT_FOUND");
    if (runIds.length === 0) return null;

    // Only claim OUTRANKED_BY_COMPETITOR when the same runs actually reported it,
    // or validation rejects the finding.
    const scoped = new Set(runIds);
    const observed = SHIPPING_CODES.filter((code) =>
      runIdsReporting(source, code).some((id) => scoped.has(id)),
    );

    return {
      severity: "medium",
      title: "Shipping terms are absent from the product page",
      evidence: runIds.map((runId) => ({
        agent_run_id: runId,
        fact: "A shipping-sensitive agent dropped the product and chose a competitor that states free shipping inline",
        references: [
          `agent_runs#${runId}.observations.shipping_information_found`,
          `agent_runs#${runId}.ranked_candidates`,
        ],
      })),
      derived_from: runIds,
      addresses_failure_codes: observed,
      recommendation: {
        action: "State shipping cost and delivery window as structured data on the offer, not only at checkout",
        surface: "content_quality",
        effort: "low",
        owner: "content",
        snippet_label: "Shipping details",
        snippet: shippingSnippet(),
      },
    };
  },
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && bun test src/evaluate/rules/structured.test.ts src/evaluate/rules/content.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/evaluate/rules/structured.ts backend/src/evaluate/rules/content.ts backend/src/evaluate/rules/structured.test.ts backend/src/evaluate/rules/content.test.ts
git commit -m "feat: add structured-data and content rules"
```

---

### Task 7: Registry, ranking, and the orchestrator

This is where the workstream becomes a deliverable: run every rule, rank the survivors, assign ids from that order, and refuse to return anything that fails `assertFindings`. The golden test compares against the committed fixture.

**Files:**
- Create: `backend/src/evaluate/rules/index.ts`
- Create: `backend/src/evaluate/rank.ts`
- Create: `backend/src/evaluate/evaluate.ts`
- Test: `backend/src/evaluate/rank.test.ts`
- Test: `backend/src/evaluate/evaluate.test.ts`

**Interfaces:**
- Consumes: all five rule modules
- Produces:
  - `RULES: readonly Rule[]`
  - `rankDrafts(drafts: { rule: Rule; draft: DraftFinding }[]): Finding[]`
  - `evaluate(source: CheckResult): Finding[]`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/evaluate/rank.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { DraftFinding, Rule } from "./types";
import { rankDrafts } from "./rank";

function draft(severity: DraftFinding["severity"], runs: string[]): DraftFinding {
  return {
    severity,
    title: "t",
    evidence: [{ agent_run_id: null, fact: "f", references: ["site_audit.llms_txt"] }],
    derived_from: runs,
    addresses_failure_codes: ["NO_LLMS_TXT"],
    recommendation: {
      action: "a", surface: "discoverability", effort: "low", owner: "web",
      snippet_label: "l", snippet: "s",
    },
  };
}

const rule = (id: string): Rule => ({ id, evaluate: () => null });

describe("rankDrafts", () => {
  test("orders by number of runs unblocked, descending", () => {
    const out = rankDrafts([
      { rule: rule("b"), draft: draft("high", ["ar_001"]) },
      { rule: rule("a"), draft: draft("high", ["ar_001", "ar_002"]) },
    ]);
    expect(out.map((f) => f.derived_from.length)).toEqual([2, 1]);
  });

  test("breaks a count tie by severity", () => {
    const out = rankDrafts([
      { rule: rule("a"), draft: draft("medium", ["ar_001"]) },
      { rule: rule("b"), draft: draft("critical", ["ar_001"]) },
    ]);
    expect(out.map((f) => f.severity)).toEqual(["critical", "medium"]);
  });

  test("breaks a remaining tie by rule id, so ordering is deterministic", () => {
    const out = rankDrafts([
      { rule: rule("protocol.llms_txt"), draft: draft("medium", ["ar_001"]) },
      { rule: rule("content.shipping"), draft: draft("medium", ["ar_001"]) },
    ]);
    expect(out.map((f) => f.finding_id)).toEqual(["F001", "F002"]);
  });

  test("assigns ids from rank order", () => {
    const out = rankDrafts([
      { rule: rule("a"), draft: draft("high", ["ar_001"]) },
      { rule: rule("b"), draft: draft("critical", ["ar_001", "ar_002"]) },
    ]);
    expect(out.map((f) => f.finding_id)).toEqual(["F001", "F002"]);
    expect(out[0].severity).toBe("critical");
  });
});
```

Create `backend/src/evaluate/evaluate.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { validateFindings } from "@contracts/validate-findings";
import { loadExampleCheckResult, loadExampleFindings } from "../fixtures";
import { evaluate } from "./evaluate";

const source = loadExampleCheckResult();

describe("evaluate", () => {
  test("its output passes the shared validator", () => {
    expect(validateFindings(evaluate(source), source)).toEqual([]);
  });

  test("reproduces the golden fixture's ids, order, severities and codes", () => {
    const actual = evaluate(source);
    const expected = loadExampleFindings();

    expect(actual.map((f) => f.finding_id)).toEqual(expected.map((f) => f.finding_id));
    expect(actual.map((f) => f.severity)).toEqual(expected.map((f) => f.severity));
    expect(actual.map((f) => f.derived_from)).toEqual(expected.map((f) => f.derived_from));
    expect(actual.map((f) => [...f.addresses_failure_codes].sort())).toEqual(
      expected.map((f) => [...f.addresses_failure_codes].sort()),
    );
    expect(actual.map((f) => f.recommendation.surface)).toEqual(
      expected.map((f) => f.recommendation.surface),
    );
  });

  test("emits no finding for an infrastructure-only failure", () => {
    // ar_006 reported only AGENT_TIMEOUT. No finding may cite it.
    for (const finding of evaluate(source)) {
      expect(finding.derived_from).not.toContain("ar_006");
      expect(finding.addresses_failure_codes).not.toContain("AGENT_TIMEOUT");
    }
  });

  test("returns an empty array when nothing failed", () => {
    const clean = loadExampleCheckResult();
    for (const run of clean.agent_runs) run.outcome.failure_codes = [];
    expect(evaluate(clean)).toEqual([]);
  });

  test("every finding carries a non-empty snippet", () => {
    for (const finding of evaluate(source)) {
      expect(finding.recommendation.snippet.length).toBeGreaterThan(0);
      expect(finding.recommendation.snippet_label.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && bun test src/evaluate/rank.test.ts src/evaluate/evaluate.test.ts`
Expected: FAIL — cannot find `./rank` and `./evaluate`.

- [ ] **Step 3: Write `backend/src/evaluate/rules/index.ts`**

```ts
import { contentAttributesRule, contentShippingRule } from "./content";
import { discoverySourcesRule } from "./discovery";
import { protocolLlmsTxtRule, protocolManifestRule } from "./protocol";
import { structuredOfferRule } from "./structured";
import type { Rule } from "../types";

/** Registration order is irrelevant — output order comes from ranking. */
export const RULES: readonly Rule[] = [
  discoverySourcesRule,
  protocolManifestRule,
  protocolLlmsTxtRule,
  structuredOfferRule,
  contentAttributesRule,
  contentShippingRule,
];
```

- [ ] **Step 4: Write `backend/src/evaluate/rank.ts`**

```ts
/**
 * Ordering and id assignment.
 *
 * Priority is array order and ids follow from it, so neither is ever stored on
 * a rule — a stored copy of a derived value drifts from its source.
 */

import type { Finding, Severity } from "@contracts/finding";
import type { DraftFinding, Rule } from "./types";

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2 };

export interface RankedDraft {
  rule: Rule;
  draft: DraftFinding;
}

/** Most runs unblocked first, then severity, then rule id for determinism. */
export function rankDrafts(drafts: RankedDraft[]): Finding[] {
  return [...drafts]
    .sort((a, b) => {
      const byImpact = b.draft.derived_from.length - a.draft.derived_from.length;
      if (byImpact !== 0) return byImpact;

      const bySeverity = SEVERITY_ORDER[a.draft.severity] - SEVERITY_ORDER[b.draft.severity];
      if (bySeverity !== 0) return bySeverity;

      return a.rule.id.localeCompare(b.rule.id);
    })
    .map((entry, index) => ({
      finding_id: `F${String(index + 1).padStart(3, "0")}`,
      ...entry.draft,
    }));
}
```

- [ ] **Step 5: Write `backend/src/evaluate/evaluate.ts`**

```ts
/**
 * Evaluate: CheckResult in, ranked Finding[] out.
 *
 * The final assert is deliberate. A finding whose references do not resolve, or
 * that claims a code the run never reported, is exactly the guesswork this
 * product replaces — better to fail loudly here than to render it.
 */

import type { CheckResult } from "@contracts/check-result";
import type { Finding } from "@contracts/finding";
import { assertFindings } from "@contracts/validate-findings";
import { rankDrafts, type RankedDraft } from "./rank";
import { RULES } from "./rules";

export function evaluate(source: CheckResult): Finding[] {
  const drafts: RankedDraft[] = [];

  for (const rule of RULES) {
    const draft = rule.evaluate(source);
    if (draft) drafts.push({ rule, draft });
  }

  const findings = rankDrafts(drafts);
  assertFindings(findings, source);
  return findings;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && bun test src/evaluate/rank.test.ts src/evaluate/evaluate.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 7: Run the whole suite and typecheck**

Run: `cd backend && bun test && bun run typecheck`
Expected: all tests pass; typecheck silent.

- [ ] **Step 8: Verify the no-category rule holds**

Run: `grep -rniE "soap|shoe|skincare|lamp|waterproof|running" backend/src --include=*.ts | grep -v ".test.ts"`
Expected: no output. Category words may appear in tests (they assert against fixture data); they must not appear in production source.

- [ ] **Step 9: Commit**

```bash
git add backend/src/evaluate/rules/index.ts backend/src/evaluate/rank.ts backend/src/evaluate/evaluate.ts backend/src/evaluate/rank.test.ts backend/src/evaluate/evaluate.test.ts
git commit -m "feat: rank findings and orchestrate evaluation"
```

---

### Task 8: HTTP endpoint and persistence

Exposes Evaluate over the API the frontend calls, and stores the result so Recommend can reload without re-deriving.

**Files:**
- Create: `backend/src/http/errors.ts`
- Create: `backend/src/store/findings.ts`
- Create: `backend/src/http/evaluate.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/store/findings.test.ts`
- Test: `backend/src/http/evaluate.test.ts`

**Interfaces:**
- Consumes: `evaluate` (Task 7), `assertCheckResult`
- Produces:
  - `openFindingsStore(path?: string): FindingsStore` with `save(runId: string, findings: Finding[]): void` and `load(runId: string): Finding[] | null`
  - `evaluateRoutes: Hono` mounting `POST /runs/:id/evaluate`
  - `jsonError(c, status, code, message)`

- [ ] **Step 1: Write the failing store test**

Create `backend/src/store/findings.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { loadExampleFindings } from "../fixtures";
import { openFindingsStore } from "./findings";

describe("findings store", () => {
  test("round-trips findings for a run", () => {
    const store = openFindingsStore(":memory:");
    const findings = loadExampleFindings();
    store.save("run_1", findings);
    expect(store.load("run_1")).toEqual(findings);
  });

  test("returns null for a run it has never seen", () => {
    expect(openFindingsStore(":memory:").load("nope")).toBeNull();
  });

  test("overwrites on re-evaluation rather than appending", () => {
    const store = openFindingsStore(":memory:");
    store.save("run_1", loadExampleFindings());
    store.save("run_1", loadExampleFindings().slice(0, 2));
    expect(store.load("run_1")!.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && bun test src/store/findings.test.ts`
Expected: FAIL — `Cannot find module './findings'`.

- [ ] **Step 3: Write `backend/src/store/findings.ts`**

```ts
/** Persistence for Evaluate's output. One row per run; re-evaluation replaces it. */

import { Database } from "bun:sqlite";
import type { Finding } from "@contracts/finding";

export interface FindingsStore {
  save(runId: string, findings: Finding[]): void;
  load(runId: string): Finding[] | null;
}

export function openFindingsStore(path = "happy2.sqlite"): FindingsStore {
  const db = new Database(path);
  db.run(`
    CREATE TABLE IF NOT EXISTS findings (
      run_id TEXT PRIMARY KEY,
      document TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  return {
    save(runId, findings) {
      db.query(
        `INSERT INTO findings (run_id, document, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(run_id) DO UPDATE SET document = ?2, created_at = ?3`,
      ).run(runId, JSON.stringify(findings), new Date().toISOString());
    },

    load(runId) {
      const row = db.query("SELECT document FROM findings WHERE run_id = ?1").get(runId) as
        | { document: string }
        | null;
      return row ? (JSON.parse(row.document) as Finding[]) : null;
    },
  };
}
```

- [ ] **Step 4: Run the store tests to verify they pass**

Run: `cd backend && bun test src/store/findings.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing route test**

Create `backend/src/http/evaluate.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { loadExampleCheckResult } from "../fixtures";
import { openFindingsStore } from "../store/findings";
import { createEvaluateRoutes } from "./evaluate";

function app() {
  return createEvaluateRoutes(openFindingsStore(":memory:"));
}

describe("POST /runs/:id/evaluate", () => {
  test("returns ranked findings for a valid CheckResult", async () => {
    const res = await app().request("/runs/run_1/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(loadExampleCheckResult()),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.findings.map((f: { finding_id: string }) => f.finding_id)).toEqual([
      "F001", "F002", "F003", "F004", "F005", "F006",
    ]);
  });

  test("rejects a body that is not a valid CheckResult", async () => {
    const res = await app().request("/runs/run_1/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ report_type: "wrong" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("invalid_check_result");
  });

  test("rejects a body that is not JSON", async () => {
    const res = await app().request("/runs/run_1/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_json");
  });

  test("persists the result so it can be reloaded", async () => {
    const store = openFindingsStore(":memory:");
    const routes = createEvaluateRoutes(store);
    await routes.request("/runs/run_7/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(loadExampleCheckResult()),
    });
    expect(store.load("run_7")!.length).toBe(6);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd backend && bun test src/http/evaluate.test.ts`
Expected: FAIL — `Cannot find module './evaluate'`.

- [ ] **Step 7: Write `backend/src/http/errors.ts`**

```ts
import type { Context } from "hono";

/** The statuses this API actually returns. Keeps the error shape honest. */
export type ErrorStatus = 400 | 404 | 409 | 422 | 500;

/** Errors are JSON with the class carried by the status. Never a 200 with an error body. */
export function jsonError(
  c: Context,
  status: ErrorStatus,
  code: string,
  message: string,
  details?: unknown,
) {
  return c.json({ error: { code, message, ...(details ? { details } : {}) } }, status);
}
```

- [ ] **Step 8: Write `backend/src/http/evaluate.ts`**

```ts
import { Hono } from "hono";
import { validateCheckResult } from "@contracts/validate";
import type { CheckResult } from "@contracts/check-result";
import { evaluate } from "../evaluate/evaluate";
import type { FindingsStore } from "../store/findings";
import { jsonError } from "./errors";

export function createEvaluateRoutes(store: FindingsStore): Hono {
  const app = new Hono();

  app.post("/runs/:id/evaluate", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonError(c, 400, "invalid_json", "Request body is not valid JSON");
    }

    const errors = validateCheckResult(body);
    if (errors.length > 0) {
      return jsonError(
        c,
        422,
        "invalid_check_result",
        "Body does not conform to the CheckResult contract",
        errors,
      );
    }

    const findings = evaluate(body as CheckResult);
    store.save(c.req.param("id"), findings);
    return c.json({ findings });
  });

  return app;
}
```

- [ ] **Step 9: Run the route tests to verify they pass**

Run: `cd backend && bun test src/http/evaluate.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 10: Wire it into `backend/src/index.ts`**

Replace the file's contents:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createEvaluateRoutes } from "./http/evaluate";
import { openFindingsStore } from "./store/findings";

const app = new Hono();

app.use("/*", cors({ origin: "http://localhost:3200" }));

app.get("/health", (c) => c.json({ ok: true }));

app.route("/", createEvaluateRoutes(openFindingsStore()));

export default { port: 3201, fetch: app.fetch };
```

- [ ] **Step 11: Verify the server starts and answers**

Run: `cd backend && bun run dev &` then `sleep 2 && curl -s localhost:3201/health`
Expected: `{"ok":true}`. Stop the server afterwards.

- [ ] **Step 12: Run the whole suite and typecheck**

Run: `cd backend && bun test && bun run typecheck`
Expected: all tests pass; typecheck silent.

- [ ] **Step 13: Add the sqlite file to `.gitignore`**

Append to the repo-root `.gitignore`:

```
*.sqlite
```

- [ ] **Step 14: Commit**

```bash
git add backend/src/http backend/src/store backend/src/index.ts .gitignore
git commit -m "feat: expose POST /runs/:id/evaluate with sqlite persistence"
```

---

### Task 9: Converge the frontend `Finding` with the shared contract

`frontend/src/lib/types.ts` still declares its own camelCase `Finding`, and the Recommend screen renders it. Two declarations of one concept is how the two halves drift apart, and the backend now emits the snake_case shape. This task deletes the duplicate and points the screen at the contract.

**Files:**
- Modify: `frontend/tsconfig.json`
- Modify: `frontend/next.config.ts`
- Modify: `frontend/src/lib/types.ts:96-115` (the `Finding` and `Severity` declarations)
- Modify: `frontend/src/lib/fixtures.ts` (the `FINDINGS` constant)
- Modify: `frontend/src/app/runs/[id]/recommend/page.tsx`

**Interfaces:**
- Consumes: `Finding`, `Severity` from `@contracts/finding`; `shoppersAffected` from `@contracts/finding`
- Produces: a Recommend screen rendering contract-shaped findings

- [ ] **Step 1: Let the frontend import from `shared/`**

Add the path alias to `frontend/tsconfig.json` `compilerOptions.paths`:

```json
"paths": {
  "@/*": ["./src/*"],
  "@contracts/*": ["../shared/contracts/*"],
  "@fixtures/*": ["../shared/fixtures/*"]
}
```

Next.js does not compile files outside the project root by default, so enable it in `frontend/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { externalDir: true },
};

export default nextConfig;
```

- [ ] **Step 2: Delete the duplicate declarations from `frontend/src/lib/types.ts`**

Remove the local `Severity` type and the entire `Finding` interface, and re-export the contract instead so existing `@/lib/types` imports keep working:

```ts
/**
 * `Finding` and `Severity` are defined once, in the shared contract, and
 * re-exported here so the screens can keep importing from `@/lib/types`.
 * Do not redeclare them — the backend emits the contract shape.
 */
export type { Finding, Severity, Surface, Effort, Owner } from "@contracts/finding";
```

Leave the rest of the file (`StageName`, `AgentPlan`, `AgentEvent`, `AgentState`, `RunInput`) untouched.

- [ ] **Step 3: Replace the `FINDINGS` fixture with the committed one**

In `frontend/src/lib/fixtures.ts`, delete the hand-written `FINDINGS` array and its `Finding` import, and re-export the shared fixture:

```ts
import type { Finding } from "@contracts/finding";
import findingsFixture from "@fixtures/findings.example.json";

/**
 * Placeholder findings until the screen reads a real run. Sourced from the
 * committed fixture so the frontend and backend cannot disagree about the shape.
 */
export const FINDINGS: readonly Finding[] = findingsFixture as unknown as Finding[];
```

- [ ] **Step 4: Update the Recommend screen's field access**

In `frontend/src/app/runs/[id]/recommend/page.tsx`, the finding loop currently reads camelCase fields. Change the import and the six field reads:

```tsx
import { shoppersAffected } from "@contracts/finding";
```

Then, inside `FINDINGS.map((finding) => { ... })`:

| Was | Becomes |
| --- | --- |
| `finding.key` | `finding.finding_id` |
| `finding.evidence` | `finding.evidence.map((e) => e.fact).join(" ")` |
| `finding.impact` | `` `+${shoppersAffected(finding)} agents` `` |
| `finding.fix` | `finding.recommendation.action` |
| `finding.surface` | `finding.recommendation.surface` |
| `finding.effort` | `finding.recommendation.effort` |
| `finding.owner` | `finding.recommendation.owner` |
| `finding.snippetLabel` | `finding.recommendation.snippet_label` |
| `finding.snippet` | `finding.recommendation.snippet` |

`finding.severity` and `finding.title` are unchanged. The two `openFindings[finding.key]` / `toggleFinding(finding.key)` calls become `finding.finding_id`.

- [ ] **Step 5: Verify the typecheck fails on anything missed**

Run: `cd frontend && npm install && npm run typecheck`
Expected: PASS. If it reports a remaining camelCase access, fix that line — the type error is the point of this task.

- [ ] **Step 6: Verify the screen still renders**

Run: `cd frontend && npm run dev` then open `http://localhost:3200/runs/demo/recommend`
Expected: six findings, each with a severity chip, an evidence line, an impact count, and an expandable snippet. Stop the server afterwards.

- [ ] **Step 7: Commit**

```bash
git add frontend/tsconfig.json frontend/next.config.ts frontend/src/lib/types.ts frontend/src/lib/fixtures.ts "frontend/src/app/runs/[id]/recommend/page.tsx"
git commit -m "refactor: render findings from the shared contract, drop the camelCase duplicate"
```

---

### Task 10: Results dashboard

`RunScores` already carries everything the dashboard needs — hit rate, discovery rate, mean rank, the per-query breakdown that answers "which prompts worked", competitors that outranked the brand, and the four surface scores. This task renders it.

**Files:**
- Create: `frontend/src/lib/scores.ts`
- Create: `frontend/src/lib/scores.test.ts`
- Create: `frontend/src/app/runs/[id]/dashboard/page.tsx`
- Create: `frontend/src/app/runs/[id]/dashboard/dashboard.module.css`
- Modify: `frontend/src/components/Stepper.tsx`

**Interfaces:**
- Consumes: `RunScores`, `CheckResult` from `@contracts/check-result`
- Produces: `formatRate(value: number): string`, `formatRank(value: number | null): string`, `queryOutcomes(scores: RunScores, config: EvaluationConfig): QueryOutcome[]`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/scores.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { CheckResult } from "@contracts/check-result";
import checkResult from "@fixtures/check-result.example.json";
import { formatRank, formatRate, queryOutcomes } from "./scores";

const source = checkResult as unknown as CheckResult;

describe("formatRate", () => {
  test("renders a fraction as a whole percentage", () => {
    expect(formatRate(0.3333)).toBe("33%");
    expect(formatRate(1)).toBe("100%");
    expect(formatRate(0)).toBe("0%");
  });
});

describe("formatRank", () => {
  test("renders a rank, and an em dash when the brand never ranked", () => {
    expect(formatRank(1.5)).toBe("1.5");
    expect(formatRank(null)).toBe("—");
  });
});

describe("queryOutcomes", () => {
  test("joins each score row to the query text that produced it", () => {
    const rows = queryOutcomes(source.scores, source.evaluation_config);
    expect(rows).toHaveLength(6);
    expect(rows[0].text).toContain("waterproof trail running shoes");
    expect(rows[0].recommended).toBe(true);
    expect(rows[2].recommended).toBe(false);
  });

  test("orders recommended queries first, so what worked reads at the top", () => {
    const rows = queryOutcomes(source.scores, source.evaluation_config);
    const flags = rows.map((r) => r.recommended);
    expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && bunx bun test src/lib/scores.test.ts`
Expected: FAIL — `Cannot find module './scores'`. (Bun is used only as the test runner here; the app still builds with Next.)

- [ ] **Step 3: Write `frontend/src/lib/scores.ts`**

```ts
/** Presentation helpers for the dashboard. Pure; no formatting logic in the view. */

import type { EvaluationConfig, RunScores } from "@contracts/check-result";

export interface QueryOutcome {
  queryId: string;
  text: string;
  intent: string;
  discovered: boolean;
  recommended: boolean;
  rank: number | null;
}

export function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatRank(value: number | null): string {
  return value === null ? "—" : String(value);
}

/** Score rows joined to their query text, recommended first. */
export function queryOutcomes(scores: RunScores, config: EvaluationConfig): QueryOutcome[] {
  const byId = new Map(config.queries.map((q) => [q.query_id, q]));

  return scores.by_query
    .map((row) => {
      const query = byId.get(row.query_id);
      return {
        queryId: row.query_id,
        text: query?.text ?? row.query_id,
        intent: query?.intent ?? "unknown",
        discovered: row.discovered,
        recommended: row.recommended,
        rank: row.rank,
      };
    })
    .sort((a, b) => Number(b.recommended) - Number(a.recommended));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && bunx bun test src/lib/scores.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write `frontend/src/app/runs/[id]/dashboard/dashboard.module.css`**

```css
.screen { padding: 32px 40px 80px; }
.column { max-width: 1040px; margin: 0 auto; display: flex; flex-direction: column; gap: 32px; }

.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.tile { border: 1px solid var(--line, #e4e4e7); border-radius: 8px; padding: 16px; }
.tileValue { font-size: 32px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.tileLabel { font-size: 12px; color: var(--muted, #71717a); margin-top: 6px; }

.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { text-align: left; font-weight: 500; color: var(--muted, #71717a); padding: 8px 12px; border-bottom: 1px solid var(--line, #e4e4e7); }
.table td { padding: 10px 12px; border-bottom: 1px solid var(--line, #f4f4f5); vertical-align: top; }
.queryText { max-width: 460px; }
.hit { color: #0b8a5d; font-weight: 500; }
.miss { color: #d02a2a; font-weight: 500; }
.rank { font-variant-numeric: tabular-nums; }

.bars { display: flex; flex-direction: column; gap: 12px; }
.bar { display: grid; grid-template-columns: 200px 1fr 48px; align-items: center; gap: 12px; font-size: 13px; }
.barTrack { height: 6px; border-radius: 3px; background: var(--line, #e4e4e7); overflow: hidden; }
.barFill { height: 100%; background: currentColor; }
.barValue { text-align: right; font-variant-numeric: tabular-nums; }

@media (max-width: 900px) {
  .tiles { grid-template-columns: repeat(2, 1fr); }
  .bar { grid-template-columns: 120px 1fr 40px; }
}
```

- [ ] **Step 6: Write `frontend/src/app/runs/[id]/dashboard/page.tsx`**

```tsx
"use client";

import type { CheckResult } from "@contracts/check-result";
import checkResultFixture from "@fixtures/check-result.example.json";

import { SectionLabel } from "@/components/SectionLabel";
import { formatRank, formatRate, queryOutcomes } from "@/lib/scores";
import styles from "./dashboard.module.css";

// Placeholder source until the run resource is wired up. Same shape either way.
const source = checkResultFixture as unknown as CheckResult;

const SURFACE_LABELS: [keyof CheckResult["scores"]["surfaces"], string][] = [
  ["discoverability", "Search & discovery"],
  ["structured_data", "Structured product data"],
  ["agent_protocol", "Agent protocol (ACP/UCP)"],
  ["content_quality", "Content quality"],
];

export default function DashboardScreen() {
  const { scores, evaluation_config: config } = source;
  const rows = queryOutcomes(scores, config);
  const recommended = rows.filter((r) => r.recommended).length;

  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        <section>
          <SectionLabel>Run results</SectionLabel>
          <div className={styles.tiles}>
            <div className={styles.tile}>
              <div className={styles.tileValue}>{formatRate(scores.hit_rate)}</div>
              <div className={styles.tileLabel}>Recommended by agents</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileValue}>{formatRate(scores.discovery_rate)}</div>
              <div className={styles.tileLabel}>Found at all</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileValue}>{formatRank(scores.mean_rank)}</div>
              <div className={styles.tileLabel}>Mean rank when recommended</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileValue}>
                {recommended}/{rows.length}
              </div>
              <div className={styles.tileLabel}>Agents that recommended you</div>
            </div>
          </div>
        </section>

        <section>
          <SectionLabel>Which prompts worked</SectionLabel>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Query</th>
                <th>Intent</th>
                <th>Found</th>
                <th>Recommended</th>
                <th>Rank</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.queryId}>
                  <td className={styles.queryText}>{row.text}</td>
                  <td>{row.intent}</td>
                  <td className={row.discovered ? styles.hit : styles.miss}>
                    {row.discovered ? "yes" : "no"}
                  </td>
                  <td className={row.recommended ? styles.hit : styles.miss}>
                    {row.recommended ? "yes" : "no"}
                  </td>
                  <td className={styles.rank}>{formatRank(row.rank)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <SectionLabel>Who outranked you</SectionLabel>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Product</th>
                <th>Times ahead</th>
              </tr>
            </thead>
            <tbody>
              {scores.competitors_ahead.map((competitor) => (
                <tr key={competitor.url}>
                  <td>
                    <a href={competitor.url} rel="noreferrer noopener" target="_blank">
                      {competitor.name}
                    </a>
                  </td>
                  <td className={styles.rank}>{competitor.times_ahead}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <SectionLabel>Surface scores</SectionLabel>
          <div className={styles.bars}>
            {SURFACE_LABELS.map(([key, label]) => (
              <div className={styles.bar} key={key}>
                <span>{label}</span>
                <span className={styles.barTrack}>
                  <span
                    className={styles.barFill}
                    style={{ width: `${scores.surfaces[key]}%` }}
                  />
                </span>
                <span className={styles.barValue}>{scores.surfaces[key]}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Add the dashboard to the stepper**

Open `frontend/src/components/Stepper.tsx` and add a `dashboard` entry after `recommend`, following the existing step shape in that file. Keep the label short — "Dashboard".

- [ ] **Step 8: Verify**

Run: `cd frontend && npm run typecheck`
Expected: PASS.

Run: `cd frontend && npm run dev` then open `http://localhost:3200/runs/demo/dashboard`
Expected: four stat tiles reading 33%, 67%, 1.5, 2/6; a six-row query table with the two recommended queries first; three competitors; four surface bars. Stop the server afterwards.

- [ ] **Step 9: Commit**

```bash
git add "frontend/src/app/runs/[id]/dashboard" frontend/src/lib/scores.ts frontend/src/lib/scores.test.ts frontend/src/components/Stepper.tsx
git commit -m "feat: add results dashboard reading RunScores"
```

---

## Done when

- `cd backend && bun test` passes with no network access.
- `cd backend && bun run typecheck` is silent.
- `evaluate(loadExampleCheckResult())` reproduces `findings.example.json`'s ids, order, severities, `derived_from` and codes, and passes `assertFindings`.
- No finding cites `ar_006` or claims `AGENT_TIMEOUT`.
- `grep -rniE "soap|shoe|skincare|lamp|waterproof|running" backend/src --include=*.ts | grep -v ".test.ts"` returns nothing.
- `POST /runs/:id/evaluate` returns ranked findings for a valid body, 422 for an invalid one, 400 for malformed JSON.
- `cd frontend && npm run typecheck` is silent, and `grep -rn "snippetLabel\|finding.key\|finding.fix" frontend/src` returns nothing.
- `/runs/demo/dashboard` renders hit rate, the per-query table, competitors ahead, and the four surface bars.

## Not in this plan

Check (Dev A), the live feed and SSE, BYOK, and `DEMO_MODE`.
