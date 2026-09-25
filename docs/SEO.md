# SEO

Store SEO focuses on public product, terms, and home pages. Admin pages are excluded from crawl-oriented metadata and audit coverage. Private order and fulfillment shells remain `noindex`.

`npm run test:cache-policy` complements rendered SEO checks by verifying public cache lifetimes for product/catalog/add-on/social assets and private/no-store behavior for admin and tokenized Worker APIs. `npm run release:i18n-seo-evidence` continues to sample canonical, alternate, Open Graph, Twitter, Product/Offer/Breadcrumb/Organization, merchant return policy, sitemap, and robots output; real translated product-copy approval remains a future human QA gate.

## Current Coverage

- Store-owned order emails and Order Success changes do not add indexable fulfillment URLs.
- Ticket/download/check-in links remain token-scoped Worker routes outside the sitemap.
- Admin remains disallowed in `robots.txt`; order lookup and Order Success are crawlable `noindex` pages so search engines can see the directive.
- `sitemap.xml` and the diagnostic `/sitemap.txt` are emitted from one shared selector. Both include only canonical, indexable public pages and active/sold-out public products; archived, test-only, and `public: false` products are excluded.
- XML `lastmod` is emitted only from an explicit content `last_modified_at`; build time is never presented as page freshness.
- Sitemap and page metadata include reciprocal `hreflang` alternates for generated localized product routes and localized public shells such as home and Terms.
- Product SEO still depends on `_products/*` fields, generated localized product routes, and Store's Product/Offer JSON-LD.
- `v1.0.6` release evidence keeps rendered canonical, hreflang, Open Graph, Twitter card, Product/Offer/Breadcrumb JSON-LD, sitemap, robots, and private-route `noindex` behavior in the release smoke path.

## Public Metadata

Shared includes generate:

- canonical URLs
- alternate locale links
- Open Graph tags
- Twitter card tags
- JSON-LD
- sitemap entries

Product pages emit Product JSON-LD from `_products/` metadata, including Product, Offer, BreadcrumbList, Organization, and merchant return policy data. Product pages with variants emit multiple Offer entries so each variant price/availability state can be represented. Super admins can customize social defaults, same-as links, and merchant return policy values from **Settings -> Brand & SEO**.

The product front matter `description` field is the SEO description. In the admin product editor it appears as **SEO description** and is intentionally separate from **Product page content**, which controls the visible product-detail body.

The rendered SEO audit checks localized product `inLanguage` against the HTML language and requires product BreadcrumbList entries with stable positions and absolute Store URLs.

`robots.txt` advertises the canonical XML sitemap only. The text sitemap is retained as a human- and tool-readable parity surface, not as a second canonical feed. `scripts/audit-seo.mjs` verifies both generated formats, while `npm run test:crawl-endpoints` verifies deployed status, MIME type, XML/text parity, private-route exclusion, canonical robots linkage, ordinary-versus-Google-Inspection responses, and every submitted URL. Deploy runs the live audit after Pages publication with bounded retries for propagation.

## Search Console Product Warnings

Every Offer, including each variant and both language routes, references the
Organization's `hasMerchantReturnPolicy` by its canonical `@id`. The policy
body and customer-facing Terms continue to use `seo.merchant_return_policy`;
the default is `MerchantReturnNotPermitted`. The rendered SEO audit rejects
missing or mismatched Offer references. This follows Google's supported
[reference to a global return policy](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing#offer).

The other optional warnings need real business data, not placeholder markup:

- **`shippingDetails`:** Store calculates USPS rates from the destination,
  package, cart, and selected service. `shipping.fallback_flat_rate` is a
  failure fallback, not the advertised rate. Do not publish it as a universal
  charge, invent delivery times, or describe tickets/downloads as free physical
  shipping. Google's offer markup needs a destination and numeric shipping
  rate. For this carrier-calculated store, configure
  [Merchant Center shipping](https://support.google.com/merchants/answer/12577710?hl=en)
  against the actual checkout policy instead. Confirm account access, origin,
  supported services, package weights/dimensions, handling days and cutoff,
  and any rate adjustments before saving. Keep international and manual-rate
  product exceptions separate. The repository does not yet supply approved
  handling times or a Merchant Center feed. Until those settings are verified,
  the shipping warning remains unresolved; adding an empty shipping object or
  just a policy URL is not a valid fix.
- **`review` / `aggregateRating`:** The catalog currently has no customer
  review dataset or visible review UI. Leave these properties absent. Google
  accepts `offers` for product-snippet eligibility and may still show these
  [non-critical warnings](https://developers.google.com/search/docs/appearance/structured-data/product-snippet#product).
  Only add ratings from genuine product reviews that are also visible to
  shoppers, following the
  [review guidelines](https://developers.google.com/search/docs/appearance/structured-data/review-snippet#guidelines).
  Do not add fabricated reviews, zero-count aggregates, or store-level ratings
  as product feedback.

After the reviewed change is deployed, inspect the live English and Spanish
mug pages with Google's Rich Results Test and Search Console URL Inspection.
Confirm the Offer resolves to the configured return policy, then request
validation for the return-policy issue. Record the optional warnings separately
and allow Google to recrawl; a local passing audit does not establish that
Search Console has cleared an issue.

## Private Routes

These routes should stay out of search indexes:

- `/admin/`
- `/orders/`
- `/es/orders/`
- `/order-success/`
- `/es/order-success/`
- token-scoped Worker fulfillment, lookup, reminder, and check-in routes

`/orders/`, `/es/orders/`, `/order-success/`, and `/es/order-success/` must stay out of the sitemap and keep `noindex,nofollow` metadata, but they should not be `robots.txt`-blocked because crawlers need to access the HTML to observe `noindex`.

## Required Product Fields

Public product SEO depends on:

- `title`
- `description`
- `image`
- `image_alt`
- `price`
- `sku`
- `status`

Run:

```bash
bundle exec jekyll build --quiet
npm run test:seo
npm run test:crawl-endpoints -- --base=https://shop.dustwave.xyz
npm run test:content-security
```

Run the live crawl command only against a deployment expected to contain the candidate. Before deployment, use `npm run test:seo` and `npx vitest run tests/unit/crawl-endpoints.test.ts` so the current production site is not mistaken for the candidate.

For release evidence, run `npm run release:smoke -- --evidence-file <path>` and complete the SEO section in [MERGE_SMOKE_CHECKLIST.md](MERGE_SMOKE_CHECKLIST.md). Record sampled canonical, alternate, Open Graph, Twitter, Product JSON-LD, sitemap inclusion/exclusion, robots, and private-route `noindex` checks.
