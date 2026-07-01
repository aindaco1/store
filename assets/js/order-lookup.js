(function() {
  'use strict';

  var root = document.querySelector('[data-store-order-lookup]');
  if (!root) return;

  var form = root.querySelector('[data-store-order-lookup-form]');
  var emailField = root.querySelector('[data-store-order-lookup-email]');
  var submitButton = root.querySelector('[data-store-order-lookup-submit]');
  var statusNode = root.querySelector('[data-store-order-lookup-status]');
  var resultsNode = root.querySelector('[data-store-order-lookup-results]');
  function getPlatformName() {
    var config = getRuntimeConfig();
    return String(config?.platform?.name || config?.platformName || 'Store').trim() || 'Store';
  }

  function getGenericSentMessage() {
    return message('generic_sent', 'If that email has %{platform} orders, a secure lookup link has been sent.', {
      platform: getPlatformName()
    });
  }

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
    return config?.i18n?.messages?.orderLookup || {};
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

  function getLookupToken() {
    try {
      return String(new URLSearchParams(window.location.search || '').get('token') || '').trim();
    } catch (_error) {
      return '';
    }
  }

  function setStatus(message) {
    if (statusNode) statusNode.textContent = message || '';
  }

  function setSubmitting(isSubmitting) {
    if (submitButton) submitButton.disabled = Boolean(isSubmitting);
    if (emailField) emailField.disabled = Boolean(isSubmitting);
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

  function getOrderStatusLabel(order) {
    if (order?.fulfillmentReady) return message('order_confirmed', 'Order confirmed');
    if (order?.status === 'payment_failed') return message('payment_failed', 'Payment failed');
    return message('order_processing', 'Order processing');
  }

  function getOrderUrl(order) {
    if (order?.orderUrl) return order.orderUrl;
    var orderToken = String(order?.orderToken || '').trim();
    return orderToken ? '/order-success/?orderToken=' + encodeURIComponent(orderToken) : '/orders/';
  }

  function getOrderTokenLabel(order) {
    return String(order?.orderToken || '').trim() || message('unavailable', 'Unavailable');
  }

  function getOrderDateLine(order) {
    if (order?.confirmedAt) return message('confirmed', 'Confirmed') + ' ' + formatDate(order.confirmedAt);
    if (order?.createdAt) return message('created', 'Created') + ' ' + formatDate(order.createdAt);
    return '';
  }

  function getOrderItemLabel(item) {
    return [
      item?.name || message('store_item', 'Store item'),
      item?.variantLabel || '',
      message('qty', 'Qty') + ' ' + (item?.quantity || 1)
    ].filter(Boolean).join(' · ');
  }

  function getOrderItemsSummary(order, maxItems) {
    var items = Array.isArray(order?.items) ? order.items : [];
    var limit = Math.max(1, Number(maxItems || 3) || 3);
    var labels = items.slice(0, limit).map(getOrderItemLabel);
    if (items.length > limit) labels.push('+' + (items.length - limit) + ' ' + message('more', 'more'));
    return labels.join('\n');
  }

  function appendTableCell(row, tagName, text, className) {
    var cell = document.createElement(tagName || 'td');
    if (className) cell.className = className;
    cell.textContent = text || '';
    row.append(cell);
    return cell;
  }

  function renderOrderTable(orders) {
    var wrapper = document.createElement('div');
    wrapper.className = 'store-order-lookup__table-wrap';
    var table = document.createElement('table');
    table.className = 'store-order-lookup__table';
    var caption = document.createElement('caption');
    caption.className = 'sr-only';
    caption.textContent = message('orders_found_caption', 'Orders found for this lookup link');
    table.append(caption);
    var thead = document.createElement('thead');
    var header = document.createElement('tr');
    [
      message('table_status', 'Status'),
      message('table_order', 'Order'),
      message('table_date', 'Date'),
      message('table_items', 'Items'),
      message('table_total', 'Total'),
      ''
    ].forEach(function(label) {
      appendTableCell(header, 'th', label);
    });
    thead.append(header);
    table.append(thead);
    var tbody = document.createElement('tbody');
    orders.forEach(function(order) {
      var row = document.createElement('tr');
      appendTableCell(row, 'td', getOrderStatusLabel(order));
      appendTableCell(row, 'td', getOrderTokenLabel(order), 'store-order-lookup__token-cell');
      appendTableCell(row, 'td', getOrderDateLine(order));
      appendTableCell(row, 'td', getOrderItemsSummary(order, 3), 'store-order-lookup__items-cell');
      appendTableCell(row, 'td', formatMoney(order.totalCents, order.currency || 'USD'), 'store-order-lookup__total-cell');
      var actionCell = document.createElement('td');
      var link = document.createElement('a');
      link.className = 'btn btn--small';
      link.href = getOrderUrl(order);
      link.textContent = message('view_order', 'View order');
      actionCell.append(link);
      row.append(actionCell);
      tbody.append(row);
    });
    table.append(tbody);
    wrapper.append(table);
    return wrapper;
  }

  function renderOrder(order) {
    var card = document.createElement('article');
    card.className = 'store-order__item store-order-lookup__order';
    appendText(card, 'h2', 'store-order__title', getOrderStatusLabel(order));
    appendText(card, 'p', 'store-order__meta', message('order', 'Order') + ' ' + getOrderTokenLabel(order));
    appendText(card, 'p', 'store-order__total', formatMoney(order.totalCents, order.currency || 'USD'));
    var dateLine = getOrderDateLine(order);
    if (dateLine) appendText(card, 'p', 'store-order__meta', dateLine);

    var items = Array.isArray(order.items) ? order.items : [];
    if (items.length > 0) {
      var itemList = document.createElement('div');
      itemList.className = 'store-order-lookup__items';
      items.forEach(function(item) {
        appendText(itemList, 'p', 'store-order__meta', getOrderItemLabel(item));
      });
      card.append(itemList);
    }

    var actions = document.createElement('div');
    actions.className = 'store-order__actions';
    var link = document.createElement('a');
    link.className = 'btn';
    link.href = getOrderUrl(order);
    link.textContent = message('view_order', 'View order');
    actions.append(link);
    card.append(actions);
    return card;
  }

  function renderLookupResults(data) {
    if (!resultsNode) return;
    resultsNode.replaceChildren();
    resultsNode.hidden = false;

    var orders = Array.isArray(data?.orders) ? data.orders : [];
    if (orders.length === 0) {
      appendText(resultsNode, 'p', 'store-order__note', message('no_orders', 'No orders are available for this link.'));
      return;
    }

    appendText(resultsNode, 'h2', 'store-order__title', message('orders', 'Orders'));
    resultsNode.append(renderOrderTable(orders));
    var list = document.createElement('div');
    list.className = 'store-order-lookup__orders';
    orders.forEach(function(order) {
      list.append(renderOrder(order));
    });
    resultsNode.append(list);
  }

  function renderLookupRequestDiagnostics(data) {
    if (!resultsNode) return;
    resultsNode.replaceChildren();
    var debug = data?.debug?.orderLookup || null;
    if (!debug || (!debug.lookupUrl && debug.deliverySent !== false)) {
      resultsNode.hidden = true;
      return;
    }
    resultsNode.hidden = false;
    var panel = document.createElement('div');
    panel.className = 'store-order__panel store-order-lookup__debug';
    if (debug.deliverySent === false) {
      appendText(panel, 'p', 'store-order__note', message('local_email_failed', 'Local email delivery failed: %{reason}.', {
        reason: debug.deliveryError || debug.deliveryReason || 'not sent'
      }));
    } else {
      appendText(panel, 'p', 'store-order__note', message('local_lookup_generated', 'Local lookup link generated.'));
    }
    if (debug.lookupUrl) {
      var link = document.createElement('a');
      link.className = 'btn btn--secondary';
      link.href = debug.lookupUrl;
      link.textContent = message('open_local_lookup', 'Open local lookup');
      panel.append(link);
    }
    resultsNode.append(panel);
  }

  async function requestLookup(email) {
    var response = await fetch(getWorkerBase() + '/api/orders/lookup', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    });
    var data = await response.json().catch(function() { return {}; });
    if (!response.ok) throw new Error(data.error || message('unable_send', 'Unable to send lookup link.'));
    return data;
  }

  async function consumeLookup(token) {
    var response = await fetch(getWorkerBase() + '/api/orders/lookup?token=' + encodeURIComponent(token), {
      method: 'GET',
      cache: 'no-store'
    });
    var data = await response.json().catch(function() { return {}; });
    if (!response.ok) throw new Error(data.error || message('unable_load', 'Unable to load orders.'));
    return data;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    var email = String(emailField?.value || '').trim();
    if (!email) {
      setStatus(message('email_required', 'Enter an email address.'));
      emailField?.focus();
      return;
    }

    setSubmitting(true);
    setStatus(message('sending', 'Sending lookup link...'));
    try {
      var data = await requestLookup(email);
      var serverMessage = String(data?.message || '').trim();
      setStatus(getCurrentLang() === 'en' && serverMessage ? serverMessage : getGenericSentMessage());
      renderLookupRequestDiagnostics(data);
    } catch (error) {
      setStatus(error?.message || message('unable_send', 'Unable to send lookup link.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function loadToken(token) {
    setStatus(message('loading', 'Loading orders...'));
    try {
      var data = await consumeLookup(token);
      renderLookupResults(data);
      setStatus(message('verified', 'Lookup link verified.'));
    } catch (error) {
      setStatus(error?.message || message('unable_load', 'Unable to load orders.'));
    }
  }

  form?.addEventListener('submit', handleSubmit);

  var token = getLookupToken();
  if (token) {
    loadToken(token);
  }
})();
