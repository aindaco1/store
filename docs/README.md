# Store Documentation

Start with the guide for the work you are doing. The [root README](../README.md) introduces Store and identifies the current release; [AGENTS.md](../AGENTS.md) defines repository-wide operating rules.

## Getting Started And Architecture

| Guide | Use it for |
| --- | --- |
| [Contributing](CONTRIBUTING.md) | Host/Podman setup, local service URLs, configuration synchronization, and pull request preparation |
| [Project overview](PROJECT_OVERVIEW.md) | Architecture, shared dependency pins, source layout, catalog model, and ownership boundaries |
| [Podman](PODMAN.md) | Container prerequisites, engine selection, runtime troubleshooting, and local parity |
| [Worker README](../worker/README.md) | Worker-only startup, bindings, routes, secrets, and API implementation context |

## Product And Store Configuration

| Guide | Use it for |
| --- | --- |
| [Customization](CUSTOMIZATION.md) | Fork configuration, identity, URLs, checkout settings, media, and localized overrides |
| [Products and add-ons](ADD_ON_PRODUCTS.md) | Product metadata, variants, prices, inventory, coupons, and optional add-ons |
| [Admin dashboard](DASHBOARD.md) | Private product/media editing, orders, inventory, coupons, analytics, marketing, users, and publishing |
| [RSVP registration](RSVP.md) | Registration windows, named attendees, custom questions, private responses, and check-in |
| [Localization](I18N.md) | Shared translated copy, locale routing, product overrides, and adding a language |
| [SEO](SEO.md) | Metadata, crawl behavior, product requirements, and private route visibility |

## Payments, Fulfillment, And Operations

| Guide | Use it for |
| --- | --- |
| [Payment processor](PAYMENT_PROCESSOR.md) | Canonical checkout, Stripe setup, webhooks, order data, and reconciliation |
| [Shipping](SHIPPING.md) | Shipping presets, USPS quotes, tax interaction, and fulfillment |
| [Downloads](DOWNLOADS.md) | R2 files, signed access, entitlement behavior, and fallback mappings |
| [Email](EMAIL.md) | Senders, message types, local dry runs, durable delivery, suppression, and localization |
| [Workflows](WORKFLOWS.md) | Cross-system lifecycles, storage map, publishing, deployment, scheduled operations, and rollback |
| [Backup and restore](BACKUP_RESTORE.md) | Data inventory, snapshots, recovery, retention, rehearsal, and production restore gates |
| [Performance](PERFORMANCE.md) | Executable budgets, caching, runtime evidence, and incident procedures |

## Testing, Security, And Review

| Guide | Use it for |
| --- | --- |
| [Testing](TESTING.md) | Test commands, coverage, pre-merge execution, release smoke procedures, and provider evidence |
| [Merge smoke checklist](MERGE_SMOKE_CHECKLIST.md) | Test data, pass/fail criteria, acceptance checks, skips, and release sign-off |
| [Accessibility](ACCESSIBILITY.md) | Keyboard, screen reader, text scaling, motion, and responsive layout checks |
| [Security](SECURITY.md) | Trust boundaries, authorization, secrets, private data, and release preconditions |
| [Security test README](../tests/security/README.md) | Focused Worker security suite setup and coverage |
| [Ethical risk review](ETHICAL_RISK.md) | Money, data, messaging, automation, admin power, media, and accessibility review |
| [Pull request template](PULL_REQUEST_TEMPLATE.md) | Change summary and verification record |

## Capabilities And Release History

- [Roadmap](ROADMAP.md): current capability inventory and future work.
- [Changelog](../CHANGELOG.md): version-by-version changes.
- [Release evidence](release-evidence/): dated validation, provider, rollout, and rollback records, including historical design QA.

## Documentation Maintenance

Keep procedures in the guide that owns the topic and link to them from other guides. Contributor setup owns local startup; Testing owns test execution; the merge smoke checklist owns acceptance and sign-off. Keep durable behavior in topic guides and dated observations in release evidence. Historical evidence records what was checked at the time, not current verification.

Keep README, LICENSE, AGENTS, and CHANGELOG at the repository root. Root `admin.md`, `orders.md`, `order-success.md`, and `terms.md` are Jekyll page sources. Worker and test READMEs stay beside their code, and shared submodules retain their own documentation.

When moving a guide, update incoming links and check relative paths and section anchors from its new location. Keep this index current as guides are added or consolidated.
