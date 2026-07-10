# Podman Local Dev

Store includes a rootless Podman local development path for the two services that normally create host setup churn:

## Current Release Baseline

The documented Podman flow remains the local production-like rehearsal path for Store release validation. `npm run test:premerge` falls back to Podman-backed Jekyll builds when host gems are unavailable, and it also runs Podman-backed security, Store Worker smoke, and headless E2E phases. `npm run release:smoke` runs Podman headless E2E when Podman is available, and `.github/workflows/podman-e2e.yml` provides scheduled non-deploying drift detection. Podman helpers cover Worker smoke, security, media, and headless E2E paths.

Runtime-dependent defaults are Podman-backed: `npm run test:security`, `npm run test:e2e`, and `npm run test:e2e:headless` use the Podman Storefront/Worker stack unless an explicit host alias is selected.

- Jekyll storefront
- Cloudflare Worker local dev server

The Podman path uses the same local URLs as the host flow:

- Storefront: `http://127.0.0.1:4002`
- Worker: `http://127.0.0.1:8989`

## Scope

Included:

- rootless Podman containers for Jekyll and the Worker
- bind-mounted repo source for fast iteration
- local Wrangler state for KV, Durable Objects, and R2
- Worker dev image based on Node 24
- ignored `worker/.dev.vars` support
- local admin dashboard defaults and CORS wiring for `http://127.0.0.1:4002`
- local admin repo sidecar for dashboard publish flows
- optional host Stripe CLI webhook forwarding
- headless Playwright in a dedicated Podman container
- Podman-aware Worker smoke, security, media, and E2E helpers
- merge-gate Podman Worker smoke coverage even when host Jekyll/Worker smoke succeeds
- default Podman-backed runtime tests for security and E2E paths, with explicit host aliases for focused local debugging
- isolated Wrangler/Miniflare state reset for Podman-backed security, Worker smoke, and headless E2E wrappers
- real Worker readiness checks through `POST /api/cart/validate`, not only open TCP ports
- stop-file based wrapper shutdown so normal cleanup exits cleanly without signalling the parent test process

Not included:

- production Cloudflare resources
- production Stripe webhooks
- production USPS/NM GRT credentials

## Prerequisites

