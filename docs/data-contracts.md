# Data contracts

These types are the interfaces between workstreams. **They are shared property.**
Changing one is a cross-team change: propose it, get agreement, then update this
document, the TypeScript source, and the fixture in a single commit.

The first implementation commit extracts these into `shared/contracts/` as the
single source of truth, imported by both `frontend/` and `backend/`. Until then,
this document is authoritative.

---

## `CheckResult`

The complete output of a Check run, and the only input Evaluate needs. Dev B and
the frontend build against a committed fixture of this shape while Check is still
being written.

```ts
interface CheckResult {
  runId: string;
  brandId: string;
  createdAt: string;              // ISO 8601
  completedAt: string | null;
  status: "running" | "complete" | "error";
  error: string | null;

  input: RunInput;
  catalogue: CatalogueSnapshot;
  personas: PersonaBrief[];       // ~20, generated per run
  shoppers: ShopperResult[];      // one per persona
  siteAudit: SiteAudit;
  scores: RunScores;

  /** Hosted artifact URLs supplied to agents this run. Empty on a first run. */
  hostedSources: string[];
}
```

## `RunInput`

```ts
interface RunInput {
  storeUrl: string;
  /** Optional overrides; discovered from the store when absent. */
  feedUrl?: string;
  sitemapUrl?: string;
  /** SKUs or product URLs this run targets. Empty = whole catalogue. */
  targetProducts: string[];
  /** Which agent tiers to run. */
  tiers: ("shared-search" | "native-search")[];
  personaCount: number;           // default 20
}
```

Brand-supplied API keys are **not** part of this type. They arrive on the request,
live in memory for the run, and are never persisted or serialised.

## `CatalogueSnapshot`

What we could actually read from the brand's store. Evaluate diagnoses gaps from
this plus `SiteAudit`.

```ts
interface CatalogueSnapshot {
  domain: string;                 // canonical host, e.g. "northwind.supply"
  fetchedAt: string;
  products: CatalogueProduct[];
  /** Products referenced by the sitemap or feed we could not fetch or parse. */
  unreadable: { url: string; reason: string }[];
}

interface CatalogueProduct {
  id: string;                     // SKU when available, else canonical URL
  url: string;
  title: string | null;
  description: string | null;
  price: { amount: number; currency: string } | null;
  availability: string | null;
  attributes: Record<string, string>;
  /** Where each field came from, for the provenance display on Create. */
  sources: Record<string, "json-ld" | "raw-html" | "feed" | "meta" | "absent">;
}
```

## `PersonaBrief`

Generated per run from the catalogue. The archetype is a category-agnostic
constant; everything else is generated.

```ts
type IntentArchetype =
  | "budget-led" | "spec-led" | "gift" | "bulk" | "urgent"
  | "sustainability-led" | "comparison" | "novice"
  | "replacement" | "constraint-led";

interface PersonaBrief {
  id: string;                     // "P01"
  archetype: IntentArchetype;
  /** Short label for the UI, e.g. "Marathon trainee". Generated. */
  name: string;
  /** The natural-language request the agent shops with. Generated. */
  prompt: string;
  /** Hex, for the tile and swatch colours. */
  color: string;
  /** Three-letter mono tag for badges. */
  tag: string;
}
```

## `ShopperResult`

One agent's run. `transcript` drives the live feed; everything else drives the
dashboard and Evaluate.

```ts
interface ShopperResult {
  id: string;                     // "S01"
  personaId: string;
  agentKind: "shared-search" | "native-search";
  model: string;
  startedAt: string;
  finishedAt: string | null;

  queriesIssued: string[];
  citations: Citation[];          // ordered as the agent presented them

  hit: {
    found: boolean;
    rank: number | null;          // 1-indexed position in citations; null if absent
    matchKind: "product" | "domain" | "none";
    matchedProductId: string | null;
  };

  /** Products that outranked the brand. Empty when the brand ranked first. */
  competitorsAhead: { name: string; url: string; rank: number }[];

  /** Why the brand was not recommended. Present when found is false. */
  reason: string | null;

  transcript: AgentEvent[];
}

interface Citation {
  url: string;
  title: string | null;
  rank: number;                   // 1-indexed
  domain: string;
}
```

