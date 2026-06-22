(function() {
  'use strict';

  var btn = document.getElementById('header-cart-btn');
  if (!btn) return;

  var priceEl = btn.querySelector('.site-header__cart-price');
  var countEl = btn.querySelector('.site-header__cart-count');
  var CACHE_KEY = 'store_cart_cache';
  var providerSubscription = null;
  var providerEventSubscription = null;
  var providerClickBound = false;
  var emptyLabel = btn.getAttribute('data-cart-label-empty') || 'Open cart. Cart is empty.';
  var oneLabel = btn.getAttribute('data-cart-label-one') || 'Open cart. %{count} item, %{total} total.';
  var otherLabel = btn.getAttribute('data-cart-label-other') || 'Open cart. %{count} items, %{total} total.';

  function formatMoney(amount) {
    return '$' + (amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
  }

  function writeCache(total, count) {
    try {
      var payload = JSON.stringify({ total: total || 0, count: count || 0 });
      localStorage.setItem(CACHE_KEY, payload);
    } catch (_error) {}
  }

  function formatSummaryLabel(total, count) {
    if (!count) return emptyLabel;
    var template = count === 1 ? oneLabel : otherLabel;
    return template
      .replace('%{count}', String(count))
      .replace('%{total}', formatMoney(total));
  }

  function renderCartSummary(total, count) {
    if (priceEl) priceEl.textContent = formatMoney(total);
    if (countEl) countEl.textContent = count ? String(count) : '';
    var label = formatSummaryLabel(total, count);
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    btn.classList.add('is-loaded');
  }

  function getSummaryFromState(state, provider) {
    var displayedSummary = provider?.getDisplaySummary?.() || provider?.getApi?.()?.summary?.getDisplay?.();
    if (displayedSummary && typeof displayedSummary.total === 'number') {
      return {
        total: Number(displayedSummary.total || 0),
        count: Number(displayedSummary.count || 0)
      };
    }

    return {
      total: Number(state?.cart?.total || 0),
      count: Number(state?.cart?.items?.count || 0)
    };
  }

  function updateFromState(state, provider) {
    var summary = getSummaryFromState(state || {}, provider);
    renderCartSummary(summary.total, summary.count);
    writeCache(summary.total, summary.count);
  }

  function markLoaded() {
    btn.classList.add('is-loaded');
  }

  function bindProvider(provider) {
    if (!provider) return;
    if (providerSubscription) providerSubscription();
    if (providerEventSubscription) providerEventSubscription();
    updateFromState(provider.store?.getState?.(), provider);
    providerSubscription = provider.store?.subscribe?.(function(state) {
      updateFromState(state || provider.store?.getState?.(), provider);
    }) || null;
    providerEventSubscription = provider.events?.on?.('summary.updated', function(summary) {
      renderCartSummary(Number(summary?.total || 0), Number(summary?.count || 0));
      writeCache(Number(summary?.total || 0), Number(summary?.count || 0));
    }) || null;
    provider.events?.on?.('cart.opened', function() {
      btn.setAttribute('aria-expanded', 'true');
    });
    provider.events?.on?.('cart.closed', function() {
      btn.setAttribute('aria-expanded', 'false');
    }) || null;

    if (provider.activeRuntime === 'first_party' && !providerClickBound) {
      btn.addEventListener('click', function(event) {
        event.preventDefault();
        provider.getApi?.()?.api?.theme?.cart?.open?.();
      });
      providerClickBound = true;
    }
  }

  function maybeBindProvider() {
    var provider = window.StoreCartProvider;
    if (!provider) return;
    bindProvider(provider);
  }

  try {
    var cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (cached && typeof cached.total === 'number') {
      renderCartSummary(cached.total, cached.count);
    }
  } catch (_error) {}

  maybeBindProvider();
  document.addEventListener('storecart.provider.ready', maybeBindProvider);
  document.addEventListener('storecart.ready', markLoaded);
})();
