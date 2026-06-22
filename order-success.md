---
layout: default
title: Order Received
description: Confirmation page for Store orders.
translation_key: order_success
indexable: false
---

<section class="storefront">
  <div class="storefront__header">
    <p class="storefront__eyebrow">Order</p>
    <h1>Order received</h1>
    <p data-store-order-summary-heading>Your payment is being finalized. Fulfillment details will appear here when the order is ready.</p>
  </div>

  <div class="store-order" data-store-order-success>
    <div class="store-order__status" data-store-order-status role="status" aria-live="polite">Loading order...</div>
    <div class="store-order__body" data-store-order-body hidden></div>
    <div class="store-order__footer">
      <a class="btn btn--secondary" href="/">Return to the store</a>
    </div>
  </div>
</section>

<script src="/assets/js/order-success.js?v={{ site.time | date: '%s' }}" defer></script>
