(function() {
  'use strict';

  var titleResizeObserver = null;
  var titleFitQueued = false;

  function formatMoney(value) {
    var amount = Number(value || 0);
    return '$' + amount.toLocaleString(undefined, {
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    });
  }

  function getControls(element) {
    return element?.closest?.('[data-store-product-controls]') || null;
  }

  function getButton(controls) {
    return controls?.querySelector?.('.store-add-item') || null;
  }

  function getProductCard(controls) {
    return controls?.closest?.('[data-store-product-card]') || null;
  }

  function fitProductTitle(title) {
    if (!title) return;

    title.style.removeProperty('--store-product-title-size');

    var styles = window.getComputedStyle(title);
    var baseSize = parseFloat(styles.fontSize || '0');
    if (!Number.isFinite(baseSize) || baseSize <= 0) return;

    var minSize = Math.max(10, baseSize * 0.56);
    var nextSize = baseSize;

    while (title.scrollHeight > title.clientHeight + 1 && nextSize > minSize) {
      nextSize -= 0.5;
      title.style.setProperty('--store-product-title-size', nextSize.toFixed(1) + 'px');
    }
  }

  function fitProductTitles() {
    titleFitQueued = false;
    document.querySelectorAll('.store-product-card__title').forEach(fitProductTitle);
    window.requestAnimationFrame(function() {
      if (!titleFitQueued) {
        document.documentElement.dataset.storeProductTitlesFit = 'ready';
      }
    });
  }

  function scheduleProductTitleFit() {
    if (titleFitQueued) return;
    titleFitQueued = true;
    document.documentElement.dataset.storeProductTitlesFit = 'pending';
    window.requestAnimationFrame(fitProductTitles);
  }

  function initProductTitleFit() {
    scheduleProductTitleFit();

    if (document.fonts?.ready) {
      document.fonts.ready.then(scheduleProductTitleFit).catch(function() {});
    }

    if ('ResizeObserver' in window) {
      if (!titleResizeObserver) {
        titleResizeObserver = new ResizeObserver(scheduleProductTitleFit);
      }
      document.querySelectorAll('.store-product-card__title').forEach(function(title) {
        titleResizeObserver.observe(title);
      });
    } else {
      window.addEventListener('resize', scheduleProductTitleFit, { passive: true });
    }
  }

  function getFilterCards() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-store-product-card]'));
  }

  function getFilterLabel(button) {
    return button?.textContent?.trim?.() || '';
  }

  function getFilterButton(root, group, value) {
    return root.querySelector('[data-store-filter-group="' + group + '"][data-store-filter-value="' + value + '"]');
  }

  function setActiveFilter(root, group, activeButton) {
    root.querySelectorAll('[data-store-filter-group="' + group + '"]').forEach(function(button) {
      var isActive = button === activeButton;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function getActiveFilter(root, group) {
    var activeButton = root.querySelector('[data-store-filter-group="' + group + '"][aria-pressed="true"]');
    if (!activeButton && group === 'collection') {
      activeButton = getFilterButton(root, 'collection', 'all');
      if (activeButton) setActiveFilter(root, 'collection', activeButton);
    }

    if (!activeButton) return null;

    var value = activeButton.getAttribute('data-store-filter-value') || '';
    if (value === 'all') return null;

    return {
      button: activeButton,
      group: group,
      value: value,
      label: getFilterLabel(activeButton)
    };
  }

  function pluralizeProduct(count) {
    return ' product' + (count === 1 ? '' : 's');
  }

  function applyStorefrontFilter(root) {
    if (!root) return;

    var collectionFilter = getActiveFilter(root, 'collection');
    var categoryFilter = getActiveFilter(root, 'category');
    var activeFilters = [collectionFilter, categoryFilter].filter(Boolean);
    var cards = getFilterCards();
    var shown = 0;

    cards.forEach(function(card) {
      var matches = activeFilters.every(function(filter) {
        return card.getAttribute('data-store-' + filter.group) === filter.value;
      });
      card.hidden = !matches;
      card.toggleAttribute('data-store-product-filtered', !matches);
      if (matches) shown += 1;
    });

    var status = root.querySelector('[data-store-filter-status]');
    if (status) {
      var labels = activeFilters.map(function(filter) { return filter.label; });
      if (!labels.length) {
        status.textContent = '';
      } else if (shown === 0) {
        status.textContent = 'No products match ' + labels.join(' + ') + '.';
      } else if (labels.length === 1) {
        status.textContent = 'Showing ' + shown + ' ' + labels[0] + pluralizeProduct(shown) + '.';
      } else {
        status.textContent = 'Showing ' + shown + pluralizeProduct(shown) + ' matching ' + labels.join(' + ') + '.';
      }
    }

    var clearButton = root.querySelector('[data-store-filter-clear]');
    if (clearButton) {
      clearButton.hidden = activeFilters.length === 0;
    }

    scheduleProductTitleFit();
  }

  function clearStorefrontFilters(root) {
    var allCollections = getFilterButton(root, 'collection', 'all');
    if (allCollections) setActiveFilter(root, 'collection', allCollections);
    setActiveFilter(root, 'category', null);
    applyStorefrontFilter(root);
  }

  function selectStorefrontFilter(root, button) {
    var group = button.getAttribute('data-store-filter-group') || '';
    var value = button.getAttribute('data-store-filter-value') || '';
    var isActive = button.getAttribute('aria-pressed') === 'true';

    if (group === 'all') {
      clearStorefrontFilters(root);
      return;
    }

    if (group === 'collection') {
      var allCollections = getFilterButton(root, 'collection', 'all');
      setActiveFilter(root, 'collection', value === 'all' || isActive ? allCollections : button);
    } else if (group === 'category') {
      setActiveFilter(root, 'category', isActive ? null : button);
    }

    applyStorefrontFilter(root);
  }

  function initStorefrontFilters() {
    var root = document.querySelector('[data-store-product-filters]');
    if (!root) return;

    root.addEventListener('click', function(event) {
      var button = event.target?.closest?.('[data-store-filter-group]');
      if (!button || !root.contains(button)) return;
      event.preventDefault();
      selectStorefrontFilter(root, button);
    });

    root.addEventListener('click', function(event) {
      var clearButton = event.target?.closest?.('[data-store-filter-clear]');
      if (!clearButton || !root.contains(clearButton)) return;
      event.preventDefault();
      clearStorefrontFilters(root);
    });

    var activeCollection = root.querySelector('[data-store-filter-group="collection"][aria-pressed="true"]') ||
      getFilterButton(root, 'collection', 'all');
    if (activeCollection) setActiveFilter(root, 'collection', activeCollection);
    applyStorefrontFilter(root);
  }

  function getPriceElement(controls) {
    return getProductCard(controls)?.querySelector?.('[data-store-price]') || null;
  }

  function getAvailabilityElement(controls) {
    return getProductCard(controls)?.querySelector?.('[data-store-availability]') || null;
  }

  function interpolateCount(template, count) {
    return String(template || '').replace(/%\{count\}/g, String(count));
  }

  function getSelectedVariant(controls) {
    var select = controls?.querySelector?.('[data-store-variant-select]');
    if (!select) return null;
    var option = select.options[select.selectedIndex];
    if (!option) return null;
    return {
      id: option.value || '',
      label: option.getAttribute('data-label') || option.textContent.trim() || '',
      price: Number(option.getAttribute('data-price') || 0),
      inventory: Number(option.getAttribute('data-inventory') || 0),
      inventoryConfigured: option.getAttribute('data-inventory-configured') === 'true',
      status: option.getAttribute('data-status') || ''
    };
  }

  function availabilityState(tracksInventory, inventory, lowStockThreshold, status, messages, inventoryConfigured) {
    var normalizedStatus = String(status || '').trim().toLowerCase();
    if (normalizedStatus === 'sold_out' || normalizedStatus === 'sold-out' || normalizedStatus === 'unavailable') {
      return { state: 'unavailable', text: messages.soldOut || 'Sold out' };
    }
    if (!tracksInventory) return { state: 'none', text: '' };
    if (inventoryConfigured && Number.isFinite(inventory) && inventory <= 0) {
      return { state: 'unavailable', text: messages.soldOut || 'Sold out' };
    }
    if (!Number.isFinite(inventory) || inventory <= 0) {
      return { state: 'pending', text: messages.pending || 'Inventory pending' };
    }
    if (inventory <= lowStockThreshold) {
      return { state: 'low', text: interpolateCount(messages.lowStock || 'Only %{count} left', inventory) };
    }
    return { state: 'in-stock', text: messages.inStock || 'In stock' };
  }

  function syncAvailability(controls, variant, button) {
    var availability = getAvailabilityElement(controls);
    if (!availability || !button) return { state: 'none', text: '' };
    var tracksInventory = availability.getAttribute('data-store-tracks-inventory') === 'true' ||
      button.getAttribute('data-product-inventory-tracking') === 'true';
    var inventory = variant
      ? Number(variant.inventory)
      : Number(button.getAttribute('data-product-inventory') || 0);
    var inventoryConfigured = variant
      ? variant.inventoryConfigured
      : button.getAttribute('data-product-inventory-configured') === 'true';
    var threshold = Math.max(0, Number(availability.getAttribute('data-store-low-stock-threshold') || button.getAttribute('data-product-low-stock-threshold') || 5) || 0);
    var status = variant?.status || button.getAttribute('data-product-status') || '';
    var messages = {
      soldOut: availability.getAttribute('data-store-sold-out-label') || button.getAttribute('data-store-sold-out-label') || 'Sold out',
      pending: availability.getAttribute('data-store-inventory-pending-label') || 'Inventory pending',
      inStock: availability.getAttribute('data-store-in-stock-label') || 'In stock',
      lowStock: availability.getAttribute('data-store-low-stock-template') || 'Only %{count} left'
    };
    var next = availabilityState(tracksInventory, inventory, threshold, status, messages, inventoryConfigured);
    availability.textContent = next.text;
    availability.dataset.storeInventoryState = next.state;
    return next;
  }

  function getQuantity(controls) {
    var input = controls?.querySelector?.('[data-store-quantity]');
    var quantity = parseInt(input?.value || '1', 10);
    if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;
    if (input && String(input.value) !== String(quantity)) input.value = String(quantity);
    return quantity;
  }

  function setQuantity(controls, quantity) {
    var input = controls?.querySelector?.('[data-store-quantity]');
    var nextQuantity = Math.max(1, parseInt(quantity || '1', 10) || 1);
    if (input) input.value = String(nextQuantity);
    return nextQuantity;
  }

  function stepQuantity(trigger) {
    var controls = getControls(trigger);
    if (!controls) return;
    var step = parseInt(trigger.getAttribute('data-store-quantity-step') || '0', 10) || 0;
    var current = getQuantity(controls);
    setQuantity(controls, current + step);
    syncControls(controls);
  }

  function syncControls(controls) {
    var button = getButton(controls);
    if (!button) return;

    var variant = getSelectedVariant(controls);
    var quantity = getQuantity(controls);
    var basePrice = Number(button.getAttribute('data-store-base-price') || button.getAttribute('data-item-price') || 0);
    var unitPrice = variant && Number.isFinite(variant.price) && variant.price >= 0
      ? variant.price
      : basePrice;
    var labelBase = button.getAttribute('data-store-button-label') || 'Add to Cart';
    var priceElement = getPriceElement(controls);

    button.setAttribute('data-item-price', String(unitPrice));
    button.setAttribute('data-item-quantity', String(quantity));
    if (priceElement) {
      priceElement.textContent = unitPrice > 0 ? formatMoney(unitPrice) : 'Free';
    }

    if (variant) {
      var baseId = button.getAttribute('data-product-sku') || button.getAttribute('data-item-id') || '';
      var baseStatus = button.getAttribute('data-product-base-status') || '';
      button.setAttribute('data-item-id', variant.id ? baseId + '__' + variant.id : baseId);
      button.setAttribute('data-item-custom3-value', variant.label || variant.id || '');
      button.setAttribute('data-item-custom5-value', variant.id || '');
      button.setAttribute('data-product-inventory', String(variant.inventory || 0));
      button.setAttribute('data-product-inventory-configured', variant.inventoryConfigured ? 'true' : 'false');
      button.setAttribute('data-product-status', variant.status || baseStatus);
    }
    var currentAvailability = syncAvailability(controls, variant, button);
    var isUnavailable = currentAvailability.state === 'unavailable';
    button.disabled = isUnavailable;
    button.setAttribute('aria-disabled', isUnavailable ? 'true' : 'false');

    var total = unitPrice * quantity;
    var soldOutLabel = button.getAttribute('data-store-sold-out-label') || 'Sold out';
    button.textContent = isUnavailable
      ? soldOutLabel
      : (total > 0 ? labelBase + ' - ' + formatMoney(total) : labelBase);
  }

  function initProductOptions() {
    document.querySelectorAll('[data-store-product-controls]').forEach(syncControls);
    initStorefrontFilters();
    initProductTitleFit();

    document.addEventListener('change', function(event) {
      var controls = getControls(event.target);
      if (controls) syncControls(controls);
    });

    document.addEventListener('input', function(event) {
      var controls = getControls(event.target);
      if (controls) syncControls(controls);
    });

    document.addEventListener('click', function(event) {
      var stepTrigger = event.target?.closest?.('[data-store-quantity-step]');
      if (stepTrigger) {
        event.preventDefault();
        stepQuantity(stepTrigger);
        return;
      }

      var controls = getControls(event.target);
      if (controls) syncControls(controls);
    }, true);

    document.documentElement.dataset.storeProductOptionsReady = 'true';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProductOptions, { once: true });
  } else {
    initProductOptions();
  }
})();
