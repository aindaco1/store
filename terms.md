---
layout: default
title: Terms and Store Policies
lang: en
translation_key: terms
description: Review Dust Wave Shop's order, payment, shipping, no-returns, fulfillment, event, download, privacy, and acceptable-use policies.
last_modified_at: 2026-07-14
---
{% capture store_name %}{% include platform-display-title.html %}{% endcapture %}
{% assign store_name = store_name | strip %}
{% assign operator_name = site.platform.company_name | default: site.author | default: "Store operator" %}
{% assign support_email = site.platform.support_email | default: "info@dustwave.xyz" %}
{% assign merchant_return_policy = site.seo.merchant_return_policy | default: empty %}
{% assign return_policy_category = merchant_return_policy.return_policy_category | default: "https://schema.org/MerchantReturnNotPermitted" %}
{% assign return_policy_days = merchant_return_policy.merchant_return_days | default: 14 | plus: 0 %}
{% assign return_fees = merchant_return_policy.return_fees | default: "https://schema.org/ReturnFeesCustomerResponsibility" %}
{% assign return_method = merchant_return_policy.return_method | default: "https://schema.org/ReturnByMail" %}

# Terms & Store Policies

**Effective July 14, 2026.** These terms govern use of {{ store_name }}, an online store operated by {{ operator_name }}. By using the site or placing an order, you agree to these terms and to any product- or event-specific terms shown before checkout. If a more specific term conflicts with these terms, the more specific term controls for that product or event unless prohibited by law.

## 1. Eligibility and acceptable use

You must be able to enter a binding agreement and must provide accurate contact, payment, tax, shipping, and attendee information when it is requested. Do not misuse the store, interfere with its operation, probe private access, impersonate another person, abuse promotions, submit unlawful material, share another person's private credentials, or use the store to violate another person's rights.

## 2. Orders and availability

- An order is not confirmed until {{ store_name }} finishes its server-side checks and either Stripe confirms payment or a no-charge order is accepted. An abandoned or failed checkout is not a confirmed order.
- Product, variant, add-on, ticket, RSVP, and download availability may be limited. Placing an item in the cart does not reserve it indefinitely.
- We may decline, cancel, or refund an order when an item is unavailable, inventory is incorrect, payment cannot be verified, fraud or abuse is suspected, or the order contains an obvious pricing, product, or technical error.
- Confirmed orders retain the item prices recorded when the order was completed. Later catalog changes do not rewrite a confirmed order.

## 3. Prices, payment, tax, and optional charges

Prices are shown in U.S. dollars unless stated otherwise. The server verifies current catalog prices, selected variants, coupons, optional add-ons, optional tips, shipping, tax, inventory, and the final total before an order can be confirmed. Browser-displayed totals may remain estimates until enough destination and cart information is available.

Stripe processes paid orders and handles full card numbers and security codes; we do not store them. Paid orders are charged when checkout is completed and Stripe confirms the payment. Applicable tax, shipping, discounts, add-ons, and optional tips are identified before you submit payment.

