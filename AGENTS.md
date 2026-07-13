# AGENTS

This is the operating guide for people and coding agents working on **Store**. Use it to make safe changes without drifting the static storefront, Cloudflare Worker, checkout math, fulfillment, private administration, or localized behavior out of sync.

Read it alongside:

- [README.md](./README.md) for the product and architecture overview
- [docs/PROJECT_OVERVIEW.md](./docs/PROJECT_OVERVIEW.md) for the Store product model and system boundaries
- [docs/CUSTOMIZATION.md](./docs/CUSTOMIZATION.md) for supported configuration
- [docs/PAYMENT_PROCESSOR.md](./docs/PAYMENT_PROCESSOR.md) for Stripe, canonical checkout, webhooks, and reconciliation
- [docs/ADD_ON_PRODUCTS.md](./docs/ADD_ON_PRODUCTS.md) for Store add-ons and variant pricing
- [docs/DASHBOARD.md](./docs/DASHBOARD.md) for private administration and publishing
- [docs/PERFORMANCE.md](./docs/PERFORMANCE.md) for budgets, caching, and runtime observability
- [docs/SECURITY.md](./docs/SECURITY.md) for security boundaries and release checks
- [docs/BACKUP_RESTORE.md](./docs/BACKUP_RESTORE.md) for backup, restore, and disaster recovery
- [docs/TESTING.md](./docs/TESTING.md) for local verification and merge gates
- [docs/ROADMAP.md](./docs/ROADMAP.md) for planned and completed work

## Project shape

Store is an open-source static commerce layer and the successor to `aindaco1/dust-wave-shop`.

- Jekyll, Sass, and browser JavaScript build the static storefront published through GitHub Pages.
- Products live in `_products/` and publish through `/api/products.json`; add-on suggestions publish through `/api/add-ons.json`.
- The Cloudflare Worker in `worker/` owns canonical cart validation, Stripe PaymentIntents and webhooks, inventory, order persistence, tickets/RSVPs, downloads, email, and privileged administration.
- The private dashboard is the supported browser surface for products, repository-backed media, coupons, downloads, orders, inventory, attendance, analytics, marketing, settings, readiness, and users.
- Shipping and tax defaults are USPS and New Mexico GRT. Resend sends Store-owned transactional email.
- Local admin publishing uses `worker/src/local-repo-service.mjs` only when `APP_MODE=test` and `ADMIN_LOCAL_REPO_WRITES_ENABLED=true`.

If a change affects pricing, availability, orders, inventory, fulfillment, email, downloads, tickets, or product publication, assume both the site and Worker are involved even when the symptom appears on only one side.

## Sources of truth

- [`_config.yml`](./_config.yml): canonical fork-facing Store configuration
- [`_config.local.yml`](./_config.local.yml): machine-local overrides only
- [`_products/`](./_products): product content, identifiers, SKUs, variants, prices, inventory, media, and fulfillment metadata
- [`_data/i18n/`](./_data/i18n): shared localized UI, runtime, and email copy
- [`_layouts/`](./_layouts) and [`_includes/`](./_includes): public pages, product rendering, SEO, and locale helpers
- [`assets/`](./assets): browser runtime, Sass, themes, product/default/add-on media, and generated derivatives
- [`worker/src/`](./worker/src): authoritative checkout, webhooks, orders, inventory, email, fulfillment, administration, and reports
- [`worker/wrangler.toml`](./worker/wrangler.toml): Worker environment wiring and mirrored defaults
- [`config/performance-budgets.json`](./config/performance-budgets.json): executable public and runtime performance thresholds
- [`config/store-data-inventory.json`](./config/store-data-inventory.json): data classification, retention, and recovery inventory
- [`tests/`](./tests): unit, security, accessibility, and end-to-end contracts
- [`scripts/`](./scripts): local development, release gates, smoke tests, audits, backup/recovery, and configuration synchronization
- [`docs/release-evidence/`](./docs/release-evidence): release-specific verification records

Any generated media manifest is rebuildable metadata. Repository source media and product/configuration references remain authoritative; do not introduce a KV-backed media catalog or alternate media database.

## Safe workflow

Inspect `git status` before editing. Existing changes belong to the user unless the task explicitly includes them; do not overwrite, discard, or silently include them in a commit.

For normal local development:

```bash
npm run podman:doctor
./scripts/dev.sh --podman
```

Use the narrowest focused test that proves a change, then run the complete pre-merge gate for substantial or release-facing work:

```bash
npm run test:premerge
```

Useful focused checks include:

- `bundle exec jekyll build --quiet`
- `npx vitest run <targeted test files>`
- `node --check <changed JavaScript file>`
- `npx playwright test tests/e2e/admin-dashboard.spec.ts --project=chromium`
- `npm run test:performance:budgets`
- `npm run test:cache-policy`
- `npm run production:posture -- --no-dev-vars`
- `npm run release:smoke -- --evidence-file <path>`

Production posture and release-smoke results are complete only when the required provider credentials and secrets were available. Record omissions explicitly in release evidence. Production deployment is manual and must use the reviewed release ref; do not perform live Stripe mutations merely to prove readiness.

## Common change paths

### Products, variants, and add-ons

Use the dashboard **Products** view for normal edits. Product IDs come from `identifier`; SKUs are explicit. Each variant carries its own `sku`, price override when needed, and inventory. A blank variant price inherits the product price, while explicit `$0` is valid. Keep dashboard normalization, public display, Worker validation, persisted order data, email, and reports aligned.

Inventory tracking is immediate. If real counts are unknown, keep counts at `0` rather than inventing stock. Coupons are KV-backed admin data, not product metadata.

### Checkout, orders, and fulfillment

