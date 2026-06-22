# Store Shipping

Store uses a Worker-first shipping model. The browser can display estimates, but the Worker owns final shipping totals during checkout and fulfillment.

## Defaults

Local and production defaults live in `_config.yml`:

```yaml
shipping:
  origin_zip: "87120"
  origin_country: "US"
  fallback_flat_rate: 3.00
  default_option: standard
  usps:
    enabled: true
    timeout_ms: 5000
    quote_cache_ttl_seconds: 600
    failure_cooldown_seconds: 300
    rate_limit_cooldown_seconds: 1800
```

The current default posture is:

- USPS live quotes when configured and available
- `$3.00` fallback flat rate
- New Mexico origin ZIP `87120`
- physical products use package presets
- tickets, RSVPs, and downloads do not require shipping

## Product Metadata

Each physical product should declare a `shipping_preset`:

```yaml
shipping_preset: tshirt
```

Current presets:

- `tshirt`
- `sticker`
- `poster`
- `parcel`
- `mug`
- `ticket`

Preset values include weight, packaging weight, length, width, height, and stack height. They are mirrored into the Worker config by:

```bash
npm run sync:worker-config
```

## Checkout Rules

The Worker derives the shipping requirement from the validated cart:

- physical items require shipping
- digital downloads do not require shipping
- paid tickets do not require shipping
- free RSVPs do not require shipping
- mixed carts require shipping only for the physical subset

For physical carts, the Worker calculates package inputs from product quantities and shipping presets, then attempts a USPS quote when configured. If USPS is disabled, missing credentials, cooling down, rate-limited, or unavailable, the Worker falls back to the configured flat rate.

## USPS Boundary

The USPS client ID is non-secret runtime config and is mirrored from `_config.yml` into Worker vars. The USPS client secret must stay outside Git in Worker secrets or ignored local `worker/.dev.vars`.

- `USPS_CLIENT_ID`: non-secret runtime config
- `USPS_CLIENT_SECRET`: Worker secret

The Store shipping implementation needs rating, not label purchasing. Do not add USPS label APIs unless the fulfillment workflow explicitly changes.

Operational expectations:

- cache successful quotes briefly
- fail closed only for malformed checkout data
- fall back gracefully when USPS is unavailable
- keep final order totals consistent across checkout, email, admin, and fulfillment exports

## Tax Interaction

Shipping and tax are calculated together in checkout totals. New Mexico GRT remains the default tax provider.

Important rules:

- the Worker is authoritative for taxable subtotal, shipping, and tax
- the browser cannot override tax or shipping totals
- address/contact drafts should be session-scoped where possible
- sensitive checkout responses should be `private, no-store`

## Admin And Fulfillment

Admin order rows and CSV exports should show the final shipping total stored on the order. Fulfillment operators should not recalculate shipping from the browser cart after checkout.

Inventory and shipping are separate concerns:

- inventory reserves/commits SKU quantity
- shipping prices the physical shipment
- digital/ticket/RSVP fulfillment skips shipment pricing

## Verification

Run after shipping config, product preset, or checkout-total changes:

```bash
npm run sync:worker-config
npx vitest run tests/unit/shipping.test.ts tests/unit/store-catalog.test.ts
SITE_URL=http://127.0.0.1:4002 WORKER_URL=http://127.0.0.1:8989 ./scripts/test-worker.sh
```

Manual launch smoke:

1. Add one physical product.
2. Enter a U.S. ZIP/postal address in checkout.
3. Confirm shipping appears in the order total.
4. Complete a Stripe test payment.
5. Confirm the order email/admin row/CSV use the same shipping total.
6. Repeat with a digital/ticket/RSVP-only cart and confirm no shipping address is required.

## Open Decisions

- Whether Store v1 should expose customer-selectable shipping service levels beyond the default option.
- Whether label purchasing belongs in Store or in a separate fulfillment workflow.
- Whether international shipping should be enabled at launch or held until real package/handling policies are finalized.
