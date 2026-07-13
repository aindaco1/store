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

## v1.0.7 Operations Hardening Review

- **Admin surveillance:** Session review could become employee tracking. Mitigation: retain only admin identity/role/source, timestamps, parsed browser/OS/device, and a 16-character keyed network fingerprint for 30 days; never retain full IP, full user agent, or precise location. Access is super-admin-only, revocation requires CSRF, and revocations are audited. Residual owner: Store operator, reviewed 2026-07-10.
- **Access denial and false positives:** Download abuse controls could lock a legitimate customer using an expired link. Mitigation: lock only after 10 failures for the same order plus keyed network fingerprint within 15 minutes, limit the lock to 30 minutes, clear the failure window after a valid request, keep the entitlement unchanged, and expose support/admin refresh controls. Residual owner: Store support/operator, reviewed 2026-07-10.
- **Audit/export misuse:** Searchable audit records could expose operational or customer data. Mitigation: return an explicit redacted field set, retain existing role/CSRF boundaries, exclude arbitrary event details, and keep CSV private/no-store. Residual owner: Store operator, reviewed 2026-07-10.
- **Automation and configuration drift:** A scheduled checker could silently alter production or leak secrets into issues. Mitigation: Production Posture reads config, binding names, secret names, and sanitized provider evidence only; it writes no runtime/provider state and creates an issue containing statuses rather than values. Residual owner: Store operator, reviewed 2026-07-10.
- **Language inequity and misleading approval:** Automated localization evidence could be mistaken for professional translation. Mitigation: packets state that professional/native-speaker review is not claimed, preserve creator-authored product copy, and require reviewer/locale/date/residual issue fields before expanding locales. Residual owner: Store content owner, reviewed 2026-07-10.
- **Performance and low-connectivity access:** Remote fonts, oversized media, or over-eager images can delay usable content. Mitigation: enforce Podman Lighthouse/resource budgets, split admin CSS, self-host licensed Inter, defer Adobe CSS, generate responsive media, and prioritize only the actual LCP candidate. Adobe project `font-display` remains an operator-controlled external setting if further LCP improvement is required.
- **Recovery data control:** A separately located, operator-controlled recovery device is acceptable only as an encrypted, checksum-verified, append-only copy with local decrypt verification; it must not be exposed as a public file server. Restricted live Stripe comparison and the first fully protected recurring drill remain credential/operator gates.

## v1.0.7 Post-Release Lockdown Review

- **Supply-chain compromise:** Mutable Action tags could execute changed third-party code with repository or production credentials. Mitigation: pin every external Action to a reviewed full commit SHA, declare workflow/job permissions explicitly, keep pull-request tests read-only with synthetic credentials, and use Dependabot for reviewable SHA updates.
- **Operational credential residue:** A one-time recovery login token could remain stored after it expires even though it no longer provides useful recovery evidence. Mitigation: create it immediately before approval, delete it after use or expiry, and never treat secret-name presence as freshness proof.
- **Authentication capability disclosure:** An unauthenticated provider CLI could start a device-login flow during an automated probe and leave a short-lived pairing capability in operator logs. Mitigation: preflight Stripe CLI state with captured `stripe whoami`, skip endpoint reads when signed out, discard identity/auth output, and use only fixed redacted failure categories across release, setup, and backup tooling.
- **User impact:** The lockdown changes CI permissions, dependency maintenance, test reproducibility, and documentation only. They do not change checkout, pricing, fulfillment, admin authorization, data collection, localization, accessibility, SEO, or customer-facing behavior.

## v1.0.8 Media, Payment, Email, and Recovery Review

- **Pricing truth and economic harm:** Divergent add-on price rules could misstate a checkout or rewrite historical reporting. Mitigation: one mirrored browser/catalog/Worker/admin contract makes blank inherit, preserves explicit zero, rejects invalid/negative/over-ceiling values, applies current catalog truth only to new selections, and preserves confirmed order prices. Residual owner: Store operator, reviewed 2026-07-13.
- **Media truth, consent, and accessibility:** Repository uploads could publish misleading, unlicensed, broken, oversized, or inaccessible product media. Mitigation: repository sources remain authoritative; deterministic references/hashes/warnings make replacement reviewable; meaningful images require alt text; decorative state is explicit; optimization never silently replaces a source with a larger derivative. Content rights and the final localized media-admin copy remain Store content-owner release gates.
- **Payment duplication:** Crash recovery or reconciliation could create a second charge. Mitigation: Stripe writes are deterministically idempotent only where retry-safe, signed webhooks use leases/completion markers, reconciliation is bounded and read-only, and ambiguous money states expose no manual create/confirm/retry/refund/cancel action. Residual owner: Store payment operator, reviewed 2026-07-13.
- **Unwanted or repeated messaging:** A durable queue could resend stale email or ignore consent. Mitigation: payloads and idempotency are frozen, processing uses leases/backoff, ambiguity stops for review, abandoned-cart reminders require consent/unsubscribe, and permanent bounce/complaint suppression is shared. Short-lived one-time links remain immediate. Residual owner: Store messaging operator, reviewed 2026-07-13.
- **Data control and surveillance:** Processor or delivery evidence could become a long-lived customer/provider payload archive. Mitigation: no raw Stripe/Resend payload is retained; identifiers/status/times are minimized; suppression is hashed; outbox payload PII expires after 30 days; webhook markers expire after 35 days; minimized processor/delivery/reconciliation evidence expires after 400 days and is classified in the recovery inventory.
- **Admin power and destructive automation:** Media replacement, full optimization, reconciliation, or recovery could be abused. Mitigation: role/scope, CSRF/origin, current-SHA, directory/type, super-admin, protected-environment, reviewer, read-only provider, and preview-only recovery boundaries remain in force. No unattended production restore or money mutation is added.
- **Recovery concentration risk:** Backups in the production account or on one operator machine can fail with the system they protect. Mitigation: the `v1.0.8` closure plan requires a separate-account private encrypted immutable archive, second-location decryption, restricted live Stripe read-only comparison, preview restore/readback, and zero-residual cleanup. Residual owner: Store recovery operator; evidence remains open as of 2026-07-13 and blocks claiming the recurring protected objective is proven.
- **Language and access inequity:** The new media dashboard adds English strings before runtime-message extraction. Mitigation: `v1.0.8` release closure requires reuse of the existing English/Spanish catalog, placeholder checks, focused dashboard assertions, and deployed sampling; fabricated translated product copy is explicitly prohibited.
