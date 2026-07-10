# Ethical Risk Review

This guide adapts the Ethical OS Toolkit from the Institute for the Future and Omidyar Network for Store feature work. Use it as a product and engineering review prompt, not as a replacement for security, accessibility, legal, tax, or privacy review.

Run this review before shipping changes that affect customer data, admin access, checkout/payment, pricing, coupons, referrals, reminders, analytics, media uploads, public product content, localization/accessibility, automation, AI/ML, public tokens, signed links, exports, backup/restore, or any new external provider integration.

Source: [Ethical OS Toolkit](https://ethicalos.org/) by Institute for the Future and Omidyar Network, 2018, CC BY-NC-SA 4.0.

## Store Principles

- Anticipate misuse, not only intended use. Consider first-order effects, then plausible second- and third-order effects after the feature scales or is copied into another workflow.
- Map who is affected. Include buyers, admins, limited admins, event attendees, email recipients, people represented in product media, Spanish-language users, disabled users, low-connectivity users, and people whose data appears in exports or backups.
- Minimize customer and admin data. Collect only what Store needs for checkout, fulfillment, tax, support, fraud prevention, and operations. Do not add hidden tracking or user-data monetization.
- Keep behavior understandable. Users should not be surprised by what Store collects, sends, stores, publishes, exports, or makes available to admins.
- Preserve real consent and off-ramps. Reminder, referral, marketing, lookup, and notification flows must stay opt-in where appropriate, suppressible, scoped, and clear about why the user is being contacted.
- Design against abuse. Assume malicious actors may try fraud, harassment, doxing, scalping, deceptive product content, stolen links, token replay, admin compromise, or bulk export misuse.
- Keep access fair and testable. New flows should preserve keyboard access, high-zoom usability, localized copy paths, and transparent rules for pricing, coupons, inventory, eligibility, and admin permissions.
- Prefer auditable systems. Sensitive mutations, automated decisions, data exports, and recovery actions need logs, owner visibility, tests, and a rollback or escalation path.

## Risk Lenses

| Ethical OS lens | Store review questions |
| --- | --- |
| Truth, disinformation, propaganda | Could product copy, email copy, SEO metadata, availability, pricing, policy text, media, or analytics mislead customers or operators? Could an upload or admin publish path enable impersonation or deceptive content? |
| Addiction and attention capture | Does the feature push unnecessary urgency, repeated reminders, intrusive notifications, or engagement loops? Is there a clear reason to interrupt the customer, and can they stop it? |
| Economic and access inequality | Who is excluded by language, disability, geography, payment method, shipping policy, tax behavior, pricing, coupons, or inventory rules? Are fees, discounts, and eligibility rules transparent? |
| Machine ethics and bias | Does the change add automation, recommendations, risk scoring, prioritization, fraud handling, or AI/ML? If so, can affected people understand the decision and get human review when needed? |
| Surveillance and chilling effects | Does Store collect behavior, location, attendance, order, referral, or admin activity data that could expose a person or group? Who can view, export, subpoena, or misuse it? |
| Data control and monetization | Is every collected field necessary? Can access be limited, revoked, exported, restored, or deleted according to the runbooks? What happens if the data leaks, the project changes ownership, or the feature is retired? |
| Implicit trust and user understanding | Would a reasonable customer or admin be surprised by the feature? Are terms, consent, status text, errors, and admin labels clear enough to understand without reading code? |
| Hateful or criminal actors | Could someone use the feature to harass, stalk, defraud, steal, launder, spread hate, bypass event access, or weaponize signed links/downloads/admin exports? What blocks, limits, and audits exist? |

## Review Workflow

1. Identify the touched Store surfaces: public storefront, cart, checkout, order lookup, order success, admin, Worker route, cron job, email, export, provider integration, backup, or docs.
2. Mark which risk lenses apply. If none apply, record `Ethical risk review: N/A - <reason>` in the PR.
3. For each applicable lens, record one concrete risk and one mitigation. Prefer existing controls such as Worker canonicalization, signed token scope, private/no-store responses, CSRF, roles/scopes, rate limits, i18n catalogs, accessibility evidence, suppression records, audit events, and release smoke.
4. Add or update tests where the mitigation can be tested. For untestable mitigations, record the manual review owner/date in the PR or release evidence.
5. Block release when a high-impact risk has no mitigation, owner, rollback path, or customer/operator communication plan.

## Red Flags

Pause and get explicit owner review before merging when a change:

- collects a new class of customer, attendee, admin, location, device, behavioral, or payment-adjacent data
- changes who can access customer data, order details, downloads, tickets, admin exports, or audit records
- adds background sends, reminders, referrals, marketing loops, or notification frequency changes
- adds automation that affects eligibility, price, discount, fraud handling, fulfillment, ranking, or admin visibility
- exposes new public URLs, signed links, public metadata, sitemap entries, or crawlable shells for private workflows
- changes backup, restore, import, export, or reconciliation behavior for sensitive records
- introduces user-generated uploads, generated content, third-party scripts, AI/ML, or analytics beyond operational diagnostics
- makes customer-facing policy, refund, tax, shipping, availability, or event-access claims

## Documentation Expectations

- Update the owning doc when a mitigation becomes part of the workflow. Do not leave ethical-risk decisions only in a PR comment.
- Keep customer-facing copy truthful, localized through the existing catalog when applicable, and specific about consent, suppression, fulfillment, and support paths.
- Keep runbooks honest about residual risk. If a mitigation depends on operator review, state the owner, evidence, and cadence.

## v1.0.6 Cache And Recovery Review

- **Surveillance/data control:** Workers Cache telemetry could become hidden admin monitoring. Mitigation: the Analytics Engine schema is fixed to route, cache status/bypass, duration, response size, and expected operation counts; it excludes identity, order, URL/query, cookie, token, location, and response-body fields and has an independent kill switch.
- **Implicit trust/admin access:** A reusable scheduled admin session would broaden access to customer rows. Mitigation: the nightly probe uses a dedicated rate-limited credential whose endpoint returns metrics only and cannot purge, change settings, or invoke checkout/fulfillment operations.
- **Backup misuse:** Captured order/admin/R2 data could expose customers or copyrighted files. Mitigation: sensitive capture requires exact acknowledgement, public-key encryption plus decryptability verification, protected approval, private temporary files, complete provider enumeration, preview-only restore, aggregate-only evidence, read-after-write verification, and exact-snapshot cleanup with zero-residual checks. No unattended production restore path exists.
- **Automation and economic harm:** A restore during active checkout or webhook settlement could duplicate or lose payment/inventory effects. Mitigation: the quarterly job uses Worker-wide request/error preflight, production concurrency, fresh one-time admin access, a restricted live read-only Stripe comparison, preview resources, idempotency fixture coverage, and no Stripe/email/check-in write path. Durable Object inventory correction additionally requires distinct super-admin maker/checker approval and maintenance/webhook/reservation interlocks. Production restore retains separate maintenance and second-review gates.
- **Accessibility, localization, and SEO:** The work adds operator scripts, settings rows, and private endpoints only. Existing boolean Settings controls remain keyboard/zoom covered; no public copy, locale route, metadata, sitemap, or crawl behavior changes.
- **Residual owner evidence:** Store operations must approve RPO/RTO/retention and the long-term off-account destination, supply a fresh one-time token and restricted live Stripe read key for each protected drill, verify decryption on a second isolated device/location, and record the first fully protected scheduled drill before the recurring recovery objective is described as proven. A live KV/R2 preview restore/readback/cleanup has passed, but admin-export, second-device, live Stripe, S3, and recurring-cadence evidence remain open.
