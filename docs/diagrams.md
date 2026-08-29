# Diagrams

Two pictures of Happy2 as it actually runs, drawn from the code rather than
from intent. `docs/architecture.md` explains *why* the pieces are shaped this
way; this file shows *where they are*.

Everything here was checked against `backend/src/index.ts`, `render.yaml`,
`.github/workflows/`, and the frontend routes. Where the running system differs
from the design, the diagram shows the running system.

**Legend.** Solid boxes run today. Dashed grey boxes exist in the repo but are
not reached from `index.ts` — see [Dark code](#dark-code). Dashed edges are
conditional or alternate paths.

---

## 1 · System and deployment

```mermaid
flowchart LR
    classDef app fill:#e8f0fe,stroke:#2563eb,stroke-width:2px,color:#0b1e3d
    classDef ext fill:#f3e8ff,stroke:#7c3aed,stroke-width:2px,color:#2a0b4d
    classDef data fill:#e6f6ef,stroke:#0b8a5d,stroke-width:2px,color:#04301f
    classDef ci fill:#fff4e5,stroke:#c2760a,stroke-width:2px,color:#3d2600
    classDef edge fill:#fdecec,stroke:#d02a2a,stroke-width:2px,color:#4d0b0b
    classDef dark fill:#f4f4f5,stroke:#9aa0a6,stroke-width:1.5px,stroke-dasharray:5 4,color:#5f6368

    BRAND["👤 Brand<br/>browser"]

    subgraph SHIP ["🔁 Ship · GitHub Actions"]
        direction TB
        PUSH["📥 push to main"]
        CI["✅ ci.yml<br/>bun test · tsc --noEmit<br/>backend and frontend"]
        DEPY["🚀 deploy.yml<br/>matrix · backend and frontend"]
        RAPI["🔑 Render REST API<br/>trigger deploy · poll until live"]
        PUSH --> CI --> DEPY --> RAPI
    end

    subgraph HOST ["☁️ Render · singapore · free plan"]
        direction TB
        FE["🖥️ happy2-frontend<br/>Next.js 15 · node 22-slim<br/>NEXT_PUBLIC_API_BASE inlined at build"]
        BE["⚙️ happy2-backend<br/>Bun + Hono · oven/bun 1-slim<br/>orchestrate fire-and-forget · SSE"]
    end

    subgraph STATE ["🗄️ State"]
        direction TB
        PG["🐘 Render Postgres · lifehax<br/>created by hand, not by the blueprint<br/>free tier is deleted 30 days after creation"]
        SQ["💾 bun:sqlite fallback<br/>no DATABASE_URL · wiped every deploy"]
    end

    subgraph EXT ["🔌 Third-party"]
        direction TB
        BB["🤖 Browserbase + Stagehand<br/>3 concurrent browsers per key"]
        OAI["🧠 OpenAI Responses API · gpt-5-mini<br/>surface simulations · Stagehand act and observe"]
        CFG["⚡ Cloudflare AI Gateway<br/>Anthropic passthrough"]
        ANT["🅰️ Anthropic · claude-sonnet-5<br/>personas and written findings"]
    end

    STORE["🌐 The brand storefront<br/>robots.txt · sitemap · products.json<br/>llms.txt · /.well-known"]

    CR["☁️ Cloud Run via deploy.sh<br/>alternate path · needs billing<br/>max-instances 1 · no-cpu-throttling"]

    RAPI -->|"redeploy by service id"| FE
    RAPI -->|"redeploy by service id"| BE
    RAPI -.->|"not used by CI"| CR

    BRAND -->|"HTTPS"| FE
    FE -->|"POST /runs then SSE on /runs/id/events"| BE

    BE -->|"finished run · one JSON document"| PG
    BE -.->|"when DATABASE_URL is unset"| SQ

    BE -->|"plain fetch · this is the evidence"| STORE
    BE --> BB
    BB -->|"real browser sessions · the visual"| STORE
    BE --> OAI
    OAI -->|"hosted web_search tool"| STORE
    BE --> CFG --> ANT

    class FE,BE app
    class BB,OAI,CFG,ANT,STORE ext
    class PG,SQ data
    class PUSH,CI,DEPY,RAPI ci
    class BRAND app
    class CR dark
```

### Things worth knowing that the boxes cannot say

- **`NEXT_PUBLIC_API_BASE` is baked into the frontend image.** Next inlines it
  into the client bundle at build time, so changing the backend URL means
  rebuilding the frontend, not editing a variable.
- **Both images build from the repo root**, because `backend/` and `frontend/`
  both import `shared/` through tsconfig path aliases.
- **Render's GitHub App is not installed on this repo.** `deploy.yml` drives
  Render's REST API by service id instead, which redeploys existing services
  but provisions nothing — the Postgres instance is dashboard state, not repo
  state, even though `render.yaml` declares it.
- **A free Render Postgres is deleted 30 days after creation.** It is the only
  hard deadline on this deployment.
- **Evidence comes from `fetch`, never from a browser session.** The browsers
  are the visual; `checks.ts` is the measurement. That split is what keeps hard
  rule 5 in `AGENTS.md` honest.

---

## 2 · Feature graph

### The journey

Four numbered steps plus two side sections. The step is read off the route
segment, so a URL is always enough to restore the view.

```mermaid
flowchart TB
    classDef screen fill:#e8f0fe,stroke:#2563eb,stroke-width:2px,color:#0b1e3d
    classDef side fill:#eef2f6,stroke:#5b6b7c,stroke-width:2px,color:#1b2733
    classDef api fill:#fff4e5,stroke:#c2760a,stroke-width:2px,color:#3d2600
    classDef dark fill:#f4f4f5,stroke:#9aa0a6,stroke-width:1.5px,stroke-dasharray:5 4,color:#5f6368

    HOME["🏠 /<br/>redirects to a run"]

    subgraph FLOW ["The four steps"]
        direction LR
        S1["1️⃣ Input<br/>store URL · feed · SKUs"]
        S2["2️⃣ Check<br/>live agents and surface consoles"]
        S3["3️⃣ Recommend<br/>findings · readiness · export"]
        S4["4️⃣ Dashboard<br/>attrition · surface radar · past runs"]
        S1 --> S2 --> S3 --> S4
    end

    PERS["👥 Personas<br/>edit briefs for this store"]
    HIST["🕘 History<br/>past runs, newest first"]
    AGENT["🔍 Agent detail<br/>drill-down from Check"]

    POSTRUN["📮 POST /runs<br/>returns 201 with a run id"]
    SSE["📡 GET /runs/id/events<br/>SSE · replays from the start<br/>memory only · 404 for a saved run"]
    DOC["📄 GET /runs/id<br/>memory, falling back to the database<br/>hydrate maps it onto provider state"]
    OVR["🧾 GET and PUT /stores/host/personas"]
    LIST["📚 GET /runs"]
    EVAL["🧮 POST /runs/id/evaluate<br/>works and is tested · no screen calls it"]

    HOME --> S1
    S1 -->|"startRun"| POSTRUN
    POSTRUN --> SSE
    SSE -->|"RunProvider folds every message into state"| S2
    S2 --> AGENT
    S2 -.->|"same run context"| S3
    S3 -.-> S4
    S4 --> LIST
    HIST --> LIST
    HIST -->|"open a past run"| DOC
    DOC -->|"restores on mount"| S2
    DOC -->|"restores on mount"| S4
    DOC -.->|"still running · keep following"| SSE
    PERS --> OVR
    OVR -.->|"seeds the next run"| POSTRUN
    S3 -.-> EVAL

    class S1,S2,S3,S4,HOME screen
    class PERS,HIST,AGENT side
    class POSTRUN,SSE,OVR,LIST,DOC api
    class EVAL dark
```

### What a run actually does

`POST /runs` returns immediately and `orchestrate()` continues in the
background. Every stage publishes to the run's event bus, and the SSE stream is
the only way the frontend learns anything.

```mermaid
flowchart TB
    classDef stage fill:#e8f0fe,stroke:#2563eb,stroke-width:2px,color:#0b1e3d
    classDef ext fill:#f3e8ff,stroke:#7c3aed,stroke-width:2px,color:#2a0b4d
    classDef msg fill:#fff4e5,stroke:#c2760a,stroke-width:2px,color:#3d2600
    classDef data fill:#e6f6ef,stroke:#0b8a5d,stroke-width:2px,color:#04301f
    classDef screen fill:#eef2f6,stroke:#5b6b7c,stroke-width:2px,color:#1b2733

    START["📮 POST /runs<br/>createRun · 201 out immediately"]

    SNAP["🗺️ snapshot<br/>catalogue.ts<br/>robots · sitemap · product feed · JSON-LD"]
    STOP["🛑 finish with an error<br/>nothing discoverable"]
    GEN["👥 generatePersonas<br/>personas.ts · 5 archetypes x 2 briefs<br/>store overrides win"]
    CHK["🔬 runChecks<br/>checks.ts · fetch and regex, no browser, no model"]

    subgraph PAR ["Run in parallel"]
        direction TB
        POP["🤖 runPopulation<br/>agents.ts · 10 tiles<br/>3 real Browserbase · 7 scripted"]
        SURF["🧪 runSurfaceSimulations<br/>surfaces/ · capped at 45s each<br/>agent protocol · llms.txt guide · web search"]
    end

    FIND["📋 computeSurfaces + deriveFindings<br/>findings.ts<br/>falls back to ruleFindings without a model"]
    DONE["✅ finish · runsStore.save"]

    BUS["📡 event bus → SSE"]

    M1["catalogue"]
    M2["personas"]
    M3["checks"]
    M4["session · agent · sessions_closed"]
    M5["surface_simulation · check_result"]
    M6["findings · surfaces"]
    M7["done"]

    V2["2️⃣ Check"]
    V3["3️⃣ Recommend"]
    V4["4️⃣ Dashboard"]

    START --> SNAP
    SNAP -->|"no products and no sitemap"| STOP
    SNAP --> GEN --> CHK --> PAR --> FIND --> DONE

    SNAP -.-> M1
    GEN -.-> M2
    CHK -.-> M3
    POP -.-> M4
    SURF -.-> M5
    FIND -.-> M6
    DONE -.-> M7

    M1 --> BUS
    M2 --> BUS
    M3 --> BUS
    M4 --> BUS
    M5 --> BUS
    M6 --> BUS
    M7 --> BUS

    BUS --> V2
    BUS --> V3
    BUS --> V4

    class SNAP,GEN,CHK,POP,SURF,FIND,DONE,START stage
    class M1,M2,M3,M4,M5,M6,M7,BUS msg
    class V2,V3,V4 screen
    class STOP ext
```

**Which message feeds which screen.**

| Message | Consumed by |
| --- | --- |
| `catalogue` | Check — product count |
| `personas` | Personas, Check — the briefs and tile labels |
| `checks` | Check — the audit column |
| `session`, `agent`, `sessions_closed` | Check tiles, Agent detail, Dashboard attrition |
| `surface_simulation` | Check — the three dark consoles |
| `check_result` | Check — the disclosable consolidated report |
| `findings`, `surfaces` | Recommend, Dashboard surface radar |
| `done` | every screen — stops the clock |

The stream is idempotent in both directions: the backend replays everything
that already happened when you connect, and `appendSurfaceEvent` de-duplicates
by `event_id` on the client, so a refresh mid-run loses nothing.

**A finished run is restored, not replayed.** `GET /runs/:id/events` answers
from the in-memory store alone and 404s for anything that has been saved, so
opening a past run goes through `GET /runs/:id` and `hydrate()` — one document
mapped onto provider state in a single step. If the run turns out to still be
in flight, the provider subscribes to the stream as well rather than freezing
it at the moment it was read.

---

## Dark code

Measured by an import walk from `backend/src/index.ts`, not from memory:
**56 of 66 non-test modules are reachable**. The ten that are not, totalling
815 lines:

```text
agents/cloudflare.ts        agents/native-client.ts
agents/native-search.ts     agents/shared-search.ts
env.ts                      fixtures.ts
models/anthropic.ts         runs/orchestrator.ts
runs/queue.ts               runs/services.ts
```

This is the residue of the older "two of everything" split. The surfaces work
pulled `catalogue/`, `audit/`, `score/`, `personas/generate.ts` and the
`evaluate/` rules into the live path, which is why the list is now short. What
remains is a second agent stack — `runs/orchestrator.ts` and the
Cloudflare/native shopper clients — plus two config modules the flat files
duplicate.

Two more things run but are not what they look like:

- **Seven of the ten Check tiles are scripted.** Only three get real
  Browserbase sessions, because the free tier allows three concurrent browsers
  per key. Their failure reasons come from the real audit, so nothing untrue is
  printed, but their pass/fail pattern is not a measurement.
- **`POST /runs/:id/evaluate` is reachable by `curl` only.** No screen calls it.

To re-measure the reachable set, walk the imports from `index.ts` rather than
trusting this section — it moves every time someone pushes.
