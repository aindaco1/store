# Store

Store is Dust Wave's open-source, static-first commerce layer for products, tickets, RSVPs, digital downloads, and services. It succeeds [`aindaco1/dust-wave-shop`](https://github.com/aindaco1/dust-wave-shop) and replaces the old Snipcart flow with a first-party cart, Cloudflare Worker checkout API, Stripe PaymentIntents, fulfillment routes, and an admin dashboard.

## Current State

Current release: `v1.3.7`. See the [changelog](CHANGELOG.md) for changes and [release evidence](docs/release-evidence/) for verification and rollback records.

Jekyll renders the storefront from repository-backed products. The Worker owns canonical pricing, inventory reservations, payments, orders, fulfillment, email, and private administration. Store uses pinned shared Platform and Jekyll Template components while retaining its own catalog, configuration, provider policy, deployment, and rollback authority.

- Storefront: [shop.dustwave.xyz](https://shop.dustwave.xyz).
- Checkout API: [checkout.dustwave.xyz](https://checkout.dustwave.xyz).
- [Project overview](docs/PROJECT_OVERVIEW.md): architecture, shared foundations, source layout, and catalog model.
- [Roadmap](docs/ROADMAP.md): current capabilities and future work.

## Local Development

Follow [contributor setup](docs/CONTRIBUTING.md#local-setup) to initialize the pinned submodules, install dependencies, and start the host or Podman stack. Use the [Podman guide](docs/PODMAN.md) for container setup and troubleshooting.

[Test commands and coverage](docs/TESTING.md) include focused checks and the full pre-merge gate. [AGENTS.md](AGENTS.md) defines repository-wide operating rules for coding agents.

## Documentation

The [documentation index](docs/README.md) groups setup, product configuration, operations, testing, security, and release history. Start there for the complete guide map.

## Production Operations

Production deployment is manual through **Deploy Production**, run from protected `main` with the reviewed immutable release tag or commit as its `ref`. Merging or tagging does not deploy by itself.

Follow the [deployment workflow](docs/WORKFLOWS.md#deployment-workflow), [merge smoke checklist](docs/MERGE_SMOKE_CHECKLIST.md), and [backup and restore runbook](docs/BACKUP_RESTORE.md). Local tests, configuration readiness, provider verification, and deployed behavior are separate evidence requirements.
