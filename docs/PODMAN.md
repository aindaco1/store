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

On macOS and Windows, Store preserves explicit `CONTAINER_HOST` and
`CONTAINER_CONNECTION` endpoints, otherwise it pins Podman's selected default
connection. Project tools never initialize, start, stop, or restart VMs. Start
and select a shared machine at the host level before launching projects. Native
Linux uses its rootless engine. All launchers retain the Podman executable on
PATH, avoiding mixed package-installer/Homebrew clients.

Release and pre-merge suites require at least 6 GiB of Podman machine memory on macOS and Windows. Browser traces, Jekyll, Wrangler/Miniflare, and the production-like Worker can exhaust a 4 GiB VM during repeated full-suite runs even when individual focused tests pass. Configure the machine while it is stopped:

```bash
podman machine stop <selected-machine>
podman machine set --memory 6144 <selected-machine>
podman machine start <selected-machine>
```

`npm run podman:doctor` reports the configured memory. Ordinary development gets a warning below 6 GiB; `npm run test:premerge` and `npm run release:smoke` fail before starting long Podman phases. After resizing, run the doctor because the selected VM backend must remain reachable with the configured value.

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

The Playwright wrapper derives its browser image tag from the exact `@playwright/test` version in `package-lock.json`. Dependency updates therefore build a matching versioned image automatically instead of reusing an incompatible browser image.

The Worker smoke validates:

- Store product catalog JSON from the static site
- add-ons catalog JSON
- Worker readiness
- valid Store carts pass `/api/cart/validate`
- tampered Store carts fail closed
- malformed checkout intent payloads fail closed

Podman-backed test wrappers reset `worker/.wrangler/state` and `worker/.wrangler/tmp` before starting their isolated stack. That keeps release, security, Worker smoke, and headless E2E runs from reusing corrupt or stale Miniflare SQLite state. Manual `./scripts/dev.sh --podman` keeps local Wrangler state unless you opt in with `PODMAN_RESET_WRANGLER_STATE=true`.

The Playwright container keeps root dependencies in a named volume. When `package-lock.json` changes, it refreshes that volume with `npm ci`, so the bind-mounted repository lockfile is never rewritten by the container's npm version. It also mounts the running Worker's dependency volume read-only, so browser fixtures that import Worker modules resolve packages such as `sales-tax` on a fresh checkout. The Worker owns installation and lockfile-based refresh of those dependencies; host `worker/node_modules` is not required or used by the Playwright container.

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

Security, Worker smoke, and Playwright wrappers share a ten-minute startup
deadline, configurable with `PODMAN_STACK_READY_TIMEOUT` in seconds. This includes
cold image builds and dependency installation; a stopped launcher still fails
immediately. Startup diagnostics end with the failure reason so the pre-merge
log tail retains it. Test assertions and test timeouts are unchanged.

Worker readiness uses the same startup budget by default because its first run
installs dependencies in a named volume before launching Wrangler. Override that
service wait with `PODMAN_WORKER_READY_TIMEOUT` if needed; the wrapper's overall
deadline still applies. Failed startup includes container logs, including when
the container is running but its HTTP service has not started.

`npm run restore:rehearse` builds a checksum-verified synthetic snapshot, plans and executes its allowed restore into isolated local Wrangler state, proves quarantined records are excluded and derived order data is scheduled for repair, then probes the normal Podman Worker auth/cache headers. It contains no production customer or provider data and performs no production writes.

For focused admin browser coverage:

```bash
./scripts/podman-playwright-run.sh npx playwright test tests/e2e/admin-dashboard.spec.ts --project=chromium
```

Performance gates also use the shared Podman Storefront/Worker stack by default:

```bash
npm run test:performance:lighthouse
npm run test:cache-policy
```

The Lighthouse wrapper starts or reuses the production-like stack, then launches the repository's pinned Playwright Chromium from the host. Raw reports should go to ignored `test-results/` or `/tmp`; do not commit browser profiles or reports containing unexpected URL parameters. The public/admin stylesheet split and local Inter subset are exercised by the normal Podman build and browser suites.

For host-side commands that need a temporary Podman-backed Storefront and Worker, use:

```bash
./scripts/podman-stack-run.sh <command...>
```

The recovery rehearsal uses that wrapper directly:

```bash
npm run restore:rehearse -- --output=/tmp/store-recovery-rehearsal.json
```

It creates a checksum-covered synthetic snapshot with physical, digital, ticket, RSVP, failed-payment, idempotency, reminder, audit, inventory, quarantine, derived-repair, and R2 fixtures. Restore commands are injected/no-op provider calls, and the reconciliation path uses a fake read-only Stripe response while asserting zero provider writes. The live Podman Worker is used only to prove unauthenticated admin responses remain private/no-store. No production value or provider write enters the drill; Podman does not prove Cloudflare edge caching or captured-production recoverability.

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
podman system connection list
podman machine list
podman info
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

## Concurrent projects

Use one shared rootless engine on macOS. Pool publishes ports 4000/8787 with
`pool-dev-*` resources; Store publishes 4002/8989 with `store-dev-*` resources.
Each launcher removes only its own project's containers/pod. An occupied host
port causes startup to fail with a diagnostic; it never signals an unknown
listener. One development stack per project is supported; concurrent checkouts
of the same project must not share these fixed resource names and local state.

Set `CONTAINER_CONNECTION=<name>` or `CONTAINER_HOST=<url>` per command to use a
specific engine. Set the normal host default with
`podman system connection default <name>`; project launchers do not change it.
Use a host login service to start the selected VM once, rather than putting
machine recovery in each project's supervisor. Restarting project containers
is safe; restarting the engine interrupts every project.

The 6 GiB release minimum covers a single project's gate, not all concurrent
workloads. Budget RAM for the combined builds, browser suites, and services;
inspect `podman stats` and `podman system df`. Resize only during an idle
maintenance window. No project launcher prunes shared storage.

## Updating the machine

Check `podman version` after updating the host CLI. Keep the VM engine on the
same supported major/minor line. In an idle maintenance window, pause any login
watchdog, confirm `podman ps` has no running workloads, and use Podman's in-place
OS update, for example:

```bash
podman machine os apply quay.io/podman/machine-os:6.1 <selected-machine>
podman machine stop <selected-machine>
podman machine set --memory 16384 <selected-machine>
podman machine start <selected-machine>
podman version
npm run podman:doctor
```

Choose the image version and RAM for the installed CLI and host capacity; these
example values are not automatic updates. Preserve existing images/volumes and
compare inventories before/after. Restore the login watchdog after verification.
Official reference: [machine OS apply](https://docs.podman.io/en/latest/markdown/podman-machine-os-apply.1.html).