## `AgentEvent`

The live-feed wire shape. Emitted by both agent implementations, persisted, then
published over SSE. Every outbound API call the backend makes produces one.

```ts
type AgentEvent =
  | { type: "run.started";    t: number; ts: string; runId: string }
  | { type: "personas.ready"; t: number; ts: string; count: number }
  | { type: "agent.started";  t: number; ts: string; shopperId: string; personaId: string }
  | { type: "agent.query";    t: number; ts: string; shopperId: string; query: string }
  | { type: "agent.fetch";    t: number; ts: string; shopperId: string; url: string; status: number }
  | { type: "agent.api";      t: number; ts: string; shopperId: string; endpoint: string; ms: number; ok: boolean }
  | { type: "agent.citation"; t: number; ts: string; shopperId: string; citation: Citation }
  | { type: "agent.verdict";  t: number; ts: string; shopperId: string; hit: ShopperResult["hit"] }
  | { type: "agent.error";    t: number; ts: string; shopperId: string; message: string }
  | { type: "audit.probe";    t: number; ts: string; target: string; found: boolean }
  | { type: "run.complete";   t: number; ts: string; runId: string }
  | { type: "run.error";      t: number; ts: string; runId: string; message: string };
```

`t` is a monotonic per-run sequence number, used as the SSE event id so
`Last-Event-ID` reconnect replays exactly the missed events. `ts` is wall clock.

**No event may contain a credential.** `agent.api` records the endpoint and
timing, never headers or keys.

## `SiteAudit`

```ts
interface SiteAudit {
  llmsTxt:        ProbeResult;    // /llms.txt
  agentCommerce:  ProbeResult;    // /.well-known/agent-commerce
  ucp:            ProbeResult;    // /.well-known/ucp
  sitemap:        ProbeResult & { productsListed: number; productsTotal: number };
  robots:         ProbeResult & { allowsAgents: boolean };
  structuredData: {
    productsWithJsonLd: number;
    productsWithOffer: number;
    productsTotal: number;
  };
  /** Products whose price is absent from served HTML. */
  clientSidePrice: string[];
}

interface ProbeResult {
  url: string;
  found: boolean;
  status: number | null;
  note: string | null;
}
```

## `RunScores`

```ts
interface RunScores {
  hitRate: number;                // 0..1
  meanRank: number | null;        // over shoppers that found the brand
  byPersona: { personaId: string; found: boolean; rank: number | null }[];
  surfaces: {
    discoverability: number;      // 0..100
    structuredData: number;
    agentProtocol: number;
    contentQuality: number;
  };
}
```

## `Finding`

Evaluate's output. The shape already exists in `frontend/src/lib/types.ts` and
moves to the shared contract unchanged, with one addition.

```ts
interface Finding {
  key: string;
  severity: "critical" | "high" | "medium";
  title: string;
  evidence: string;               // must name specific shopper ids
  fix: string;
  impact: string;                 // e.g. "+4 shoppers"
  surface: string;
  effort: string;
  owner: string;
  snippetLabel: string;
  snippet: string;

  /** Shopper ids this finding was derived from. Must be non-empty. */
  derivedFrom: string[];
}
```

`derivedFrom` is the machine-checkable form of the evidence rule: a finding with
an empty `derivedFrom` fails validation and must not be emitted.

---

## HTTP surface

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/runs` | Create a run from `RunInput`; returns `{ runId }` |
| `GET` | `/runs/:id` | The run resource, including `CheckResult` when complete |
| `GET` | `/runs/:id/events` | SSE stream of `AgentEvent`; supports `Last-Event-ID` |
| `POST` | `/runs/:id/evaluate` | Produce `Finding[]` from the run's `CheckResult` |
| `POST` | `/runs/:id/create` | Generate artifacts; returns hosted URLs |
| `GET` | `/hosted/:brandId/*` | Serve generated artifacts to agents and brands |
| `GET` | `/health` | Liveness |

Errors are JSON: `{ error: { code, message } }`, with the HTTP status carrying
the class. Never return a 200 with an error body.
