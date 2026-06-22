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
    return 'If that email has ' + getPlatformName() + ' orders, a secure lookup link has been sent.';
  }

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

  function getOrderStatusLabel(order) {
    if (order?.fulfillmentReady) return 'Order confirmed';
    if (order?.status === 'payment_failed') return 'Payment failed';
    return 'Order processing';
  }

  function getOrderUrl(order) {
    if (order?.orderUrl) return order.orderUrl;
    var orderToken = String(order?.orderToken || '').trim();
    return orderToken ? '/order-success/?orderToken=' + encodeURIComponent(orderToken) : '/orders/';
  }

  function renderOrder(order) {
    var card = document.createElement('article');
    card.className = 'store-order__item store-order-lookup__order';
    appendText(card, 'h2', 'store-order__title', getOrderStatusLabel(order));
    appendText(card, 'p', 'store-order__meta', 'Order ' + (order.orderToken || ''));
    appendText(card, 'p', 'store-order__total', formatMoney(order.totalCents, order.currency || 'USD'));
    var dateLine = order.confirmedAt
      ? 'Confirmed ' + formatDate(order.confirmedAt)
      : (order.createdAt ? 'Created ' + formatDate(order.createdAt) : '');
    if (dateLine) appendText(card, 'p', 'store-order__meta', dateLine);

    var items = Array.isArray(order.items) ? order.items : [];
    if (items.length > 0) {
      var itemList = document.createElement('div');
      itemList.className = 'store-order-lookup__items';
      items.forEach(function(item) {
        var label = [
          item.name || 'Store item',
          item.variantLabel || '',
          'Qty ' + (item.quantity || 1)
        ].filter(Boolean).join(' · ');
        appendText(itemList, 'p', 'store-order__meta', label);
      });
      card.append(itemList);
    }

    var actions = document.createElement('div');
    actions.className = 'store-order__actions';
    var link = document.createElement('a');
    link.className = 'btn';
    link.href = getOrderUrl(order);
    link.textContent = 'View order';
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
      appendText(resultsNode, 'p', 'store-order__note', 'No orders are available for this link.');
      return;
    }

    appendText(resultsNode, 'h2', 'store-order__title', 'Orders');
    var list = document.createElement('div');
    list.className = 'store-order-lookup__orders';
    orders.forEach(function(order) {
      list.append(renderOrder(order));
    });
    resultsNode.append(list);
  }

  async function requestLookup(email) {
    var response = await fetch(getWorkerBase() + '/api/orders/lookup', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    });
    var data = await response.json().catch(function() { return {}; });
    if (!response.ok) throw new Error(data.error || 'Unable to send lookup link.');
    return data;
  }

  async function consumeLookup(token) {
    var response = await fetch(getWorkerBase() + '/api/orders/lookup?token=' + encodeURIComponent(token), {
      method: 'GET',
      cache: 'no-store'
    });
    var data = await response.json().catch(function() { return {}; });
    if (!response.ok) throw new Error(data.error || 'Unable to load orders.');
    return data;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    var email = String(emailField?.value || '').trim();
    if (!email) {
      setStatus('Enter an email address.');
      emailField?.focus();
      return;
    }

    setSubmitting(true);
    setStatus('Sending lookup link...');
    try {
      var data = await requestLookup(email);
      setStatus(data?.message || getGenericSentMessage());
      if (resultsNode) {
        resultsNode.hidden = true;
        resultsNode.replaceChildren();
      }
    } catch (error) {
      setStatus(error?.message || 'Unable to send lookup link.');
    } finally {
      setSubmitting(false);
    }
  }

  async function loadToken(token) {
    setStatus('Loading orders...');
    try {
      var data = await consumeLookup(token);
      renderLookupResults(data);
      setStatus('Lookup link verified.');
    } catch (error) {
      setStatus(error?.message || 'Unable to load orders.');
    }
  }

  form?.addEventListener('submit', handleSubmit);

  var token = getLookupToken();
  if (token) {
    loadToken(token);
  }
})();
