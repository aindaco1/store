# Tax rate data

Store's `nm_grt` provider keeps its existing New Mexico address lookup and
starter/fallback policy. For other US destinations it tries the bundled
OpenSalesTax ZIP snapshot before the existing offline rules. `offline_rules`
uses the same US lookup. `flat`, paid `zip_tax`, and international rules retain
their existing behavior. No subscription, API key, new database, or runtime
request is needed for the bundled US data.

## Coverage and estimates

The source is [OpenSalesTax](https://github.com/ejosterberg/open-sales-tax),
Apache-2.0, which compiles public SST and state revenue data. Platform imports its
release dump as **data only**; it never executes upstream SQL or Python. The
derived snapshot, license, and notice live in `shared/dust-wave-platform/packages/tax-core/data/open-us-tax.*`.
The snapshot records the release, exact download URL, SHA-256, and source asset
timestamp. Platform's changes are a conservative ZIP subset and compact JSON
representation; the upstream license and notice remain alongside it.

This is a general-rate lookup, not nationwide address-level accuracy. Current
data contains 9,177 ZIP candidates; runtime date/conflict checks may reject a
candidate (9,176 resolve on October 27, 2026). Coverage is partial, including
NYC and available ZIPs in 23 states plus Puerto Rico; it is not a complete
nationwide local-tax database. Every bundled US quote is labeled **Estimated tax** because ZIP
boundaries and upstream contributor data cannot guarantee the street address's
jurisdiction. State, county, city, and district components remain available in
the quote breakdown. For example, the NYC general rate for `10467` is 8.875%:
4% NY, 4.5% NYC, and 0.375% MCTD. [NYC Finance](https://www.nyc.gov/site/finance/business/business-nys-sales-tax.page)

Store deliberately skips ZIPs with address/ZIP+4-specific boundary records,
cross-state matches, multiple applicable cities/counties, missing or overlapping
active rates, and unsupported county/city combinations. A supplied ZIP+4 does
not bypass those checks. Alabama, Colorado, and Louisiana are excluded because
the upstream documents local coverage gaps. New Mexico uses its existing
provider. Rates older than 90 days **since the source asset update** expire;
re-downloading an unchanged file does not renew freshness.

As selected by the store owner, missing/ambiguous/stale local coverage keeps the
existing offline regional rate and lets checkout continue. The customer sees
**Estimated tax (...%; local taxes may be missing)**, including on zero-rate
fallbacks. This can undercollect local tax. It is a deliberate availability
policy, not an assertion that the offline rate is the complete amount due.

The Worker uses the same resolver for previews and canonical checkout. New
orders retain the server-generated estimate flag, coverage, source version,
components, and timestamp in `orderDraft.taxDetails`; settled totals are never
recalculated. No new storage key family or customer data is introduced. The
snapshot is Worker-only and is not downloaded by storefront browsers.

Existing taxable-subtotal, shipping, origin, and destination-selection policy
is unchanged. This change does not determine registration/nexus, product-specific
exemptions, holidays, or event sourcing. In particular, an admission's applicable
location can be its venue rather than the buyer's billing ZIP; a general NYC
rate alone does not establish that an NM event owes NYC tax. See
[NY tax sourcing guidance](https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/sales_tax_rates_additional_sales_taxes_and_fees.htm).

## Refresh and review

Run `npm run tax:update -- --output=/absolute/candidate.json` with supported Node 24. It downloads the latest public release,
checks GitHub's SHA-256, validates the COPY schema and rate values, and refuses
stale sources or a coverage drop over 20%. The old snapshot remains in place
on failure. No database server or paid endpoint is involved.

For reproducible import of an already downloaded release, use:

```sh
node scripts/update-open-us-tax.mjs --dump=/absolute/source.sql.gz --manifest=/absolute/source.json --output=/absolute/candidate.json
```

The manifest supplies `release`, `sourceUrl`, `sha256`, and `sourceUpdatedAt`
copied from the upstream release asset. Never advance the timestamp manually.

The **Open tax data refresh** GitHub workflow in dust-wave-platform checks every Monday and supports
manual runs. It uploads a candidate snapshot for review; a changed snapshot,
invalid feed, failing regression, or stale upstream source fails the job so the
repository's normal Actions notifications can surface it. It does not merge or
deploy rate changes automatically. Scheduled checks begin after this workflow
lands on the default branch.

Review source/release notes, license/NOTICE changes, coverage changes, and effective dates against the
relevant revenue authority. Update expected regression rates only after that
review. Run the tax tests and `npm run test:premerge`, then commit the reviewed snapshot in Platform and advance Store and Pool's immutable pins independently. Deploy Store through its normal process. Roll back
the consumer adapter and Platform pin together; if it has expired, the labeled fallback applies.

```sh
npx vitest run tests/unit/open-us-tax.test.ts tests/unit/tax.test.ts
```

The tests cover NYC's full stack, representative local rates, ZIP edits,
ambiguous boundaries, date transitions, overlapping rates, source expiry,
invalid schemas, and preservation of the last snapshot on failed imports.

## ZIP, state, and mailing city consistency

For US billing and shipping addresses, Store checks a supplied state against
an exact ZIP entry before preparing payment or quoting tax. Five-digit ZIPs and
ZIP+4 use the same reference. Full state names and abbreviations are accepted.
The same Worker helper serves the form's private `POST /address/check` feedback
and canonical shipping, tax, and checkout validation. Exact entries also take
precedence over broad ZIP ranges when inferring the tax state.

A conflict asks the shopper to correct either ZIP or state; it never silently
changes their address. A different city produces an optional suggestion with a
**Use [city]** button. Alternate mailing names remain allowed. Unknown ZIPs,
military entries without state data, and non-US addresses receive no new
consistency restriction. This is not street/deliverability validation, issuer
AVS, or proof of a street's tax jurisdiction.

The Worker-only reference is derived from [GeoNames US postal data](https://download.geonames.org/export/zip/),
licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Store groups
ZIP entries by state and mailing city and removes entries without a state.
GeoNames supplies this data as-is without guarantees of accuracy, timeliness,
or completeness. Attribution, source URL, retrieval date, and archive SHA-256
are retained in `shared/dust-wave-platform/packages/tax-core/data/us-postal.json`. Run `npm run postal:update -- --output=/absolute/postal-candidate.json`
(Python 3, standard library only) to create a reviewable refresh in Platform.
The updater requires an explicit output and never changes a consumer pin. Review changed
ZIP assignments and city names, then run the address/tax regressions and normal
premerge gate before releasing it. No subscription or runtime third-party
address request is needed.

The browser sends only country, ZIP, state, and city to Store, after input has
settled. Results are private/no-store and not persisted; the existing tax rate
limit protects the endpoint. Stale responses are ignored. A feedback request
failure is not treated as an invalid address; canonical checkout still enforces
known conflicts. No new customer storage key family is introduced.
