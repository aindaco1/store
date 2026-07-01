(function() {
  'use strict';

  var root = document.querySelector('[data-store-order-success]');
  if (!root) return;

  var statusNode = root.querySelector('[data-store-order-status]');
  var bodyNode = root.querySelector('[data-store-order-body]');
  var headingNode = document.querySelector('[data-store-order-summary-heading]');
  var MAX_POLLS = 12;
  var POLL_DELAY_MS = 2500;

  function getRuntimeConfig() {
    return window.STORE_CONFIG || window.StoreConfig || {};
  }

  function getCurrentLang() {
    var config = getRuntimeConfig();
    return String(config?.i18n?.currentLang || document.documentElement.lang || 'en').toLowerCase() === 'es' ? 'es' : 'en';
  }

  function getLocale() {
    return getCurrentLang() === 'es' ? 'es-US' : 'en-US';
  }

  function getRuntimeMessages() {
    var config = getRuntimeConfig();
    return config?.i18n?.messages?.orderSuccess || {};
  }

  function interpolate(template, values) {
    return String(template || '').replace(/%\{([^}]+)\}/g, function(match, key) {
      return Object.prototype.hasOwnProperty.call(values || {}, key) ? String(values[key]) : match;
    });
  }

  function message(key, fallback, values) {
    var value = getRuntimeMessages()[key] || fallback || '';
    return interpolate(value, values || {});
  }

  function getWorkerBase() {
    var config = getRuntimeConfig();
    return String(
      config?.platform?.workerUrl ||
      config?.workerBase ||
      'https://checkout.dustwave.xyz'
    ).replace(/\/+$/, '');
  }

  function getOrderToken() {
    try {
      return String(new URLSearchParams(window.location.search || '').get('orderToken') || '').trim();
    } catch (_error) {
      return '';
    }
  }

  function setStatus(message) {
    if (statusNode) statusNode.textContent = message || '';
  }

  function formatMoney(cents, currency) {
    var amount = Math.max(0, Number(cents || 0) || 0) / 100;
    try {
      return new Intl.NumberFormat(getLocale(), {
        style: 'currency',
        currency: currency || 'USD'
      }).format(amount);
    } catch (_error) {
      return '$' + amount.toFixed(2);
    }
  }

  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    try {
      return new Intl.DateTimeFormat(getLocale(), {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(date);
    } catch (_error) {
      return date.toISOString();
    }
  }

  function appendText(parent, tagName, className, text) {
    var node = document.createElement(tagName);
    if (className) node.className = className;
    node.textContent = text || '';
    parent.append(node);
    return node;
  }

  function appendMoneyRow(parent, label, cents, currency, options) {
    var row = document.createElement('div');
    row.className = options?.strong ? 'store-order__breakdown-row store-order__breakdown-row--strong' : 'store-order__breakdown-row';
    appendText(row, 'dt', '', label);
    appendText(row, 'dd', '', (options?.negative ? '-' : '') + formatMoney(cents, currency));
    parent.append(row);
  }

  function renderTotals(parent, totals, payment, currency) {
    var subtotal = Number(totals?.subtotalCents || 0) || 0;
    var discount = Math.max(0, Number(totals?.discountCents || 0) || 0);
    var tip = Math.max(0, Number(totals?.tipAmountCents || 0) || 0);
    var shipping = Math.max(0, Number(totals?.shippingCents || 0) || 0);
    var tax = Math.max(0, Number(totals?.taxCents || 0) || 0);
    var total = Number(totals?.totalCents ?? payment?.amountCents ?? 0) || 0;
    var coupon = String(totals?.couponCode || totals?.coupon?.code || '').trim();
    var breakdown = document.createElement('dl');
    breakdown.className = 'store-order__breakdown';
    appendMoneyRow(breakdown, message('subtotal', 'Subtotal'), subtotal, currency);
    if (discount > 0) appendMoneyRow(
      breakdown,
      coupon ? message('discount_with_code', 'Discount (%{code})', { code: coupon }) : message('discount', 'Discount'),
      discount,
      currency,
      { negative: true }
    );
    if (tip > 0) appendMoneyRow(breakdown, message('tip', 'Tip'), tip, currency);
    if (shipping > 0 || totals?.requiresShipping) appendMoneyRow(breakdown, message('shipping', 'Shipping'), shipping, currency);
    appendMoneyRow(breakdown, message('tax', 'Tax'), tax, currency);
    appendMoneyRow(breakdown, message('total_paid', 'Total paid'), total, currency, { strong: true });
    parent.append(breakdown);
  }

  function appendAddressLine(parent, value) {
    var text = String(value || '').trim();
    if (text) appendText(parent, 'p', 'store-order__meta', text);
  }

  function renderShipping(parent, shipping) {
    if (!shipping?.required || !shipping?.address) return;
    var address = shipping.address || {};
    var panel = document.createElement('section');
    panel.className = 'store-order__panel';
    appendText(panel, 'h2', 'store-order__title', message('shipping_heading', 'Shipping'));
    if (shipping.option) appendText(panel, 'p', 'store-order__meta', message('method', 'Method') + ': ' + shipping.option);
    appendAddressLine(panel, address.name);
    appendAddressLine(panel, address.line1 || address.address1);
    appendAddressLine(panel, address.line2 || address.address2);
    appendAddressLine(panel, [address.city, address.region || address.state || address.province, address.postalCode].filter(Boolean).join(', '));
    appendAddressLine(panel, address.country);
    parent.append(panel);
  }

  function appendAction(parent, action, fallbackLabel, options) {
    if (!action) return;
    if (action.available === false) {
      var serverMessage = String(action.message || '').trim();
      appendText(parent, 'p', 'store-order__note', getCurrentLang() === 'en' && serverMessage
        ? serverMessage
        : message('download_unavailable', '%{label} is not available yet.', { label: fallbackLabel }));
      return;
    }
    if (!action?.href) return;
    var link = document.createElement('a');
    link.className = options?.secondary ? 'btn btn--secondary' : 'btn';
    link.href = action.href;
    link.textContent = getCurrentLang() === 'en' && action.label ? action.label : fallbackLabel;
    if (options?.blank) {
      link.target = '_blank';
      link.rel = 'noopener';
    }
    parent.append(link);
  }

  function renderActions(parent, item) {
    var actions = item.actions || {};
    var actionRow = document.createElement('div');
    actionRow.className = 'store-order__actions';
    appendAction(actionRow, actions.download, message('download', 'Download'));
    appendAction(actionRow, actions.ticket, item.fulfillmentType === 'rsvp' ? message('open_rsvp', 'Open RSVP') : message('open_ticket', 'Open ticket'), { blank: true });
    appendAction(actionRow, actions.calendar, message('add_calendar', 'Add to calendar'), { secondary: true });
    if (actionRow.childElementCount > 0) parent.append(actionRow);
  }

  function getFulfillmentTypeLabel(type) {
    var normalized = String(type || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (!normalized) return '';
    return message('fulfillment_' + normalized, type);
  }

  function renderOrder(data) {
    if (!bodyNode) return;
    bodyNode.replaceChildren();
    bodyNode.hidden = false;

    var currency = data?.totals?.currency || data?.payment?.currency || 'USD';
    var overview = document.createElement('section');
    overview.className = 'store-order__panel';
    appendText(overview, 'h2', 'store-order__title', data.fulfillmentReady ? message('order_confirmed', 'Order confirmed') : message('order_processing', 'Order processing'));
    appendText(overview, 'p', 'store-order__meta', message('order', 'Order') + ' ' + (data.orderToken || ''));
    appendText(overview, 'p', 'store-order__total', formatMoney(data?.totals?.totalCents || data?.payment?.amountCents || 0, currency));
    if (data.confirmedAt) appendText(overview, 'p', 'store-order__meta', message('confirmed', 'Confirmed') + ' ' + formatDate(data.confirmedAt));
    renderTotals(overview, data?.totals || {}, data?.payment || {}, currency);
    bodyNode.append(overview);

    var items = Array.isArray(data.items) ? data.items : [];
    var list = document.createElement('section');
    list.className = 'store-order__items';
    appendText(list, 'h2', 'store-order__title', message('items', 'Items'));

    items.forEach(function(item) {
      var row = document.createElement('article');
      row.className = 'store-order__item';
      var header = document.createElement('div');
      header.className = 'store-order__item-header';
      appendText(header, 'h3', 'store-order__item-title', item.name || item.sku || message('store_item', 'Store item'));
      appendText(header, 'p', 'store-order__item-price', formatMoney(item.subtotalCents, item.currency || currency));
      row.append(header);
      var details = [
        item.variantLabel || '',
        message('qty', 'Qty') + ' ' + (item.quantity || 1),
        getFulfillmentTypeLabel(item.fulfillmentType)
      ].filter(Boolean).join(' · ');
      appendText(row, 'p', 'store-order__meta', details);
      if (item.event?.startsAt) {
        appendText(row, 'p', 'store-order__meta', formatDate(item.event.startsAt));
      }
      if (item.event?.venue) {
        appendText(row, 'p', 'store-order__meta', item.event.venue);
      }
      if (item.event?.address) {
        appendText(row, 'p', 'store-order__meta', item.event.address);
      }
      renderActions(row, item);
      if (item.actions?.download?.available === true) {
        appendText(row, 'p', 'store-order__note', message('download_note', 'Your download stays available from this order page.'));
      }
      list.append(row);
    });

    bodyNode.append(list);
    renderShipping(bodyNode, data.shipping || {});
  }

  async function fetchOrder(orderToken) {
    var response = await fetch(getWorkerBase() + '/api/orders/' + encodeURIComponent(orderToken), {
      method: 'GET',
      cache: 'no-store'
    });
    var data = await response.json().catch(function() { return {}; });
    if (!response.ok) {
      throw new Error(data.error || message('unable_load_order', 'Unable to load order.'));
    }
    return data;
  }

  async function loadOrder(orderToken, pollCount) {
    setStatus(pollCount > 0 ? message('still_processing', 'Still processing payment...') : message('loading_order', 'Loading order...'));
    try {
      var data = await fetchOrder(orderToken);
      renderOrder(data);
      if (data.fulfillmentReady) {
        setStatus(message('ready_fulfillment', 'Ready for fulfillment.'));
        if (headingNode) headingNode.textContent = message('confirmed_heading', 'Your order is confirmed. Fulfillment actions are available below.');
        return;
      }
      if (data.status === 'payment_failed') {
        setStatus(message('payment_failed_status', 'Payment failed.'));
        if (headingNode) headingNode.textContent = message('payment_failed_heading', 'The payment did not complete. Please return to the store and try again.');
        return;
      }
      setStatus(message('payment_processing', 'Payment is still processing.'));
      if (pollCount < MAX_POLLS) {
        window.setTimeout(function() {
          loadOrder(orderToken, pollCount + 1);
        }, POLL_DELAY_MS);
      }
    } catch (error) {
      setStatus(error?.message || message('unable_load_order', 'Unable to load order.'));
    }
  }

  var orderToken = getOrderToken();
  if (!orderToken) {
    setStatus(message('missing_token', 'Missing order token.'));
    return;
  }

  loadOrder(orderToken, 0);
})();
