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
      return new Intl.NumberFormat('en-US', {
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
      return new Intl.DateTimeFormat('en-US', {
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

  function appendAction(parent, action, fallbackLabel, options) {
    if (!action) return;
    if (action.available === false) {
      appendText(parent, 'p', 'store-order__note', action.message || (fallbackLabel + ' is not available yet.'));
      return;
    }
    if (!action?.href) return;
    var link = document.createElement('a');
    link.className = options?.secondary ? 'btn btn--secondary' : 'btn';
    link.href = action.href;
    link.textContent = action.label || fallbackLabel;
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
    appendAction(actionRow, actions.download, 'Download');
    appendAction(actionRow, actions.ticket, item.fulfillmentType === 'rsvp' ? 'Open RSVP' : 'Open ticket', { blank: true });
    appendAction(actionRow, actions.calendar, 'Add to calendar', { secondary: true });
    if (actionRow.childElementCount > 0) parent.append(actionRow);
  }

  function renderOrder(data) {
    if (!bodyNode) return;
    bodyNode.replaceChildren();
    bodyNode.hidden = false;

    var currency = data?.totals?.currency || data?.payment?.currency || 'USD';
    var overview = document.createElement('section');
    overview.className = 'store-order__panel';
    appendText(overview, 'h2', 'store-order__title', data.fulfillmentReady ? 'Order confirmed' : 'Order processing');
    appendText(overview, 'p', 'store-order__meta', 'Order ' + (data.orderToken || ''));
    appendText(overview, 'p', 'store-order__total', formatMoney(data?.totals?.totalCents || data?.payment?.amountCents || 0, currency));
    if (data.confirmedAt) appendText(overview, 'p', 'store-order__meta', 'Confirmed ' + formatDate(data.confirmedAt));
    bodyNode.append(overview);

    var items = Array.isArray(data.items) ? data.items : [];
    var list = document.createElement('section');
    list.className = 'store-order__items';
    appendText(list, 'h2', 'store-order__title', 'Items');

    items.forEach(function(item) {
      var row = document.createElement('article');
      row.className = 'store-order__item';
      var header = document.createElement('div');
      header.className = 'store-order__item-header';
      appendText(header, 'h3', 'store-order__item-title', item.name || item.sku || 'Store item');
      appendText(header, 'p', 'store-order__item-price', formatMoney(item.subtotalCents, item.currency || currency));
      row.append(header);
      var details = [
        item.variantLabel || '',
        'Qty ' + (item.quantity || 1),
        item.fulfillmentType || ''
      ].filter(Boolean).join(' · ');
      appendText(row, 'p', 'store-order__meta', details);
      if (item.event?.startsAt) {
        appendText(row, 'p', 'store-order__meta', formatDate(item.event.startsAt));
      }
      if (item.event?.venue) {
        appendText(row, 'p', 'store-order__meta', item.event.venue);
      }
      renderActions(row, item);
      list.append(row);
    });

    bodyNode.append(list);
  }

  async function fetchOrder(orderToken) {
    var response = await fetch(getWorkerBase() + '/api/orders/' + encodeURIComponent(orderToken), {
      method: 'GET',
      cache: 'no-store'
    });
    var data = await response.json().catch(function() { return {}; });
    if (!response.ok) {
      throw new Error(data.error || 'Unable to load order.');
    }
    return data;
  }

  async function loadOrder(orderToken, pollCount) {
    setStatus(pollCount > 0 ? 'Still processing payment...' : 'Loading order...');
    try {
      var data = await fetchOrder(orderToken);
      renderOrder(data);
      if (data.fulfillmentReady) {
        setStatus('Ready for fulfillment.');
        if (headingNode) headingNode.textContent = 'Your order is confirmed. Fulfillment actions are available below.';
        return;
      }
      if (data.status === 'payment_failed') {
        setStatus('Payment failed.');
        if (headingNode) headingNode.textContent = 'The payment did not complete. Please return to the store and try again.';
        return;
      }
      setStatus('Payment is still processing.');
      if (pollCount < MAX_POLLS) {
        window.setTimeout(function() {
          loadOrder(orderToken, pollCount + 1);
        }, POLL_DELAY_MS);
      }
    } catch (error) {
      setStatus(error?.message || 'Unable to load order.');
    }
  }

  var orderToken = getOrderToken();
  if (!orderToken) {
    setStatus('Missing order token.');
    return;
  }

  loadOrder(orderToken, 0);
})();
