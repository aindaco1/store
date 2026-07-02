# Podman Local Dev

Store includes a rootless Podman local development path for the two services that normally create host setup churn:

## Release v1.0.4 Audit

The documented Podman flow remains the fallback parity path for Store release validation. `npm run test:premerge` falls back to Podman-backed Jekyll builds when host gems are unavailable, and it also runs a Podman Store Worker smoke phase even when the host path succeeds. Podman helpers cover Worker smoke, security, media, and headless E2E paths.

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
npm run test:security:podman
npm run test:e2e:headless:podman
./scripts/podman-playwright-run.sh npx playwright test --workers=1
```

For focused admin browser coverage:

```bash
./scripts/podman-playwright-run.sh npx playwright test tests/e2e/admin-dashboard.spec.ts --project=chromium
```

For host-side commands that need a temporary Podman-backed Storefront and Worker, use:

```bash
./scripts/podman-stack-run.sh <command...>
```

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

## Cross-Platform First Run

Fresh setup sequence:

```bash
npm run podman:doctor
./scripts/dev.sh --podman
npm run test:e2e:headless:podman
```

If the doctor passes and the headless Podman suite is green, the local Store environment is ready for normal work.
