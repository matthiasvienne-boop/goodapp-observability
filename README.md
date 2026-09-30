# @goodapp/observability

Structured logging, Sentry initialization, environment-variable validation, and a health-check helper — shared across GoodApp products. Extracted from Veynoris' already-working implementation; generalized only where a second consumer genuinely needed a different value plugged in. See [GoodApp OS's PACKAGE-STANDARD.md](../goodapp_online/docs/PACKAGE-STANDARD.md) for the full standard this package follows, and [SHARED-COMPONENTS.md](../goodapp_online/docs/SHARED-COMPONENTS.md#status-goodappobservability-2026-07-09) for the complete build/integration status.

**Status: Draft.** Built, locally validated, locally integrated into both Veynoris and BeleggersApp — not yet published to GitHub, not yet consumed by either product in production. See "Releaseflow" below for what's left.

## What's in it

Two subpath exports, kept physically separate so a browser bundle never has to deal with Node-only code:

### `@goodapp/observability/server`

```ts
import {
  createLogger,        // structured JSON logger, console-compatible variadic API
  configureObservability, // optional: tag every log line with a serviceName
  requestContext,       // the shared AsyncLocalStorage instance backing request correlation
  currentRequestId,     // reads the current request's ID, if any
  initBackendSentry,    // Sentry.init() wrapper, no-op if no DSN
  setupBackendSentryErrorHandler, // Express error-handler wiring for Sentry
  validateEnv,          // fail-fast env-var validation engine — takes YOUR rules, not built-in ones
  createHealthCheckHandler, // Express handler factory for a { status, checks } health endpoint
} from "@goodapp/observability/server";
```

### `@goodapp/observability/client`

```ts
import { initFrontendSentry } from "@goodapp/observability/client";
```

## Logger redaction (since 0.4.1, PLAT-184)

The logger redacts secrets before it writes a line, the same way the Sentry integration always did. What it does, and deliberately does not do:

- Free text (the message, an `Error`'s message and stack, and every string value in the metadata) goes through `redacteerTekst`: connection-string passwords, `Authorization: Bearer ...`, `sk_`/`whsec_` keys and the other named patterns are replaced with `[weggelaten]`. Commit hashes and bundler hashes are left alone.
- Metadata keys from the secret list (`password`, `token`, `authorization`, `cookie`, `session`, ...) lose their value, also when nested. Numbers and booleans stay, so `inputTokens: 1200` is not affected. Pass product-specific keys through `redacteerVoorLog(value, 0, ["tendertekst"])` if you need more.
- The confidential business words that Sentry also strips (`prijs`, `bedrag`, `email`, `bericht`, ...) are **not** removed from logs: a log line that hides the price it is reporting gets bypassed, and then nothing is protected.
- Before 0.4.1 the output for a line without secrets was byte-identical to a plain `console.*` line; that is still true. A line that contained a secret now differs, on purpose.

## Request context middleware (since 0.5.0, PLAT-208)

The logger has always put `requestId`, `userId` and `organizationId` on a line when a request context exists, but only Veynoris ever created one. `requestContextMiddleware` is that middleware, ready to use with Express:

```ts
import { requestContextMiddleware, verrijkRequestContext } from "@goodapp/observability/server";

app.use(requestContextMiddleware({ stilPaden: ["/api/health"] })); // as early as possible, before the routes

// in your auth middleware, after the token is verified:
verrijkRequestContext({ userId: user.id, organizationId: user.organizationId });
```

- An incoming `x-request-id` is reused if it is at most 128 characters of `A-Z a-z 0-9 . _ : -`; anything else gets a fresh UUID. The id is returned in the response header.
- Every log line inside the request carries the id. The finished request is logged with method, path, status and duration: 5xx as `error` (that goes to Sentry), 4xx as `warn`, the rest as `info`.
- The query string is never logged (it can hold tokens); neither are bodies or headers.
- `naVerzoek(info, req)` is an optional hook for something product-specific after the response (Veynoris' visit counter). An error in it never breaks the request.

## What's deliberately *not* in it

- **Environment-rule lists.** `validateEnv()` takes a `rules: EnvRule[]` argument — each product supplies its own (JWT secrets, Stripe keys, whatever it needs). No product-specific variable names live in this public repo.
- **Request-correlation middleware.** The `requestContext` `AsyncLocalStorage` instance is exported so a consumer can build its own Express middleware around it (see Veynoris' `apps/api/src/middleware/request-context.ts`, which stays product-local and imports only `requestContext`/`createLogger` from here).
- **Anything that would only make sense for one product.** No `serviceName === "veynoris"` branches, no assumptions about ORM, database, or business logic. See [PACKAGE-STANDARD.md](../goodapp_online/docs/PACKAGE-STANDARD.md) chapter 15 for the permanent list of things GoodApp packages never share.

## Install

### Right now: local development (`file:` dependency)

Both Veynoris and BeleggersApp currently depend on this package via:

```json
"@goodapp/observability": "file:/Users/matthiasvienne/goodapp-observability"
```

This works for local builds, typechecks, and runtime smoke tests. It does **not** work for either product's actual production build — confirmed during Phase 1 research that BeleggersApp's `Dockerfile` only copies `package*.json` manifests into the build context before `npm ci` runs, so a path outside the repo can never resolve there. Veynoris' Railway buildpack has the same fundamental limitation (a fresh clone never contains a sibling directory on the host filesystem). **A `file:` dependency is a local-validation convenience only, never a production dependency spec.**

### Once published: git dependency, pinned to a commit SHA

```json
"@goodapp/observability": "github:<account>/goodapp-observability#<resolved-commit-sha>"
```

A version tag (`vX.Y.Z`) is a human-readable pointer, not a promise of immutability — pin to the exact commit SHA a tag pointed to at install time, not to the tag itself. This is what makes rollback a one-line `package.json` change instead of a hope that nobody force-moved a tag.

## Usage

```ts
// server entrypoint, as early as possible
import { createLogger, initBackendSentry, validateEnv, createHealthCheckHandler } from "@goodapp/observability/server";

const log = createLogger("server");
initBackendSentry({ serviceName: "your-product-api" }); // no-op if SENTRY_DSN unset

const MY_RULES = [
  { key: "DATABASE_URL", level: "always" as const, description: "Postgres connection" },
];
try {
  validateEnv(MY_RULES);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1); // the engine throws; YOU own the exit decision — see the note below
}

app.get("/api/health", createHealthCheckHandler({
  checks: { database: async () => { await db.ping(); return true; } },
}));
```

```tsx
// client entrypoint
import { initFrontendSentry } from "@goodapp/observability/client";

initFrontendSentry({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  serviceName: "your-product-client",
});
```

**Important: `validateEnv()` throws, it does not call `process.exit()`.** Always wrap it in an explicit `try/catch` that calls `process.exit(1)` yourself, at the exact call site — never let the throw propagate uncaught. This isn't a style preference: during the BeleggersApp integration, a naive uncaught-throw approach would have been silently swallowed by a `process.on("uncaughtException", ...)` handler that product had already registered earlier in its boot sequence (a legitimate pattern for *other* errors) — meaning a production server with a missing required secret would have booted successfully instead of refusing to start. See [AI-AGENTS.md](../goodapp_online/docs/AI-AGENTS.md) principle 5 and [DECISIONS.md](../goodapp_online/docs/DECISIONS.md) (2026-07-09) for the full story.

## Versioning

Strict [SemVer](https://semver.org/). Major = any change observable by a caller (removed export, changed signature, changed default, changed response shape, changed throw behavior). Minor = new capability, backward compatible. Patch = bug fix, no API surface change. Full policy: [PACKAGE-STANDARD.md](../goodapp_online/docs/PACKAGE-STANDARD.md) chapter 4.

## Releaseflow

The path from "package exists locally" to "a product deploys it to production":

1. **Local validation** (done for `v0.1.0`) — dual CJS/ESM build, `typesVersions` resolution verified against both a node10-resolution consumer and a bundler-resolution consumer, fresh `rm -rf node_modules dist && npm install` round-trip, isolated smoke tests (real HTTP round-trip on the health-check handler, hard-fail throw path, Sentry no-op).
2. **Publish to GitHub** *(not yet done — requires GitHub authentication that wasn't available during the sessions that built this)*: `gh repo create <account>/goodapp-observability --public`, push, tag `v0.1.0`.
3. **Scratch-project smoke test**: in an isolated throwaway directory (not either product), install the package fresh via its git URL and confirm both subpath imports resolve and the `prepare`-triggered build succeeds in a genuinely clean environment — proves the exact mechanism a Docker build will exercise, without risking either product's lockfile.
4. **Pin, one product at a time**: switch `@goodapp/observability` in `package.json` from the `file:` path to `github:<account>/goodapp-observability#<resolved-sha>`, regenerate the lockfile, re-run that product's own build/typecheck/smoke validation.
5. **Deploy, one product at a time** — never both products' first production rollout of a new version simultaneously.
6. **Rollback, if needed**: change the pinned SHA back to the previous one, reinstall. No action required in this repository.

Each future release repeats steps 1–2 (bump version, tag, push) followed by each consumer independently choosing when to move to the new pin — consumers are never forced onto a new version by a package release alone.

## Compatibility

See [PACKAGE-STANDARD.md](../goodapp_online/docs/PACKAGE-STANDARD.md) chapter 12 for the full matrix. Summary: Node ≥ 20, TypeScript ≥ 5.4, works under both `module:"commonjs"`/node10 resolution (both products' backends) and `moduleResolution:"bundler"` (both products' Vite frontends). Zero required Railway configuration.

## License

[MIT](./LICENSE) — chosen because this package is, and must remain, generic infrastructure with no business logic (see [PACKAGE-STANDARD.md](../goodapp_online/docs/PACKAGE-STANDARD.md) chapter 15). Nothing in here is sensitive; there's no reason to restrict reuse.
