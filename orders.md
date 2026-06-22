---
layout: default
title: Orders
description: Request a secure order lookup link.
translation_key: orders
indexable: false
sitemap: false
---

<section class="storefront storefront--orders">
  <div class="storefront__header storefront__header--compact">
    <p class="storefront__eyebrow">Orders</p>
    <h1>Find your order</h1>
  </div>

  <div class="store-order-lookup" data-store-order-lookup>
    <form class="store-order-lookup__form" data-store-order-lookup-form novalidate>
      <div class="store-order-lookup__field">
        <label for="store-order-lookup-email">Email address</label>
        <input id="store-order-lookup-email" name="email" type="email" autocomplete="email" required data-store-order-lookup-email>
      </div>
      <button class="btn" type="submit" data-store-order-lookup-submit>Email lookup link</button>
    </form>

    <div class="store-order__status" data-store-order-lookup-status role="status" aria-live="polite"></div>
    <div class="store-order-lookup__results" data-store-order-lookup-results hidden></div>
  </div>
</section>

<script src="/assets/js/order-lookup.js?v={{ site.time | date: '%s' }}" defer></script>
