---
layout: default
title: Términos y políticas de la tienda
lang: es
translation_key: terms
permalink: /es/terms/
description: Consulta las políticas de Dust Wave Shop sobre pedidos, pagos, envíos, no devoluciones, entrega, eventos, descargas, privacidad y uso aceptable.
last_modified_at: 2026-07-14
---
{% capture store_name %}{% include platform-display-title.html %}{% endcapture %}
{% assign store_name = store_name | strip %}
{% assign operator_name = site.platform.company_name | default: site.author | default: "Operador de Store" %}
{% assign support_email = site.platform.support_email | default: "info@dustwave.xyz" %}
{% assign merchant_return_policy = site.seo.merchant_return_policy | default: empty %}
{% assign return_policy_category = merchant_return_policy.return_policy_category | default: "https://schema.org/MerchantReturnNotPermitted" %}
{% assign return_policy_days = merchant_return_policy.merchant_return_days | default: 14 | plus: 0 %}
{% assign return_fees = merchant_return_policy.return_fees | default: "https://schema.org/ReturnFeesCustomerResponsibility" %}
{% assign return_method = merchant_return_policy.return_method | default: "https://schema.org/ReturnByMail" %}

# Términos y políticas de la tienda

**Vigentes a partir del 14 de julio de 2026.** Estos términos rigen el uso de {{ store_name }}, una tienda en línea operada por {{ operator_name }}. Al usar el sitio o realizar un pedido, aceptas estos términos y cualquier término específico del producto o evento que se muestre antes del pago. Si un término más específico entra en conflicto con estos términos, el término más específico controla para ese producto o evento, salvo que la ley lo prohíba.

> **Aviso de traducción:** Esta versión en español se proporciona por conveniencia y fue traducida automáticamente. En caso de conflicto, la versión en inglés controla hasta que esta traducción reciba revisión legal y de una persona hablante nativa.

## 1. Elegibilidad y uso aceptable

Debes poder celebrar un acuerdo vinculante y proporcionar información exacta de contacto, pago, impuestos, envío y asistencia cuando se solicite. No uses indebidamente la tienda, interfieras con su funcionamiento, intentes acceder a áreas privadas, suplantes a otra persona, abuses de promociones, envíes material ilícito, compartas credenciales privadas de otra persona ni uses la tienda para violar derechos ajenos.

## 2. Pedidos y disponibilidad

- Un pedido no se confirma hasta que {{ store_name }} completa sus verificaciones del lado del servidor y Stripe confirma el pago o se acepta un pedido sin cargo. Un pago abandonado o fallido no es un pedido confirmado.
- La disponibilidad de productos, variantes, complementos, boletos, RSVPs y descargas puede ser limitada. Agregar un artículo al carrito no lo reserva de manera indefinida.
- Podemos rechazar, cancelar o reembolsar un pedido cuando un artículo no está disponible, el inventario es incorrecto, el pago no puede verificarse, se sospecha fraude o abuso, o el pedido contiene un error evidente de precio, producto o tecnología.
- Los pedidos confirmados conservan los precios de los artículos registrados cuando se completó el pedido. Los cambios posteriores del catálogo no modifican un pedido confirmado.

## 3. Precios, pagos, impuestos y cargos opcionales

Los precios se muestran en dólares estadounidenses salvo que se indique otra cosa. El servidor verifica los precios actuales del catálogo, variantes seleccionadas, cupones, complementos opcionales, propinas opcionales, envío, impuestos, inventario y total final antes de confirmar un pedido. Los totales mostrados por el navegador pueden seguir siendo estimaciones hasta que haya suficiente información sobre el destino y el carrito.

Stripe procesa los pedidos pagados y gestiona los números completos de tarjeta y códigos de seguridad; nosotros no los almacenamos. Los pedidos pagados se cobran cuando se completa el pago y Stripe lo confirma. Los impuestos, el envío, los descuentos, los complementos y las propinas opcionales aplicables se identifican antes de que envíes el pago.

