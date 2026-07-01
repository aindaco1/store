---
layout: default
lang: es
title: Pedido recibido
description: Página de confirmación para pedidos de Store.
translation_key: order_success
indexable: false
order_success_script: true
permalink: /es/order-success/
---

<section class="storefront">
  <div class="storefront__header">
    <p class="storefront__eyebrow">Pedido</p>
    <h1>Pedido recibido</h1>
    <p data-store-order-summary-heading>Tu pago se está finalizando. Los detalles de cumplimiento aparecerán aquí cuando el pedido esté listo.</p>
  </div>

  <div class="store-order" data-store-order-success>
    <div class="store-order__status" data-store-order-status role="status" aria-live="polite">Cargando pedido...</div>
    <div class="store-order__body" data-store-order-body hidden></div>
    <div class="store-order__footer">
      <a class="btn btn--secondary" href="/es/">Volver a la tienda</a>
    </div>
  </div>
</section>
