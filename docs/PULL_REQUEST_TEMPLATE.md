# Pull Request Checklist

## Summary

- What changed:
- Why:

## Checks

- [ ] `npm run test:unit`
- [ ] `npm run test:content-security`
- [ ] `npm run test:security`
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
- [ ] Product publish and inventory publish paths still trigger the intended writes.
