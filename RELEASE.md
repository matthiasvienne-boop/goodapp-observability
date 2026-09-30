# Release Guide — `@goodapp/observability`

This document is the template every future GoodApp shared package (`@goodapp/email`, `@goodapp/ai`, `@goodapp/support`, `@goodapp/ui`, ...) follows. It records why this package exists, its public contract, and the exact process — proven end-to-end on this package — for releasing, adopting, and rolling back a GoodApp package without a monorepo.

## Why this package exists

Veynoris had already built a clean, generic implementation of four things every backend/frontend pair needs: structured logging, error tracking, environment-variable validation, and a health-check endpoint. BeleggersApp had none of them — no Sentry, no structured logging, no env-validation engine, just a hardcoded `{ ok: true }` health check. This is the specific, evidenced situation `@goodapp/observability` exists to fix: not a hypothetical "might be useful," but two real products with a proven, one-sided capability gap. See the original audit: [`goodapp_online/docs/SHARED-COMPONENTS.md`](https://github.com/matthiasvienne-boop/goodapp-observability/blob/main/README.md) (in the GoodApp OS repo, not this one).

It is the **first** package built under [`PACKAGE-STANDARD.md`](../goodapp_online/docs/PACKAGE-STANDARD.md) and exists to prove the entire distribution mechanism — local build → public GitHub repo → tag → pinned git dependency → per-product validation — works, before a second, riskier package is attempted.

## Public API

Two subpath exports. Nothing is exported from the package root — every import names its target explicitly.

**`@goodapp/observability/server`** (Node only):
`createLogger`, `configureObservability`, `requestContext`, `currentRequestId`, `requestContextMiddleware`, `verrijkRequestContext`, `initBackendSentry`, `setupBackendSentryErrorHandler`, `validateEnv`, `createHealthCheckHandler`, plus the `Logger`, `LogLevel`, `RequestContext`, `BackendSentryOptions`, `EnvRule`, `EnvLevel`, `HealthCheck`, `HealthCheckResult`, `HealthCheckOptions` types.

**`@goodapp/observability/client`** (browser only):
`initFrontendSentry`, plus the `FrontendSentryOptions` type.

Full usage examples: [README.md](./README.md).

## Semantic versioning policy

Strict [SemVer](https://semver.org/), enforced the same way for every GoodApp package:

- **Major** — anything a caller would observe: a removed export, a changed function signature, a changed default value, a changed response shape, a changed throw/no-op behavior.
- **Minor** — a new export or a new optional parameter with a backward-compatible default. Never breaks an existing call site.
- **Patch** — a bug fix with zero change to the public API surface.

Pre-1.0 (`0.x`, where this package starts): breaking changes are allowed between minor versions, same as any 0.x package — this is what "Draft" lifecycle stage means in [`PACKAGE-STANDARD.md`](../goodapp_online/docs/PACKAGE-STANDARD.md) chapter 3. Once a second product depends on a version in production, the package graduates to Experimental and this gets stricter.

## Backwards compatibility policy

- A minor or patch release must never break a consumer who hasn't opted into anything new.
- Every production consumer pins to a **resolved commit SHA**, never a tag or branch — a tag is a human-readable pointer, not an immutability guarantee. This is what makes every release safe to ship: nothing changes for an existing consumer until *they* decide to move their pin.
- Deprecating an export: mark it `@deprecated` in JSDoc and note it in a future `CHANGELOG.md` entry for at least one minor version before removing it in a major.

## Release checklist

1. Make the change. If it's a genuine behavior change (not a pure bugfix), decide major/minor/patch per the policy above *before* writing the version bump.
2. From a **completely clean state**, build and commit `dist/` yourself — it is tracked in git, not built during a consumer's install:
   ```
   rm -rf node_modules dist && npm install && npm run build
   ```
   **Why `dist/` is committed, not (only) built on install:** the original release shipped relative imports without a `.js` extension (`from "./logger"`). `tsconfig`'s `moduleResolution: "bundler"` type-checks that fine and `tsc` emits it byte-for-byte as `from "./logger"` — but real Node ESM (unlike a bundler) does no extension-guessing on relative specifiers, so every consumer's runtime import of `@goodapp/observability/server` threw `Cannot find module '.../logger'` the moment anything actually *ran* the code (Vitest under Node, not just `tsc`/a bundler build — which is exactly why it broke `test-api` in CI while `typecheck`/`build-web`/`build-api` stayed green, and why it looked like a phantom CI-only failure at first). Fixed by adding explicit `.js` extensions to every relative import in `src/`. Committing the built `dist/` on top of that fix means a consumer's install never depends on this package's own build step succeeding at all — belt and suspenders, not a substitute for the actual fix.
3. Bump `version` in `package.json`.
4. Commit (including the rebuilt `dist/`).
5. Tag: `git tag -a vX.Y.Z -m "..."`, then `git push origin main --tags` (or push the specific tag).
6. **Before touching any consumer**, validate the new tag from a fresh, isolated scratch project — not either product:
   ```
   mkdir /tmp/scratch && cd /tmp/scratch
   npm init -y
   npm install github:matthiasvienne-boop/goodapp-observability#<new-tag-or-sha>
   ```
   Confirm: `npm install` succeeds (no build runs — `dist/` arrives as committed files), both subpath imports resolve under TypeScript, and a minimal script actually runs at runtime (not just typechecks). This is the exact mechanism a Docker `npm ci` will exercise — a `file:` dependency or a symlinked local test **cannot** substitute for this step (see "A real bug this step caught," below).
7. Only after step 6 passes: update **one** consumer's `package.json` to the new pinned SHA, regenerate its lockfile, run its own typecheck + build + smoke validation.
8. Repeat step 7 for the second consumer, independently, on its own schedule — never both products' first adoption of a new version at the same time.
9. Deploying is a separate, later decision for each product's own team/process — this checklist stops at "validated and pinned," not "deployed."

## Rollback checklist

Because every consumer pins to an exact commit SHA, rollback never touches this repository:

1. In the affected product, change the pinned SHA in `package.json` back to the previous known-good one.
2. `npm install` to regenerate the lockfile.
3. Re-run that product's typecheck + build.
4. Deploy per that product's own process.

If the package itself shipped a real bug: fix forward with a new patch release (repeat the Release checklist), while affected consumers stay on their last-known-good pin in the meantime. Never force a consumer to adopt a fix — they choose when to move their pin, same as any other release.

## How future GoodApp packages should be created

This is the reference sequence — copy it, don't reinvent it, for `@goodapp/email` and everything after:

1. **Justify it first.** Run the [`PACKAGE-STANDARD.md`](../goodapp_online/docs/PACKAGE-STANDARD.md) chapter 13 checklist: written twice already? Two real consumers? No business logic? Independently testable? Independently evolvable? Fewer than four YES answers means it isn't a package yet.
2. **Extract, don't redesign.** Start from whichever product already has a working implementation. Copy it close to verbatim. Generalize only the specific values that are genuinely product-specific (this package's precedent: the env-validation *rule list* became a parameter; the *engine* stayed untouched).
3. **Split server/client if there's a browser surface.** Two subpath exports, dual CJS/ESM build, so a Node-only SDK never ends up in a browser bundle. Add a `typesVersions` map — both real consumers here compile via plain `tsc` with `module:"commonjs"` and no `moduleResolution` set, which defaults to legacy node10 resolution that does **not** read the `exports` field for types. Skipping this silently breaks typechecking in exactly the setup both current products use.
4. **peerDependencies, not dependencies**, for anything the consumer already has its own version opinion about (Sentry SDKs, Express, React). Also list them in this package's own `devDependencies` so its *own* build can typecheck against them.
5. **Validate locally first**, cheaply, via a `file:` dependency — builds, typechecks, isolated smoke tests with real HTTP round-trips, not just type-level checks.
6. **A real bug this step caught, worth repeating for every future package:** a `file:`-linked local test can silently succeed for reasons that don't hold in production. Here, Node's module resolution walked *up* through the symlink into this package's own `node_modules` (where its `devDependencies`, including `@sentry/node`, were installed) and found what it needed — masking that a real consumer must supply `@sentry/node` itself as a peer dependency. The git-dependency install (step 6 of the Release checklist above) does **not** carry over this package's own `devDependencies` — only what's inside `dist/` per the `files` field — and correctly failed at runtime with `Cannot find module '@sentry/node'` until the scratch project declared its own peer dependency, exactly matching what a real consumer must do. **Always run the fresh-scratch-project, git-dependency validation before trusting a `file:`-based local test.**
7. **Publish public**, unless the package would contain something sensitive (it shouldn't — see [`PACKAGE-STANDARD.md`](../goodapp_online/docs/PACKAGE-STANDARD.md) chapter 15 for what never belongs in a shared package). Public avoids needing any Railway secret to install it.
8. **One consumer at a time**, always, for both initial adoption and every future version bump.
9. **Write this same `RELEASE.md`, README.md, and LICENSE** in the new package's own repo — don't just link back here.
