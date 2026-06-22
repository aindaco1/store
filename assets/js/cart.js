(function() {
'use strict';

const RUNTIME_CONFIG = window.STORE_CONFIG || window.StoreConfig || {};
const WORKER_BASE = RUNTIME_CONFIG?.platform?.workerUrl || RUNTIME_CONFIG?.workerBase || 'https://checkout.dustwave.xyz';
const PLATFORM_NAME = RUNTIME_CONFIG?.platform?.name || RUNTIME_CONFIG?.platformName || 'Store';
const STORE_PENDING_ORDER_KEY = 'store_pending_order';
const CART_SUMMARY_CACHE_KEY = 'store_cart_cache';
const logger = window.StoreLogger?.createLogger('cart') || {
  debug() {},
  info() {},
  warn() {},
  error() {}
};
const CART_VIEW_ROUTE = '/cart';
const CHECKOUT_ENTRY_ROUTES = new Set(['/checkout', '/checkout/billing']);
const CHECKOUT_PAYMENT_ROUTE = '/checkout/payment';
const CART_EVENT_NAMES = {
  cartCreated: 'cart.created',
  itemAdded: 'item.added',
  itemUpdated: 'item.updated',
  itemRemoved: 'item.removed',
  routeChanged: 'theme.routechanged',
  summaryCheckoutClicked: 'summary.checkout_clicked'
};
const PLACEHOLDER_CART_EMAIL = 'placeholder@store.local';
const PLACEHOLDER_BILLING_ADDRESS = {
  name: 'Customer',
  address1: '123 Store Lane',
  city: 'Denver',
  country: 'US',
  province: 'CO',
  postalCode: '80202'
};
const EMPTY_CART_STATE = {
  cart: {
    items: {
      count: 0,
      items: []
    }
  }
};
let currentCartRoute = null;
let hasInitializedCart = false;

function getCartProvider() {
  return window.StoreCartProvider || null;
}

function getCartRoot() {
  return document.querySelector('[data-store-cart-root]');
}

function getCartClient() {
  return getCartProvider()?.getApi?.() || null;
}

function getRequestedCartRuntime() {
  return String(RUNTIME_CONFIG?.cartRuntime || RUNTIME_CONFIG?.checkout?.cartRuntime || '').trim().toLowerCase();
}

function getActiveCartRuntime() {
  const providerRuntime = String(getCartProvider()?.activeRuntime || '').trim().toLowerCase();
  if (providerRuntime) return providerRuntime;
  return getRequestedCartRuntime();
}

function isFirstPartyCartRuntime() {
  return getActiveCartRuntime() === 'first_party';
}

function getCurrentPath() {
  return window.location?.pathname || '/';
}

function isOrderSuccessPath() {
  return /^\/order-success\/?$/.test(getCurrentPath());
}

function getCartState() {
  return getCartProvider()?.store?.getState?.() ||
    getCartClient()?.store?.getState?.() ||
    EMPTY_CART_STATE;
}

function getCartItems(state) {
  return state?.cart?.items?.items || [];
}

function subscribeCartStore(handler) {
  if (typeof handler !== 'function') return function() {};
  return getCartProvider()?.store?.subscribe?.(handler) ||
    getCartClient()?.store?.subscribe?.(handler) ||
    function() {};
}

function onCartEvent(eventName, handler) {
  if (typeof handler !== 'function') return;
  const provider = getCartProvider();
  if (provider?.events?.on) {
    return provider.events.on(eventName, handler);
  }

  return getCartClient()?.events?.on?.(eventName, handler);
}

function addCartItem(item) {
  return getCartClient()?.api?.cart?.items?.add?.(item);
}

function removeCartItem(uniqueId) {
  return getCartClient()?.api?.cart?.items?.remove?.(uniqueId);
}

function updateCart(payload) {
  return getCartClient()?.api?.cart?.update?.(payload);
}

function openCart() {
  return getCartClient()?.api?.theme?.cart?.open?.();
}

function navigateCart(route) {
  return getCartClient()?.api?.theme?.cart?.navigate?.(route);
}

function bootCart(handler) {
  const provider = getCartProvider();
  if (!provider?.onReady) return;
  provider.onReady(handler);
}

function debugCartUI(...args) {
  logger.debug(...args);
}

function getStorageValue(storage, key) {
  try {
    return storage?.getItem?.(key) || '';
  } catch (_error) {
    return '';
  }
}

function removeStorageValue(storage, key) {
  try {
    storage?.removeItem?.(key);
  } catch (_error) {}
}

function writeCartSummaryCache(total, count) {
  const payload = JSON.stringify({ total: total || 0, count: count || 0 });
  try {
    localStorage.setItem(CART_SUMMARY_CACHE_KEY, payload);
  } catch (_error) {}
}

function readPendingOrderFlag() {
  const candidates = [
    getStorageValue(sessionStorage, STORE_PENDING_ORDER_KEY),
    getStorageValue(localStorage, STORE_PENDING_ORDER_KEY)
  ];

  return candidates.some((raw) => {
    if (raw === 'true') return true;
    try {
      return JSON.parse(raw)?.value === 'true';
    } catch (_error) {
      return false;
    }
  });
}

function clearPendingOrderFlag() {
  removeStorageValue(sessionStorage, STORE_PENDING_ORDER_KEY);
  removeStorageValue(localStorage, STORE_PENDING_ORDER_KEY);
}

function cartHasPhysicalItems() {
  const state = getCartState();
  const items = state.cart.items.items || [];
  return items.some(item => {
    const fields = item.customFields || [];
    const cat = fields.find(f => f.name === '_category');
    if (cat && cat.value === 'physical') return true;

    // Checkout summary state can be slimmer than cart-edit state; keep a fallback.
    const text = `${item.name || ''} ${item.id || ''} ${item.description || ''}`.toLowerCase();
    return text.includes('physical');
  });
}

function getCartSubtotalCents(state) {
  const subtotal = state?.cart?.subtotal || state?.cart?.total || 0;
  return Math.round(subtotal * 100);
}

function cartHasItems(state) {
  return (state?.cart?.items?.count || 0) > 0;
}

function getCheckoutTokens(state) {
  return {
    publicToken: state?.cart?.paymentSession?.publicToken || null,
    cartToken: state?.cart?.token || null
  };
}

function canAutofillBilling(state) {
  return Boolean(state?.cart?.token);
}

function getCheckoutCustomerDetails(state) {
  const billing = state?.cart?.billingAddress || {};
  let email = state?.customer?.email ||
    state?.cart?.email ||
    billing.email ||
    '';

  if (email === PLACEHOLDER_CART_EMAIL) {
    email = '';
  }

  return {
    email,
    customerName: billing.fullName || billing.name || '',
    phone: billing.phone || ''
  };
}

function isCheckoutEntryRoute(route) {
  return typeof route === 'string' && CHECKOUT_ENTRY_ROUTES.has(route);
}

function getCartRouteChangeTarget(routeChange) {
  return typeof routeChange?.to === 'string' ? routeChange.to : null;
}

function setCurrentCartRoute(route) {
  currentCartRoute = typeof route === 'string' ? route : null;
}

function resetCartRouteToSummary() {
  setCurrentCartRoute(CART_VIEW_ROUTE);
}

function handleCartRouteEvent(routeChange, source, onCheckoutEntry) {
  const nextRoute = getCartRouteChangeTarget(routeChange);
  setCurrentCartRoute(nextRoute);
  debugCartUI(source, routeChange);

  if (isCheckoutEntryRoute(nextRoute) && typeof onCheckoutEntry === 'function') {
    return onCheckoutEntry(nextRoute);
  }

  return Promise.resolve();
}

function formatCents(cents) {
  return '$' + (cents / 100).toFixed(2);
}


function isVisibleElement(element) {
  return !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
}

function findVisible(root, selector) {
  if (!root) return null;
  return Array.from(root.querySelectorAll(selector)).find(isVisibleElement) || null;
}

function findVisibleCartSidebar(root) {
  return findVisible(
    root,
    '.store-first-party-cart__panel, [class*="cart-summary-side"], [class*="cart-summary--edit"]'
  );
}

function routeLooksLikeCheckout(route) {
  return typeof route === 'string' && route.startsWith('/checkout');
}

function isCheckoutViewActive(cartRoot) {
  if (routeLooksLikeCheckout(currentCartRoute)) return true;
  if (currentCartRoute && !routeLooksLikeCheckout(currentCartRoute)) return false;
  return !!findVisible(
    cartRoot,
    '[data-store-cart-step="checkout"], .store-first-party-cart__checkout-preview, [class*="checkout"], [class*="payment"]'
  );
}

function processPendingCartItem() {
  var pendingItem = localStorage.getItem('pendingCartItem');
  if (pendingItem) {
    localStorage.removeItem('pendingCartItem');
    var item = JSON.parse(pendingItem);
    addCartItem(item).then(function() {
      openCart();
    });
  }
}

function getButtonCustomFieldDefinitions(button) {
  const definitions = [];
  for (let index = 1; index <= 10; index++) {
    const name = button.getAttribute(`data-item-custom${index}-name`);
    if (!name) continue;
    definitions.push({
      name,
      type: button.getAttribute(`data-item-custom${index}-type`) || 'text',
      value: button.getAttribute(`data-item-custom${index}-value`) || '',
      placeholder: button.getAttribute(`data-item-custom${index}-placeholder`) || '',
      required: button.getAttribute(`data-item-custom${index}-required`) === 'true'
    });
  }
  return definitions;
}

function buildCartItemFromButton(button) {
  const isStackable = button.getAttribute('data-item-stackable') === 'true' ||
    button.getAttribute('data-item-stackable') === 'always';
  const maxQty = button.getAttribute('data-item-max-quantity');
  const item = {
    id: button.getAttribute('data-item-id'),
    name: button.getAttribute('data-item-name'),
    price: parseFloat(button.getAttribute('data-item-price')),
    url: button.getAttribute('data-item-url'),
    description: button.getAttribute('data-item-description'),
    stackable: isStackable,
    shippable: button.getAttribute('data-item-shippable') === 'true'
  };
  if (maxQty) {
    item.maxQuantity = parseInt(maxQty, 10);
  } else if (!isStackable) {
    item.maxQuantity = 1;
  }

  const customFields = getButtonCustomFieldDefinitions(button);
  if (customFields.length > 0) {
    item.customFields = customFields;
  }

  const readNumericShippingAttribute = (attributeName) => {
    const rawValue = button.getAttribute(attributeName);
    if (rawValue === null || String(rawValue).trim() === '') {
      return NaN;
    }
    return Number(rawValue);
  };
  const manualDomesticRate = String(button.getAttribute('data-item-manual-domestic-rate') || '').trim();
  const weightOz = readNumericShippingAttribute('data-item-shipping-weight-oz');
  const packagingWeightOz = readNumericShippingAttribute('data-item-shipping-packaging-weight-oz');
  const lengthIn = readNumericShippingAttribute('data-item-shipping-length-in');
  const widthIn = readNumericShippingAttribute('data-item-shipping-width-in');
  const heightIn = readNumericShippingAttribute('data-item-shipping-height-in');
  const stackHeightIn = readNumericShippingAttribute('data-item-shipping-stack-height-in');
  if (manualDomesticRate ||
    Number.isFinite(weightOz) ||
    Number.isFinite(packagingWeightOz) ||
    Number.isFinite(lengthIn) ||
    Number.isFinite(widthIn) ||
    Number.isFinite(heightIn) ||
    Number.isFinite(stackHeightIn)) {
    item.shipping = {
      ...(manualDomesticRate ? { manual_domestic_rate: manualDomesticRate } : {}),
      ...(Number.isFinite(weightOz) ? { weight_oz: weightOz } : {}),
      ...(Number.isFinite(packagingWeightOz) ? { packaging_weight_oz: packagingWeightOz } : {}),
      ...(Number.isFinite(lengthIn) ? { length_in: lengthIn } : {}),
      ...(Number.isFinite(widthIn) ? { width_in: widthIn } : {}),
      ...(Number.isFinite(heightIn) ? { height_in: heightIn } : {}),
      ...(Number.isFinite(stackHeightIn) ? { stack_height_in: stackHeightIn } : {})
    };
  }

  return item;
}

function initCartRuntime() {
  if (hasInitializedCart) return;
  hasInitializedCart = true;
  logger.debug('Cart runtime ready - Store order mode');
  
  // Clear cart after returning from a completed Store order.
  const pendingOrder = readPendingOrderFlag();
  logger.debug('Checking pending order flag:', pendingOrder);
  if (pendingOrder && isOrderSuccessPath()) {
    clearPendingOrderFlag();
    
    // Subscribe to cart ready event to clear items
    const unsubscribe = subscribeCartStore(() => {
      const state = getCartState();
      const items = state.cart.items.items || [];
      if (items.length > 0) {
        logger.debug('Clearing', items.length, 'items from cart');
        unsubscribe(); // Stop listening
        items.forEach(item => {
          removeCartItem(item.uniqueId).catch(err => {
            logger.error('Failed to remove item:', err);
          });
        });
      }
    });
    
    // Also try after delay as fallback
    setTimeout(() => {
      const state = getCartState();
      const items = state.cart.items.items || [];
      if (items.length > 0) {
        logger.debug('Clearing', items.length, 'items (delayed)');
        items.forEach(item => {
          removeCartItem(item.uniqueId).catch(() => {});
        });
      }
    }, 2000);
  }
 
function getCartTotalCents(state) {
  const displayedSummary = getCartProvider()?.getDisplaySummary?.() ||
    getCartClient()?.summary?.getDisplay?.();
  if (displayedSummary && Number.isFinite(Number(displayedSummary.totalCents))) {
    return Math.max(0, Math.round(Number(displayedSummary.totalCents)));
  }

  const numericTotal = Number(state?.cart?.total);
  if (Number.isFinite(numericTotal) && numericTotal >= 0) {
    return Math.round(numericTotal * 100);
  }
    return getCartSubtotalCents(state);
  }

  // Update header price immediately on load and on every state change
  function updateHeaderPrice() {
    const state = getCartState();
    const count = state.cart.items.count || 0;
    const totalCents = getCartTotalCents(state);
    
    const headerPrice = document.querySelector('.storecart-total-price');
    if (headerPrice) {
      headerPrice.textContent = formatCents(totalCents);
    }
    
    // Cache total so cart-icon.html can show it before the cart runtime loads.
    try {
      writeCartSummaryCache(totalCents / 100, count);
    } catch (e) {}
  }
  updateHeaderPrice();
  subscribeCartStore(() => {
    updateHeaderPrice();
  });
  onCartEvent('summary.updated', () => {
    updateHeaderPrice();
  });
  onCartEvent(CART_EVENT_NAMES.summaryCheckoutClicked, () => {
    resetCartRouteToSummary();
    debugCartUI(CART_EVENT_NAMES.summaryCheckoutClicked);
  });
  
  processPendingCartItem();

  document.querySelectorAll('[data-redirect-url].store-add-item').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var redirectUrl = this.getAttribute('data-redirect-url');
      var item = buildCartItemFromButton(this);
      localStorage.setItem('pendingCartItem', JSON.stringify(item));
      window.location.href = redirectUrl;
    });
  });

}

// Initialize the cart runtime through the provider seam when available.
bootCart(initCartRuntime);
window.__StoreCartRuntimeCartUiLoaded = true;

})(); // End IIFE