Start with browser code in `assets/js/`, product templates in `_includes/` and `_layouts/`, Worker code in `worker/src/`, and [docs/PAYMENT_PROCESSOR.md](./docs/PAYMENT_PROCESSOR.md).

The browser proposes cart state; the Worker resolves products, variants, coupons, shipping, tax, inventory, and canonical totals. Confirmed orders retain their stored unit prices. Downloads, tickets, RSVPs, check-in, shipping, and order email must continue to derive from canonical order state.

### Email and customer communication

Check Worker mail logic, `_data/i18n/`, sender configuration, and [docs/EMAIL.md](./docs/EMAIL.md). Preserve domain alignment, `reply_to`, plain-text output, delivery idempotency, appropriate suppression, and the boundary between transactional and promotional content. Admin login and explicit test sends remain immediate. Provider failure must not roll back an order, entitlement, inventory confirmation, or ticket.

### Media

The repository asset tree is authoritative. Use the existing optimizer and GitHub workflow for changed/all repair; do not process media inside the Worker. Preserve source files and intentionally skipped larger derivatives. Require alt text for meaningful product images and use explicit decorative-image state only where empty alt text is semantically correct. Cleanup must be reference-aware and limited to dashboard-owned media.

### Localization, SEO, and accessibility

Shared system strings belong in `_data/i18n/<lang>.yml`; product-authored copy remains product content unless a localized override exists. New public and private UI must preserve locale routing, private/noindex behavior, keyboard access, focus handling, semantic names, and readable failure states.

## Invariants to protect

1. **Repository product data is canonical.** Do not create a second product or media source of truth in KV, local configuration, or browser state.
2. **Store runtime names stay canonical.** Do not reintroduce Snipcart or legacy cart aliases. Public add buttons use `store-add-item`.
3. **Worker-mirrored settings stay synchronized.** Pricing, URLs, sender identity, tax, shipping, and other mirrored values must match the site configuration.
4. **Checkout totals are server-verified.** Current catalog pricing governs new selections; confirmed orders preserve their stored prices. All cent amounts remain within the Worker amount ceiling.
5. **Inventory is serialized and idempotent.** Scarce SKU reservation and confirmation remain Durable Object responsibilities and must not double-apply across retries.
6. **Static browsing stays cheap.** Worker calls belong to validation, checkout, admin, inventory, order, ticket, download, and email flows—not ordinary catalog browsing.
7. **Private flows stay private.** Admin, order, lookup, download, check-in, and observability responses remain non-indexable and `private, no-store` where applicable.
8. **Admin authorization remains canonical.** Preserve `limited_admin` and `accessScopes`, with CSRF/origin checks on mutations and super-admin gates where required.
9. **Payment recovery must not create a second charge.** Use deterministic idempotency, crash-safe webhook processing, and read-only reconciliation. Do not add manual ambiguous-money recovery without distinct maker/checker operators.
10. **Email delivery is separate from order truth.** Durable notification retries may continue after canonical order and fulfillment state is committed.
11. **Performance thresholds are executable.** A configured budget is not a gate until a test or audit consumes it. Browser-facing admin responses remain private/no-store even when an internal cache experiment exists.
12. **Data retention is explicit.** Keep journals redacted and bounded, update the data inventory and backup/restore order with every new key family, and avoid raw provider payloads when identifiers and status fields suffice.
13. **Ethical review travels with product changes.** Review money, data, messaging, automation, admin power, media, accessibility, and visibility while implementation is still easy to change.

## Documentation map

- Product architecture: [docs/PROJECT_OVERVIEW.md](./docs/PROJECT_OVERVIEW.md)
- Fork configuration: [docs/CUSTOMIZATION.md](./docs/CUSTOMIZATION.md)
- Payments: [docs/PAYMENT_PROCESSOR.md](./docs/PAYMENT_PROCESSOR.md)
- Add-ons and variant pricing: [docs/ADD_ON_PRODUCTS.md](./docs/ADD_ON_PRODUCTS.md)
- Email: [docs/EMAIL.md](./docs/EMAIL.md)
- Downloads: [docs/DOWNLOADS.md](./docs/DOWNLOADS.md)
- Shipping and tax: [docs/SHIPPING.md](./docs/SHIPPING.md)
- Dashboard: [docs/DASHBOARD.md](./docs/DASHBOARD.md)
- Performance: [docs/PERFORMANCE.md](./docs/PERFORMANCE.md)
- Security: [docs/SECURITY.md](./docs/SECURITY.md)
- Backup and recovery: [docs/BACKUP_RESTORE.md](./docs/BACKUP_RESTORE.md)
- Testing: [docs/TESTING.md](./docs/TESTING.md)
- Workflows and deployment: [docs/WORKFLOWS.md](./docs/WORKFLOWS.md)
- Localization: [docs/I18N.md](./docs/I18N.md)
- SEO: [docs/SEO.md](./docs/SEO.md)
- Ethical risk: [docs/ETHICAL_RISK.md](./docs/ETHICAL_RISK.md)
- Merge and release checks: [docs/MERGE_SMOKE_CHECKLIST.md](./docs/MERGE_SMOKE_CHECKLIST.md)

## Working style for coding agents

- Read the implementation and nearby tests before structural changes.
- Prefer small, local, DRY edits that preserve established patterns.
- Update tests and operator docs whenever behavior or release expectations change.
- Consider storefront, Worker, email, localization, accessibility, security, performance, fulfillment, and recovery consequences together.
- Reuse an existing configuration surface or helper before inventing another.
- Preserve unrelated user changes and stage only files in scope.

When uncertain, make the smallest change that keeps the storefront and Worker aligned, prove it with the narrowest meaningful test, and run the broader gate when warranted.
