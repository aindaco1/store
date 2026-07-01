# Pull Request Checklist

## Summary

- What changed:
- Why:

## Checks

- [ ] `npm run test:unit`
- [ ] `npm run test:seo`
- [ ] `npm run test:content-security`
- [ ] `npm run test:security`
- [ ] `npm run sync:worker-config` when catalog/config changed
- [ ] `bundle exec jekyll build --quiet`
- [ ] Playwright coverage for touched UI paths

## Store Smoke

- [ ] Product add-to-cart still works.
- [ ] Cart quantity changes still work.
- [ ] Checkout rejects tampered prices.
- [ ] Paid order confirmation still settles from Stripe webhook.
- [ ] Free RSVP confirmation still bypasses Stripe.
- [ ] Digital download fulfillment still returns a signed action.
- [ ] Ticket/RSVP check-in still works from admin.
- [ ] Coupons still apply/reject correctly when touched.
- [ ] Customer order lookup remains generic on request and token-scoped on consume.
- [ ] Reminder, referral, or marketing changes preserve suppression/audit behavior.
- [ ] Product publish and inventory publish paths still trigger the intended writes.
