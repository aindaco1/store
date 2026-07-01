---
layout: default
lang: es
title: Pedidos
description: Solicita un enlace seguro para buscar tu pedido.
translation_key: orders
indexable: false
sitemap: false
order_lookup_script: true
permalink: /es/orders/
---

<section class="storefront storefront--orders">
  <div class="storefront__header storefront__header--compact">
    <h1>Busca tu pedido</h1>
  </div>

  <div class="store-order-lookup" data-store-order-lookup>
    <form class="store-order-lookup__form" data-store-order-lookup-form novalidate>
      <div class="store-order-lookup__field">
        <label for="store-order-lookup-email">Correo electrónico</label>
        <input id="store-order-lookup-email" name="email" type="email" autocomplete="email" required data-store-order-lookup-email>
      </div>
      <button class="btn" type="submit" data-store-order-lookup-submit>Enviar enlace de búsqueda</button>
    </form>

    <div class="store-order__status" data-store-order-lookup-status role="status" aria-live="polite"></div>
    <div class="store-order-lookup__results" data-store-order-lookup-results hidden></div>
  </div>
</section>
