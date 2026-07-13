# Contributing To Store

Store is Dust Wave's static-first commerce layer for products, tickets, RSVPs, and digital downloads.

## Local Setup

Host flow:

```bash
npm install
bundle install
./scripts/dev.sh
```

Podman flow:

```bash
npm run podman:doctor
./scripts/dev.sh --podman
```

Local URLs:

- Storefront: `http://127.0.0.1:4002`
- Worker: `http://127.0.0.1:8989`
- Admin: `http://127.0.0.1:4002/admin/`

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

## Product Changes

When editing `_products/`, shipping, tax, pricing, or canonical URL settings, regenerate Worker inputs:

```bash
npm run sync:worker-config
```

Then run:

```bash
npm run test:seo
npm run test:content-security
SITE_URL=http://127.0.0.1:4002 WORKER_URL=http://127.0.0.1:8989 ./scripts/test-worker.sh --podman
```

## Test Expectations

Default confidence path:

```bash
bundle exec jekyll build --quiet
npm run test:seo
npm run test:content-security
npm run test:unit
npm run test:unit:coverage
npm run test:e2e:headless
```

For Worker/security changes:

```bash
npm run test:security
SITE_URL=http://127.0.0.1:4002 WORKER_URL=http://127.0.0.1:8989 ./scripts/test-worker.sh --podman
```

For Podman:

```bash
npm run podman:self-check
```

For branches that touch checkout, fulfillment, admin, i18n, accessibility, SEO, Podman/release tooling, payment/webhooks, inventory, reminders, or catalog publishing, run the release gate and record the evidence path:

```bash
npm run release:smoke -- --evidence-file /tmp/store-release-smoke.md
```

Default browser coverage is Store-only. Add new Playwright coverage to the Store public/admin specs unless the change introduces a new Store surface that deserves its own spec.

## Pull Request Checklist

- [ ] Product/catalog changes regenerate Worker config snapshots.
- [ ] Product content audit passes.
- [ ] Jekyll build passes.
- [ ] Relevant unit tests pass.
- [ ] Relevant Worker smoke/security checks pass.
- [ ] Default Playwright suite passes for UI changes.
- [ ] Admin changes preserve session, CSRF, role/scope, and audit behavior.
- [ ] Coupon, lookup, reminder, or marketing changes include Worker tests or focused admin/browser coverage.
- [ ] Ethical risk review is recorded for triggered changes, or marked `N/A` with a reason.
- [ ] No secrets, tokens, customer data, or production export files are committed.
- [ ] External GitHub Actions remain pinned to full commit SHAs; version bumps arrive through reviewed Dependabot pull requests.
- [ ] Docs are updated when workflow or operator behavior changes.
- [ ] `npm run release:smoke -- --evidence-file /tmp/store-release-smoke.md` passes for release-impacting changes, or each skipped external evidence item has owner/date/reason.

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