- [Podman](https://podman.io/docs/installation)
- optional [Stripe CLI](https://stripe.com/docs/stripe-cli) for local webhook forwarding

On macOS and Windows, `./scripts/dev.sh --podman` will initialize/start the default `podman machine` when needed. On Linux, it talks directly to the local rootless Podman engine.

## Start

Run:

```bash
npm run podman:doctor
./scripts/dev.sh --podman
```

The local admin dashboard is then available at:

```text
http://127.0.0.1:4002/admin/
```

The Worker serves Store APIs at:

```text
http://127.0.0.1:8989
```

Local admin repository writes use the sidecar at:

```text
http://127.0.0.1:8799
```

## Self-Check

For the strongest Podman confidence pass:

```bash
npm run podman:self-check
```

That runs:

- `npm run podman:doctor`
- `SKIP_STRIPE=true ./scripts/dev.sh --podman` in detached mode
- `./scripts/test-worker.sh` against the started Podman stack
- `./scripts/podman-playwright-run.sh npx playwright test`

The Worker smoke validates:

- Store product catalog JSON from the static site
- add-ons catalog JSON
- Worker readiness
- valid Store carts pass `/api/cart/validate`
- tampered Store carts fail closed
- malformed checkout intent payloads fail closed

Podman-backed test wrappers reset `worker/.wrangler/state` and `worker/.wrangler/tmp` before starting their isolated stack. That keeps release, security, Worker smoke, and headless E2E runs from reusing corrupt or stale Miniflare SQLite state. Manual `./scripts/dev.sh --podman` keeps local Wrangler state unless you opt in with `PODMAN_RESET_WRANGLER_STATE=true`.

The Playwright container keeps root dependencies in a named volume. When `package-lock.json` changes, it refreshes that volume with `npm ci`, so the bind-mounted repository lockfile is never rewritten by the container's npm version.

Wrappers that start their own stack pass a private `PODMAN_STOP_FILE` into `./scripts/dev.sh --podman`. Cleanup touches that file and waits for the supervisor to exit normally before removing the pod. This avoids signal-based teardown leaking `143` exits into Vitest, Playwright, or pre-merge scripts.

## Rebuild Images

Normal code changes do not need an image rebuild because the repo is bind-mounted.

Rebuild when you change:

- `Containerfile.dev`
- `worker/Containerfile.dev`
- system package requirements
- media optimizer dependencies
- Node/Wrangler runtime assumptions

Use:

```bash
PODMAN_REBUILD=1 ./scripts/dev.sh --podman
```

The site image also supports media optimization:

```bash
npm run media:optimize:podman
npm run media:optimize:check:podman
```

## Testing

Podman-backed helpers:

```bash
./scripts/test-worker.sh --podman
npm run test:security
npm run test:e2e:headless
npm run restore:rehearse
./scripts/podman-playwright-run.sh npx playwright test --workers=1
```

`npm run test:security`, `npm run test:e2e`, and `npm run test:e2e:headless` are Podman-backed by default. Host-only aliases are available as `npm run test:security:host`, `npm run test:e2e:host`, and `npm run test:e2e:headless:host`.

The Podman wrappers require both containers to be reachable and a real Store cart validation request to return `200` before they run tests. That catches Worker startup, rate-limit storage, catalog, and local networking failures earlier than simple port checks.

`npm run restore:rehearse` builds a checksum-verified synthetic snapshot, plans and executes its allowed restore into isolated local Wrangler state, proves quarantined records are excluded and derived order data is scheduled for repair, then probes the normal Podman Worker auth/cache headers. It contains no production customer or provider data and performs no production writes.

For focused admin browser coverage:

```bash
./scripts/podman-playwright-run.sh npx playwright test tests/e2e/admin-dashboard.spec.ts --project=chromium
```

For host-side commands that need a temporary Podman-backed Storefront and Worker, use:

```bash
./scripts/podman-stack-run.sh <command...>
```

The recovery rehearsal uses that wrapper directly:

```bash
npm run restore:rehearse -- --output=/tmp/store-recovery-rehearsal.json
```

It creates a checksum-covered synthetic snapshot with physical, digital, ticket, RSVP, failed-payment, idempotency, reminder, audit, inventory, quarantine, derived-repair, and R2 fixtures. Restore commands are injected/no-op provider calls; the live Podman Worker is used only to prove unauthenticated admin responses remain private/no-store. No production value or provider write enters the drill.

## CI And Release Evidence

`.github/workflows/podman-e2e.yml` runs the headless Podman E2E path on a weekly schedule and by manual dispatch. The workflow is read-only and non-deploying; it installs Podman, runs `npm run podman:doctor`, then runs `npm run test:e2e:headless:podman`.

`.github/workflows/recovery-readiness.yml` separately runs the representative Podman restore rehearsal each Sunday at `03:43 America/Denver`, combines it with inventory/backup/provider readiness, and uploads sanitized JSON evidence. It does not fetch production KV/R2 values. The quarterly captured-data workflow is a separate protected preview operation and must not be represented as part of ordinary Podman CI.

For release evidence, run:

```bash
npm run release:smoke -- --evidence-file /tmp/store-release-smoke.md
```

Use [MERGE_SMOKE_CHECKLIST.md](MERGE_SMOKE_CHECKLIST.md) to record Podman doctor, local stack, Worker smoke, headless E2E, stale `gvproxy`/port cleanup, and image rebuild decisions. When Podman E2E passes inside `npm run release:smoke`, the release wrapper records that pass as the automated accessibility evidence source because the suite includes axe and 200% text-scaling checks.

## Stripe Webhooks

If the Stripe CLI is available and authenticated, `./scripts/dev.sh --podman` can forward local Stripe webhooks to:

```text
http://127.0.0.1:8989/webhooks/stripe
```

The launcher updates `worker/.dev.vars` with the local webhook secret when it can read it from the Stripe CLI output. If forwarding is inactive, paid checkout UI can still start, but local webhook settlement will not complete until forwarding is configured.

## Logs

If the pod is already running:

```bash
podman logs -f store-dev-site
podman logs -f store-dev-worker
```

Container names use the `store-dev-*` prefix across the local Podman helpers.

If startup stalls, check the Podman machine:

```bash
podman machine inspect
podman machine start
```

Then retry:

```bash
npm run podman:doctor
./scripts/dev.sh --podman
```

If Worker requests return `503` with `Rate limiting unavailable` and the Worker log mentions a malformed SQLite database, stop the stack and rerun the failing test wrapper. The wrapper resets local Wrangler state automatically; for manual dev, run:

```bash
PODMAN_RESET_WRANGLER_STATE=true SKIP_STRIPE=true ./scripts/dev.sh --podman
```

## Cross-Platform First Run

Fresh setup sequence:

```bash
npm run podman:doctor
./scripts/dev.sh --podman
npm run test:e2e:headless:podman
```

If the doctor passes and the headless Podman suite is green, the local Store environment is ready for normal work.
