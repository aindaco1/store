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
- [PRODUCTION_LAUNCH.md](PRODUCTION_LAUNCH.md)
- [BACKUP_RESTORE.md](BACKUP_RESTORE.md)

Historical extraction notes live in [history/](history/) and should not drive launch-facing behavior unless you are auditing the origin of an imported pattern.

Use `/Users/aindaco1/Desktop/agents.md` as the product brief when working in Codex.

## Development Rules

- Keep Store product data in `_products/`.
- Do not reintroduce Snipcart.
- Do not add Pool cart button classes; Store buttons use `store-add-item`.
- Treat the Worker as authoritative for cart totals, inventory, tax, shipping, and order state.
- Do not commit secrets. Local secrets belong in `worker/.dev.vars`; production secrets belong in Cloudflare Worker secrets.
- Admin mutations must keep session, CSRF, role/scope, normalization, and audit boundaries intact.
- Product content should use Markdown, not raw HTML.

## Product Changes

When editing `_products/`, shipping, tax, pricing, or canonical URL settings, regenerate Worker inputs:

```bash
npm run sync:worker-config
```

Then run:

```bash
npm run test:content-security
SITE_URL=http://127.0.0.1:4002 WORKER_URL=http://127.0.0.1:8989 ./scripts/test-worker.sh
```

## Test Expectations

Default confidence path:

```bash
bundle exec jekyll build --quiet
npm run test:content-security
npm run test:unit
PLAYWRIGHT_EXTERNAL_SERVER=1 CI=1 npx playwright test --project=chromium --workers=1
```

For Worker/security changes:

```bash
npm run test:security
SITE_URL=http://127.0.0.1:4002 WORKER_URL=http://127.0.0.1:8989 ./scripts/test-worker.sh
```

For Podman:

```bash
npm run podman:self-check
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
- [ ] No secrets, tokens, customer data, or production export files are committed.
- [ ] Docs are updated when workflow or operator behavior changes.

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
