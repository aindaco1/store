---
layout: default
title: Terms
description: Dust Wave Shop terms, refund policy, shipping policy, ticket policy, download policy, and privacy policy.
translation_key: terms
---

{%- capture platform_title -%}{% include platform-display-title.html %}{%- endcapture -%}
{%- assign platform_title = platform_title | strip -%}
{%- assign platform_name = site.platform.name | default: site.title | default: "Store" | strip -%}
{%- assign platform_company = site.platform.company_name | default: site.author | default: "Dust Wave" | strip -%}
{%- assign support_email = site.platform.support_email | default: "info@dustwave.xyz" | strip -%}

<section class="storefront">
  <div class="storefront__header">
    <h1>Terms & Privacy</h1>
    <p>Effective July 1, 2026.</p>
  </div>

  <div class="storefront__product-copy">
    <h2>Contact</h2>
    <p>{{ platform_company }} operates {{ platform_title }}. Questions about an order, event, download, return, or this policy can be sent to <a href="mailto:{{ support_email }}">{{ support_email }}</a>.</p>

    <h2>Purchases</h2>
    <p>By placing an order, you agree that the information you provide is accurate and that you are authorized to use the selected payment method. Prices are listed in U.S. dollars. Taxes, shipping, and other checkout charges are shown before you submit payment.</p>
    <p>We may cancel or refund an order if an item is unavailable, inventory is incorrect, payment cannot be verified, fraud or abuse is suspected, or an order contains an obvious pricing or product error.</p>

    <h2>Payments</h2>
    <p>Payments are processed by Stripe. We do not store complete card numbers on our servers. Stripe may collect and process payment, fraud-prevention, and billing information under its own terms and privacy policy.</p>

    <h2 id="shipping-policy">Shipping</h2>
    <p>Physical orders ship from New Mexico. Shipping options and estimated charges are shown at checkout. Delivery dates are estimates, not guarantees, because carrier delays, weather, address issues, and event schedules can affect timing.</p>
    <p>If an order cannot ship within the expected timeframe, we will contact you with an updated estimate or a refund option. Please contact us promptly if your shipping address is wrong; we cannot guarantee changes after fulfillment begins.</p>

    <h2 id="returns-refunds">Returns and Refunds</h2>
    <p>For physical merchandise, contact us within 14 days of delivery if you want to request a return or exchange. Returned items must be unused, unworn, unwashed, and in reasonably resaleable condition unless the issue is damage, defect, or our fulfillment error.</p>
    <p>Shipping charges are not refundable unless the return is caused by our mistake or a damaged/defective item. Return shipping is usually the buyer's responsibility unless we approve otherwise.</p>
    <p>Damaged, defective, or incorrect items should be reported within 7 days of delivery with the order number and photos. We may offer a replacement, repair, store credit, or refund depending on availability.</p>
    <p>Final-sale items include digital downloads after access is delivered, event tickets after the event starts, free RSVPs, worn apparel, opened intimate goods, and items marked final sale. This does not limit rights you may have under applicable law.</p>

    <h2>Tickets and RSVPs</h2>
    <p>Tickets and RSVPs are valid only for the event listed at purchase. They may include QR or check-in credentials tied to the order. Do not post ticket links, QR codes, or order links publicly.</p>
    <p>If we cancel an event, we will offer a refund or replacement option when practical. If an event is postponed or moved, we will explain whether existing tickets remain valid, can be transferred, or can be refunded.</p>

    <h2>Digital Downloads</h2>
    <p>Digital products are delivered through signed order links. Confirmed digital access remains available from the order page unless we revoke access for a refund, chargeback, fraud, support, rights, or legal reason. Individual download links may be short-lived for security and can be refreshed from the order page when access is still active.</p>
    <p>Unless a product page says otherwise, digital purchases are for personal use only and do not transfer copyright, resale rights, public performance rights, or commercial licensing rights.</p>

    <h2>Product Information</h2>
    <p>We try to describe products accurately, including images, sizes, materials, variants, and event details. Small differences in color, print placement, packaging, or display are possible. Limited-run items may not be restocked.</p>

    <h2>Privacy Policy</h2>
    <p>We collect information you provide during checkout or account/admin workflows, such as name, email, shipping address, billing details, order contents, ticket or RSVP details, and support messages. We also collect basic technical information such as browser, device, IP address, pages visited, checkout events, and security logs.</p>
    <p>We use this information to process orders, calculate shipping and tax, prevent fraud, send order and admin emails, provide downloads and tickets, respond to support requests, operate the site, keep records, and improve the store.</p>
    <p>We share information with service providers only as needed to run the store, including Stripe for payments, Cloudflare for hosting and security, Resend for email, USPS and shipping/tax services for fulfillment, and analytics or operational tools if enabled. We may also disclose information if required by law, to protect rights and safety, or as part of a business transfer.</p>
    <p>We do not sell customer personal information. We do not knowingly collect personal information from children under 13. If you believe a child sent us personal information, contact us and we will review it.</p>
    <p>We keep order, fulfillment, tax, security, and support records for as long as needed for operations, legal compliance, dispute handling, fraud prevention, and accounting. You can contact us to request access, correction, or deletion of your information. Some records may need to be retained where required by law or legitimate business needs.</p>

    <h2>Security</h2>
    <p>We use reasonable technical and organizational safeguards, including HTTPS, token-scoped order links, restricted admin access, and third-party payment processing. No online service can guarantee absolute security, so please keep order links private and contact us if you suspect unauthorized access.</p>

    <h2>Site Use and Intellectual Property</h2>
    <p>Site content, product artwork, photos, copy, videos, audio, downloads, logos, and designs belong to {{ platform_company }} or the credited creators unless otherwise stated. You may not copy, resell, scrape, or commercially reuse site content or downloads without written permission.</p>
    <p>You agree not to interfere with checkout, abuse promotions, attempt unauthorized access, upload malicious files, or use the site in a way that violates law or harms the store, creators, customers, or event attendees.</p>

    <h2>Disclaimers and Limits</h2>
    <p>The store is provided as available. To the fullest extent allowed by law, {{ platform_company }} is not liable for indirect, incidental, special, consequential, or punitive damages arising from site use, products, events, shipping delays, or third-party services.</p>
    <p>Some jurisdictions do not allow certain limitations, so parts of this section may not apply to you.</p>

    <h2>Changes</h2>
    <p>We may update these terms and policies from time to time. The effective date above shows the latest version. Continued use of the store after changes means you accept the updated terms.</p>
  </div>
</section>
