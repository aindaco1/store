# Contributing To Store

This guide covers contributor setup and change preparation. Use the [documentation index](README.md) to find feature and operator guides.

## Local Setup

Run commands from the repository root. Initialize the recorded shared dependencies before installing or testing; clone with `--recurse-submodules` when possible. CI uses the recorded commits and never follows a moving submodule branch.

Host flow:

```bash
git submodule update --init --recursive
npm ci
bundle install
./scripts/dev.sh
```

Podman flow (see [prerequisites and engine selection](PODMAN.md#prerequisites)):

```bash
git submodule update --init --recursive
npm run podman:doctor
./scripts/dev.sh --podman
```

Local URLs:

- Storefront: `http://127.0.0.1:4002`
- Worker: `http://127.0.0.1:8989`
- Admin: `http://127.0.0.1:4002/admin/`
- Local repository sidecar: `http://127.0.0.1:8799`

`./scripts/dev.sh` starts the storefront, Worker, and repository sidecar, synchronizes Worker configuration, regenerates the catalog, and configures missing local secrets. It also attempts Stripe CLI webhook forwarding. The sidecar enables dashboard writes only with `APP_MODE=test` and `ADMIN_LOCAL_REPO_WRITES_ENABLED=true`.

For a separately managed storefront, use:

```bash
bundle exec jekyll serve --config _config.yml,_config.local.yml --host 127.0.0.1 --port 4002
```

See the [Worker-only launch](../worker/README.md#local-development) for the API and sidecar. Local orders and inventory belong to the simulated Worker state. Local email behavior and dry-run flags are documented under [durable delivery](EMAIL.md#durable-delivery); webhook diagnosis is in [Payment Processor](PAYMENT_PROCESSOR.md#missed-local-webhook).

## Before Editing

Read these first for Store work:

- [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)
- [WORKFLOWS.md](WORKFLOWS.md)
- [DASHBOARD.md](DASHBOARD.md)
- [TESTING.md](TESTING.md)
- [SECURITY.md](SECURITY.md)
- [ETHICAL_RISK.md](ETHICAL_RISK.md)
- [BACKUP_RESTORE.md](BACKUP_RESTORE.md)

Use the repository-root [`AGENTS.md`](../AGENTS.md) as the operating guide and product boundary when working in Codex.

## Development Rules

- Keep Store product data in `_products/`.
- Prefer `store_collection` for collections and `storefront_category`/`product_category` for product-type categories; treat the existing `category: dustwave` and `category: fronteras` values as migrated collection data.
- Do not reintroduce Snipcart.
- Do not add legacy cart button classes; Store buttons use `store-add-item`.
- Treat the Worker as authoritative for cart totals, inventory, tax, shipping, and order state.
- Do not commit secrets. Local secrets belong in `worker/.dev.vars`; production secrets belong in Cloudflare Worker secrets.
- Admin mutations must keep session, CSRF, role/scope, normalization, rate-limit, and audit boundaries intact.
- Product content should use Markdown, not raw HTML.
- Coupons, reminders, marketing referrals, and runtime admin users live in KV-backed Worker/admin flows, not product markdown.
- Run the ethical risk review for changes that affect customer/admin data, access, automation, analytics, reminders, referrals, public tokens, signed links, pricing, coupons, product content, or external providers.
- Do not add hidden tracking, manipulative urgency, unsuppressible reminders, or customer-data monetization. Collect only what Store needs for checkout, fulfillment, tax, support, security, and operations.

## Configuration And Product Changes

`_config.yml` owns public settings and Worker-mirrored defaults; `_config.local.yml` contains machine-local overrides. After changing products, shipping, tax, pricing, or canonical URLs, synchronize the Worker inputs:

```bash
npm run sync:worker-config
```

This runs `scripts/sync-worker-config.rb` and `scripts/generate-catalog-snapshot.rb`. The local stack regenerates the catalog at startup and when product/configuration sources change; dashboard saves wait for the running Worker to load the saved catalog before refreshing. Use `npm run catalog:generate` to diagnose malformed YAML or recover a stale snapshot. Restart a separately managed Worker after changing its configuration.

Shared translated copy lives in `_data/i18n/<lang>.yml`, with locale configuration under `i18n` in `_config.yml`. Product-authored copy stays canonical unless a product defines a `localized.<lang>` override. See [Customization](CUSTOMIZATION.md), [product and variant configuration](ADD_ON_PRODUCTS.md), and [Localization](I18N.md) for the full contracts.

## Test Expectations

Use [Testing](TESTING.md) as the command and coverage reference. Start with focused checks; run the [pre-merge gate](TESTING.md#pre-merge) for substantial or release-facing work.

Changes to checkout, fulfillment, admin, i18n, accessibility, SEO, Podman/release tooling, payment/webhooks, inventory, reminders, or catalog publishing also require [release smoke](TESTING.md#release-smoke) and the [merge smoke checklist](MERGE_SMOKE_CHECKLIST.md). Record each skipped external evidence item with an owner, date, and reason.

Default browser coverage is Store-only. Add new Playwright coverage to the Store public/admin specs unless a new Store surface warrants its own spec. Product/catalog changes require content and SEO checks; Worker/security changes require relevant security and Worker smoke coverage; UI changes require browser coverage.

## Pull Request Preparation

Use the [pull request template](PULL_REQUEST_TEMPLATE.md) for the summary and verification record. Include the problem, resulting behavior, relevant checks and evidence, and any limitations. Record triggered [ethical risk review](ETHICAL_RISK.md), or mark it `N/A` with a reason.

Keep secrets, tokens, customer data, and production exports out of the commit. Preserve session, CSRF, role/scope, and audit behavior in admin changes. Keep external GitHub Actions pinned to full commit SHAs and update them through reviewed Dependabot pull requests. Update operator documentation when behavior or workflows change.

## Branch Names

Use short, descriptive branches:

- `feat/store-downloads`
- `fix/cart-quantity`
- `docs/shipping`
- `test/admin-inventory`

## Glossary

| Term | Meaning |
| --- | --- |
| Store | This static-first commerce project |
| Storefront | Jekyll public product site |
| Worker | Cloudflare Worker API and checkout backend |
| Product | `_products/*.md` catalog item |
| Order | Store checkout record, free or paid |
| Fulfillment | Download, ticket/RSVP, or physical shipping action |
| Admin | Private dashboard for Store operations |
| Inventory baseline | Admin-entered available stock before reservation/commit math |
