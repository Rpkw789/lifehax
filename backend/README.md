# Happy2 backend

To install dependencies:

```sh
bun install
```

To run:

```sh
bun run dev
```

The backend listens on `http://localhost:3201` once the HTTP shell is wired.

## Check simulation handoff

`runSimulation` in `src/runs/orchestrator.ts` is the Check workstream entry
point. It accepts one store URL and one target product URL, executes the
catalogue snapshot, generated personas, shopper fan-out, deterministic matching
and scoring, validates the final `CheckResult`, then passes that document to an
injected `ResultSink`. The HTTP/SQLite workstream owns the concrete sink and
route wiring.

Use `createSimulationDependencies` in `src/runs/services.ts` to select either:

- `shared-search`: Cloudflare AI Gateway credentials from server configuration.
- `native-search`: a request-scoped Anthropic key that remains in memory.

Both tiers require a server Anthropic key for persona generation. Never include
either key in a result sink, event sink, error payload, or log.

Offline verification does not call the network:

```sh
npm test
npm run typecheck
```