## 4. Shipping and fulfillment
{: #shipping-policy}

- Physical products ship to the address confirmed during checkout. You are responsible for checking the address and contacting [{{ support_email }}](mailto:{{ support_email }}) promptly if it is wrong. We cannot guarantee a change after fulfillment begins.
- Unless a product says otherwise, physical products ship from New Mexico, United States. Available destinations, methods, signature options, free-shipping terms, and charges are the ones shown during checkout.
- Product pages may show an estimated availability, shipment, or delivery period. These are good-faith estimates, not guarantees. Inventory, production, weather, customs, carrier operations, address problems, and other events can cause delays.
- If we learn that we cannot ship within the promised time—or within 30 days when no shipment time was stated—we will ask whether you agree to the delay or cancel the unshipped merchandise and issue the refund required by law. We will not substitute a materially different item without your agreement.
- If international delivery is offered, the recipient is responsible for import duties, brokerage fees, and local taxes not collected during checkout unless the product or checkout explicitly says otherwise.
- Carrier delay or loss is reviewed using available tracking, address, and fulfillment records. Contact us promptly if tracking appears stalled, shows the wrong destination, or marks a package delivered when it was not received.
- Tickets, RSVPs, and digital products do not require physical shipping. Their access details are delivered through the order page or transactional email.

## 5. No returns, fulfillment problems, and refunds
{: #returns-refunds}

{% if return_policy_category == "https://schema.org/MerchantReturnNotPermitted" %}
**Default policy: no returns or exchanges.** Once a paid order is charged, physical merchandise, event tickets, digital products, and add-ons are final sale. We do not accept returns or exchanges for change of mind, preference, fit, or sizing.

This final-sale policy does not remove remedies for a damaged, defective, incorrect, or missing physical item:

1. Email [{{ support_email }}](mailto:{{ support_email }}) as soon as reasonably possible and ordinarily within **seven calendar days after the carrier marks the shipment delivered**.
2. Include the order reference, a description of the problem, and clear photos of the item, packaging, and shipping label when reasonably available.
3. We verify the report against available carrier tracking and fulfillment records. If a shipment has no tracking or no reliable delivered timestamp, we review timing and evidence in good faith.
4. When the problem is verified, the available remedy may be repair, replacement, completion of missing items, or a refund for the affected item, depending on the problem and available inventory.

The seven-day period is a **problem-reporting guideline, not a return window**. Reporting later does not waive rights that cannot legally be waived, although delay may make carrier claims or factual verification harder.
{% elsif return_policy_category == "https://schema.org/MerchantReturnFiniteReturnWindow" %}
**Eligible physical merchandise may be returned or exchanged within {{ return_policy_days }} days after delivery.** Returned items must be unused, unworn, unwashed, and in reasonably resaleable condition unless the issue is damage, defect, or our fulfillment error. Contact [{{ support_email }}](mailto:{{ support_email }}) for approval before sending or bringing back an item.
{% if return_method == "https://schema.org/ReturnInStore" %}
Approved returns are completed in store using the instructions provided by support.
{% elsif return_method == "https://schema.org/ReturnAtKiosk" %}
Approved returns are completed at the designated kiosk using the instructions provided by support.
{% else %}
Approved returns are sent by mail using the instructions provided by support.
{% endif %}
{% if return_fees == "https://schema.org/FreeReturn" %}
Approved return shipping is provided at no charge.
{% elsif return_fees == "https://schema.org/ReturnShippingFees" %}
Any return-shipping fee will be disclosed before the return is authorized.
{% else %}
The customer is responsible for arranging and paying return shipping unless the return is caused by our error or a damaged or defective item.
{% endif %}
{% elsif return_policy_category == "https://schema.org/MerchantReturnUnlimitedWindow" %}
**Eligible physical merchandise may be returned or exchanged without a fixed return deadline.** Items must be unused, unworn, unwashed, and in reasonably resaleable condition unless the issue is damage, defect, or our fulfillment error. Contact [{{ support_email }}](mailto:{{ support_email }}) for approval and instructions before returning an item.
{% else %}
**Returns are not accepted unless required by law or caused by damage, defect, an incorrect or missing item, or another fulfillment problem.** Contact [{{ support_email }}](mailto:{{ support_email }}) for review.
{% endif %}

When returns are permitted, ordinary returns do not include digital products after access is delivered, tickets after the event starts, free RSVPs, worn apparel, opened intimate goods, or items specifically marked final sale. Damaged, defective, incorrect, or missing items should still be reported promptly with the order reference and available photos.

If charged merchandise cannot be shipped or another charged item cannot be fulfilled, we will explain the available lawful options. Depending on the issue, those may include consent to a delay, completion of missing items, repair, replacement, an agreed substitute, or a refund for the affected item. Duplicate charges, processor errors, suspected fraud, canceled events, chargebacks, and legally required remedies are reviewed separately from ordinary returns.

## 6. Tickets and RSVPs

Tickets and RSVPs are valid only for the event listed with the order. They may include QR or check-in credentials tied to the order. Keep ticket, QR, check-in, and order links private; sharing them can let someone else use the associated access.

Customer-requested cancellations, missed events, and unused tickets remain subject to the return policy above and any event-specific terms. If we cancel an event, we will offer the applicable refund or replacement option. If an event is postponed, moved, or materially changed, we will explain whether existing tickets remain valid and what transfer, replacement, or refund options apply.

## 7. Digital products and downloads

Digital products are delivered through token-scoped order pages and signed download links. Confirmed access remains available from the order page unless access is revoked because of a refund, chargeback, fraud, misuse, support correction, rights issue, or legal requirement. Individual download links may expire for security and can be refreshed from the order page while the entitlement remains active.

Unless a product page says otherwise, digital purchases are for personal use only. A purchase does not transfer copyright, resale rights, public-performance rights, or commercial licensing rights.

## 8. Communications and access links

Order confirmations, payment notices, shipping and fulfillment messages, download or ticket access, event updates, and support replies are transactional communications. Optional abandoned-checkout reminders require the consent described at checkout and include an unsubscribe method. Event reminders are sent only for eligible confirmed ticket or RSVP orders.

Order lookup, order detail, download, ticket, check-in, and administration links may provide access without a password. Keep them private. A link may expire, be refreshed, be revoked, or be temporarily limited when it is misused or no longer points to an active entitlement.

## 9. Privacy and data

We collect information needed to operate the service, including contact details, order contents, prices and payment status, shipping information for physical products, ticket or RSVP details, reminder choices, referral information when supplied, and support messages. Stripe handles full payment-card details. Cloudflare provides site, Worker, security, storage, and operational infrastructure; Resend delivers email; and shipping, tax, address, analytics, or abuse-prevention providers receive limited data only when their service is needed and enabled.

Authorized administrators may access customer, attendee, order, reporting, inventory, download, and fulfillment information only within their assigned role and scope. Super administrators may access information needed to operate, secure, reconcile, support, audit, back up, or restore the store. We do not sell customer personal information. Records may be retained for fulfillment, accounting, fraud prevention, security, legal obligations, disputes, payment reconciliation, and disaster recovery, then deleted or minimized when no longer reasonably needed.

To ask a privacy question or request review, correction, or deletion of information associated with your email, contact [{{ support_email }}](mailto:{{ support_email }}). We may need to verify that you control the relevant email or order. Some records may still need to be retained for legal, accounting, fraud-prevention, security, or dispute-handling purposes.

## 10. Intellectual property and open source

Product artwork, photos, copy, video, audio, downloads, logos, designs, and other creative material belong to {{ operator_name }} or the credited creators unless stated otherwise. You may not copy, resell, scrape, distribute, or commercially reuse that material without permission or an applicable license.

The software that powers the store is available under the license published in its [GitHub repository](https://github.com/aindaco1/store). That software license does not grant rights to product media, downloads, trademarks, customer information, private administration data, or other material not covered by the repository license.

## 11. Availability, disclaimers, and liability

The store is provided on an “as available” basis. We work to keep catalog, checkout, order, inventory, email, and fulfillment records reliable, but do not promise uninterrupted or error-free operation. To the fullest extent permitted by law, {{ operator_name }} is not liable for indirect, incidental, special, consequential, or punitive damages arising from use of the store, products, events, carrier delays, or third-party services. Nothing in these terms excludes liability or customer rights that cannot legally be excluded.

## 12. Changes to these terms

We may update these terms to reflect product, legal, or operational changes. The effective date above will change when the public terms change materially. Changes apply prospectively unless law requires otherwise. Material changes affecting an existing order or event should also be communicated to the affected customer through the normal order or event channel.

## 13. Contact

Questions about an order, payment, shipment, fulfillment problem, event, download, privacy request, or these terms can be sent to [{{ support_email }}](mailto:{{ support_email }}). Include the order reference when applicable; do not email full card numbers, security codes, ticket QR codes, or private access links.