## 4. Envío y entrega
{: #shipping-policy}

- Los productos físicos se envían a la dirección confirmada durante el pago. Es tu responsabilidad revisar la dirección y comunicarte pronto con [{{ support_email }}](mailto:{{ support_email }}) si es incorrecta. No podemos garantizar un cambio después de que comience la preparación.
- Salvo que un producto indique otra cosa, los productos físicos se envían desde Nuevo México, Estados Unidos. Los destinos, métodos, opciones de firma, condiciones de envío gratuito y cargos disponibles son los que se muestran durante el pago.
- Las páginas de producto pueden mostrar un periodo estimado de disponibilidad, envío o entrega. Son estimaciones de buena fe, no garantías. El inventario, la producción, el clima, las aduanas, las operaciones del transportista, los problemas de dirección y otros acontecimientos pueden causar retrasos.
- Si sabemos que no podemos enviar dentro del plazo prometido —o dentro de 30 días cuando no se indicó un plazo de envío— te pediremos que aceptes el retraso o cancelaremos la mercancía no enviada y emitiremos el reembolso exigido por la ley. No sustituiremos un artículo por otro materialmente distinto sin tu autorización.
- Si se ofrece entrega internacional, la persona destinataria es responsable de aranceles, cargos de intermediación e impuestos locales no cobrados durante el pago, salvo que el producto o el pago indiquen expresamente otra cosa.
- Los retrasos o pérdidas del transportista se revisan con los registros disponibles de seguimiento, dirección y preparación. Contáctanos pronto si el seguimiento parece detenido, muestra un destino incorrecto o marca un paquete como entregado cuando no lo recibiste.
- Los boletos, RSVPs y productos digitales no requieren envío físico. Sus detalles de acceso se entregan mediante la página del pedido o correo transaccional.

## 5. No devoluciones, problemas de entrega y reembolsos
{: #returns-refunds}

{% if return_policy_category == "https://schema.org/MerchantReturnNotPermitted" %}
**Política predeterminada: no se aceptan devoluciones ni cambios.** Una vez cobrado un pedido, la mercancía física, los boletos de eventos, los productos digitales y los complementos son venta final. No aceptamos devoluciones ni cambios por arrepentimiento, preferencia, ajuste o talla.

Esta política de venta final no elimina las soluciones disponibles para un artículo físico dañado, defectuoso, incorrecto o faltante:

1. Escribe a [{{ support_email }}](mailto:{{ support_email }}) tan pronto como sea razonablemente posible y, por lo general, dentro de los **siete días calendario posteriores a la fecha en que el transportista marque el envío como entregado**.
2. Incluye la referencia del pedido, una descripción del problema y fotos claras del artículo, empaque y etiqueta de envío cuando estén razonablemente disponibles.
3. Verificamos el reporte con los registros disponibles de seguimiento y preparación. Si el envío no tiene seguimiento o no existe una fecha confiable de entrega, revisamos de buena fe el momento del reporte y la evidencia.
4. Cuando se verifica el problema, la solución disponible puede ser reparación, reemplazo, entrega de artículos faltantes o reembolso del artículo afectado, según el problema y el inventario disponible.

El periodo de siete días es una **pauta para reportar problemas, no un plazo de devolución**. Un reporte posterior no elimina derechos que legalmente no puedan excluirse, aunque la demora puede dificultar una reclamación al transportista o la verificación de los hechos.
{% elsif return_policy_category == "https://schema.org/MerchantReturnFiniteReturnWindow" %}
**La mercancía física elegible puede devolverse o cambiarse dentro de los {{ return_policy_days }} días posteriores a la entrega.** Los artículos deben estar sin usar, sin vestir, sin lavar y en condiciones razonables para reventa, salvo que el problema sea daño, defecto o un error nuestro de preparación. Comunícate con [{{ support_email }}](mailto:{{ support_email }}) para obtener aprobación antes de enviar o llevar un artículo de vuelta.
{% if return_method == "https://schema.org/ReturnInStore" %}
Las devoluciones aprobadas se completan en la tienda según las instrucciones proporcionadas por soporte.
{% elsif return_method == "https://schema.org/ReturnAtKiosk" %}
Las devoluciones aprobadas se completan en el quiosco designado según las instrucciones proporcionadas por soporte.
{% else %}
Las devoluciones aprobadas se envían por correo según las instrucciones proporcionadas por soporte.
{% endif %}
{% if return_fees == "https://schema.org/FreeReturn" %}
El envío de devolución aprobado se proporciona sin cargo.
{% elsif return_fees == "https://schema.org/ReturnShippingFees" %}
Cualquier cargo de envío de devolución se informará antes de autorizar la devolución.
{% else %}
El cliente es responsable de organizar y pagar el envío de devolución, salvo que la devolución se deba a un error nuestro o a un artículo dañado o defectuoso.
{% endif %}
{% elsif return_policy_category == "https://schema.org/MerchantReturnUnlimitedWindow" %}
**La mercancía física elegible puede devolverse o cambiarse sin un plazo fijo.** Los artículos deben estar sin usar, sin vestir, sin lavar y en condiciones razonables para reventa, salvo que el problema sea daño, defecto o un error nuestro de preparación. Comunícate con [{{ support_email }}](mailto:{{ support_email }}) para obtener aprobación e instrucciones antes de devolver un artículo.
{% else %}
**No se aceptan devoluciones salvo que la ley las exija o se deban a daño, defecto, un artículo incorrecto o faltante u otro problema de entrega.** Comunícate con [{{ support_email }}](mailto:{{ support_email }}) para revisión.
{% endif %}

Cuando se permiten devoluciones, las devoluciones ordinarias no incluyen productos digitales después de entregar el acceso, boletos después de que comience el evento, RSVPs gratuitos, ropa usada, productos íntimos abiertos ni artículos marcados específicamente como venta final. Los artículos dañados, defectuosos, incorrectos o faltantes deben reportarse pronto con la referencia del pedido y las fotos disponibles.

Si no podemos enviar mercancía cobrada o no podemos entregar otro artículo cobrado, explicaremos las opciones legales disponibles. Según el problema, pueden incluir aceptar un retraso, completar artículos faltantes, reparar, reemplazar, aceptar un sustituto o recibir un reembolso por el artículo afectado. Los cobros duplicados, errores del procesador, sospechas de fraude, eventos cancelados, contracargos y soluciones exigidas por la ley se revisan por separado de las devoluciones ordinarias.

## 6. Boletos y RSVPs

Los boletos y RSVPs son válidos solo para el evento indicado en el pedido. Pueden incluir credenciales QR o de registro vinculadas al pedido. Mantén privados los enlaces de boletos, QR, registro y pedido; compartirlos puede permitir que otra persona use el acceso asociado.

Las cancelaciones solicitadas por el cliente, la inasistencia y los boletos no utilizados siguen sujetos a la política de devoluciones anterior y a cualquier término específico del evento. Si cancelamos un evento, ofreceremos el reembolso u opción de reemplazo aplicable. Si un evento se pospone, cambia de lugar o cambia de manera importante, explicaremos si los boletos existentes siguen siendo válidos y qué opciones de transferencia, reemplazo o reembolso corresponden.

## 7. Productos digitales y descargas

Los productos digitales se entregan mediante páginas de pedido con alcance por token y enlaces de descarga firmados. El acceso confirmado permanece disponible desde la página del pedido salvo que se revoque por un reembolso, contracargo, fraude, uso indebido, corrección de soporte, problema de derechos o exigencia legal. Los enlaces individuales de descarga pueden vencer por seguridad y pueden actualizarse desde la página del pedido mientras el derecho de acceso siga activo.

Salvo que la página del producto indique otra cosa, las compras digitales son solo para uso personal. Una compra no transfiere derechos de autor, derechos de reventa, derechos de ejecución pública ni derechos de licencia comercial.

## 8. Comunicaciones y enlaces de acceso

Las confirmaciones de pedido, avisos de pago, mensajes de envío y entrega, acceso a descargas o boletos, actualizaciones de eventos y respuestas de soporte son comunicaciones transaccionales. Los recordatorios opcionales de pagos abandonados requieren el consentimiento descrito durante el pago e incluyen un método para cancelar la suscripción. Los recordatorios de eventos se envían solo para pedidos confirmados elegibles con boletos o RSVPs.

Los enlaces de búsqueda de pedidos, detalles de pedidos, descargas, boletos, registro y administración pueden proporcionar acceso sin contraseña. Mantenlos privados. Un enlace puede vencer, actualizarse, revocarse o limitarse temporalmente cuando se use indebidamente o deje de apuntar a un derecho de acceso activo.

## 9. Privacidad y datos

Recopilamos la información necesaria para operar el servicio, incluidos datos de contacto, contenido del pedido, precios y estado del pago, información de envío para productos físicos, detalles de boletos o RSVPs, preferencias de recordatorios, información de referencia cuando se proporciona y mensajes de soporte. Stripe gestiona los datos completos de las tarjetas. Cloudflare proporciona la infraestructura del sitio, Worker, seguridad, almacenamiento y operaciones; Resend entrega correo; y los proveedores de envío, impuestos, direcciones, analítica o prevención de abusos reciben datos limitados solo cuando su servicio es necesario y está habilitado.

Las personas administradoras autorizadas pueden acceder a información de clientes, asistentes, pedidos, reportes, inventario, descargas y entrega solo dentro de su función y alcance asignados. Las personas superadministradoras pueden acceder a la información necesaria para operar, proteger, conciliar, dar soporte, auditar, respaldar o restaurar la tienda. No vendemos información personal de clientes. Los registros pueden conservarse para entrega, contabilidad, prevención de fraude, seguridad, obligaciones legales, disputas, conciliación de pagos y recuperación ante desastres, y después eliminarse o reducirse cuando ya no sean razonablemente necesarios.

Para hacer una pregunta de privacidad o solicitar la revisión, corrección o eliminación de información asociada con tu correo, comunícate con [{{ support_email }}](mailto:{{ support_email }}). Es posible que debamos verificar que controlas el correo o pedido correspondiente. Algunos registros aún pueden necesitar conservarse por motivos legales, contables, de prevención de fraude, seguridad o manejo de disputas.

## 10. Propiedad intelectual y código abierto

El arte de productos, fotos, textos, video, audio, descargas, logotipos, diseños y demás material creativo pertenecen a {{ operator_name }} o a las personas creadoras acreditadas, salvo que se indique otra cosa. No puedes copiar, revender, extraer, distribuir ni reutilizar comercialmente ese material sin permiso o una licencia aplicable.

El código fuente del software que impulsa la tienda está disponible bajo la licencia publicada en su [repositorio de GitHub](https://github.com/aindaco1/store). Esa licencia de software no otorga derechos sobre material de productos, descargas, marcas, información de clientes, datos privados de administración ni otro material no cubierto por la licencia del repositorio.

## 11. Disponibilidad, descargos y responsabilidad

La tienda se ofrece “según disponibilidad”. Trabajamos para mantener confiables el catálogo, el pago, los pedidos, el inventario, el correo y los registros de entrega, pero no prometemos un funcionamiento ininterrumpido ni libre de errores. En la medida máxima permitida por la ley, {{ operator_name }} no responde por daños indirectos, incidentales, especiales, consecuentes o punitivos derivados del uso de la tienda, productos, eventos, retrasos del transportista o servicios de terceros. Nada en estos términos excluye responsabilidades ni derechos del cliente que legalmente no puedan excluirse.

## 12. Cambios a estos términos

Podemos actualizar estos términos para reflejar cambios de producto, legales u operativos. La fecha de vigencia anterior cambiará cuando los términos públicos cambien de manera importante. Los cambios se aplican hacia el futuro, salvo que la ley exija otra cosa. Los cambios importantes que afecten un pedido o evento existente también deben comunicarse a la persona afectada mediante el canal normal del pedido o evento.

## 13. Contacto

Envía tus preguntas sobre pedidos, pagos, envíos, problemas de entrega, eventos, descargas, solicitudes de privacidad o estos términos a [{{ support_email }}](mailto:{{ support_email }}). Incluye la referencia del pedido cuando corresponda; no envíes por correo números completos de tarjeta, códigos de seguridad, códigos QR de boletos ni enlaces privados de acceso.
