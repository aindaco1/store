---
layout: default
lang: es
title: Términos
description: Términos de Dust Wave Shop, política de no devoluciones y problemas de entrega, política de envíos, boletos, descargas y privacidad.
translation_key: terms
permalink: /es/terms/
last_modified_at: 2026-07-14
---

{%- capture platform_title -%}{% include platform-display-title.html %}{%- endcapture -%}
{%- assign platform_title = platform_title | strip -%}
{%- assign platform_name = site.platform.name | default: site.title | default: "Store" | strip -%}
{%- assign platform_company = site.platform.company_name | default: site.author | default: "Dust Wave" | strip -%}
{%- assign support_email = site.platform.support_email | default: "info@dustwave.xyz" | strip -%}
{%- assign merchant_return_policy = site.seo.merchant_return_policy | default: empty -%}
{%- assign return_policy_category = merchant_return_policy.return_policy_category | default: "https://schema.org/MerchantReturnNotPermitted" -%}
{%- assign return_policy_days = merchant_return_policy.merchant_return_days | default: 14 | plus: 0 -%}

<section class="storefront">
  <div class="storefront__header">
    <h1>Términos y privacidad</h1>
    <p>Vigente a partir del 14 de julio de 2026.</p>
  </div>

  <div class="storefront__product-copy">
    <h2>Aviso de traducción</h2>
    <p>Esta traducción al español se proporciona por conveniencia y fue traducida automáticamente. En caso de conflicto, la versión en inglés controla hasta que esta traducción sea revisada legalmente.</p>

    <h2>Contacto</h2>
    <p>{{ platform_company }} opera {{ platform_title }}. Las preguntas sobre un pedido, evento, descarga, devolución o esta política pueden enviarse a <a href="mailto:{{ support_email }}">{{ support_email }}</a>.</p>

    <h2>Compras</h2>
    <p>Al realizar un pedido, aceptas que la información que proporcionas es exacta y que estás autorizado para usar el método de pago seleccionado. Los precios se muestran en dólares estadounidenses. Los impuestos, el envío y otros cargos de checkout se muestran antes de que envíes el pago.</p>
    <p>Podemos cancelar o reembolsar un pedido si un artículo no está disponible, el inventario es incorrecto, el pago no puede verificarse, se sospecha fraude o abuso, o un pedido contiene un error evidente de precio o producto.</p>

    <h2>Pagos</h2>
    <p>Los pagos son procesados por Stripe. No almacenamos números completos de tarjeta en nuestros servidores. Stripe puede recopilar y procesar información de pago, prevención de fraude y facturación conforme a sus propios términos y política de privacidad.</p>

    <h2 id="shipping-policy">Envíos</h2>
    <p>Los pedidos físicos se envían desde Nuevo México. Las opciones de envío y los cargos estimados se muestran durante el checkout. Las fechas de entrega son estimaciones, no garantías, porque retrasos del transportista, clima, problemas de dirección y horarios de eventos pueden afectar los tiempos.</p>
    <p>Si un pedido no puede enviarse dentro del plazo esperado, nos comunicaremos contigo con una estimación actualizada o una opción de reembolso. Contáctanos pronto si tu dirección de envío es incorrecta; no podemos garantizar cambios después de que comience el cumplimiento.</p>

    <h2 id="returns-refunds">Devoluciones, problemas de entrega y reembolsos</h2>
    {%- if return_policy_category == "https://schema.org/MerchantReturnNotPermitted" %}
    <p><strong>Política predeterminada: no se aceptan devoluciones ni cambios.</strong> Una vez cobrado un pedido, la mercancía física, los boletos de eventos, los productos digitales y los complementos son venta final. No aceptamos devoluciones ni cambios por arrepentimiento, preferencia, ajuste o talla.</p>
    <p>Esta política de venta final no elimina las soluciones disponibles para un artículo físico dañado, defectuoso, incorrecto o faltante:</p>
    <ol>
      <li>Escribe a <a href="mailto:{{ support_email }}">{{ support_email }}</a> tan pronto como sea razonablemente posible y, por lo general, dentro de los <strong>siete días calendario posteriores a la fecha en que el transportista marque el envío como entregado</strong>.</li>
      <li>Incluye la referencia del pedido, una descripción del problema y fotos claras del artículo, empaque y etiqueta de envío cuando estén razonablemente disponibles.</li>
      <li>Verificamos el reporte con los registros disponibles de seguimiento y preparación. Si el envío no tiene seguimiento o no existe una fecha confiable de entrega, revisamos de buena fe el momento del reporte y la evidencia.</li>
      <li>Cuando se verifica el problema, la solución disponible puede ser reparación, reemplazo, entrega de artículos faltantes o reembolso del artículo afectado, según el problema y el inventario disponible.</li>
    </ol>
    <p>El periodo de siete días es una <strong>pauta para reportar problemas, no un plazo de devolución</strong>. Un reporte posterior no elimina derechos que legalmente no puedan excluirse, aunque la demora puede dificultar una reclamación al transportista o la verificación de los hechos.</p>
    <p>Si un artículo cobrado no puede entregarse, {{ platform_company }} proporcionará un plan actualizado y podrá ofrecer un envío posterior, un sustituto razonable con tu aprobación o un reembolso por el artículo no entregado. Los cobros duplicados, errores del procesador, sospechas de fraude, eventos cancelados y reembolsos exigidos por la ley se revisan por separado de las devoluciones ordinarias.</p>
    {%- else %}
    <p>Para mercancía física, contáctanos dentro de los {{ return_policy_days }} días posteriores a la entrega si quieres solicitar una devolución o cambio. Los artículos devueltos deben estar sin usar, sin vestir, sin lavar y en condiciones razonables para reventa, salvo que el problema sea daño, defecto o error nuestro de cumplimiento.</p>
    <p>Los cargos de envío no son reembolsables salvo que la devolución sea causada por nuestro error o por un artículo dañado o defectuoso. El envío de devolución normalmente es responsabilidad del comprador, a menos que aprobemos lo contrario.</p>
    <p>Los artículos dañados, defectuosos, incorrectos o faltantes deben reportarse normalmente dentro de los siete días calendario posteriores a la entrega con el número de pedido y fotos. Podemos ofrecer reemplazo, reparación, entrega de artículos faltantes, crédito de tienda o reembolso según el problema y la disponibilidad.</p>
    <p>Las descargas digitales después de que se entregue el acceso, los boletos después de que comience el evento, los RSVPs gratuitos, la ropa usada, los productos íntimos abiertos y los artículos marcados como venta final siguen sin ser elegibles para devoluciones ordinarias. Esto no limita derechos que legalmente no puedan excluirse.</p>
    {%- endif %}

    <h2>Boletos y RSVPs</h2>
    <p>Los boletos y RSVPs son válidos solo para el evento indicado al momento de compra. Pueden incluir credenciales QR o de check-in vinculadas al pedido. No publiques enlaces de boletos, códigos QR ni enlaces de pedidos en público.</p>
    <p>Si cancelamos un evento, ofreceremos un reembolso u opción de reemplazo cuando sea práctico. Si un evento se pospone o cambia de lugar, explicaremos si los boletos existentes siguen siendo válidos, pueden transferirse o pueden reembolsarse.</p>

    <h2>Descargas digitales</h2>
    <p>Los productos digitales se entregan mediante enlaces de pedido firmados. El acceso digital confirmado permanece disponible desde la página del pedido salvo que revoquemos el acceso por un reembolso, contracargo, fraude, soporte, derechos o motivo legal. Los enlaces individuales de descarga pueden ser de corta duración por seguridad y pueden actualizarse desde la página del pedido cuando el acceso sigue activo.</p>
    <p>Salvo que la página del producto indique lo contrario, las compras digitales son solo para uso personal y no transfieren derechos de autor, derechos de reventa, derechos de ejecución pública ni derechos de licencia comercial.</p>

    <h2>Información del producto</h2>
    <p>Intentamos describir los productos con exactitud, incluidas imágenes, tallas, materiales, variantes y detalles de eventos. Puede haber pequeñas diferencias en color, ubicación de impresión, empaque o visualización. Los artículos de tirada limitada pueden no reponerse.</p>

    <h2>Política de privacidad</h2>
    <p>Recopilamos la información que proporcionas durante checkout o flujos de cuenta/administración, como nombre, correo electrónico, dirección de envío, detalles de facturación, contenido del pedido, detalles de boleto o RSVP y mensajes de soporte. También recopilamos información técnica básica como navegador, dispositivo, dirección IP, páginas visitadas, eventos de checkout y registros de seguridad.</p>
    <p>Usamos esta información para procesar pedidos, calcular envío e impuestos, prevenir fraude, enviar correos de pedido y administración, proporcionar descargas y boletos, responder solicitudes de soporte, operar el sitio, mantener registros y mejorar la tienda.</p>
    <p>Compartimos información con proveedores de servicios solo según sea necesario para operar la tienda, incluidos Stripe para pagos, Cloudflare para alojamiento y seguridad, Resend para correo electrónico, USPS y servicios de envío/impuestos para cumplimiento, y herramientas de analítica u operación si están habilitadas. También podemos divulgar información si la ley lo exige, para proteger derechos y seguridad, o como parte de una transferencia comercial.</p>
    <p>No vendemos información personal de clientes. No recopilamos conscientemente información personal de menores de 13 años. Si crees que un menor nos envió información personal, contáctanos y la revisaremos.</p>
    <p>Conservamos registros de pedidos, cumplimiento, impuestos, seguridad y soporte durante el tiempo necesario para operaciones, cumplimiento legal, manejo de disputas, prevención de fraude y contabilidad. Puedes contactarnos para solicitar acceso, corrección o eliminación de tu información. Algunos registros pueden necesitar conservarse cuando lo exija la ley o por necesidades comerciales legítimas.</p>

    <h2>Seguridad</h2>
    <p>Usamos salvaguardas técnicas y organizativas razonables, incluidas HTTPS, enlaces de pedido con alcance por token, acceso administrativo restringido y procesamiento de pagos por terceros. Ningún servicio en línea puede garantizar seguridad absoluta, así que mantén privados los enlaces de pedido y contáctanos si sospechas acceso no autorizado.</p>

    <h2>Uso del sitio y propiedad intelectual</h2>
    <p>El contenido del sitio, arte de productos, fotos, textos, videos, audio, descargas, logotipos y diseños pertenecen a {{ platform_company }} o a los creadores acreditados, salvo que se indique lo contrario. No puedes copiar, revender, extraer o reutilizar comercialmente contenido del sitio o descargas sin permiso por escrito.</p>
    <p>Aceptas no interferir con checkout, abusar de promociones, intentar acceso no autorizado, subir archivos maliciosos ni usar el sitio de una manera que viole la ley o perjudique a la tienda, creadores, clientes o asistentes a eventos.</p>

    <h2>Descargos de responsabilidad y límites</h2>
    <p>La tienda se proporciona según disponibilidad. En la medida máxima permitida por la ley, {{ platform_company }} no es responsable por daños indirectos, incidentales, especiales, consecuentes o punitivos que surjan del uso del sitio, productos, eventos, retrasos de envío o servicios de terceros.</p>
    <p>Algunas jurisdicciones no permiten ciertas limitaciones, por lo que partes de esta sección pueden no aplicarse a ti.</p>

    <h2>Cambios</h2>
    <p>Podemos actualizar estos términos y políticas de vez en cuando. La fecha de vigencia anterior muestra la versión más reciente. El uso continuado de la tienda después de cambios significa que aceptas los términos actualizados.</p>
  </div>
</section>
