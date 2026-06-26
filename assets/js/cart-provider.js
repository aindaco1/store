(function() {
'use strict';

  const DEFAULT_RUNTIME = 'first_party';
  const DEFAULT_CHECKOUT_PROVIDER = 'first_party';
  const FIRST_PARTY_RUNTIME = 'first_party';
  const FIRST_PARTY_CHECKOUT_PROVIDER = 'first_party';
  const FIRST_PARTY_CART_TOKEN_PREFIX = 'storecart_';
  const FIRST_PARTY_ITEM_ID_PREFIX = 'storeitem_';
  const FIRST_PARTY_CHECKOUT_SNAPSHOT_KEY = 'store_first_party_checkout_snapshot';
  const ACTIVE_CUSTOM_CHECKOUT_ORDER_ID_KEY = 'store_active_custom_checkout_order_id';
  const FIRST_PARTY_CART_STATE_KEY = 'store_first_party_cart_state';
  const FIRST_PARTY_CART_DRAFT_KEY = 'store_first_party_cart_draft';
  const STORE_MARKETING_ATTRIBUTION_KEY = 'store_marketing_attribution';
  const ABANDONED_CHECKOUT_RESUME_PARAM = 'checkoutResume';
  const PENDING_ORDER_KEY = 'store_pending_order';
  const CART_SUMMARY_CACHE_KEY = 'store_cart_cache';
  const ADD_ON_ITEM_PREFIX = 'addon__';
  const CART_VIEW_ROUTE = '/cart';
  const CHECKOUT_VIEW_ROUTE = '/checkout';
  const STORE_CHECKOUT_INTENT_ENDPOINT = '/api/checkout/intent';
  const STORE_ORDER_SUCCESS_PATH = '/order-success/';
  const DEFAULT_WORKER_BASE = 'https://checkout.dustwave.xyz';
  const DEFAULT_CHECKOUT_UI_MODE = 'custom';
  const DEFAULT_PLATFORM_TIP_PERCENT = 5;
  const MAX_PLATFORM_TIP_PERCENT = 15;
  const FIRST_PARTY_CHECKOUT_SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;
  const ACTIVE_CUSTOM_CHECKOUT_ORDER_ID_TTL_MS = 30 * 60 * 1000;
  const FIRST_PARTY_CART_DRAFT_TTL_MS = 12 * 60 * 60 * 1000;
  const STORE_MARKETING_ATTRIBUTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const LIVE_REFRESH_MARKER_TTL_MS = 10 * 60 * 1000;
  const DEFAULT_PLATFORM_NAME = 'Store';
  const DEFAULT_FLAT_SHIPPING_RATE = 3;
  const DEFAULT_SALES_TAX_RATE = 0.07875;
  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'iframe',
    '[tabindex]:not([tabindex="-1"])'
  ].join(', ');
  const DEFAULT_SHIPPING_COUNTRY = 'US';
  // USPS-derived checkout destinations now live in shared site data so forks can refresh them without editing runtime code.
  const SHIPPING_COUNTRY_OPTIONS = Array.isArray(getRuntimeConfig()?.shipping?.countries) && getRuntimeConfig().shipping.countries.length > 0
    ? getRuntimeConfig().shipping.countries
    : [{ value: 'US', label: 'United States' }];
  const US_STATE_OPTIONS = [
    ['AL', 'Alabama'],
    ['AK', 'Alaska'],
    ['AZ', 'Arizona'],
    ['AR', 'Arkansas'],
    ['CA', 'California'],
    ['CO', 'Colorado'],
    ['CT', 'Connecticut'],
    ['DE', 'Delaware'],
    ['FL', 'Florida'],
    ['GA', 'Georgia'],
    ['HI', 'Hawaii'],
    ['ID', 'Idaho'],
    ['IL', 'Illinois'],
    ['IN', 'Indiana'],
    ['IA', 'Iowa'],
    ['KS', 'Kansas'],
    ['KY', 'Kentucky'],
    ['LA', 'Louisiana'],
    ['ME', 'Maine'],
    ['MD', 'Maryland'],
    ['MA', 'Massachusetts'],
    ['MI', 'Michigan'],
    ['MN', 'Minnesota'],
    ['MS', 'Mississippi'],
    ['MO', 'Missouri'],
    ['MT', 'Montana'],
    ['NE', 'Nebraska'],
    ['NV', 'Nevada'],
    ['NH', 'New Hampshire'],
    ['NJ', 'New Jersey'],
    ['NM', 'New Mexico'],
    ['NY', 'New York'],
    ['NC', 'North Carolina'],
    ['ND', 'North Dakota'],
    ['OH', 'Ohio'],
    ['OK', 'Oklahoma'],
    ['OR', 'Oregon'],
    ['PA', 'Pennsylvania'],
    ['RI', 'Rhode Island'],
    ['SC', 'South Carolina'],
    ['SD', 'South Dakota'],
    ['TN', 'Tennessee'],
    ['TX', 'Texas'],
    ['UT', 'Utah'],
    ['VT', 'Vermont'],
    ['VA', 'Virginia'],
    ['WA', 'Washington'],
    ['WV', 'West Virginia'],
    ['WI', 'Wisconsin'],
    ['WY', 'Wyoming'],
    ['DC', 'District of Columbia']
  ];
  const shippingOptionUtils = window.StoreShippingOptionUtils || {
    normalizeSelection: function(availableOptions, selectedOption, defaultOption) {
      const options = Array.isArray(availableOptions) ? availableOptions : [];
      const requested = String(selectedOption || '').trim().toLowerCase();
      if (requested && options.some((option) => option?.id === requested)) {
        return requested;
      }

      const normalizedDefault = String(defaultOption || 'standard').trim().toLowerCase() || 'standard';
      if (options.some((option) => option?.id === normalizedDefault)) {
        return normalizedDefault;
      }

      return options[0]?.id || 'standard';
    },
    getSelectedDetails: function(availableOptions, selectedOption, defaultOption) {
      const options = Array.isArray(availableOptions) ? availableOptions : [];
      const resolvedOption = this.normalizeSelection(options, selectedOption, defaultOption);
      return options.find((option) => option?.id === resolvedOption) || null;
    },
    getPrimaryQuote: function(quotes) {
      const normalizedQuotes = Array.isArray(quotes) ? quotes : [];
      const shippableQuotes = normalizedQuotes.filter((quote) => (
        Number(quote?.shippingCents || 0) > 0 || quote?.shipment?.hasPhysical === true
      ));
      return shippableQuotes[0] || normalizedQuotes[0] || null;
    },
    resolveQuote: function(payload, selectedOption, fallbackShippingCents) {
      const quotes = Array.isArray(payload?.quotes) ? payload.quotes : [];
      const primaryQuote = this.getPrimaryQuote(quotes);
      const shippableQuotes = quotes.filter((quote) => (
        Number(quote?.shippingCents || 0) > 0 || quote?.shipment?.hasPhysical === true
      ));
      const optionSourceQuote = shippableQuotes.length === 1 ? shippableQuotes[0] : primaryQuote;
      const availableOptions = shippableQuotes.length === 1 && Array.isArray(optionSourceQuote?.availableOptions)
        ? optionSourceQuote.availableOptions
        : [];
      const defaultOption = String(optionSourceQuote?.defaultOption || 'standard').trim().toLowerCase() || 'standard';
      const resolvedOption = this.normalizeSelection(
        availableOptions,
        selectedOption || optionSourceQuote?.selectedOption,
        defaultOption
      );
      const selectedDetails = this.getSelectedDetails(availableOptions, resolvedOption, defaultOption);
      const shippingCents = selectedDetails
        ? Math.max(0, Number(selectedDetails.shippingCents || 0))
        : Math.max(0, Number(payload?.totalShippingCents || fallbackShippingCents || 0));

      return {
        shippingCents,
        source: String(primaryQuote?.source || ''),
        availableOptions,
        defaultOption,
        selectedOption: resolvedOption
      };
    },
    shouldShowOptions: function(quote) {
      const source = String(quote?.source || '').trim().toLowerCase();
      const availableOptions = Array.isArray(quote?.availableOptions) ? quote.availableOptions : [];
      const shippingCents = Math.max(0, Number(quote?.shippingCents ?? quote?.amountCents ?? 0));
      return source === 'usps_live' && shippingCents > 0 && availableOptions.length > 1;
    },
    formatChoice: function(option, labelResolver, moneyFormatter) {
      if (!option) return '';
      const label = typeof labelResolver === 'function' ? labelResolver(option.id) : String(option?.label || option?.id || '');
      const delta = Math.max(0, Number(option?.priceDeltaCents || 0));
      if (delta <= 0) return label;
      const formattedDelta = typeof moneyFormatter === 'function' ? moneyFormatter(delta) : String(delta);
      return `${label} (+${formattedDelta})`;
    }
  };
  const addOnUtils = window.StoreAddOnUtils || {
    invalidateCachedInventory: function() {
      try {
        localStorage.removeItem('store_add_on_inventory');
      } catch (_error) {}
    },
	    getCatalog: function(config) {
	      const productCount = Math.max(1, Math.min(5, parseInt(String(config?.product_count ?? config?.productCount ?? 3), 10) || 3));
	      return {
	        enabled: config?.enabled !== false,
	        productCount,
	        product_count: productCount,
	        products: Array.isArray(config?.products) ? config.products : []
	      };
	    },
	    findProduct: function(catalog, productId) {
	      const normalizedId = String(productId || '').trim();
	      if (!normalizedId) return null;
	      return this.getCatalog(catalog).products.find((product) => (
	        String(product?.id || '').trim() === normalizedId ||
	        String(product?.sku || '').trim() === normalizedId
	      )) || null;
	    },
    findVariant: function(product, variantId) {
      const variants = Array.isArray(product?.variants) ? product.variants : [];
      return variants.find((variant) => String(variant?.id || '') === String(variantId || '')) || null;
    },
    getSelectionKey: function(selection) {
      return `${String(selection?.productId || '').trim()}::${String(selection?.variantId || '').trim()}`;
    },
    getOptionLabel: function(option) {
      return option?.variantLabel ? `${option.name} (${option.variantLabel})` : String(option?.name || '');
    },
    normalizeSelection: function(selection, catalog) {
      const product = this.findProduct(catalog, selection?.productId);
      if (!product) return null;

      const quantity = Math.max(0, Number(selection?.quantity || 0));
      if (!Number.isFinite(quantity) || quantity <= 0) return null;

      const variants = Array.isArray(product?.variants) ? product.variants : [];
      let variantId = String(selection?.variantId || '').trim();
      let variantLabel = String(selection?.variantLabel || '').trim();
      if (variants.length > 0) {
        const variant = this.findVariant(product, variantId);
        if (!variant) return null;
        variantId = String(variant.id || '');
        variantLabel = String(variant.label || variantId);
      } else {
        variantId = '';
        variantLabel = '';
      }

      return {
        productId: String(product.id || ''),
        sku: String(product.sku || product.id || ''),
        name: String(product.name || ''),
        description: String(product.description || ''),
        imageUrl: String(product.image_url || ''),
        sourceUrl: String(product.source_url || ''),
        quantity,
	        unitPrice: Math.round(Number(product.price || 0) * 100),
	        category: String(product.category || product.fulfillment_type || 'digital'),
	        type: String(product.type || '').trim().toLowerCase(),
	        fulfillmentType: String(product.fulfillment_type || product.category || 'digital'),
	        shipping_preset: product.shipping_preset || null,
	        shipping: product.shipping || null,
        variantOptionName: String(product.variant_option_name || ''),
        variantId,
        variantLabel
      };
    },
    normalizeSelections: function(selections, catalog) {
      return (Array.isArray(selections) ? selections : [])
        .map((selection) => this.normalizeSelection(selection, catalog))
        .filter(Boolean)
        .sort((a, b) => (
          a.productId.localeCompare(b.productId) ||
          a.variantId.localeCompare(b.variantId)
        ));
    },
    flattenCatalogOptions: function(catalog) {
      return this.getCatalog(catalog).products.flatMap((product) => {
        const variants = Array.isArray(product?.variants) ? product.variants : [];
        if (variants.length === 0) {
          return [{
            productId: String(product?.id || ''),
            variantId: '',
            variantLabel: '',
            key: this.getSelectionKey({ productId: product?.id, variantId: '' }),
            name: String(product?.name || ''),
            description: String(product?.description || ''),
            imageUrl: String(product?.image_url || ''),
            unitPrice: Math.round(Number(product?.price || 0) * 100),
            category: String(product?.category || 'digital'),
            sourceUrl: String(product?.source_url || '')
          }];
        }

        return variants.map((variant) => ({
          productId: String(product?.id || ''),
          variantId: String(variant?.id || ''),
          variantLabel: String(variant?.label || variant?.id || ''),
          key: this.getSelectionKey({ productId: product?.id, variantId: variant?.id }),
          name: String(product?.name || ''),
          description: String(product?.description || ''),
          imageUrl: String(product?.image_url || ''),
          unitPrice: Math.round(Number(product?.price || 0) * 100),
          category: String(product?.category || 'digital'),
          sourceUrl: String(product?.source_url || '')
        }));
      });
    },
    getSelectionQuantityMap: function(selections, catalog) {
      const map = new Map();
      this.normalizeSelections(selections, catalog).forEach((selection) => {
        map.set(this.getSelectionKey(selection), selection.quantity);
      });
      return map;
    },
    buildSelectionEntries: function(selections, catalog) {
      return this.normalizeSelections(selections, catalog).map((selection) => ({
        productId: selection.productId,
        variantId: selection.variantId,
        variantLabel: selection.variantLabel,
        quantity: Math.max(1, Number(selection.quantity || 1)),
        category: selection.category || 'digital',
        name: selection.name,
        description: selection.description,
        imageUrl: selection.imageUrl,
        sourceUrl: selection.sourceUrl,
        unitPrice: selection.unitPrice,
        shipping: selection.shipping || null,
        shipping_preset: selection.shipping_preset || null
      }));
    },
    selectionFromCartItem: function(item, catalog) {
      const rawId = String(item?.id || '').trim();
      if (!rawId.startsWith('addon__')) return null;
      const match = rawId.match(/^addon__(.+?)(?:__variant__(.+))?$/);
      if (!match) return null;
      return this.normalizeSelection({
        productId: String(match[1] || ''),
        variantId: String(match[2] || ''),
        quantity: Math.max(1, Number(item?.quantity || 1))
      }, catalog);
    },
    selectionsFromCartItems: function(items, catalog) {
      return (Array.isArray(items) ? items : [])
        .map((item) => this.selectionFromCartItem(item, catalog))
        .filter(Boolean)
        .sort((a, b) => (
          a.productId.localeCompare(b.productId) ||
          a.variantId.localeCompare(b.variantId)
        ));
    },
    buildCartItem: function(selection, catalog) {
      const normalized = this.normalizeSelection(selection, catalog);
      if (!normalized) return null;

      const itemId = normalized.variantId
        ? `addon__${normalized.productId}__variant__${normalized.variantId}`
        : `addon__${normalized.productId}`;
      const customFields = [];
      if (normalized.productId) {
        customFields.push({ name: '_product_id', value: normalized.productId });
      }
      if (normalized.sku) {
        customFields.push({ name: '_sku', value: normalized.sku });
      }
      if (normalized.fulfillmentType) {
        customFields.push({ name: '_product_type', value: normalized.fulfillmentType });
      }
      if (normalized.variantId) {
        customFields.push({ name: '_variant_id', value: normalized.variantId });
      }
      if (normalized.variantLabel) {
        customFields.push({ name: '_variant_label', value: normalized.variantLabel });
      }
      if (normalized.category) {
        customFields.push({ name: '_category', value: normalized.category });
      }
      return {
        id: itemId,
        uniqueId: itemId,
        name: normalized.name,
        description: normalized.description,
        imageUrl: normalized.imageUrl,
        url: normalized.sourceUrl || '/',
        price: normalized.unitPrice / 100,
        quantity: normalized.quantity,
        stackable: true,
        shippable: normalized.category === 'physical',
        shipping: normalized.shipping || undefined,
        customFields
      };
    }
  };
  if (typeof addOnUtils.getLowStockThreshold !== 'function') {
    addOnUtils.getLowStockThreshold = function(config) {
      return Math.max(0, Number(config?.low_stock_threshold ?? config?.lowStockThreshold ?? 5) || 5);
    };
  }
	  if (typeof addOnUtils.buildProductStateEntries !== 'function') {
	    addOnUtils.buildProductStateEntries = function(catalog, selections, inventorySnapshot) {
      const resolvedCatalog = this.getCatalog(catalog);
      const threshold = this.getLowStockThreshold(resolvedCatalog);
      const selectedEntries = this.buildSelectionEntries(selections, resolvedCatalog);
      const selectedByProduct = new Map();
      selectedEntries.forEach((entry) => {
        if (!selectedByProduct.has(entry.productId)) {
          selectedByProduct.set(entry.productId, entry);
        }
      });

      return resolvedCatalog.products.map((product) => {
        const selected = selectedByProduct.get(String(product?.id || '')) || null;
        const snapshot = inventorySnapshot?.products?.[product?.id] || {};
        const variants = Array.isArray(product?.variants) ? product.variants : [];
        const hasVariants = variants.length > 0;

        const variantStates = variants.map((variant) => {
          const variantId = String(variant?.id || '');
          const variantSnapshot = snapshot?.variants?.[variantId] || {};
          const configuredInventory = Number.isFinite(Number(variant?.inventory)) && Number(variant.inventory) >= 0 ? Math.round(Number(variant.inventory)) : null;
          const remaining = variantSnapshot?.remaining === null || variantSnapshot?.remaining === undefined
            ? configuredInventory
            : (Number.isFinite(Number(variantSnapshot.remaining)) ? Math.max(0, Number(variantSnapshot.remaining)) : configuredInventory);
          const selectedQuantity = selected?.variantId === variantId ? Math.max(1, Number(selected.quantity || 1)) : 0;
          const maxQuantity = remaining;
          const editableMaxQuantity = remaining === null ? null : remaining + selectedQuantity;
          const available = maxQuantity === null ? true : maxQuantity > 0;
          return {
            id: variantId,
            label: String(variant?.label || variantId),
            inventory: configuredInventory,
            sold: Math.max(0, Number(variantSnapshot?.sold || 0)),
            remaining,
            maxQuantity,
            editableMaxQuantity,
            selected: selected?.variantId === variantId,
            available,
            lowStock: available && maxQuantity !== null && maxQuantity <= threshold
          };
        }).filter((variant) => variant.available || variant.selected);

        const defaultVariant = hasVariants
          ? (variantStates.find((variant) => variant.selected) || variantStates[0] || null)
          : null;
        const configuredInventory = Number.isFinite(Number(product?.inventory)) && Number(product.inventory) >= 0 ? Math.round(Number(product.inventory)) : null;
        const remaining = snapshot?.remaining === null || snapshot?.remaining === undefined
          ? configuredInventory
          : (Number.isFinite(Number(snapshot.remaining)) ? Math.max(0, Number(snapshot.remaining)) : configuredInventory);
        const selectedQuantity = !hasVariants && selected ? Math.max(1, Number(selected.quantity || 1)) : 0;
        const maxQuantity = hasVariants ? (defaultVariant?.maxQuantity ?? null) : remaining;
        const editableMaxQuantity = hasVariants ? (defaultVariant?.editableMaxQuantity ?? null) : (remaining === null ? null : remaining + selectedQuantity);
        const available = hasVariants ? variantStates.length > 0 : (maxQuantity === null ? true : maxQuantity > 0);

        return {
	          productId: String(product?.id || ''),
	          sku: String(product?.sku || ''),
	          name: String(product?.name || ''),
	          description: String(product?.description || ''),
	          imageUrl: String(product?.image_url || ''),
	          sourceUrl: String(product?.source_url || ''),
	          priceCents: Math.round(Number(product?.price || 0) * 100),
	          category: String(product?.category || product?.fulfillment_type || 'digital'),
	          type: String(product?.type || '').trim().toLowerCase(),
	          fulfillmentType: String(product?.fulfillment_type || product?.category || 'digital'),
	          variantOptionName: String(product?.variant_option_name || 'Option'),
          inventory: configuredInventory,
          sold: Math.max(0, Number(snapshot?.sold || 0)),
          remaining,
          maxQuantity,
          editableMaxQuantity,
          available,
          lowStock: !hasVariants && available && maxQuantity !== null && maxQuantity <= threshold,
          selectedQuantity: Math.max(1, Number(selected?.quantity || 1)),
          selectedVariantId: hasVariants ? String(selected?.variantId || defaultVariant?.id || '') : '',
          selectedVariantLabel: hasVariants ? String(selected?.variantLabel || defaultVariant?.label || '') : '',
          inCart: !!selected,
          variants: variantStates
        };
	      }).filter((product) => product.available || product.inCart);
	    };
	  }
	  if (typeof addOnUtils.getProductType !== 'function') {
	    addOnUtils.getProductType = function(product) {
	      return String(product?.type || product?.product_type || product?.merchandising_type || '').trim().toLowerCase();
	    };
	  }
	  if (typeof addOnUtils.getSuggestedProductStateEntries !== 'function') {
	    addOnUtils.getSuggestedProductStateEntries = function(catalog, items, selections, inventorySnapshot) {
	      const resolvedCatalog = this.getCatalog(catalog);
	      const inCartIds = new Set();
	      const targetTypes = new Set();
		      const parseAddOnItemProductId = function(value) {
		        const rawId = String(value || '').trim();
		        if (!rawId) return '';
		        if (rawId.startsWith('addon__')) {
		          const match = rawId.match(/^addon__(.+?)(?:__variant__(.+))?$/);
		          return match ? String(match[1] || '').trim() : '';
		        }
		        const variantSeparatorIndex = rawId.indexOf('__');
		        return variantSeparatorIndex > 0 ? rawId.slice(0, variantSeparatorIndex) : rawId;
		      };
		      const getCustomFieldValue = function(item, names) {
		        const wanted = new Set((Array.isArray(names) ? names : [names]).map((name) => String(name || '').trim().toLowerCase()));
		        const fields = Array.isArray(item?.customFields)
		          ? item.customFields
		          : Array.isArray(item?.custom_fields)
		            ? item.custom_fields
		            : [];
		        const match = fields.find((field) => wanted.has(String(field?.name || '').trim().toLowerCase()));
		        return match ? String(match.value || '').trim() : '';
		      };
		      (Array.isArray(items) ? items : []).forEach((item) => {
		        const customSku = getCustomFieldValue(item, ['_sku', 'sku']);
		        const rawId = parseAddOnItemProductId(item?.productId || item?.product_id || item?.id || item?.sku || customSku || '');
		        if (rawId) inCartIds.add(rawId);
		        if (item?.sku) inCartIds.add(String(item.sku || '').trim());
		        if (customSku) inCartIds.add(customSku);
		        const product = this.findProduct(resolvedCatalog, rawId) ||
		          this.findProduct(resolvedCatalog, item?.sku) ||
		          this.findProduct(resolvedCatalog, customSku);
		        if (product?.id) inCartIds.add(String(product.id || '').trim());
		        if (product?.sku) inCartIds.add(String(product.sku || '').trim());
		        if (String(item?.id || item?.uniqueId || '').trim().startsWith('addon__')) return;
		        const type = this.getProductType(product) ||
		          getCustomFieldValue(item, ['_merchandising_type', '_product_catalog_type', '_store_product_type']);
		        if (type) targetTypes.add(type);
		      });
	      if (targetTypes.size === 0) return [];
	      return this.buildProductStateEntries(resolvedCatalog, selections, inventorySnapshot).filter((product) => {
	        const type = this.getProductType(product);
	        if (!type || !targetTypes.has(type)) return false;
	        if (product.inCart) return false;
	        if (inCartIds.has(product.productId) || inCartIds.has(product.sku)) return false;
	        return true;
	      }).slice(0, resolvedCatalog.productCount || 3);
	    };
	  }
	  const ADD_ON_CATALOG = addOnUtils.getCatalog(getRuntimeConfig().addOns);
  const ADD_ON_OPTIONS = addOnUtils.flattenCatalogOptions(ADD_ON_CATALOG);
  const ADD_ON_INVENTORY_CACHE_KEY = 'store_add_on_inventory';
  let addOnInventorySnapshot = null;
  let addOnInventoryRequest = null;
  let requestCartAddOnInventoryRerender = null;
  const cartAddOnDrafts = new Map();

  function getRuntimeConfig() {
    return window.STORE_CONFIG || window.StoreConfig || {};
  }

  function getPlatformAuthorName() {
    const config = getRuntimeConfig();
    return String(
      config?.platform?.author ||
      config?.platformAuthor ||
      config?.platform?.companyName ||
      config?.platformCompanyName ||
      getPlatformName()
    ).trim() || getPlatformName();
  }

  function getAddOnInventoryTtlMs() {
    const config = getRuntimeConfig();
    const parsed = Number(
      config?.cache?.liveInventoryTtlSeconds ??
      config?.liveInventoryCacheTtlSeconds ??
      300
    );
    return (Number.isFinite(parsed) && parsed >= 0 ? parsed : 300) * 1000;
  }

  function readCachedAddOnInventory() {
    try {
      const storage = getLocalStorageSafe();
      const stored = readStorageValue(storage, ADD_ON_INVENTORY_CACHE_KEY);
      const raw = stored.raw;
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const ttlMs = getAddOnInventoryTtlMs();
      const savedAt = Number(parsed.savedAt || 0);
      if (ttlMs > 0 && savedAt > 0 && (Date.now() - savedAt) > ttlMs) {
        return null;
      }
      return parsed.data || null;
    } catch (_error) {
      return null;
    }
  }

  function writeCachedAddOnInventory(data) {
    try {
      writeStorageValue(getLocalStorageSafe(), ADD_ON_INVENTORY_CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        data
      }));
    } catch (_error) {}
  }

  async function fetchCartAddOnInventorySnapshot(options) {
    const force = options?.force === true;
    if (!force && addOnInventorySnapshot) {
      return addOnInventorySnapshot;
    }

    if (!force) {
      const cached = readCachedAddOnInventory();
      if (cached) {
        addOnInventorySnapshot = cached;
        return cached;
      }
    }

    try {
      const response = await fetch(`${getWorkerBase()}/add-ons/inventory`);
      if (!response.ok) {
        throw new Error(`Failed to load add-on inventory (${response.status})`);
      }
      const data = await response.json();
      addOnInventorySnapshot = data;
      writeCachedAddOnInventory(data);
      return data;
    } catch (_error) {
      return addOnInventorySnapshot || {
        lowStockThreshold: addOnUtils.getLowStockThreshold(ADD_ON_CATALOG),
        products: {}
      };
    }
  }

  function ensureCartAddOnInventorySnapshot() {
    if (addOnInventoryRequest) return addOnInventoryRequest;
    addOnInventoryRequest = fetchCartAddOnInventorySnapshot().then((data) => {
      addOnInventorySnapshot = data;
      if (typeof requestCartAddOnInventoryRerender === 'function') {
        requestCartAddOnInventoryRerender();
      } else if (typeof renderFirstPartyCart === 'function') {
        renderFirstPartyCart();
      }
      return data;
    }).finally(() => {
      addOnInventoryRequest = null;
    });
    return addOnInventoryRequest;
  }

  function getRuntimeMessages() {
    return getRuntimeConfig()?.i18n?.messages || {};
  }

  function getRuntimeLocale() {
    const htmlLang = String(document.documentElement?.lang || '').trim();
    if (htmlLang) return htmlLang;
    return String(getRuntimeConfig()?.i18n?.lang || 'en').trim() || 'en';
  }

  function getRuntimeMessage(path, fallback) {
    const parts = String(path || '').split('.');
    let value = getRuntimeMessages();
    for (const part of parts) {
      if (!value || typeof value !== 'object') return fallback;
      value = value[part];
    }
    return typeof value === 'string' && value ? value : fallback;
  }

  function humanizeIdentifier(value) {
    return String(value || '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  }

  function getRequestedRuntime() {
    const config = getRuntimeConfig();
    return config?.checkout?.cartRuntime ||
      config?.cartRuntime ||
      DEFAULT_RUNTIME;
  }

  function getRequestedCheckoutProvider() {
    const config = getRuntimeConfig();
    return config?.checkout?.provider ||
      config?.checkoutProvider ||
      DEFAULT_CHECKOUT_PROVIDER;
  }

  function getWorkerBase() {
    const config = getRuntimeConfig();
    return config?.platform?.workerUrl ||
      config?.workerBase ||
      DEFAULT_WORKER_BASE;
  }

  function getCheckoutUiMode() {
    const config = getRuntimeConfig();
    return String(
      config?.checkout?.uiMode ||
      config?.checkoutUiMode ||
      DEFAULT_CHECKOUT_UI_MODE
    ).trim().toLowerCase();
  }

  function getPlatformName() {
    const config = getRuntimeConfig();
    return config?.platform?.name ||
      config?.platformName ||
      DEFAULT_PLATFORM_NAME;
  }

  function getPlatformCompanyName() {
    const config = getRuntimeConfig();
    return String(
      config?.platform?.companyName ||
      config?.platformCompanyName ||
      getPlatformName()
    ).trim() || getPlatformName();
  }

  function getSalesTaxRate() {
    const config = getRuntimeConfig();
    const parsed = Number(
      config?.pricing?.salesTaxRate ??
      config?.salesTaxRate
    );
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SALES_TAX_RATE;
  }

  function getFlatShippingFeeCents() {
    const config = getRuntimeConfig();
    const parsed = Number(
      config?.pricing?.flatShippingRate ??
      config?.flatShippingRate
    );
    const amount = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_FLAT_SHIPPING_RATE;
    return Math.round(amount * 100);
  }

  function getShippingFallbackFeeCents() {
    const config = getRuntimeConfig();
    const parsed = Number(
      config?.shipping?.fallbackFlatRate ??
      config?.shippingFallbackFlatRate
    );
    const amount = Number.isFinite(parsed) && parsed >= 0 ? parsed : 3;
    return Math.round(amount * 100);
  }

  function isGlobalFreeShippingDefaultEnabled() {
    const config = getRuntimeConfig();
    const value =
      config?.shipping?.freeShippingDefault ??
      config?.shippingFreeShippingDefault;
    if (value === true || value === false) return value;
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'true';
  }

  function getDefaultPlatformTipPercent() {
    const config = getRuntimeConfig();
    const parsed = Number(
      config?.pricing?.defaultTipPercent ??
      config?.defaultTipPercent
    );
    const max = getMaxPlatformTipPercent();
    const fallback = Math.min(DEFAULT_PLATFORM_TIP_PERCENT, max);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : fallback;
  }

  function getMaxPlatformTipPercent() {
    const config = getRuntimeConfig();
    const parsed = Number(
      config?.pricing?.maxTipPercent ??
      config?.maxTipPercent
    );
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : MAX_PLATFORM_TIP_PERCENT;
  }

  function formatTaxRateLabel() {
    return getRuntimeMessage('cart.salesTaxLabel', 'Sales tax (%{rate}%)')
      .replace('%{rate}', (getSalesTaxRate() * 100).toFixed(3).replace(/\.?0+$/, ''));
  }

  function formatGenericTaxLabel() {
    return getRuntimeMessage('cart.taxLabel', 'Tax');
  }

  function formatTaxPendingLabel() {
    return getRuntimeMessage('cart.salesTaxPendingLabel', 'Tax');
  }

  function formatTaxLabelFromQuote(taxQuote) {
    const effectiveRate = Math.max(0, Number(taxQuote?.taxDetails?.effectiveRate ?? taxQuote?.effectiveRate) || 0);
    const country = String(taxQuote?.taxDetails?.destination?.country || taxQuote?.destination?.country || '').trim().toUpperCase();
    if (effectiveRate > 0 && country === 'US') {
      return getRuntimeMessage('cart.salesTaxLabel', 'Sales tax (%{rate}%)')
        .replace('%{rate}', (effectiveRate * 100).toFixed(3).replace(/\.?0+$/, ''));
    }

    if (effectiveRate > 0) {
      return getRuntimeMessage('cart.taxLabelWithRate', 'Tax (%{rate}%)')
        .replace('%{rate}', (effectiveRate * 100).toFixed(3).replace(/\.?0+$/, ''));
    }

    return formatGenericTaxLabel();
  }

  function getStoredBillingAddress(state) {
    return state?.cart?.billingAddress && typeof state.cart.billingAddress === 'object'
      ? { ...state.cart.billingAddress }
      : {};
  }

  function getCurrentBillingAddress(state) {
    const root = getCartRoot();
    const fields = root ? Array.from(root.querySelectorAll('[data-cart-tax-destination-field]')) : [];
    if (fields.length > 0) {
      const read = function(name) {
        const field = fields.find((node) => node.getAttribute('data-cart-tax-destination-field') === name);
        if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
          return String(field.value || '').trim();
        }
        return '';
      };

      return {
        country: (read('country') || DEFAULT_SHIPPING_COUNTRY).toUpperCase(),
        postal_code: read('postal_code'),
        state: read('state'),
        city: read('city'),
        line1: read('line1'),
        line2: read('line2')
      };
    }

    return getStoredBillingAddress(state);
  }

  function normalizeTaxDestination(value) {
    if (!value || typeof value !== 'object') {
      return {
        country: '',
        postalCode: '',
        state: '',
        city: '',
        line1: '',
        line2: ''
      };
    }

    return {
      country: String(value.country || '').trim().toUpperCase(),
      postalCode: String(value.postalCode || value.postal_code || '').trim(),
      state: String(value.state || value.province || value.region || '').trim().toUpperCase(),
      city: String(value.city || '').trim(),
      line1: String(value.line1 || value.address1 || '').trim(),
      line2: String(value.line2 || value.address2 || '').trim()
    };
  }

  function isNewMexicoPostalCode(postalCode) {
    const match = String(postalCode || '').trim().match(/^(\d{5})/);
    if (!match) return false;
    const value = Number(match[1]);
    return Number.isInteger(value) && value >= 87000 && value <= 88499;
  }

  function taxDestinationNeedsDetailedStreetAddress(destination) {
    const normalized = normalizeTaxDestination(destination);
    return normalized.country === 'US' && (
      normalized.state === 'NM' ||
      isNewMexicoPostalCode(normalized.postalCode)
    );
  }

  function getTaxLocationRequiredMessage(destination) {
    const normalized = normalizeTaxDestination(destination);
    if (taxDestinationNeedsDetailedStreetAddress(normalized)) {
      return getRuntimeMessage(
        'cart.taxLocationRequiredNm',
        'Enter your billing street address, city, state, and postal code to finalize New Mexico tax before continuing.'
      );
    }

    return getRuntimeMessage(
      'cart.taxLocationRequired',
      'Enter your billing country and postal code to finalize tax before continuing.'
    );
  }

  function getTaxLocationNote(destination) {
    const normalized = normalizeTaxDestination(destination);
    if (taxDestinationNeedsDetailedStreetAddress(normalized)) {
      return getRuntimeMessage(
        'cart.taxLocationNoteNm',
        'Add your New Mexico billing street address, city, state, and postal code so we can finalize tax before you save your payment method.'
      );
    }

    return getRuntimeMessage(
      'cart.taxLocationNote',
      'Add your billing country and postal code so we can finalize tax before you save your payment method.'
    );
  }

  function isTaxDestinationReady(destination) {
    const normalized = normalizeTaxDestination(destination);
    if (!normalized.country) return false;

    if (taxDestinationNeedsDetailedStreetAddress(normalized)) {
      return Boolean(
        normalized.line1 &&
        normalized.city &&
        normalized.state &&
        normalized.postalCode
      );
    }

    if (normalized.country === 'US') {
      return normalized.postalCode.length >= 5 || normalized.state.length > 0;
    }

    return normalized.postalCode.length > 0;
  }

  function isTaxDestinationReadyForQuote(destination) {
    const normalized = normalizeTaxDestination(destination);
    if (!normalized.country) return false;

    if (normalized.country === 'US') {
      return normalized.postalCode.length >= 5 || normalized.state.length > 0;
    }

    return normalized.postalCode.length > 0;
  }

  function readReadyTaxDestination(state) {
    const normalized = normalizeTaxDestination(getCurrentBillingAddress(state));
    return isTaxDestinationReady(normalized) ? normalized : null;
  }

  function resolveDisplayedShippingDraft(options) {
    if (options?.shippingDraft) return options.shippingDraft;

    const root = getCartRoot();
    const estimatePostalField = root?.querySelector('[data-cart-estimate-postal]');
    const checkoutPostalField = root?.querySelector('[data-cart-custom-shipping-field="postal_code"]');
    const checkoutCountryField = root?.querySelector('[data-cart-custom-shipping-field="country"]');

    if (options?.currentRoute === CHECKOUT_VIEW_ROUTE && options?.checkoutMode === 'custom') {
      return {
        address: {
          postal_code: checkoutPostalField instanceof HTMLInputElement
            ? String(checkoutPostalField.value || '').trim()
            : '',
          country: checkoutCountryField instanceof HTMLSelectElement
            ? String(checkoutCountryField.value || '').trim().toUpperCase()
            : DEFAULT_SHIPPING_COUNTRY
        }
      };
    }

    return {
      address: {
        postal_code: estimatePostalField instanceof HTMLInputElement
          ? String(estimatePostalField.value || '').trim()
          : '',
        country: DEFAULT_SHIPPING_COUNTRY
      }
    };
  }

  function resolveDisplayedTaxState(state, options) {
    const billingDestination = normalizeTaxDestination(getCurrentBillingAddress(state));
    const shippingDraft = resolveDisplayedShippingDraft(options);
    const shippingDestination = normalizeTaxDestination({
      country: shippingDraft?.address?.country,
      postal_code: shippingDraft?.address?.postal_code,
      state: shippingDraft?.address?.state,
      city: shippingDraft?.address?.city,
      line1: shippingDraft?.address?.line1,
      line2: shippingDraft?.address?.line2
    });
    const hasTaxDestination = isTaxDestinationReadyForQuote(billingDestination) || isTaxDestinationReadyForQuote(shippingDestination);
    const taxQuote = options?.taxQuote || null;
    const quoteStatus = String(taxQuote?.status || '').trim().toLowerCase();
    const quotedAmountCents = Number.isFinite(Number(taxQuote?.amountCents))
      ? Math.max(0, Number(taxQuote.amountCents))
      : 0;
    if (quoteStatus === 'ready' && hasTaxDestination) {
      return {
        hasTaxDestination,
        taxReady: true,
        taxCents: quotedAmountCents,
        taxLabel: String(taxQuote?.label || formatTaxLabelFromQuote(taxQuote)),
        taxDisplayValue: ''
      };
    }

    if (hasTaxDestination && (quoteStatus === 'loading' || quoteStatus === 'needs_input' || quoteStatus === 'error')) {
      return {
        hasTaxDestination,
        taxReady: false,
        taxCents: 0,
        taxLabel: formatTaxPendingLabel(),
        taxDisplayValue: '--'
      };
    }

    return {
      hasTaxDestination,
      taxReady: false,
      taxCents: 0,
      taxLabel: formatTaxPendingLabel(),
      taxDisplayValue: '--'
    };
  }

  function cartRequiresCustomCheckoutTaxLocation(state) {
    const items = state?.cart?.items?.items || [];
    return getCheckoutUiMode() === 'custom' && !cartHasPhysicalItems(items);
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  function formatTipSliderValueText(tipPercent, tipAmountCents) {
    const percent = sanitizeTipPercent(tipPercent, getDefaultPlatformTipPercent());
    return `${percent}% tip, ${formatCents(Math.max(0, tipAmountCents || 0))}`;
  }

  function renderShippingCountryOptions(selectedValue) {
    const selected = String(selectedValue || DEFAULT_SHIPPING_COUNTRY).trim().toUpperCase();
    const displayNames = typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
      ? new Intl.DisplayNames([getRuntimeLocale()], { type: 'region' })
      : null;
    const getCountryLabel = function(option) {
      const fallbackLabel = String(option?.label || option?.value || '');
      if (!displayNames || !option?.value) return fallbackLabel;
      try {
        return String(displayNames.of(option.value) || fallbackLabel);
      } catch (_error) {
        return fallbackLabel;
      }
    };
    return SHIPPING_COUNTRY_OPTIONS.map((option) => `
      <option value="${escapeHtml(option.value)}" ${selected === option.value ? 'selected' : ''}>${escapeHtml(getCountryLabel(option))}</option>
    `).join('');
  }

  function renderUsStateOptions(selectedValue) {
    const selected = String(selectedValue || '').trim().toUpperCase();
    return `
      <option value="">Select state</option>
      ${US_STATE_OPTIONS.map(([value, label]) => `
        <option value="${escapeHtml(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(label)}</option>
      `).join('')}
    `;
  }

  function getCartRoot() {
    return document.querySelector('[data-store-cart-root]');
  }

  function getSessionStorageSafe() {
    try {
      return window.sessionStorage;
    } catch (_error) {
      return null;
    }
  }

  function getLocalStorageSafe() {
    try {
      return window.localStorage;
    } catch (_error) {
      return null;
    }
  }

  function readStorageValue(storage, key) {
    if (!storage) return { raw: '', key: '' };
    const raw = storage.getItem(key);
    if (raw !== null) {
      return { raw, key };
    }

    return { raw: '', key: '' };
  }

  function writeStorageValue(storage, key, value) {
    if (!storage) return;
    storage.setItem(key, value);
  }

  function removeStorageValue(storage, key) {
    if (!storage) return;
    storage.removeItem(key);
  }

  function writeTimedStorageValue(storage, key, value) {
    if (!storage) return;
    if (!value) {
      removeStorageValue(storage, key);
      return;
    }
    writeStorageValue(storage, key, JSON.stringify({
      value: String(value),
      savedAt: Date.now()
    }));
  }

  function readTimedStorageValue(storage, key, ttlMs) {
    if (!storage) return '';
    const stored = readStorageValue(storage, key);
    const raw = stored.raw;
    if (!raw) return '';

    try {
      const parsed = JSON.parse(raw);
      const value = String(parsed?.value || '').trim();
      const savedAt = Number(parsed?.savedAt || 0);
      if (!value) {
        removeStorageValue(storage, key);
        return '';
      }
      if (Number.isFinite(savedAt) && savedAt > 0 && Date.now() - savedAt > ttlMs) {
        removeStorageValue(storage, key);
        return '';
      }
      return value;
    } catch (_error) {
      removeStorageValue(storage, key);
      return '';
    }
  }

  function normalizeMarketingAttributionValue(value, maxLength) {
    return String(value || '')
      .trim()
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .slice(0, maxLength || 120);
  }

  function readStoreMarketingAttribution() {
    const storage = getLocalStorageSafe() || getSessionStorageSafe();
    if (!storage) return null;
    const raw = readStorageValue(storage, STORE_MARKETING_ATTRIBUTION_KEY).raw;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const savedAt = Number(parsed?.savedAt || 0);
      if (!savedAt || Date.now() - savedAt > STORE_MARKETING_ATTRIBUTION_TTL_MS) {
        removeStorageValue(storage, STORE_MARKETING_ATTRIBUTION_KEY);
        return null;
      }
      return parsed?.value && typeof parsed.value === 'object' ? parsed.value : null;
    } catch (_error) {
      removeStorageValue(storage, STORE_MARKETING_ATTRIBUTION_KEY);
      return null;
    }
  }

  function writeStoreMarketingAttribution(value) {
    if (!value || typeof value !== 'object') return;
    const storage = getLocalStorageSafe() || getSessionStorageSafe();
    if (!storage) return;
    writeStorageValue(storage, STORE_MARKETING_ATTRIBUTION_KEY, JSON.stringify({
      value,
      savedAt: Date.now()
    }));
  }

  function captureStoreMarketingAttribution() {
    let url;
    try {
      url = new URL(window.location.href);
    } catch (_error) {
      return;
    }
    const params = url.searchParams;
    const attribution = {
      ref: normalizeMarketingAttributionValue(params.get('ref'), 80),
      utmSource: normalizeMarketingAttributionValue(params.get('utm_source'), 80),
      utmMedium: normalizeMarketingAttributionValue(params.get('utm_medium'), 80),
      utmCampaign: normalizeMarketingAttributionValue(params.get('utm_campaign'), 120),
      utmContent: normalizeMarketingAttributionValue(params.get('utm_content'), 120),
      landingPath: normalizeMarketingAttributionValue(url.pathname + url.search, 2048),
      capturedAt: new Date().toISOString()
    };
    const hasAttribution = ['ref', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent']
      .some((key) => attribution[key]);
    if (hasAttribution) {
      writeStoreMarketingAttribution(attribution);
    }
  }

  function dispatchProviderReady(detail) {
    document.dispatchEvent(new CustomEvent('storecart.provider.ready', { detail: detail || {} }));
    document.dispatchEvent(new CustomEvent('store.ready', { detail: detail || {} }));
    document.dispatchEvent(new CustomEvent('store.cart.ready', { detail: detail || {} }));
  }

  function dispatchCartReady(detail) {
    document.dispatchEvent(new CustomEvent('storecart.ready', { detail: detail || {} }));
  }

  function getStripeCheckoutSidecar() {
    return window.StoreStripeCheckoutSidecar || null;
  }

  function loadStripeJs() {
    const sidecar = getStripeCheckoutSidecar();
    if (sidecar && typeof sidecar.ensureStripeJs === 'function') {
      return sidecar.ensureStripeJs();
    }
    return Promise.reject(new Error('Stripe checkout helper is unavailable.'));
  }

  let stripeJsPrewarmPromise = null;
  let stripeJsPrewarmScheduled = false;

  function canUseCustomCheckoutUi() {
    return getRequestedCheckoutProvider() === FIRST_PARTY_CHECKOUT_PROVIDER && getCheckoutUiMode() === 'custom';
  }

  function prewarmStripeJs() {
    if (!canUseCustomCheckoutUi()) return null;
    const sidecar = getStripeCheckoutSidecar();
    if (!sidecar || typeof sidecar.ensureStripeJs !== 'function') {
      return null;
    }
    if (stripeJsPrewarmPromise) return stripeJsPrewarmPromise;

    stripeJsPrewarmPromise = loadStripeJs().catch((error) => {
      stripeJsPrewarmPromise = null;
      throw error;
    });

    return stripeJsPrewarmPromise;
  }

  function scheduleStripeJsPrewarm() {
    if (!canUseCustomCheckoutUi() || stripeJsPrewarmScheduled || stripeJsPrewarmPromise) return;
    stripeJsPrewarmScheduled = true;

    const start = function() {
      stripeJsPrewarmScheduled = false;
      const prewarm = prewarmStripeJs();
      if (prewarm && typeof prewarm.catch === 'function') {
        void prewarm.catch(() => {});
      }
    };

    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(start, { timeout: 1200 });
      return;
    }

    window.setTimeout(start, 120);
  }

  function createEventBus() {
    const listeners = new Map();

    return {
      on: function(eventName, handler) {
        if (typeof handler !== 'function') return function() {};
        const handlers = listeners.get(eventName) || [];
        handlers.push(handler);
        listeners.set(eventName, handlers);

        return function unsubscribe() {
          const currentHandlers = listeners.get(eventName) || [];
          listeners.set(eventName, currentHandlers.filter((currentHandler) => currentHandler !== handler));
        };
      },
      emit: function(eventName, payload) {
        const handlers = listeners.get(eventName) || [];
        handlers.forEach((handler) => handler(payload));
      }
    };
  }

  function createStore(initialState) {
    let state = initialState;
    const subscribers = new Set();

    return {
      getState: function() {
        return state;
      },
      setState: function(nextState) {
        state = nextState;
        subscribers.forEach((subscriber) => subscriber(state));
      },
      subscribe: function(handler) {
        if (typeof handler !== 'function') return function() {};
        subscribers.add(handler);
        return function unsubscribe() {
          subscribers.delete(handler);
        };
      }
    };
  }

  function normalizeCartItem(item) {
    const catalogItem = normalizeStoreCatalogCartItem(item, { preserveAddOnId: true });
    const quantity = Math.max(1, Number(catalogItem?.quantity || 1));
    const price = Number(catalogItem?.price || 0);
    const maxQuantity = Number(catalogItem?.maxQuantity);
    return {
      ...catalogItem,
      quantity,
      price,
      maxQuantity: Number.isFinite(maxQuantity) && maxQuantity > 0 ? maxQuantity : undefined,
      uniqueId: catalogItem?.uniqueId || `${FIRST_PARTY_ITEM_ID_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    };
  }

  const MANUAL_DOMESTIC_RATE_FIRST_CLASS_FLAT = 'FIRST_CLASS_FLAT';
  const FIRST_CLASS_FLAT_MIN_LENGTH_IN = 11.5;
  const FIRST_CLASS_FLAT_MAX_LENGTH_IN = 15;
  const FIRST_CLASS_FLAT_MIN_WIDTH_IN = 6.125;
  const FIRST_CLASS_FLAT_MAX_WIDTH_IN = 12;
  const FIRST_CLASS_FLAT_MAX_HEIGHT_IN = 0.75;
  const FIRST_CLASS_FLAT_MAX_WEIGHT_OZ = 13;
  const FIRST_CLASS_FLAT_RATE_TABLE_CENTS = {
    1: 163,
    2: 190,
    3: 217,
    4: 244,
    5: 272,
    6: 300,
    7: 328,
    8: 356,
    9: 384,
    10: 414,
    11: 444,
    12: 474,
    13: 504
  };

  function normalizeManualDomesticRate(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return normalized === MANUAL_DOMESTIC_RATE_FIRST_CLASS_FLAT ? normalized : '';
  }

  function getShippingMetric(shipping, snakeKey, camelKey) {
    const parsed = Number(shipping?.[snakeKey] ?? shipping?.[camelKey]);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function getManualDomesticShippingCentsFromShipping(shipping, quantity) {
    if (!shipping || typeof shipping !== 'object') return null;
    const manualDomesticRate = normalizeManualDomesticRate(
      shipping.manual_domestic_rate ?? shipping.manualDomesticRate
    );
    if (manualDomesticRate !== MANUAL_DOMESTIC_RATE_FIRST_CLASS_FLAT) {
      return null;
    }

    const resolvedQuantity = Math.max(1, Number(quantity || 1));
    if (!Number.isInteger(resolvedQuantity) || resolvedQuantity <= 0) {
      return null;
    }

    const weightOz = getShippingMetric(shipping, 'weight_oz', 'weightOz');
    const packagingWeightOz = getShippingMetric(shipping, 'packaging_weight_oz', 'packagingWeightOz');
    const lengthIn = getShippingMetric(shipping, 'length_in', 'lengthIn');
    const widthIn = getShippingMetric(shipping, 'width_in', 'widthIn');
    const heightIn = getShippingMetric(shipping, 'height_in', 'heightIn');
    const stackHeightIn = getShippingMetric(shipping, 'stack_height_in', 'stackHeightIn');

    if (!Number.isFinite(weightOz) || weightOz <= 0 ||
      !Number.isFinite(lengthIn) || !Number.isFinite(widthIn) || !Number.isFinite(heightIn)) {
      return null;
    }

    const totalWeightOz = (weightOz * resolvedQuantity) + (Number.isFinite(packagingWeightOz) && packagingWeightOz > 0 ? packagingWeightOz : 0);
    const effectiveStackHeight = Number.isFinite(stackHeightIn) && stackHeightIn > 0 ? stackHeightIn : heightIn;
    const totalHeightIn = heightIn + (effectiveStackHeight * Math.max(0, resolvedQuantity - 1));

    const qualifies = totalWeightOz > 0 &&
      totalWeightOz <= FIRST_CLASS_FLAT_MAX_WEIGHT_OZ &&
      lengthIn >= FIRST_CLASS_FLAT_MIN_LENGTH_IN &&
      lengthIn <= FIRST_CLASS_FLAT_MAX_LENGTH_IN &&
      widthIn >= FIRST_CLASS_FLAT_MIN_WIDTH_IN &&
      widthIn <= FIRST_CLASS_FLAT_MAX_WIDTH_IN &&
      totalHeightIn > 0 &&
      totalHeightIn <= FIRST_CLASS_FLAT_MAX_HEIGHT_IN;

    if (!qualifies) {
      return null;
    }

    return FIRST_CLASS_FLAT_RATE_TABLE_CENTS[Math.max(1, Math.ceil(totalWeightOz))] ?? null;
  }

  function getCartItemManualDomesticShippingCents(item) {
    return getManualDomesticShippingCentsFromShipping(item?.shipping, item?.quantity || 1);
  }

  function getManualDomesticShippingSummary(items) {
    const normalizedItems = Array.isArray(items) ? items : [];
    const addOnSelections = getCartBundleAddOnSelections(normalizedItems);
    let candidateCount = 0;
    let totalCents = 0;
    let invalid = false;

    for (const item of normalizedItems) {
      if (isAddOnCartItem(item)) continue;
      if (!firstPartyItemIsPhysical(item)) continue;

      const manualCents = getCartItemManualDomesticShippingCents(item);
      if (!Number.isFinite(manualCents) || manualCents < 0) {
        invalid = true;
        continue;
      }
      candidateCount += 1;
      totalCents += manualCents;
    }

    for (const selection of addOnSelections) {
      if (String(selection?.category || '').trim().toLowerCase() !== 'physical') continue;

      const manualCents = getManualDomesticShippingCentsFromShipping(selection?.shipping, selection?.quantity || 1);
      if (!Number.isFinite(manualCents) || manualCents < 0) {
        invalid = true;
        continue;
      }
      candidateCount += 1;
      totalCents += manualCents;
    }

    return { candidateCount, totalCents, invalid };
  }

  function getItemQuantityCap(item) {
    return Number.isFinite(item?.maxQuantity) && item.maxQuantity > 0 ? item.maxQuantity : Infinity;
  }

  function shouldMergeCartItem(existingItem, nextItem) {
    if (!existingItem || !nextItem) return false;
    if (existingItem.id !== nextItem.id) return false;
    if (nextItem.stackable) return true;
    return getItemQuantityCap(nextItem) !== Infinity;
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

  function hasInteractiveCustomFields(button) {
    return getButtonCustomFieldDefinitions(button).some((field) => field.type !== 'hidden');
  }

  function buildButtonShippingMetadata(button) {
    if (!button) return null;

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

    if (!manualDomesticRate &&
      !Number.isFinite(weightOz) &&
      !Number.isFinite(packagingWeightOz) &&
      !Number.isFinite(lengthIn) &&
      !Number.isFinite(widthIn) &&
      !Number.isFinite(heightIn) &&
      !Number.isFinite(stackHeightIn)) {
      return null;
    }

    return {
      ...(manualDomesticRate ? { manual_domestic_rate: manualDomesticRate } : {}),
      ...(Number.isFinite(weightOz) ? { weight_oz: weightOz } : {}),
      ...(Number.isFinite(packagingWeightOz) ? { packaging_weight_oz: packagingWeightOz } : {}),
      ...(Number.isFinite(lengthIn) ? { length_in: lengthIn } : {}),
      ...(Number.isFinite(widthIn) ? { width_in: widthIn } : {}),
      ...(Number.isFinite(heightIn) ? { height_in: heightIn } : {}),
      ...(Number.isFinite(stackHeightIn) ? { stack_height_in: stackHeightIn } : {})
    };
  }

  function buildCartItemFromButton(button) {
    const isStackable = button.getAttribute('data-item-stackable') === 'true' ||
      button.getAttribute('data-item-stackable') === 'always';
    const maxQty = button.getAttribute('data-item-max-quantity');
    const item = {
      id: button.getAttribute('data-item-id'),
      name: button.getAttribute('data-item-name'),
      price: parseFloat(button.getAttribute('data-item-price') || '0'),
      quantity: Math.max(1, parseInt(button.getAttribute('data-item-quantity') || '1', 10) || 1),
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

    const shipping = buildButtonShippingMetadata(button);
    if (shipping) {
      item.shipping = shipping;
    }

    return item;
  }

  function buildPendingCartItemFromButton(button) {
    const isStackable = button.getAttribute('data-item-stackable') === 'true' ||
      button.getAttribute('data-item-stackable') === 'always';
    const maxQty = button.getAttribute('data-item-max-quantity');
    const item = {
      id: button.getAttribute('data-item-id'),
      name: button.getAttribute('data-item-name'),
      price: parseFloat(button.getAttribute('data-item-price') || '0'),
      quantity: Math.max(1, parseInt(button.getAttribute('data-item-quantity') || '1', 10) || 1),
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

    const shipping = buildButtonShippingMetadata(button);
    if (shipping) {
      item.shipping = shipping;
    }

    return item;
  }

  function redirectWindow(url) {
    if (!url) return;

    if (typeof window.location?.assign === 'function') {
      window.location.assign(url);
      return;
    }

    window.location.href = url;
  }

  function calculateCartTotals(items, tipPercent = DEFAULT_PLATFORM_TIP_PERCENT) {
    const subtotal = items.reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.quantity) || 1)), 0);
    const subtotalCents = Math.round(subtotal * 100);
    const nextTipPercent = sanitizeTipPercent(tipPercent, getDefaultPlatformTipPercent());
    const tipAmountCents = Math.round((subtotalCents * nextTipPercent) / 100);
    const shippingCents = getStoreFallbackShippingCents(items);
    const taxCents = 0;

    return {
      subtotal,
      total: (subtotalCents + tipAmountCents + taxCents + shippingCents) / 100
    };
  }

  function formatCurrency(amount) {
    return '$' + (Number(amount || 0)).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatCents(cents) {
    return '$' + (Math.round(Number(cents || 0)) / 100).toFixed(2);
  }

  function renderBusyButtonLabel(label, isBusy) {
    const safeLabel = escapeHtml(String(label || ''));
    if (!isBusy) return safeLabel;
    return `${safeLabel}<span class="store-button-spinner store-button-spinner" aria-hidden="true"></span>`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeInternalHref(value) {
    const href = String(value || '/').trim();
    if (!href) return '/';
    if (href.startsWith('/')) return href;

    try {
      const parsed = new URL(href, window.location.origin);
      if (parsed.origin === window.location.origin || /^https?:$/.test(parsed.protocol)) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch (_error) {}

    return '/';
  }

  function isFirstPartyOrderId(orderId) {
    return /^store-intent-[a-z0-9_-]+$/i.test(String(orderId || ''));
  }

  function sanitizeTipPercent(value, fallback) {
    const max = getMaxPlatformTipPercent();
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= max) {
      return parsed;
    }
    const fallbackParsed = Number(fallback);
    if (Number.isInteger(fallbackParsed) && fallbackParsed >= 0 && fallbackParsed <= max) {
      return fallbackParsed;
    }
    return Math.min(getDefaultPlatformTipPercent(), max);
  }

  function resolveStoredTipPercent(value, touched) {
    if (touched === true) {
      return sanitizeTipPercent(value, getDefaultPlatformTipPercent());
    }
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= getMaxPlatformTipPercent()) {
      return parsed;
    }
    return getDefaultPlatformTipPercent();
  }

  function calculateTax(subtotalCents) {
    return Math.round(Math.max(0, Number(subtotalCents) || 0) * getSalesTaxRate());
  }

  function isAddOnCartItem(item) {
    return String(item?.id || '').trim().startsWith(ADD_ON_ITEM_PREFIX);
  }

  function getCartBundleAddOnSelections(items) {
    if (!ADD_ON_CATALOG.enabled) return [];
    return addOnUtils.selectionsFromCartItems
      ? addOnUtils.selectionsFromCartItems(items, ADD_ON_CATALOG)
      : [];
  }

  function getCartBundleAddOnSelectionKey(selection) {
    return addOnUtils.getSelectionKey
      ? addOnUtils.getSelectionKey(selection)
      : `${String(selection?.productId || '').trim()}::${String(selection?.variantId || '').trim()}`;
  }

  function getCartAddOnOptionLabel(option) {
    return addOnUtils.getOptionLabel
      ? addOnUtils.getOptionLabel(option)
      : String(option?.name || '');
  }

  function firstPartyItemIsPhysical(item) {
    if (item?.shippable === true) return true;

    const fields = Array.isArray(item?.customFields) ? item.customFields : [];
    return fields.some((field) => field?.name === '_category' && field?.value === 'physical');
  }

  function cartRequiresQuotedShipping(items) {
    const normalizedItems = Array.isArray(items) ? items : [];
    const manualSummary = getManualDomesticShippingSummary(normalizedItems);
    if (manualSummary.invalid) {
      return true;
    }

    return manualSummary.candidateCount > 1;
  }

  function getStoreFallbackShippingCents(items) {
    const normalizedItems = Array.isArray(items) ? items : [];
    const addOnSelections = getCartBundleAddOnSelections(normalizedItems);
    const manualSummary = getManualDomesticShippingSummary(normalizedItems);

    if (!manualSummary.invalid && manualSummary.candidateCount === 1) {
      return manualSummary.totalCents;
    }

    const hasPhysicalStoreItem = normalizedItems.some((item) => !isAddOnCartItem(item) && firstPartyItemIsPhysical(item));
    const hasPhysicalAddOn = addOnSelections.some((selection) => String(selection?.category || '').trim().toLowerCase() === 'physical');

    return hasPhysicalStoreItem || hasPhysicalAddOn
      ? getShippingFallbackFeeCents()
      : 0;
  }

  function normalizeAppliedCoupon(coupon) {
    if (!coupon || typeof coupon !== 'object') return null;
    const code = String(coupon.code || '').trim().toUpperCase();
    const discountCents = Math.max(0, Math.round(Number(coupon.discountCents || 0) || 0));
    if (!code || discountCents <= 0) return null;
    return {
      id: String(coupon.id || '').trim(),
      code,
      description: String(coupon.description || '').trim(),
      discountType: String(coupon.discountType || '').trim(),
      percentOff: Number(coupon.percentOff || 0) || 0,
      amountOffCents: Math.max(0, Math.round(Number(coupon.amountOffCents || 0) || 0)),
      appliesTo: String(coupon.appliesTo || '').trim(),
      productIds: Array.isArray(coupon.productIds) ? coupon.productIds : [],
      discountCents
    };
  }

  function normalizeCouponCodeInput(value) {
    return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
  }

  function buildFirstPartyPricing(state) {
    const items = state?.cart?.items?.items || [];
    const subtotalCents = Math.round((Number(state?.cart?.subtotal || 0)) * 100);
    const coupon = normalizeAppliedCoupon(state?.cart?.coupon);
    const discountCents = Math.min(subtotalCents, coupon ? coupon.discountCents : 0);
    const discountedSubtotalCents = Math.max(0, subtotalCents - discountCents);
    const tipPercent = sanitizeTipPercent(state?.cart?.tipPercent, getDefaultPlatformTipPercent());
    const tipAmountCents = Math.round((discountedSubtotalCents * tipPercent) / 100);
    const shippingCents = getStoreFallbackShippingCents(items);
    const taxCents = 0;

    return {
      subtotalCents,
      discountCents,
      discountedSubtotalCents,
      coupon,
      tipPercent,
      tipAmountCents,
      taxCents,
      shippingCents,
      totalCents: discountedSubtotalCents + tipAmountCents + taxCents + shippingCents
    };
  }

  function isCustomCheckoutEstimateActive(state, options) {
    const route = options?.currentRoute;
    if (route !== CHECKOUT_VIEW_ROUTE && route !== CART_VIEW_ROUTE) return false;
    const items = state?.cart?.items?.items || [];
    return cartHasPhysicalItems(items) && cartRequiresQuotedShipping(items);
  }

  function getDisplayedFirstPartyPricing(state, options) {
    const pricing = buildFirstPartyPricing(state);
    const items = state?.cart?.items?.items || [];
    const storeCheckoutCart = cartHasStoreItems(items);
    const totalLabel = getRuntimeMessage('cart.orderTotal', 'Order total');
    const shippingDraft = resolveDisplayedShippingDraft(options);
    const taxState = resolveDisplayedTaxState(state, {
      ...options,
      shippingDraft,
          subtotalCents: pricing.discountedSubtotalCents,
          taxQuote: options?.taxQuote || null
    });
    if (!isCustomCheckoutEstimateActive(state, options)) {
      return {
        ...pricing,
        taxCents: taxState.taxCents,
        taxLabel: taxState.taxLabel,
        taxDisplayValue: taxState.taxDisplayValue,
        shippingLabel: getRuntimeMessage('cart.shipping', 'Shipping'),
        totalLabel: taxState.taxReady
          ? totalLabel
          : getRuntimeMessage('cart.estimatedTotal', 'Estimated total'),
        isShippingEstimate: false,
        showShippingRow: pricing.shippingCents > 0,
        shippingDisplayValue: '',
        totalCents: pricing.discountedSubtotalCents + pricing.tipAmountCents + taxState.taxCents + pricing.shippingCents
      };
    }

    const shippingQuote = options?.shippingQuote || null;
    const cartItems = state?.cart?.items?.items || [];
    const hasPhysicalItems = cartHasPhysicalItems(cartItems);
    const fallbackShippingCents = getStoreFallbackShippingCents(cartItems);
    const requiresQuotedShipping = cartRequiresQuotedShipping(cartItems);
    const quoteStatus = String(shippingQuote?.status || 'idle').trim().toLowerCase();
    const isCalculatingQuote = quoteStatus === 'loading';
    const source = String(shippingQuote?.source || '').trim().toLowerCase();
    const hasEstimateAddress = isShippingPostalCodeQuoteReady(
      String(shippingDraft?.address?.country || '').trim() || DEFAULT_SHIPPING_COUNTRY,
      String(shippingDraft?.address?.postal_code || '').trim()
    );
    const quotedAmountCents = Number.isFinite(Number(shippingQuote?.amountCents))
      ? Math.max(0, Number(shippingQuote.amountCents))
      : null;
    const needsEstimateInput = hasPhysicalItems &&
      requiresQuotedShipping &&
      !hasEstimateAddress;
    const quoteUnavailable = isQuotedShippingUnavailable(
      shippingQuote,
      requiresQuotedShipping,
      hasEstimateAddress
    );
    const shouldFallbackToPhysicalShipping = hasPhysicalItems &&
      !isCalculatingQuote &&
      !needsEstimateInput &&
      !quoteUnavailable &&
      (quotedAmountCents === null || (quotedAmountCents === 0 && (source === '' || source === 'none')));
    const shippingCents = quoteUnavailable
      ? 0
      : shouldFallbackToPhysicalShipping
      ? fallbackShippingCents
      : (needsEstimateInput || (isCalculatingQuote && requiresQuotedShipping))
        ? 0
      : (quotedAmountCents ?? fallbackShippingCents);
    const isEstimate = shouldRenderShippingAsEstimate(shippingQuote) || quoteUnavailable;
    const shippingLabel = (isCalculatingQuote && !requiresQuotedShipping)
      ? getRuntimeMessage('cart.shippingCalculating', 'Calculating shipping...')
      : (isEstimate || needsEstimateInput)
        ? getRuntimeMessage('cart.shippingEstimate', 'Estimated shipping')
        : getRuntimeMessage('cart.shipping', 'Shipping');

    return {
      ...pricing,
      taxCents: taxState.taxCents,
      taxLabel: taxState.taxLabel,
      taxDisplayValue: taxState.taxDisplayValue,
      shippingCents,
      totalCents: pricing.discountedSubtotalCents + pricing.tipAmountCents + taxState.taxCents + shippingCents,
      shippingLabel,
      totalLabel: isCalculatingQuote || isEstimate || needsEstimateInput || quoteUnavailable || !taxState.taxReady
        ? getRuntimeMessage('cart.estimatedTotal', 'Estimated total')
        : totalLabel,
      isShippingEstimate: isCalculatingQuote || isEstimate || needsEstimateInput || quoteUnavailable,
      shippingSource: source,
      showShippingRow: pricing.shippingCents > 0 || needsEstimateInput || isCalculatingQuote,
      shippingDisplayValue: (needsEstimateInput || quoteUnavailable || (isCalculatingQuote && requiresQuotedShipping)) ? '--' : ''
    };
  }

  function getCartShippingOptionMessageKey(optionId) {
    switch (String(optionId || '').trim().toLowerCase()) {
      case 'signature_required':
        return 'cart.shippingOptionSignatureRequired';
      case 'adult_signature_required':
        return 'cart.shippingOptionAdultSignatureRequired';
      case 'standard':
      default:
        return 'cart.shippingOptionStandard';
    }
  }

  function getCartShippingOptionLabel(optionId) {
    switch (String(optionId || '').trim().toLowerCase()) {
      case 'signature_required':
        return getRuntimeMessage('cart.shippingOptionSignatureRequired', 'Signature required');
      case 'adult_signature_required':
        return getRuntimeMessage('cart.shippingOptionAdultSignatureRequired', 'Adult signature required');
      case 'standard':
      default:
        return getRuntimeMessage('cart.shippingOptionStandard', 'Standard');
    }
  }

  function getCartSelectedShippingOptionDetails(shippingQuote) {
    const availableOptions = Array.isArray(shippingQuote?.availableOptions) ? shippingQuote.availableOptions : [];
    const selectedOption = shippingOptionUtils.normalizeSelection(
      availableOptions,
      shippingQuote?.selectedOption,
      shippingQuote?.defaultOption
    );
    return availableOptions.find((option) => option?.id === selectedOption) || null;
  }

  function shouldShowCartShippingOptions(shippingQuote) {
    return shippingOptionUtils.shouldShowOptions({
      ...shippingQuote,
      shippingCents: Number(shippingQuote?.amountCents || 0)
    });
  }

  function shouldRenderShippingAsEstimate(shippingQuote) {
    const source = String(shippingQuote?.source || '').trim().toLowerCase();
    const status = String(shippingQuote?.status || '').trim().toLowerCase();
    return source === 'usps_live' || status === 'loading';
  }

  function isFallbackShippingSource(source) {
    const normalized = String(source || '').trim().toLowerCase();
    return normalized === 'fallback_flat_rate' ||
      normalized === 'fallback_missing_metadata' ||
      normalized.endsWith('_fallback');
  }

  function isQuotedShippingUnavailable(shippingQuote, requiresQuotedShipping, hasEstimateAddress) {
    if (!requiresQuotedShipping || !hasEstimateAddress) return false;

    const status = String(shippingQuote?.status || '').trim().toLowerCase();
    const source = String(shippingQuote?.source || '').trim().toLowerCase();
    return status === 'error' || isFallbackShippingSource(source);
  }

  function formatCartShippingOptionChoice(option) {
    return shippingOptionUtils.formatChoice(option, getCartShippingOptionLabel, formatCents);
  }

  function renderCartShippingOptionChoices(shippingQuote) {
    const availableOptions = Array.isArray(shippingQuote?.availableOptions) ? shippingQuote.availableOptions : [];
    const selectedOption = shippingOptionUtils.normalizeSelection(
      availableOptions,
      shippingQuote?.selectedOption,
      shippingQuote?.defaultOption
    );
    return availableOptions.map((option) => `
      <option value="${escapeAttribute(option.id)}"${option.id === selectedOption ? ' selected' : ''}>${escapeHtml(formatCartShippingOptionChoice(option))}</option>
    `).join('');
  }

  function buildCartShippingQuoteState(data, fallbackShippingCents, currentQuote) {
    const resolvedQuote = shippingOptionUtils.resolveQuote(
      data,
      currentQuote?.selectedOption,
      fallbackShippingCents
    );

    return {
      status: 'ready',
      amountCents: resolvedQuote.shippingCents,
      source: resolvedQuote.source,
      availableOptions: resolvedQuote.availableOptions,
      defaultOption: resolvedQuote.defaultOption,
      selectedOption: resolvedQuote.selectedOption
    };
  }

  function buildCartTaxQuoteState(data, currentQuote) {
    const taxCents = Number.isFinite(Number(data?.taxCents))
      ? Math.max(0, Number(data.taxCents))
      : Math.max(0, Number(currentQuote?.amountCents) || 0);
    return {
      status: 'ready',
      amountCents: taxCents,
      taxDetails: data?.taxDetails && typeof data.taxDetails === 'object'
        ? { ...data.taxDetails }
        : (currentQuote?.taxDetails && typeof currentQuote.taxDetails === 'object' ? { ...currentQuote.taxDetails } : null),
      label: formatTaxLabelFromQuote({
        ...data,
        taxDetails: data?.taxDetails || currentQuote?.taxDetails || null
      })
    };
  }

  function renderCartShippingSummaryValue(
    shippingQuote,
    shippingCents,
    shippingDisplayValue = '',
    amountDataAttribute = 'data-cart-checkout-summary-shipping'
  ) {
    if (!shouldShowCartShippingOptions(shippingQuote)) {
      return `<strong ${amountDataAttribute}>${escapeHtml(shippingDisplayValue || formatCents(shippingCents))}</strong>`;
    }

    return `
      <div class="store-first-party-cart__summary-value store-first-party-cart__summary-value--shipping-option">
        <select id="store-custom-shipping-option" class="store-first-party-cart__input store-first-party-cart__input--select store-first-party-cart__input--summary-select" data-cart-custom-shipping-option aria-label="${escapeAttribute(getRuntimeMessage('cart.shippingOption', 'Delivery option'))}">
          ${renderCartShippingOptionChoices(shippingQuote)}
        </select>
        <strong ${amountDataAttribute}>${escapeHtml(shippingDisplayValue || formatCents(shippingCents))}</strong>
      </div>
    `;
  }

  function renderCartSummaryShippingRow(pricing, shippingQuote) {
    return `
      <div class="store-first-party-cart__summary-row" data-cart-summary-shipping-row>
        <span data-cart-summary-shipping-label>${escapeHtml(pricing.shippingLabel || getRuntimeMessage('cart.shipping', 'Shipping'))}</span>
        <div data-cart-summary-shipping-value>
          ${renderCartShippingSummaryValue(
            shippingQuote,
            pricing.shippingCents,
            pricing.shippingDisplayValue,
            'data-cart-summary-shipping'
          )}
        </div>
      </div>
    `;
  }

  function renderCheckoutSummaryShippingRow(pricing, shippingQuote) {
    return `
      <div class="store-first-party-cart__summary-row" data-cart-checkout-summary-shipping-row>
        <span data-cart-checkout-summary-shipping-label>${escapeHtml(pricing.shippingLabel || getRuntimeMessage('cart.shipping', 'Shipping'))}</span>
        <div data-cart-checkout-summary-shipping-value>
          ${renderCartShippingSummaryValue(shippingQuote, pricing.shippingCents, pricing.shippingDisplayValue)}
        </div>
      </div>
    `;
  }

  function renderCartDiscountSummaryRow(pricing, prefix) {
    if (!pricing || pricing.discountCents <= 0) return '';
    const coupon = pricing.coupon || {};
    const label = coupon.code
      ? getRuntimeMessage('cart.discountWithCode', 'Discount (%{code})').replace('%{code}', coupon.code)
      : getRuntimeMessage('cart.discount', 'Discount');
    const dataPrefix = prefix === 'checkout' ? 'data-cart-checkout-summary' : 'data-cart-summary';
    return `
      <div class="store-first-party-cart__summary-row" ${dataPrefix}-discount-row>
        <span ${dataPrefix}-discount-label>${escapeHtml(label)}</span>
        <strong ${dataPrefix}-discount>-${formatCents(pricing.discountCents)}</strong>
      </div>
    `;
  }

  function renderCartCouponBox(state, pricing) {
    const cart = state?.cart || {};
    const coupon = pricing?.coupon || normalizeAppliedCoupon(cart.coupon);
    const couponCode = normalizeCouponCodeInput(cart.couponCode || coupon?.code || '');
    const status = String(cart.couponStatus || '').trim();
    const error = String(cart.couponError || '').trim();
    const message = error
      ? error
      : coupon
        ? getRuntimeMessage('cart.couponApplied', 'Coupon applied.')
        : '';
    return `
      <form class="store-first-party-cart__coupon" data-cart-coupon-form>
        <label class="store-first-party-cart__section-label" for="store-cart-coupon-code">${escapeHtml(getRuntimeMessage('cart.couponCode', 'Coupon code'))}</label>
        <div class="store-first-party-cart__coupon-row">
          <input
            id="store-cart-coupon-code"
            class="store-first-party-cart__coupon-input"
            type="text"
            autocomplete="off"
            inputmode="text"
            value="${escapeAttribute(couponCode)}"
            aria-describedby="store-cart-coupon-status"
            data-cart-coupon-code
          >
          <button type="submit" class="store-first-party-cart__action store-first-party-cart__action--secondary store-first-party-cart__coupon-apply" data-cart-coupon-apply ${status === 'loading' ? 'disabled aria-busy="true"' : ''}>${escapeHtml(getRuntimeMessage('cart.applyCoupon', 'Apply'))}</button>
          ${coupon ? `<button type="button" class="store-first-party-cart__remove store-first-party-cart__coupon-remove" data-cart-coupon-remove>${escapeHtml(getRuntimeMessage('cart.removeCoupon', 'Remove coupon'))}</button>` : ''}
        </div>
        <p id="store-cart-coupon-status" class="store-first-party-cart__coupon-status${error ? ' is-error' : ''}" role="status" aria-live="polite">${escapeHtml(message)}</p>
      </form>
    `;
  }

  function getPersistedShippingEstimateCountry(shippingDraft, fallbackDraft) {
    const country = String(
      shippingDraft?.address?.country ||
      fallbackDraft?.address?.country ||
      DEFAULT_SHIPPING_COUNTRY
    ).trim().toUpperCase();
    return /^[A-Z]{2}$/.test(country) ? country : DEFAULT_SHIPPING_COUNTRY;
  }

  function getPersistedShippingEstimatePostalCode(shippingDraft, fallbackDraft) {
    return String(
      shippingDraft?.address?.postal_code ||
      fallbackDraft?.address?.postal_code ||
      ''
    ).trim();
  }

  function mergeShippingDraftWithDefaults(nextDraft, shippingDraft, fallbackDraft) {
    const previous = shippingDraft || fallbackDraft || {};
    const previousAddress = previous?.address || {};
    const nextAddress = nextDraft?.address || {};
    return {
      name: String(nextDraft?.name ?? previous?.name ?? '').trim(),
      address: {
        line1: String(nextAddress.line1 ?? previousAddress.line1 ?? '').trim(),
        line2: String(nextAddress.line2 ?? previousAddress.line2 ?? '').trim(),
        city: String(nextAddress.city ?? previousAddress.city ?? '').trim(),
        state: String(nextAddress.state ?? previousAddress.state ?? '').trim(),
        postal_code: String(nextAddress.postal_code ?? previousAddress.postal_code ?? '').trim(),
        country: String(nextAddress.country ?? previousAddress.country ?? DEFAULT_SHIPPING_COUNTRY).trim().toUpperCase() || DEFAULT_SHIPPING_COUNTRY
      }
    };
  }

  function isShippingPostalCodeQuoteReady(country, postalCode) {
    const normalizedCountry = String(country || DEFAULT_SHIPPING_COUNTRY).trim().toUpperCase();
    const normalizedPostal = String(postalCode || '').trim();
    if (!normalizedPostal) return false;

    if (normalizedCountry === 'US') {
      return /^\d{5}(?:-\d{4})?$/.test(normalizedPostal);
    }

    return normalizedPostal.length >= 3;
  }

  function renderCartShippingEstimateField(shippingDraft, fallbackDraft) {
    return `
      <div class="store-first-party-cart__field store-first-party-cart__field--summary" data-cart-shipping-estimate-field>
        <label class="store-first-party-cart__field-label" for="store-cart-estimate-postal">${escapeHtml(getRuntimeMessage('cart.shippingEstimatePostalCode', 'ZIP for shipping estimate'))}</label>
        <input
          id="store-cart-estimate-postal"
          class="store-first-party-cart__input store-first-party-cart__input--summary-postal"
          type="text"
          inputmode="numeric"
          autocomplete="shipping postal-code"
          value="${escapeAttribute(getPersistedShippingEstimatePostalCode(shippingDraft, fallbackDraft))}"
          data-cart-estimate-postal
        >
        <p class="store-first-party-cart__note">${escapeHtml(getRuntimeMessage('cart.shippingEstimatePostalHelp', 'Enter a U.S. ZIP code to estimate shipping before checkout.'))}</p>
      </div>
    `;
  }

  function cartHasPhysicalItems(items) {
    return (items || []).some((item) => {
      if (item?.shippable === true) return true;

      const fields = Array.isArray(item?.customFields) ? item.customFields : [];
      return fields.some((field) => field?.name === '_category' && field?.value === 'physical');
    });
  }

  function shouldDeferPhysicalCustomCheckoutStart(state, options) {
    const items = state?.cart?.items?.items || [];
    if (!cartHasPhysicalItems(items)) return false;
    if (String(options?.checkoutMode || getCheckoutUiMode()).trim().toLowerCase() !== 'custom') return false;
    return !Boolean(options?.hasCustomCheckoutSession);
  }

  function buildCheckoutLineItems(items) {
    return (items || []).map((item) => ({
      name: getCartItemFieldValue(item, '_variant_label')
        ? `${item?.name || item?.id || 'Untitled item'} (${getCartItemFieldValue(item, '_variant_label')})`
        : (item?.name || item?.id || 'Untitled item'),
      quantity: Math.max(1, Number(item?.quantity || 1)),
      showQuantity: item?.stackable === true || Math.max(1, Number(item?.quantity || 1)) > 1,
      amountCents: Math.round((Number(item?.price) || 0) * Math.max(1, Number(item?.quantity || 1)) * 100)
    }));
  }

  function getCartBundleAddOnSelectionsByProduct(items) {
    const selections = getCartBundleAddOnSelections(items);
    const map = new Map();
    selections.forEach((selection) => {
      if (!map.has(selection.productId)) {
        map.set(selection.productId, selection);
      }
    });
    return map;
  }

  function getCartAddOnProductCards(items) {
    const selections = getCartBundleAddOnSelections(items);
    const productCards = addOnUtils.getSuggestedProductStateEntries
      ? addOnUtils.getSuggestedProductStateEntries(ADD_ON_CATALOG, items, selections, addOnInventorySnapshot)
      : addOnUtils.buildProductStateEntries
        ? addOnUtils.buildProductStateEntries(ADD_ON_CATALOG, selections, addOnInventorySnapshot)
      : [];

    return productCards.filter((product) => {
      return !product.inCart;
    });
  }

  function getCartAddOnDraft(product) {
    const existing = cartAddOnDrafts.get(product.productId);
    if (existing) {
      return {
        variantId: String(existing.variantId || product.selectedVariantId || ''),
        quantity: Math.max(1, Number(existing.quantity || 1))
      };
    }

    return {
      variantId: String(product.selectedVariantId || product.variants?.[0]?.id || ''),
      quantity: Math.max(1, Number(product.selectedQuantity || 1))
    };
  }

  function setCartAddOnDraft(productId, draft) {
    cartAddOnDrafts.set(String(productId || ''), {
      variantId: String(draft?.variantId || ''),
      quantity: Math.max(1, Number(draft?.quantity || 1))
    });
  }

  function getCartAddOnSelectedVariant(product, draft) {
    if (product.variants?.length) {
      return product.variants.find((variant) => variant.id === String(draft?.variantId || '')) || product.variants[0] || null;
    }
    return null;
  }

  function renderCartAddOnVariantOptions(product, selectedVariantId) {
    return (product.variants || []).map((variant) => `
      <option
        value="${escapeAttribute(variant.id)}"
        data-max-quantity="${escapeAttribute(String(Math.max(1, Number(variant.maxQuantity ?? 1))))}"
        data-remaining="${escapeAttribute(String(Number.isFinite(Number(variant.remaining)) ? Number(variant.remaining) : ''))}"
        data-low-stock="${variant.lowStock ? 'true' : 'false'}"
        ${variant.id === selectedVariantId ? ' selected' : ''}
      >
        ${escapeHtml(variant.label)}
      </option>
    `).join('');
  }

  function getCartAddOnStockCopy(product, variant) {
    const count = variant ? variant.maxQuantity : product.maxQuantity;
    if (!Number.isFinite(Number(count)) || Number(count) <= 0) return '';
    const isLowStock = variant?.lowStock || product?.lowStock;
    return getRuntimeMessage(
      isLowStock ? 'cart.addOnLowStock' : 'cart.addOnStock',
      isLowStock ? 'Only %{count} left' : '%{count} left'
    ).replace('%{count}', String(count));
  }

  function syncCartAddOnCardVariantState(card) {
    if (!(card instanceof HTMLElement)) return;
    const variantField = card.querySelector('[data-cart-addon-variant]');
    const quantityField = card.querySelector('[data-cart-addon-product-quantity]');
    const statusField = card.querySelector('[data-cart-addon-status]');
    if (!(quantityField instanceof HTMLInputElement)) return;
    if (!(variantField instanceof HTMLSelectElement)) {
      const fallbackMax = Math.max(1, parseInt(quantityField.getAttribute('max') || '1', 10) || 1);
      const currentQuantity = Math.max(1, parseInt(quantityField.value || '1', 10) || 1);
      quantityField.max = String(fallbackMax);
      quantityField.value = String(Math.min(fallbackMax, currentQuantity));
      return;
    }

    const selectedOption = Array.from(variantField.options || []).find((option) => option.value === variantField.value)
      || variantField.selectedOptions?.[0]
      || variantField.options?.[variantField.selectedIndex]
      || null;
    const maxQuantity = Math.max(1, parseInt(selectedOption?.getAttribute('data-max-quantity') || '1', 10) || 1);
    const remaining = parseInt(selectedOption?.getAttribute('data-remaining') || '', 10);
    const isLowStock = selectedOption?.getAttribute('data-low-stock') === 'true';
    const currentQuantity = Math.max(1, parseInt(quantityField.value || '1', 10) || 1);
    quantityField.max = String(maxQuantity);
    quantityField.value = String(Math.min(maxQuantity, currentQuantity));

    if (!(statusField instanceof HTMLElement)) return;
    if (Number.isFinite(remaining) && remaining > 0) {
      statusField.hidden = false;
      statusField.textContent = getRuntimeMessage(
        isLowStock ? 'cart.addOnLowStock' : 'cart.addOnStock',
        isLowStock ? 'Only %{count} left' : '%{count} left'
      ).replace('%{count}', String(remaining));
      statusField.classList.toggle('addon-product-card__status--low-stock', isLowStock);
    } else {
      statusField.hidden = true;
      statusField.textContent = '';
      statusField.classList.remove('addon-product-card__status--low-stock');
    }
  }

  function buildCartAddOnSelectionsFromProductState(items, productId, variantId, quantity) {
    const nextSelections = getCartBundleAddOnSelections(items).filter((selection) => selection.productId !== productId);
    if (quantity > 0) {
      nextSelections.push({ productId, variantId, quantity });
    }
    return nextSelections;
  }

  function renderCartAddOnProductGrid(products) {
    return `
      <div class="addon-product-grid">
        ${products.map((product) => {
          const draft = getCartAddOnDraft(product);
          const selectedVariant = getCartAddOnSelectedVariant(product, draft);
          const maxQuantity = Math.max(1, Number(selectedVariant?.maxQuantity ?? product.maxQuantity ?? 1));
          const stockCopy = getCartAddOnStockCopy(product, selectedVariant);
          const stockClass = (selectedVariant?.lowStock || product.lowStock)
            ? 'addon-product-card__status addon-product-card__status--block addon-product-card__status--low-stock'
            : 'addon-product-card__status addon-product-card__status--block';
          const controlClasses = [
            'addon-product-card__controls',
            product.variants?.length ? 'addon-product-card__controls--with-variant' : ''
          ].filter(Boolean).join(' ');
          return `
            <article class="addon-product-card" data-cart-addon-product="${escapeAttribute(product.productId)}" data-cart-addon-active="false">
              ${product.imageUrl ? `
                <div class="addon-product-card__media">
                  <img class="addon-product-card__image" src="${escapeAttribute(product.imageUrl)}" alt="" loading="lazy" decoding="async">
                </div>
              ` : ''}
              <div class="addon-product-card__main">
                <div class="addon-product-card__header">
                  <strong class="addon-product-card__name">${escapeHtml(product.name)}</strong>
                  <span class="addon-product-card__price">${formatCents(product.priceCents || 0)}</span>
                </div>
                ${product.description ? `<p class="addon-product-card__description">${escapeHtml(product.description)}</p>` : ''}
              </div>
              <p class="${stockClass}" data-cart-addon-status aria-live="polite" ${stockCopy ? '' : 'hidden'}>${escapeHtml(stockCopy)}</p>
              <div class="${controlClasses}">
                ${product.variants?.length ? `
                  <div class="addon-product-card__field addon-product-card__field--variant">
                    <select
                      id="store-cart-addon-variant-${escapeAttribute(product.productId)}"
                      class="store-first-party-cart__input store-first-party-cart__input--select"
                      aria-label="${escapeAttribute(product.variantOptionName || getRuntimeMessage('cart.addOnVariant', 'Variation'))}"
                      data-cart-addon-variant
                      data-addon-product-id="${escapeAttribute(product.productId)}"
                    >
                      ${renderCartAddOnVariantOptions(product, selectedVariant?.id || '')}
                    </select>
                  </div>
                ` : ''}
                <div class="addon-product-card__field addon-product-card__field--qty">
                  <input
                    id="store-cart-addon-qty-${escapeAttribute(product.productId)}"
                    class="store-first-party-cart__input store-first-party-cart__input--addon-qty"
                    type="number"
                    min="1"
                    max="${escapeAttribute(String(maxQuantity))}"
                    step="1"
                    inputmode="numeric"
                    pattern="[0-9]*"
                    aria-label="${escapeAttribute(getRuntimeMessage('cart.quantity', 'Quantity'))}"
                    value="${escapeAttribute(String(Math.min(maxQuantity, Math.max(1, Number(draft.quantity || 1)))))}"
                    data-cart-addon-product-quantity
                    data-addon-product-id="${escapeAttribute(product.productId)}"
                  >
                </div>
              </div>
              <div class="addon-product-card__footer">
                <button
                  type="button"
                  class="btn btn--secondary addon-product-card__button"
                  data-cart-addon-add
                  data-addon-product-id="${escapeAttribute(product.productId)}"
                >${escapeHtml(getRuntimeMessage('cart.addToCart', 'Add to cart'))}</button>
              </div>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderCartAddOnSection(items) {
    if (!ADD_ON_CATALOG.enabled || !ADD_ON_CATALOG.products?.length || !Array.isArray(items) || items.length === 0) {
      return '';
    }
    void ensureCartAddOnInventorySnapshot();
    const platformProductCards = getCartAddOnProductCards(items);
    const supportNote = getRuntimeMessage(
      'cart.platformAddOnsNote',
      'These add-ons ship with your Store order when available.'
    ).replace('%{author}', getPlatformAuthorName());

    if (platformProductCards.length === 0) {
      return '';
    }

    return `
      <section class="store-first-party-cart__callout store-first-party-cart__callout--addons">
        <p class="store-first-party-cart__section-label">${escapeHtml(
          getRuntimeMessage('cart.platformAddOns', 'Add-ons').replace('%{platform}', getPlatformName())
        )}</p>
        <p class="store-first-party-cart__note">${escapeHtml(supportNote)}</p>
        ${renderCartAddOnProductGrid(platformProductCards)}
      </section>
    `;
  }

  function getCurrentPath() {
    return String(window.location?.pathname || '/');
  }

  function formatConfirmationDate(value) {
    if (!value) return '';

    try {
      return new Date(value).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (_error) {
      return '';
    }
  }

  function getCartItemFieldValue(item, fieldName) {
    const fields = Array.isArray(item?.customFields) ? item.customFields : [];
    const normalizedFieldName = String(fieldName || '').trim().toLowerCase();
    const match = fields.find((field) => String(field?.name || '').trim().toLowerCase() === normalizedFieldName);
    return match ? String(match.value || '') : '';
  }

  function getCartItemMetaLines(item) {
    const lines = [];
    const variantLabel = getCartItemFieldValue(item, '_variant_label') || getCartItemFieldValue(item, '_variant');
    if (variantLabel) {
      lines.push(variantLabel);
    }
    return lines;
  }

  function isStoreCartItem(item) {
    return Boolean(
      getCartItemFieldValue(item, '_product_type') ||
      getCartItemFieldValue(item, '_sku')
    );
  }

  function cartHasStoreItems(items) {
    return Array.isArray(items) && items.some((item) => isStoreCartItem(item));
  }

  function cartHasOnlyStoreItems(items) {
    const normalizedItems = Array.isArray(items) ? items : [];
    return normalizedItems.length > 0 && normalizedItems.every((item) => isStoreCartItem(item));
  }

  function parseStoreCartItemId(rawId) {
    const id = String(rawId || '').trim();
    if (!id) return { productId: '', variantId: '', isAddOn: false };

    const addOnMatch = id.match(/^addon__(.+?)(?:__variant__(.+))?$/);
    if (addOnMatch) {
      return {
        productId: String(addOnMatch[1] || '').trim(),
        variantId: String(addOnMatch[2] || '').trim(),
        isAddOn: true
      };
    }

    const marker = id.indexOf('__');
    if (marker >= 0) {
      return {
        productId: id.slice(0, marker),
        variantId: id.slice(marker + 2),
        isAddOn: false
      };
    }

    return { productId: id, variantId: '', isAddOn: false };
  }

  function firstStoreCartValue(values) {
    for (const value of values) {
      const normalized = String(value ?? '').trim();
      if (normalized) return normalized;
    }
    return '';
  }

  function getStoreCartItemProductId(item) {
    const parsedId = parseStoreCartItemId(item?.id);
    return firstStoreCartValue([
      item?.productId,
      item?.product_id,
      getCartItemFieldValue(item, '_product_id'),
      parsedId.productId,
      item?.sku,
      getCartItemFieldValue(item, '_sku')
    ]);
  }

  function getStoreCartItemVariantId(item) {
    const explicitVariantId = getCartItemFieldValue(item, '_variant_id');
    if (explicitVariantId) return explicitVariantId;

    const parsedId = parseStoreCartItemId(item?.id);
    if (parsedId.variantId) return parsedId.variantId;

    return getCartItemFieldValue(item, '_variant');
  }

  function findStoreCatalogProductForCartItem(item) {
    const parsedId = parseStoreCartItemId(item?.id);
    const candidates = [
      item?.productId,
      item?.product_id,
      getCartItemFieldValue(item, '_product_id'),
      parsedId.productId,
      item?.sku,
      getCartItemFieldValue(item, '_sku'),
      item?.id
    ];

    for (const candidate of candidates) {
      const product = addOnUtils.findProduct(ADD_ON_CATALOG, candidate);
      if (product) return product;
    }

    return null;
  }

  function isActiveStoreCatalogStatus(status) {
    const normalized = String(status || 'active').trim().toLowerCase();
    return !normalized || normalized === 'active' || normalized === 'available' || normalized === 'live';
  }

  function hasConfiguredStoreInventory(value) {
    if (value === null || value === undefined || value === '') return false;
    return Number.isFinite(Number(value));
  }

  function isStoreCatalogVariantAvailable(product, variant) {
    if (!variant || !isActiveStoreCatalogStatus(variant.status || product?.status)) return false;
    if (product?.inventory_tracking !== true) return true;
    if (!hasConfiguredStoreInventory(variant.inventory)) return true;
    return Number(variant.inventory) > 0;
  }

  function getDefaultStoreCatalogVariant(product) {
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    if (variants.length === 0) return null;
    return variants.find((variant) => isStoreCatalogVariantAvailable(product, variant)) || variants[0] || null;
  }

  function findStoreCatalogVariant(product, requestedValue) {
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    const requested = String(requestedValue || '').trim().toLowerCase();
    if (!requested || variants.length === 0) return null;

    return variants.find((variant) => [
      variant?.id,
      variant?.sku,
      variant?.label,
      variant?.name
    ].some((candidate) => String(candidate || '').trim().toLowerCase() === requested)) || null;
  }

  function resolveStoreCatalogVariantForCartItem(product, item) {
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    if (variants.length === 0) return null;

    const requested = firstStoreCartValue([
      item?.variantId,
      item?.variant_id,
      getStoreCartItemVariantId(item),
      getCartItemFieldValue(item, '_variant_label'),
      getCartItemFieldValue(item, '_variant')
    ]);
    return findStoreCatalogVariant(product, requested) || getDefaultStoreCatalogVariant(product);
  }

  function upsertCartItemCustomField(fields, name, value) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) return fields;

    const nextFields = Array.isArray(fields)
      ? fields.map((field) => ({ ...field }))
      : [];
    const normalizedLookup = normalizedName.toLowerCase();
    const match = nextFields.find((field) => String(field?.name || '').trim().toLowerCase() === normalizedLookup);
    const normalizedValue = String(value ?? '');

    if (match) {
      match.type = match.type || 'hidden';
      match.value = normalizedValue;
      return nextFields;
    }

    nextFields.push({
      name: normalizedName,
      type: 'hidden',
      value: normalizedValue,
      placeholder: '',
      required: false
    });
    return nextFields;
  }

  function normalizeStoreCatalogCartItem(item, options = {}) {
    const product = findStoreCatalogProductForCartItem(item);
    if (!product) return item;

    const parsedId = parseStoreCartItemId(item?.id);
    const variant = resolveStoreCatalogVariantForCartItem(product, item);
    const variantId = String(variant?.id || '').trim();
    const preserveAddOnId = options.preserveAddOnId === true && parsedId.isAddOn;
    const productId = String(product.id || getStoreCartItemProductId(item)).trim();
    const sku = String(product.sku || productId).trim();
    const fulfillmentType = String(product.fulfillment_type || product.category || getCartItemFieldValue(item, '_product_type') || 'physical').trim();
    const isNonShippable = ['digital', 'ticket', 'rsvp', 'service'].includes(fulfillmentType.toLowerCase());
    const catalogShipping = product.shipping && typeof product.shipping === 'object' ? product.shipping : null;
    const price = Number(variant?.price ?? product.price ?? item?.price ?? 0);
    const normalizedId = preserveAddOnId
      ? String(item?.id || '')
      : (variantId ? `${productId}__${variantId}` : productId);
    let customFields = Array.isArray(item?.customFields) ? item.customFields : [];

    customFields = upsertCartItemCustomField(customFields, '_product_id', productId);
    customFields = upsertCartItemCustomField(customFields, '_sku', sku);
    customFields = upsertCartItemCustomField(customFields, '_product_type', fulfillmentType);
    if (product.type) {
      customFields = upsertCartItemCustomField(customFields, '_merchandising_type', product.type);
    }
    if (variantId) {
      customFields = upsertCartItemCustomField(customFields, '_variant_id', variantId);
      customFields = upsertCartItemCustomField(customFields, '_variant', variant?.label || variantId);
    }

    return {
      ...item,
      id: normalizedId || item?.id,
      name: item?.name || product.name || productId,
      price: Number.isFinite(price) ? price : Number(item?.price || 0),
      url: item?.url || product.source_url || product.url || '',
      imageUrl: item?.imageUrl || item?.image || product.image_url || product.image || '',
      shippable: !isNonShippable,
      shipping: !isNonShippable && catalogShipping ? catalogShipping : item?.shipping,
      customFields
    };
  }

  function buildStoreOrderSuccessPath(orderToken) {
    const normalizedToken = String(orderToken || '').trim();
    return normalizedToken
      ? `${STORE_ORDER_SUCCESS_PATH}?orderToken=${encodeURIComponent(normalizedToken)}`
      : STORE_ORDER_SUCCESS_PATH;
  }

  function buildStoreOrderSuccessUrl(orderToken) {
    try {
      return new URL(buildStoreOrderSuccessPath(orderToken), window.location.origin).href;
    } catch (_error) {
      return buildStoreOrderSuccessPath(orderToken);
    }
  }

  function isStoreOrderId(orderId) {
    return /^store-order-[a-z0-9_-]+$/i.test(String(orderId || '').trim());
  }

  function isStoreOrderSuccessPath() {
    return /^\/(?:[a-z]{2,3}(?:-[a-z0-9]{2,8})?\/)?order-success\/?$/.test(getCurrentPath());
  }

  function buildFirstPartyCheckoutSnapshot(state) {
    const items = state?.cart?.items?.items || [];
    if (items.length === 0) return null;

    return {
      cart: {
        tipPercent: sanitizeTipPercent(state?.cart?.tipPercent, getDefaultPlatformTipPercent()),
        tipTouched: state?.cart?.tipTouched === true,
        couponCode: normalizeCouponCodeInput(state?.cart?.couponCode || state?.cart?.coupon?.code || ''),
        coupon: normalizeAppliedCoupon(state?.cart?.coupon),
        items: items.map((item) => ({
          id: item?.id || '',
          name: item?.name || '',
          price: Number(item?.price || 0),
          quantity: Math.max(1, Number(item?.quantity || 1)),
          url: item?.url || '',
          description: item?.description || '',
          imageUrl: item?.imageUrl || '',
          stackable: item?.stackable === true,
          shippable: item?.shippable === true,
          maxQuantity: Number.isFinite(Number(item?.maxQuantity)) ? Number(item?.maxQuantity) : undefined,
          customFields: Array.isArray(item?.customFields) ? item.customFields : undefined
        }))
      },
      savedAt: Date.now()
    };
  }

  function writeFirstPartyCheckoutSnapshot(state) {
    const snapshot = buildFirstPartyCheckoutSnapshot(state);
    if (!snapshot) return;

    try {
      writeStorageValue(
        getLocalStorageSafe(),
        FIRST_PARTY_CHECKOUT_SNAPSHOT_KEY,
        JSON.stringify(snapshot)
      );
    } catch (_error) {}
  }

  function writeFirstPartyCheckoutSnapshotPayload(snapshot) {
    if (!Array.isArray(snapshot?.cart?.items) || snapshot.cart.items.length === 0) return false;
    try {
      writeStorageValue(
        getLocalStorageSafe(),
        FIRST_PARTY_CHECKOUT_SNAPSHOT_KEY,
        JSON.stringify({
          ...snapshot,
          savedAt: Date.now()
        })
      );
      return true;
    } catch (_error) {
      return false;
    }
  }

  function readFirstPartyCheckoutSnapshot() {
    const storage = getLocalStorageSafe();
    if (!storage) return null;

    try {
      const stored = readStorageValue(storage, FIRST_PARTY_CHECKOUT_SNAPSHOT_KEY);
      const raw = stored.raw;
      if (!raw) return null;

      const snapshot = JSON.parse(raw);
      if (!Array.isArray(snapshot?.cart?.items) || snapshot.cart.items.length === 0) {
        removeStorageValue(storage, FIRST_PARTY_CHECKOUT_SNAPSHOT_KEY);
        return null;
      }

      const savedAt = Number(snapshot?.savedAt || 0);
      if (Number.isFinite(savedAt) && savedAt > 0 && Date.now() - savedAt > FIRST_PARTY_CHECKOUT_SNAPSHOT_TTL_MS) {
        removeStorageValue(storage, FIRST_PARTY_CHECKOUT_SNAPSHOT_KEY);
        return null;
      }

      let didNormalize = false;
      snapshot.cart.items = snapshot.cart.items.map((item) => {
        const normalized = normalizeCartItem(item);
        if (JSON.stringify(normalized) !== JSON.stringify(item)) {
          didNormalize = true;
        }
        return normalized;
      });

      if (didNormalize) {
        try {
          writeStorageValue(
            storage,
            FIRST_PARTY_CHECKOUT_SNAPSHOT_KEY,
            JSON.stringify(snapshot)
          );
        } catch (_error) {}
      }

      return snapshot;
    } catch (_error) {
      return null;
    }
  }

  function buildFirstPartyCartDraftState(state) {
    const email = String(state?.cart?.email || '').trim();
    const billingAddress = state?.cart?.billingAddress && typeof state.cart.billingAddress === 'object'
      ? { ...state.cart.billingAddress }
      : {};
    const customer = state?.customer && typeof state.customer === 'object'
      ? { ...state.customer }
      : {};

    const hasBillingAddress = Object.values(billingAddress).some((value) => String(value || '').trim());
    const hasCustomer = Object.values(customer).some((value) => String(value || '').trim());

    if (!email && !hasBillingAddress && !hasCustomer) {
      return null;
    }

    return {
      email,
      billingAddress,
      customer,
      savedAt: Date.now()
    };
  }

  function writeFirstPartyCartDraftState(state) {
    const storage = getSessionStorageSafe();
    if (!storage) return;

    try {
      const payload = buildFirstPartyCartDraftState(state);
      if (!payload) {
        removeStorageValue(storage, FIRST_PARTY_CART_DRAFT_KEY);
        return;
      }
      writeStorageValue(storage, FIRST_PARTY_CART_DRAFT_KEY, JSON.stringify(payload));
    } catch (_error) {}
  }

  function readFirstPartyCartDraftState() {
    const storage = getSessionStorageSafe();
    if (!storage) return null;

    try {
      const stored = readStorageValue(storage, FIRST_PARTY_CART_DRAFT_KEY);
      const raw = stored.raw;
      if (!raw) return null;
      const draft = JSON.parse(raw);
      const savedAt = Number(draft?.savedAt || 0);
      if (Number.isFinite(savedAt) && savedAt > 0 && Date.now() - savedAt > FIRST_PARTY_CART_DRAFT_TTL_MS) {
        removeStorageValue(storage, FIRST_PARTY_CART_DRAFT_KEY);
        return null;
      }

      return {
        email: String(draft?.email || ''),
        billingAddress: draft?.billingAddress && typeof draft.billingAddress === 'object'
          ? { ...draft.billingAddress }
          : {},
        customer: draft?.customer && typeof draft.customer === 'object'
          ? { ...draft.customer }
          : {}
      };
    } catch (_error) {
      return null;
    }
  }

  function writeFirstPartyCartDraftPayload(draft) {
    const payload = draft && typeof draft === 'object' ? draft : {};
    const hasDraft = String(payload.email || '').trim() ||
      Object.values(payload.billingAddress || {}).some((value) => String(value || '').trim()) ||
      Object.values(payload.customer || {}).some((value) => String(value || '').trim());
    try {
      if (!hasDraft) {
        removeStorageValue(getSessionStorageSafe(), FIRST_PARTY_CART_DRAFT_KEY);
        return true;
      }
      writeStorageValue(getSessionStorageSafe(), FIRST_PARTY_CART_DRAFT_KEY, JSON.stringify({
        email: String(payload.email || ''),
        billingAddress: payload.billingAddress && typeof payload.billingAddress === 'object' ? payload.billingAddress : {},
        customer: payload.customer && typeof payload.customer === 'object' ? payload.customer : {},
        savedAt: Date.now()
      }));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function clearFirstPartyCheckoutSnapshot() {
    try {
      removeStorageValue(getLocalStorageSafe(), FIRST_PARTY_CHECKOUT_SNAPSHOT_KEY);
    } catch (_error) {}
  }

  function writeActiveCustomCheckoutOrderId(orderId) {
    const nextOrderId = String(orderId || '').trim();
    try {
      const sessionStorage = getSessionStorageSafe();
      const localStorage = getLocalStorageSafe();
      writeTimedStorageValue(sessionStorage, ACTIVE_CUSTOM_CHECKOUT_ORDER_ID_KEY, nextOrderId);
      if (localStorage) {
        removeStorageValue(localStorage, ACTIVE_CUSTOM_CHECKOUT_ORDER_ID_KEY);
      }
    } catch (_error) {}
  }

  function readActiveCustomCheckoutOrderId() {
    try {
      const sessionStorage = getSessionStorageSafe();
      const localStorage = getLocalStorageSafe();
      const sessionValue = readTimedStorageValue(
        sessionStorage,
        ACTIVE_CUSTOM_CHECKOUT_ORDER_ID_KEY,
        ACTIVE_CUSTOM_CHECKOUT_ORDER_ID_TTL_MS
      );
      if (sessionValue) return sessionValue;

      const migrated = readTimedStorageValue(
        localStorage,
        ACTIVE_CUSTOM_CHECKOUT_ORDER_ID_KEY,
        ACTIVE_CUSTOM_CHECKOUT_ORDER_ID_TTL_MS
      );
      if (migrated) {
        writeTimedStorageValue(sessionStorage, ACTIVE_CUSTOM_CHECKOUT_ORDER_ID_KEY, migrated);
        removeStorageValue(localStorage, ACTIVE_CUSTOM_CHECKOUT_ORDER_ID_KEY);
      }
      return migrated;
    } catch (_error) {
      return '';
    }
  }

  function setPendingOrderFlag() {
    try {
      const sessionStorage = getSessionStorageSafe();
      writeTimedStorageValue(sessionStorage, PENDING_ORDER_KEY, 'true');

      const localStorage = getLocalStorageSafe();
      removeStorageValue(localStorage, PENDING_ORDER_KEY);
    } catch (_error) {}
  }

  function clearPendingOrderFlag() {
    try {
      const sessionStorage = getSessionStorageSafe();
      removeStorageValue(sessionStorage, PENDING_ORDER_KEY);

      const localStorage = getLocalStorageSafe();
      removeStorageValue(localStorage, PENDING_ORDER_KEY);
    } catch (_error) {}
  }

  function buildPersistedFirstPartyCartState(state) {
    const items = coerceBundleAddOnCartItems(
      Array.isArray(state?.cart?.items?.items) ? state.cart.items.items : []
    );
    if (items.length === 0) return null;

    return {
      token: String(state?.cart?.token || `${FIRST_PARTY_CART_TOKEN_PREFIX}${Date.now().toString(36)}`),
      tipPercent: sanitizeTipPercent(state?.cart?.tipPercent, getDefaultPlatformTipPercent()),
      tipTouched: state?.cart?.tipTouched === true,
      couponCode: normalizeCouponCodeInput(state?.cart?.couponCode || state?.cart?.coupon?.code || ''),
      coupon: normalizeAppliedCoupon(state?.cart?.coupon),
      items: items.map((item) => ({
        id: String(item?.id || ''),
        uniqueId: String(item?.uniqueId || ''),
        name: String(item?.name || ''),
        price: Number(item?.price || 0),
        quantity: Math.max(1, Number(item?.quantity || 1)),
        url: String(item?.url || ''),
        description: String(item?.description || ''),
        imageUrl: String(item?.imageUrl || ''),
        stackable: item?.stackable === true,
        shippable: item?.shippable === true,
        shipping: item?.shipping && typeof item.shipping === 'object'
          ? item.shipping
          : undefined,
        maxQuantity: Number.isFinite(Number(item?.maxQuantity)) ? Number(item?.maxQuantity) : undefined,
        customFields: Array.isArray(item?.customFields) ? item.customFields : undefined
      }))
    };
  }

  function writePersistedFirstPartyCartState(state) {
    try {
      const payload = buildPersistedFirstPartyCartState(state);
      if (!payload) {
        removeStorageValue(getSessionStorageSafe(), FIRST_PARTY_CART_DRAFT_KEY);
        removeStorageValue(getLocalStorageSafe(), FIRST_PARTY_CART_STATE_KEY);
        return;
      }

      writeFirstPartyCartDraftState(state);
      writeStorageValue(getLocalStorageSafe(), FIRST_PARTY_CART_STATE_KEY, JSON.stringify(payload));
    } catch (_error) {}
  }

  function readPersistedFirstPartyCartState() {
    try {
      const storage = getLocalStorageSafe();
      if (!storage) return null;

      const stored = readStorageValue(storage, FIRST_PARTY_CART_STATE_KEY);
      const raw = stored.raw;
      if (!raw) return null;

      const persisted = JSON.parse(raw);
      if (!Array.isArray(persisted?.items) || persisted.items.length === 0) {
        return null;
      }

      let didNormalize = false;
      const items = coerceBundleAddOnCartItems(persisted.items
        .map((item) => {
          const normalized = normalizeCartItem(item);
          if (JSON.stringify(normalized) !== JSON.stringify(item)) {
            didNormalize = true;
          }
          return normalized;
        })
        .filter((item) => item.id));

      if (items.length === 0) {
        return null;
      }

      if (didNormalize) {
        try {
          writeStorageValue(storage, FIRST_PARTY_CART_STATE_KEY, JSON.stringify({
            ...persisted,
            items
          }));
        } catch (_error) {}
      }

      return {
        token: String(persisted?.token || `${FIRST_PARTY_CART_TOKEN_PREFIX}${Date.now().toString(36)}`),
        tipPercent: resolveStoredTipPercent(persisted?.tipPercent, persisted?.tipTouched === true),
        tipTouched: persisted?.tipTouched === true,
        couponCode: normalizeCouponCodeInput(persisted?.couponCode || persisted?.coupon?.code || ''),
        coupon: normalizeAppliedCoupon(persisted?.coupon),
        items
      };
    } catch (_error) {
      return null;
    }
  }

  function clearPersistedFirstPartyCartState() {
    try {
      removeStorageValue(getLocalStorageSafe(), FIRST_PARTY_CART_STATE_KEY);
      removeStorageValue(getSessionStorageSafe(), FIRST_PARTY_CART_DRAFT_KEY);
    } catch (_error) {}
  }

  function getCurrentLang() {
    return getRuntimeConfig()?.i18n?.currentLang || document.documentElement.lang || 'en';
  }

  function coerceBundleAddOnCartItems(items) {
    return Array.isArray(items) ? items : [];
  }

  function buildStoreCheckoutPayload(state) {
    const items = (state?.cart?.items?.items || [])
      .map((item) => normalizeStoreCatalogCartItem(item, { preserveAddOnId: false }));
    if (items.length === 0) {
      return {
        valid: false,
        error: 'Your cart is empty.'
      };
    }

    if (!cartHasOnlyStoreItems(items)) {
      return {
        valid: false,
        error: 'This cart contains an item from an older Store version. Please remove it and add the product again.'
      };
    }

    const checkoutItems = items.map((item) => {
      const customFields = Array.isArray(item?.customFields) ? item.customFields : [];
      const variantId = getStoreCartItemVariantId(item);
      const productId = getStoreCartItemProductId(item);
      return {
        id: String(item?.id || ''),
        productId,
        sku: getCartItemFieldValue(item, '_sku') || productId,
        variantId,
        name: String(item?.name || ''),
        price: Number(item?.price || 0),
        quantity: Math.max(1, Number(item?.quantity || 1)),
        url: String(item?.url || ''),
        image: String(item?.imageUrl || item?.image || ''),
        customFields
      };
    });

    const payload = {
      items: checkoutItems,
      tipPercent: sanitizeTipPercent(state?.cart?.tipPercent, getDefaultPlatformTipPercent()),
      preferredLang: getCurrentLang()
    };
    const couponCode = normalizeCouponCodeInput(state?.cart?.couponCode || state?.cart?.coupon?.code || '');
    if (couponCode) payload.couponCode = couponCode;
    const attribution = readStoreMarketingAttribution();
    if (attribution) {
      payload.attribution = attribution;
    }

    const billingDestination = readReadyTaxDestination(state);
    if (billingDestination) {
      payload.billingAddress = {
        country: billingDestination.country,
        postalCode: billingDestination.postalCode,
        state: billingDestination.state,
        city: billingDestination.city,
        line1: billingDestination.line1,
        line2: billingDestination.line2
      };
    }

    return {
      valid: true,
      kind: 'store',
      endpoint: STORE_CHECKOUT_INTENT_ENDPOINT,
      payload
    };
  }

  function buildFirstPartyCheckoutPayload(state) {
    return buildStoreCheckoutPayload(state);
  }

  function buildFirstPartyInitialState() {
    const persisted = readPersistedFirstPartyCartState();
    const draft = readFirstPartyCartDraftState();
    const persistedItems = persisted?.items || [];
    const persistedTipPercent = resolveStoredTipPercent(persisted?.tipPercent, persisted?.tipTouched === true);
    const persistedTotals = calculateCartTotals(
      persistedItems,
      persistedTipPercent
    );
    const draftEmail = String(draft?.email || '');

    return {
      cart: {
        token: persisted?.token || `${FIRST_PARTY_CART_TOKEN_PREFIX}${Date.now().toString(36)}`,
        paymentSession: {
          publicToken: null
        },
        subtotal: persistedTotals.subtotal || 0,
        total: persistedTotals.total || 0,
        email: draftEmail,
        tipPercent: persistedTipPercent,
        tipTouched: persisted?.tipTouched === true,
        couponCode: persisted?.couponCode || '',
        coupon: persisted?.coupon || null,
        couponStatus: '',
        couponError: '',
        billingAddress: draft?.billingAddress || {},
        items: {
          count: persistedItems.length,
          items: persistedItems
        }
      },
      customer: draft?.customer || (draftEmail ? { email: draftEmail } : {})
    };
  }

  function buildFirstPartyProvider() {
    const eventBus = createEventBus();
    const store = createStore(buildFirstPartyInitialState());
    let currentRoute = null;
    let isCartOpen = false;
    let suppressDrawerRerender = false;
    let activeCustomCheckoutMount = null;
    let customCheckoutShippingQuoteToken = 0;
    let customCheckoutTaxQuoteToken = 0;
    let customCheckoutTaxDraftSyncTimer = 0;
    let pendingCustomCheckoutTaxDraft = null;
    let customCheckoutFlowToken = 0;
    let lastCustomCheckoutShippingSignature = '';
    let persistedCustomCheckoutEmailDraft = '';
    let persistedCustomCheckoutShippingDraft = null;
    let persistedAbandonedCheckoutConsentDraft = false;
    let cartDialogCleanup = null;
    let cartBackgroundUnlock = null;
    let cartReturnFocusTarget = null;
    let cartShouldFocusAfterRender = false;
    let checkoutUiState = {
      status: 'idle',
      error: '',
      mode: getCheckoutUiMode(),
      customCheckout: null
    };

    function emitStateChanged() {
      const state = store.getState();
      store.setState(state);
    }

    function updateCartState(updater) {
      const currentState = store.getState();
      const nextState = updater(currentState);
      store.setState(nextState);
      writePersistedFirstPartyCartState(nextState);
      return nextState;
    }

    function getDisplayedCartSummary() {
      const state = store.getState();
      const pricing = getDisplayedFirstPartyPricing(state, {
        currentRoute,
        checkoutMode: checkoutUiState.mode,
        shippingQuote: checkoutUiState.customCheckout?.shippingQuote,
        taxQuote: checkoutUiState.customCheckout?.taxQuote
      });

      return {
        count: Number(state?.cart?.items?.count || 0),
        total: pricing.totalCents / 100,
        totalCents: pricing.totalCents
      };
    }

    function emitCartSummaryUpdated() {
      eventBus.emit('summary.updated', getDisplayedCartSummary());
    }

    function clearCustomCheckoutTaxDraftSyncTimer() {
      if (!customCheckoutTaxDraftSyncTimer) return;
      window.clearTimeout(customCheckoutTaxDraftSyncTimer);
      customCheckoutTaxDraftSyncTimer = 0;
    }

    function applyCartBundleAddOnSelections(selections) {
      const normalizedSelections = addOnUtils.normalizeSelections
        ? addOnUtils.normalizeSelections(selections, ADD_ON_CATALOG)
        : [];

      const nextState = updateCartState((state) => {
        const currentItems = Array.isArray(state?.cart?.items?.items) ? state.cart.items.items : [];
        const nonAddOnItems = currentItems.filter((item) => !isAddOnCartItem(item));
        const existingAddOnItems = currentItems.filter((item) => isAddOnCartItem(item));
        const existingById = new Map(existingAddOnItems.map((item) => [String(item.id || ''), item]));
        const nextAddOnItems = normalizedSelections
          .map((selection) => addOnUtils.buildCartItem(selection, ADD_ON_CATALOG))
          .filter(Boolean)
          .map((item) => {
            const existingItem = existingById.get(String(item.id || ''));
            return normalizeCartItem({
              ...item,
              uniqueId: existingItem?.uniqueId || item.uniqueId
            });
          });
        const nextItems = coerceBundleAddOnCartItems(nonAddOnItems.concat(nextAddOnItems));
        const totals = calculateCartTotals(
          nextItems,
          state.cart?.tipPercent
        );

        return {
          ...state,
          cart: {
            ...state.cart,
            ...totals,
            couponCode: '',
            coupon: null,
            couponStatus: '',
            couponError: '',
            items: {
              count: nextItems.length,
              items: nextItems
            }
          }
        };
      });

      if (currentRoute === CHECKOUT_VIEW_ROUTE && checkoutUiState.mode === 'custom') {
        refreshCustomCheckoutEstimates();
        syncCheckoutPreviewSummaryUI();
      }

      return nextState;
    }

    function ensureFirstPartyCartRoot() {
      const root = getCartRoot();
      if (!root) return null;

      root.hidden = false;
      root.setAttribute('data-store-cart-root', 'true');
      root.id = 'store-first-party-cart-root';
      root.classList.add('store-first-party-cart-root');
      return root;
    }

    function isFocusableNode(node) {
      return node instanceof HTMLElement &&
        !node.hidden &&
        node.getAttribute('aria-hidden') !== 'true' &&
        !node.closest('[hidden],[aria-hidden="true"]');
    }

    function getFocusableNodes(container) {
      if (!(container instanceof HTMLElement)) return [];

      return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((node) => {
        if (!isFocusableNode(node)) return false;
        if ('disabled' in node && node.disabled) return false;
        return true;
      });
    }

    function rememberCartReturnFocus(node) {
      const target = node instanceof HTMLElement ? node : document.activeElement;
      if (!(target instanceof HTMLElement)) return;
      if (getCartRoot()?.contains(target)) return;
      cartReturnFocusTarget = target;
    }

    function restoreCartReturnFocus() {
      const target = cartReturnFocusTarget;
      if (!(target instanceof HTMLElement)) return;
      if (!target.isConnected) return;
      window.setTimeout(() => {
        if (!(target instanceof HTMLElement) || !target.isConnected) return;
        try {
          target.focus();
        } catch (_error) {}
      }, 0);
    }

    function lockCartBackground(root) {
      Array.from(document.body.children).forEach((child) => {
        if (!(child instanceof HTMLElement) || child === root) return;
        child.setAttribute('data-store-cart-lock', 'true');
        child.setAttribute('data-store-cart-prev-aria-hidden', child.getAttribute('aria-hidden') ?? '__none__');
        child.setAttribute('data-store-cart-prev-inert', child.inert ? 'true' : 'false');
        child.setAttribute('aria-hidden', 'true');
        child.inert = true;
      });

      return function unlockCartBackground() {
        document.querySelectorAll('[data-store-cart-lock="true"]').forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          const ariaHidden = node.getAttribute('data-store-cart-prev-aria-hidden');
          const inert = node.getAttribute('data-store-cart-prev-inert');
          if (ariaHidden === '__none__' || ariaHidden === null) {
            node.removeAttribute('aria-hidden');
          } else {
            node.setAttribute('aria-hidden', ariaHidden);
          }
          node.inert = inert === 'true';
          node.removeAttribute('data-store-cart-lock');
          node.removeAttribute('data-store-cart-prev-aria-hidden');
          node.removeAttribute('data-store-cart-prev-inert');
        });
      };
    }

    function teardownCartDialog() {
      if (typeof cartDialogCleanup === 'function') {
        cartDialogCleanup();
      }
      cartDialogCleanup = null;
      if (typeof cartBackgroundUnlock === 'function') {
        cartBackgroundUnlock();
      }
      cartBackgroundUnlock = null;
    }

    function focusCartDialog(panel) {
      const preferred =
        panel.querySelector('[data-cart-dialog-initial-focus]') ||
        panel.querySelector('[data-cart-close]') ||
        getFocusableNodes(panel)[0] ||
        panel;

      if (!(preferred instanceof HTMLElement)) return;
      try {
        preferred.focus();
      } catch (_error) {}
    }

    function activateCartDialog(root) {
      const panel = root.querySelector('.store-first-party-cart__panel') ||
        root.querySelector('.store-first-party-cart__panel');
      if (!(panel instanceof HTMLElement)) return;

      cartBackgroundUnlock = lockCartBackground(root);
      const handleKeydown = function(event) {
        if (!isCartOpen) return;
        if (!root.contains(panel)) return;

        if (event.key === 'Escape') {
          event.preventDefault();
          requestCloseFirstPartyCart();
          return;
        }

        if (event.key !== 'Tab') return;

        const focusable = getFocusableNodes(panel);
        if (!focusable.length) {
          event.preventDefault();
          panel.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      };

      document.addEventListener('keydown', handleKeydown, true);
      cartDialogCleanup = function() {
        document.removeEventListener('keydown', handleKeydown, true);
      };

      if (cartShouldFocusAfterRender) {
        focusCartDialog(panel);
        cartShouldFocusAfterRender = false;
      }
    }

    function restoreCheckoutFromSnapshot(snapshot) {
      if (!snapshot?.cart?.items?.length) return false;

      const nextItems = snapshot.cart.items.map((item) => normalizeCartItem(item));
      const draft = readFirstPartyCartDraftState();
      const nextEmail = String(draft?.email || snapshot?.cart?.email || '');
      const nextTipPercent = resolveStoredTipPercent(snapshot?.cart?.tipPercent, snapshot?.cart?.tipTouched === true);
      const totals = calculateCartTotals(
        nextItems,
        nextTipPercent
      );

      store.setState({
        ...store.getState(),
        customer: {
          ...store.getState().customer,
          ...(draft?.customer || {}),
          email: nextEmail
        },
        cart: {
          ...store.getState().cart,
          ...totals,
          email: nextEmail,
          tipPercent: nextTipPercent,
          tipTouched: snapshot?.cart?.tipTouched === true,
          couponCode: normalizeCouponCodeInput(snapshot?.cart?.couponCode || snapshot?.cart?.coupon?.code || ''),
          coupon: normalizeAppliedCoupon(snapshot?.cart?.coupon),
          couponStatus: '',
          couponError: '',
          billingAddress: draft?.billingAddress || store.getState().cart?.billingAddress || {},
          items: {
            count: nextItems.length,
            items: nextItems
          }
        }
      });
      writePersistedFirstPartyCartState(store.getState());

      return true;
    }

    function restoreSavedCheckoutIntoCartState() {
      return false;
    }

    function renderFirstPartyCart() {
      const root = ensureFirstPartyCartRoot();
      document.documentElement.classList.toggle('store-cart-open', Boolean(root) && isCartOpen);
      document.body.classList.toggle('store-cart-open', Boolean(root) && isCartOpen);
      document.documentElement.classList.toggle('store-cart-open', Boolean(root) && isCartOpen);
      document.body.classList.toggle('store-cart-open', Boolean(root) && isCartOpen);
      if (!root) return;

      if (!isCartOpen) {
        teardownCartDialog();
        teardownActiveCustomCheckoutMount();
        root.innerHTML = '';
        root.setAttribute('aria-hidden', 'true');
        return;
      }

      teardownCartDialog();

      const state = store.getState();
      const items = state.cart.items.items || [];
      const total = Number(state.cart.total || 0);
      const isCheckoutPreview = currentRoute === CHECKOUT_VIEW_ROUTE;
      const isFirstPartyCheckoutEnabled = getRequestedCheckoutProvider() === FIRST_PARTY_CHECKOUT_PROVIDER;
      const pricing = getDisplayedFirstPartyPricing(state, {
        currentRoute,
        checkoutMode: checkoutUiState.mode,
        shippingQuote: checkoutUiState.customCheckout?.shippingQuote,
        taxQuote: checkoutUiState.customCheckout?.taxQuote
      });
      const hasPhysicalItems = cartHasPhysicalItems(items);
      const checkoutLineItems = buildCheckoutLineItems(items);
      const wantsCustomCheckout = isCheckoutPreview &&
        isFirstPartyCheckoutEnabled &&
        getCheckoutUiMode() === 'custom';
      const isCustomCheckout = wantsCustomCheckout && checkoutUiState.mode === 'custom';
      const customCheckout = checkoutUiState.customCheckout || {};
      const hasCustomCheckoutSession = Boolean(customCheckout?.sessionId || customCheckout?.clientSecret);
      const taxLocationDraft = normalizeTaxDestination(getStoredBillingAddress(state));
      const requiresDetailedTaxLocation = taxDestinationNeedsDetailedStreetAddress(taxLocationDraft);
      const isDeferredCustomCheckoutStart = shouldDeferPhysicalCustomCheckoutStart(state, {
        currentRoute,
        checkoutMode: checkoutUiState.mode,
        hasCustomCheckoutSession: Boolean(checkoutUiState.customCheckout?.sessionId || checkoutUiState.customCheckout?.clientSecret)
      });
      const requiresTaxLocation = cartRequiresCustomCheckoutTaxLocation(state);
      const hasReadyTaxLocation = Boolean(readReadyTaxDestination(state));
      const showCustomCheckoutConfirmButton = wantsCustomCheckout &&
        !isDeferredCustomCheckoutStart &&
        (hasCustomCheckoutSession || (isCustomCheckout && !requiresTaxLocation));
      const checkoutErrorMarkup = `
        <p class="store-first-party-cart__error" data-cart-checkout-error role="alert" ${checkoutUiState.error ? '' : 'hidden'}>${escapeHtml(checkoutUiState.error || '')}</p>
      `;
      const abandonedReminderMarkup = `
        <label class="store-first-party-cart__checkbox store-first-party-cart__reminder">
          <input type="checkbox" ${readAbandonedCheckoutConsentDraft() ? 'checked' : ''} data-cart-abandoned-consent>
          <span>${escapeHtml(getRuntimeMessage('cart.checkoutReminderConsent', 'Email me one reminder if I leave checkout.'))}</span>
        </label>
      `;
      const customCheckoutMarkup = wantsCustomCheckout ? `
        ${hasPhysicalItems ? `
          <div class="store-first-party-cart__callout store-first-party-cart__callout--stripe">
            <p class="store-first-party-cart__section-label">${escapeHtml(getRuntimeMessage('cart.shippingAddress', 'Contact & Shipping address'))}</p>
            <div class="store-first-party-cart__shipping-fallback store-first-party-cart__shipping-fallback--plain" data-cart-custom-shipping-fallback>
              <div class="store-first-party-cart__shipping-grid">
                <div class="store-first-party-cart__field store-first-party-cart__field--full">
                  <label class="store-first-party-cart__field-label" for="store-custom-shipping-name">${escapeHtml(getRuntimeMessage('cart.fullName', 'Full name'))} <span class="store-first-party-cart__required-mark" aria-hidden="true">*</span></label>
                  <input id="store-custom-shipping-name" name="shipping-name" class="store-first-party-cart__input" type="text" autocomplete="section-store-checkout shipping name" autocapitalize="words" aria-describedby="store-custom-shipping-error" aria-invalid="${customCheckout?.shippingError ? 'true' : 'false'}" value="${escapeHtml(getPersistedCustomCheckoutShippingDraft()?.name || '')}" data-cart-custom-shipping-field="name">
                </div>
                <div class="store-first-party-cart__field store-first-party-cart__field--full">
                  <label class="store-first-party-cart__field-label" for="store-custom-checkout-email-fallback">${escapeHtml(getRuntimeMessage('cart.emailAddress', 'Email address'))} <span class="store-first-party-cart__required-mark" aria-hidden="true">*</span></label>
                  <input
                    id="store-custom-checkout-email-fallback"
                    name="checkout-email"
                    class="store-first-party-cart__input"
                    type="email"
                    inputmode="email"
                    autocomplete="section-store-checkout email"
                    autocapitalize="off"
                    spellcheck="false"
                    aria-describedby="store-custom-checkout-email-error"
                    value="${escapeHtml(getPersistedCustomCheckoutEmailDraft())}"
                    data-cart-custom-checkout-email
                  >
                  <p id="store-custom-checkout-email-error" class="store-first-party-cart__field-error" data-cart-custom-checkout-email-error ${customCheckout?.emailError ? '' : 'hidden'}>${escapeHtml(customCheckout?.emailError || '')}</p>
                  ${abandonedReminderMarkup}
                </div>
                <div class="store-first-party-cart__field store-first-party-cart__field--full">
                  <label class="store-first-party-cart__field-label" for="store-custom-shipping-line1">${escapeHtml(getRuntimeMessage('cart.addressLine1', 'Address line 1'))} <span class="store-first-party-cart__required-mark" aria-hidden="true">*</span></label>
                  <input id="store-custom-shipping-line1" name="shipping-address-line1" class="store-first-party-cart__input" type="text" autocomplete="section-store-checkout shipping address-line1" autocapitalize="words" aria-describedby="store-custom-shipping-error" aria-invalid="${customCheckout?.shippingError ? 'true' : 'false'}" value="${escapeHtml(getPersistedCustomCheckoutShippingDraft()?.address?.line1 || '')}" data-cart-custom-shipping-field="line1">
                </div>
                <div class="store-first-party-cart__field store-first-party-cart__field--full">
                  <label class="store-first-party-cart__field-label" for="store-custom-shipping-line2">${escapeHtml(getRuntimeMessage('cart.addressLine2', 'Address line 2'))}</label>
                  <input id="store-custom-shipping-line2" name="shipping-address-line2" class="store-first-party-cart__input" type="text" autocomplete="section-store-checkout shipping address-line2" autocapitalize="words" aria-describedby="store-custom-shipping-error" aria-invalid="${customCheckout?.shippingError ? 'true' : 'false'}" value="${escapeHtml(getPersistedCustomCheckoutShippingDraft()?.address?.line2 || '')}" data-cart-custom-shipping-field="line2">
                </div>
                <div class="store-first-party-cart__field">
                  <label class="store-first-party-cart__field-label" for="store-custom-shipping-city">${escapeHtml(getRuntimeMessage('cart.city', 'City'))} <span class="store-first-party-cart__required-mark" aria-hidden="true">*</span></label>
                  <input id="store-custom-shipping-city" name="shipping-address-level2" class="store-first-party-cart__input" type="text" autocomplete="section-store-checkout shipping address-level2" autocapitalize="words" aria-describedby="store-custom-shipping-error" aria-invalid="${customCheckout?.shippingError ? 'true' : 'false'}" value="${escapeHtml(getPersistedCustomCheckoutShippingDraft()?.address?.city || '')}" data-cart-custom-shipping-field="city">
                </div>
                <div class="store-first-party-cart__field">
                  <label class="store-first-party-cart__field-label" for="store-custom-shipping-state">${escapeHtml(getRuntimeMessage('cart.stateProvince', 'State / Province'))} <span class="store-first-party-cart__required-mark" aria-hidden="true">*</span></label>
                  <input id="store-custom-shipping-state" name="shipping-address-level1" class="store-first-party-cart__input" type="text" autocomplete="section-store-checkout shipping address-level1" autocapitalize="characters" aria-describedby="store-custom-shipping-error" aria-invalid="${customCheckout?.shippingError ? 'true' : 'false'}" value="${escapeHtml(getPersistedCustomCheckoutShippingDraft()?.address?.state || '')}" data-cart-custom-shipping-field="state">
                </div>
                <div class="store-first-party-cart__field">
                  <label class="store-first-party-cart__field-label" for="store-custom-shipping-postal">${escapeHtml(getRuntimeMessage('cart.postalCode', 'Postal code'))} <span class="store-first-party-cart__required-mark" aria-hidden="true">*</span></label>
                  <input id="store-custom-shipping-postal" name="shipping-postal-code" class="store-first-party-cart__input" type="text" inputmode="numeric" autocomplete="section-store-checkout shipping postal-code" aria-describedby="store-custom-shipping-error" aria-invalid="${customCheckout?.shippingError ? 'true' : 'false'}" value="${escapeHtml(getPersistedCustomCheckoutShippingDraft()?.address?.postal_code || '')}" data-cart-custom-shipping-field="postal_code">
                </div>
                <div class="store-first-party-cart__field">
                  <label class="store-first-party-cart__field-label" for="store-custom-shipping-country">${escapeHtml(getRuntimeMessage('cart.country', 'Country'))} <span class="store-first-party-cart__required-mark" aria-hidden="true">*</span></label>
                  <select id="store-custom-shipping-country" name="shipping-country" class="store-first-party-cart__input store-first-party-cart__input--select" autocomplete="section-store-checkout shipping country" aria-describedby="store-custom-shipping-error" aria-invalid="${customCheckout?.shippingError ? 'true' : 'false'}" data-cart-custom-shipping-field="country">
                    ${renderShippingCountryOptions(getPersistedCustomCheckoutShippingDraft()?.address?.country || DEFAULT_SHIPPING_COUNTRY)}
                  </select>
                </div>
              </div>
              <p id="store-custom-shipping-error" class="store-first-party-cart__field-error" data-cart-custom-shipping-error role="alert" ${customCheckout?.shippingError ? '' : 'hidden'}>${escapeHtml(customCheckout?.shippingError || '')}</p>
            </div>
          </div>
        ` : `
          <div class="store-first-party-cart__callout store-first-party-cart__callout--stripe">
            <p class="store-first-party-cart__section-label">${escapeHtml(getRuntimeMessage('cart.contact', 'Contact'))}</p>
            <div class="store-first-party-cart__stripe-shell">
              <div class="store-first-party-cart__field store-first-party-cart__field--compact" data-cart-custom-checkout-email-fallback>
                <label class="store-first-party-cart__field-label" for="store-custom-checkout-email">${escapeHtml(getRuntimeMessage('cart.emailAddress', 'Email address'))} <span class="store-first-party-cart__required-mark" aria-hidden="true">*</span></label>
                  <input
                    id="store-custom-checkout-email"
                    name="checkout-email"
                    class="store-first-party-cart__input"
                    type="email"
                    inputmode="email"
                    autocomplete="section-store-checkout email"
                    aria-describedby="store-custom-checkout-email-error"
                    value="${escapeHtml(getPersistedCustomCheckoutEmailDraft())}"
                    data-cart-custom-checkout-email
                  >
                <p id="store-custom-checkout-email-error" class="store-first-party-cart__field-error" data-cart-custom-checkout-email-error ${customCheckout?.emailError ? '' : 'hidden'}>${escapeHtml(customCheckout?.emailError || '')}</p>
                ${abandonedReminderMarkup}
              </div>
            </div>
          </div>
          ${!hasCustomCheckoutSession ? `
            <div class="store-first-party-cart__callout store-first-party-cart__callout--stripe">
              <p class="store-first-party-cart__section-label">${escapeHtml(getRuntimeMessage('cart.taxLocation', 'Tax location'))}</p>
              <div class="store-first-party-cart__stripe-shell">
                <p class="store-first-party-cart__note" data-cart-tax-location-note>${escapeHtml(getTaxLocationNote(taxLocationDraft))}</p>
                <div class="store-first-party-cart__shipping-grid">
                  <div class="store-first-party-cart__field store-first-party-cart__field--full">
                    <label class="store-first-party-cart__field-label" for="store-custom-tax-line1">${escapeHtml(getRuntimeMessage('cart.addressLine1', 'Address line 1'))}${requiresDetailedTaxLocation ? ' <span class="store-first-party-cart__required-mark" aria-hidden="true">*</span>' : ''}</label>
                    <input id="store-custom-tax-line1" name="billing-address-line1" class="store-first-party-cart__input" type="text" autocomplete="section-store-checkout billing address-line1" autocapitalize="words" aria-describedby="store-custom-tax-error" aria-invalid="${customCheckout?.taxError ? 'true' : 'false'}" value="${escapeHtml(getStoredBillingAddress(state)?.line1 || '')}" data-cart-tax-destination-field="line1">
                  </div>
                  <div class="store-first-party-cart__field store-first-party-cart__field--full">
                    <label class="store-first-party-cart__field-label" for="store-custom-tax-line2">${escapeHtml(getRuntimeMessage('cart.addressLine2', 'Address line 2'))}</label>
                    <input id="store-custom-tax-line2" name="billing-address-line2" class="store-first-party-cart__input" type="text" autocomplete="section-store-checkout billing address-line2" autocapitalize="words" aria-describedby="store-custom-tax-error" aria-invalid="${customCheckout?.taxError ? 'true' : 'false'}" value="${escapeHtml(getStoredBillingAddress(state)?.line2 || '')}" data-cart-tax-destination-field="line2">
                  </div>
                  <div class="store-first-party-cart__field">
                    <label class="store-first-party-cart__field-label" for="store-custom-tax-country">${escapeHtml(getRuntimeMessage('cart.country', 'Country'))} <span class="store-first-party-cart__required-mark" aria-hidden="true">*</span></label>
                    <select id="store-custom-tax-country" name="billing-country" class="store-first-party-cart__input store-first-party-cart__input--select" autocomplete="section-store-checkout billing country" aria-describedby="store-custom-tax-error" aria-invalid="${customCheckout?.taxError ? 'true' : 'false'}" data-cart-tax-destination-field="country">
                      ${renderShippingCountryOptions(getStoredBillingAddress(state)?.country || DEFAULT_SHIPPING_COUNTRY)}
                    </select>
                  </div>
                  <div class="store-first-party-cart__field">
                    <label class="store-first-party-cart__field-label" for="store-custom-tax-city">${escapeHtml(getRuntimeMessage('cart.city', 'City'))}${requiresDetailedTaxLocation ? ' <span class="store-first-party-cart__required-mark" aria-hidden="true">*</span>' : ''}</label>
                    <input id="store-custom-tax-city" name="billing-address-level2" class="store-first-party-cart__input" type="text" autocomplete="section-store-checkout billing address-level2" autocapitalize="words" aria-describedby="store-custom-tax-error" aria-invalid="${customCheckout?.taxError ? 'true' : 'false'}" value="${escapeHtml(getStoredBillingAddress(state)?.city || '')}" data-cart-tax-destination-field="city">
                  </div>
                  <div class="store-first-party-cart__field">
                    <label class="store-first-party-cart__field-label" for="store-custom-tax-postal">${escapeHtml(getRuntimeMessage('cart.postalCode', 'Postal code'))} <span class="store-first-party-cart__required-mark" aria-hidden="true">*</span></label>
                    <input id="store-custom-tax-postal" name="billing-postal-code" class="store-first-party-cart__input" type="text" inputmode="text" autocomplete="section-store-checkout billing postal-code" aria-describedby="store-custom-tax-error" aria-invalid="${customCheckout?.taxError ? 'true' : 'false'}" value="${escapeHtml(getStoredBillingAddress(state)?.postal_code || getStoredBillingAddress(state)?.postalCode || '')}" data-cart-tax-destination-field="postal_code">
                  </div>
                  <div class="store-first-party-cart__field">
                    <label class="store-first-party-cart__field-label" for="store-custom-tax-state">${escapeHtml(requiresDetailedTaxLocation ? getRuntimeMessage('cart.stateProvince', 'State / Province') : getRuntimeMessage('cart.stateProvinceOptional', 'State / Province (optional)'))}${requiresDetailedTaxLocation ? ' <span class="store-first-party-cart__required-mark" aria-hidden="true">*</span>' : ''}</label>
                    <input id="store-custom-tax-state" name="billing-address-level1" class="store-first-party-cart__input" type="text" autocomplete="section-store-checkout billing address-level1" autocapitalize="characters" aria-describedby="store-custom-tax-error" aria-invalid="${customCheckout?.taxError ? 'true' : 'false'}" value="${escapeHtml(getStoredBillingAddress(state)?.state || '')}" data-cart-tax-destination-field="state">
                  </div>
                </div>
                <p id="store-custom-tax-error" class="store-first-party-cart__field-error" data-cart-custom-tax-error role="alert" ${customCheckout?.taxError ? '' : 'hidden'}>${escapeHtml(customCheckout?.taxError || '')}</p>
              </div>
            </div>
          ` : ''}
        `}
        <div class="store-first-party-cart__callout store-first-party-cart__callout--stripe">
          <p class="store-first-party-cart__section-label">${escapeHtml(getRuntimeMessage('cart.paymentMethod', 'Payment method'))}</p>
          <div class="store-first-party-cart__stripe-shell">
            <div class="store-first-party-cart__stripe-region store-first-party-cart__stripe-region--payment" data-cart-custom-checkout-region="payment"></div>
          </div>
          <p class="store-first-party-cart__note store-first-party-cart__note--payment-consent">${escapeHtml(getRuntimeMessage('cart.storePaymentConsent', 'Your payment is processed securely by Stripe.'))}</p>
        </div>
      ` : `
        <div class="store-first-party-cart__callout">
          <p class="store-first-party-cart__section-label">${escapeHtml(getRuntimeMessage('cart.nextStep', 'Next step'))}</p>
          <p class="store-first-party-cart__note">${escapeHtml(getRuntimeMessage('cart.hostedCheckoutNote', "Continue to Stripe's secure payment platform to enter your payment information and email address."))}</p>
        </div>
      `;
      const itemMarkup = items.length > 0 ? items.map((item) => {
        const metaLines = getCartItemMetaLines(item);
        const itemQuantity = Math.max(1, Number(item.quantity || 1));
        const itemMaxQuantity = getItemQuantityCap(item);
        const hasFiniteMaxQuantity = Number.isFinite(itemMaxQuantity);
        return `
        <li class="store-first-party-cart__item" data-item-id="${item.uniqueId}">
          ${item.imageUrl ? `
            <div class="store-first-party-cart__item-media">
              <img class="store-first-party-cart__item-image" src="${escapeAttribute(item.imageUrl)}" alt="" loading="lazy" decoding="async">
            </div>
          ` : ''}
          <div class="store-first-party-cart__item-main">
            <strong class="store-first-party-cart__item-name">${escapeHtml(item.name || item.id || getRuntimeMessage('cart.untitledItem', 'Untitled item'))}</strong>
            ${item.description ? `<p class="store-first-party-cart__item-description">${escapeHtml(item.description)}</p>` : ''}
            ${metaLines.map((line) => `<span class="store-first-party-cart__item-meta">${escapeHtml(line)}</span>`).join('')}
          </div>
          <div class="store-first-party-cart__item-actions">
            <span class="store-first-party-cart__item-price">${formatCurrency((item.price || 0) * itemQuantity)}</span>
            <div class="store-first-party-cart__quantity" aria-label="${escapeAttribute(getRuntimeMessage('cart.quantity', 'Quantity'))}">
              <button type="button" class="store-first-party-cart__quantity-button" data-cart-item-quantity-step="-1" data-cart-item-id="${escapeAttribute(item.uniqueId)}" aria-label="${escapeAttribute(getRuntimeMessage('cart.decreaseQuantity', 'Decrease quantity'))}"${itemQuantity <= 1 ? ' disabled' : ''}>-</button>
              <input class="store-first-party-cart__quantity-input" type="number" inputmode="numeric" min="1"${hasFiniteMaxQuantity ? ` max="${escapeAttribute(String(itemMaxQuantity))}"` : ''} value="${escapeAttribute(String(itemQuantity))}" data-cart-item-quantity data-cart-item-id="${escapeAttribute(item.uniqueId)}" aria-label="${escapeAttribute(getRuntimeMessage('cart.quantity', 'Quantity'))}">
              <button type="button" class="store-first-party-cart__quantity-button" data-cart-item-quantity-step="1" data-cart-item-id="${escapeAttribute(item.uniqueId)}" aria-label="${escapeAttribute(getRuntimeMessage('cart.increaseQuantity', 'Increase quantity'))}"${hasFiniteMaxQuantity && itemQuantity >= itemMaxQuantity ? ' disabled' : ''}>+</button>
            </div>
            <button type="button" class="store-first-party-cart__remove" data-remove-item="${item.uniqueId}">${escapeHtml(getRuntimeMessage('cart.remove', 'Remove'))}</button>
          </div>
        </li>
      `;
      }).join('') : `
        <li class="store-first-party-cart__empty">${escapeHtml(getRuntimeMessage('cart.empty', 'Your cart is empty.'))}</li>
      `;
      const cartEstimateMarkup = items.length > 0 ? `
        <div class="store-first-party-cart__tip-box">
          <div class="store-first-party-cart__tip-header">
            <strong id="store-cart-tip-label">${escapeHtml(getRuntimeMessage('cart.tipLabel', `Tip ${getPlatformCompanyName()} for platform maintenance.`))}</strong>
            <span id="store-cart-tip-amount" data-cart-tip-amount>${formatCents(pricing.tipAmountCents)}</span>
          </div>
          <p class="store-first-party-cart__tip-copy" id="store-cart-tip-copy">${escapeHtml(getRuntimeMessage('cart.tipCopy', `Optional tips help keep ${getPlatformCompanyName()} doing its thing.`))}</p>
          <div class="store-first-party-cart__tip-controls">
            <input
              id="store-cart-tip-input"
              class="store-first-party-cart__tip-slider"
              type="range"
              min="0"
              max="${getMaxPlatformTipPercent()}"
              step="1"
              value="${pricing.tipPercent}"
              aria-labelledby="store-cart-tip-label"
              aria-describedby="store-cart-tip-copy store-cart-tip-percent"
              aria-valuetext="${escapeAttribute(formatTipSliderValueText(pricing.tipPercent, pricing.tipAmountCents))}"
              data-cart-tip
            >
            <span class="store-first-party-cart__tip-percent" id="store-cart-tip-percent" data-cart-tip-percent>${pricing.tipPercent}%</span>
          </div>
        </div>
        ${cartRequiresQuotedShipping(items)
          ? renderCartShippingEstimateField(customCheckout?.shippingDraft, persistedCustomCheckoutShippingDraft)
          : ''}
        ${renderCartCouponBox(state, pricing)}
        <section class="store-first-party-cart__callout">
          <p class="store-first-party-cart__section-label">${escapeHtml(getRuntimeMessage('cart.orderTotal', 'Order total'))}</p>
          <div class="store-first-party-cart__checkout-summary">
            <div class="store-first-party-cart__summary-row">
              <span>${escapeHtml(getRuntimeMessage('cart.subtotal', 'Subtotal'))}</span>
              <strong data-cart-summary-subtotal>${formatCents(pricing.subtotalCents)}</strong>
            </div>
            ${renderCartDiscountSummaryRow(pricing, 'cart')}
            ${pricing.tipAmountCents > 0 ? `
              <div class="store-first-party-cart__summary-row" data-cart-summary-tip-row>
                <span data-cart-summary-tip-label>${escapeHtml(getRuntimeMessage('cart.tipWithPercent', '%{platform} tip (%{percent}%)').replace('%{platform}', getPlatformCompanyName()).replace('%{percent}', String(pricing.tipPercent)))}</span>
                <strong data-cart-summary-tip-amount>${formatCents(pricing.tipAmountCents)}</strong>
              </div>
            ` : ''}
            <div class="store-first-party-cart__summary-row">
              <span data-cart-summary-tax-label>${escapeHtml(pricing.taxLabel || formatTaxRateLabel())}</span>
              <strong data-cart-summary-tax>${escapeHtml(pricing.taxDisplayValue || formatCents(pricing.taxCents))}</strong>
            </div>
            ${pricing.showShippingRow ? renderCartSummaryShippingRow(pricing, customCheckout?.shippingQuote) : ''}
            <div class="store-first-party-cart__summary-row store-first-party-cart__summary-row--total">
              <span data-cart-summary-total-label>${escapeHtml(pricing.totalLabel || getRuntimeMessage('cart.orderTotal', 'Order total'))}</span>
              <strong data-cart-summary-total>${formatCents(pricing.totalCents)}</strong>
            </div>
          </div>
        </section>
      ` : '';
      const cartAddOnMarkup = renderCartAddOnSection(items);
      const bodyMarkup = isCheckoutPreview ? `
        <section class="store-first-party-cart__checkout-preview">
          <div class="store-first-party-cart__summary-block">
            <div class="store-first-party-cart__line-items">
              <p class="store-first-party-cart__section-label">${escapeHtml(getRuntimeMessage('cart.orderSummary', 'Order summary'))}</p>
              <ul class="store-first-party-cart__line-item-list">
                ${checkoutLineItems.map((item) => `
                  <li class="store-first-party-cart__line-item">
                    <div>
                      <strong class="store-first-party-cart__line-item-name">${escapeHtml(item.name)}</strong>
                      ${item.showQuantity ? `<span>${escapeHtml(getRuntimeMessage('cart.quantity', 'Qty %{count}').replace('%{count}', String(item.quantity)))}</span>` : ''}
                    </div>
                    <strong class="store-first-party-cart__line-item-amount">${formatCents(item.amountCents)}</strong>
                  </li>
                `).join('')}
              </ul>
            </div>
            <div class="store-first-party-cart__checkout-summary">
              <div class="store-first-party-cart__summary-row">
                <span>${escapeHtml(getRuntimeMessage('cart.subtotal', 'Subtotal'))}</span>
                <strong data-cart-checkout-summary-subtotal>${formatCents(pricing.subtotalCents)}</strong>
              </div>
              ${renderCartDiscountSummaryRow(pricing, 'checkout')}
              ${pricing.tipAmountCents > 0 ? `
                <div class="store-first-party-cart__summary-row" data-cart-checkout-summary-tip-row>
                  <span data-cart-checkout-summary-tip-label>${escapeHtml(getRuntimeMessage('cart.tipWithPercent', '%{platform} tip (%{percent}%)').replace('%{platform}', getPlatformCompanyName()).replace('%{percent}', String(pricing.tipPercent)))}</span>
                  <strong data-cart-checkout-summary-tip-amount>${formatCents(pricing.tipAmountCents)}</strong>
                </div>
              ` : ''}
              <div class="store-first-party-cart__summary-row">
                <span data-cart-checkout-summary-tax-label>${escapeHtml(pricing.taxLabel || formatTaxRateLabel())}</span>
                <strong data-cart-checkout-summary-tax>${escapeHtml(pricing.taxDisplayValue || formatCents(pricing.taxCents))}</strong>
              </div>
              ${pricing.showShippingRow ? renderCheckoutSummaryShippingRow(pricing, customCheckout?.shippingQuote) : ''}
              <div class="store-first-party-cart__summary-row store-first-party-cart__summary-row--total">
                <span data-cart-checkout-summary-total-label>${escapeHtml(pricing.totalLabel || getRuntimeMessage('cart.orderTotal', 'Order total'))}</span>
                <strong data-cart-checkout-summary-total>${formatCents(pricing.totalCents)}</strong>
              </div>
            </div>
          </div>
          ${customCheckoutMarkup}
          ${checkoutErrorMarkup}
        </section>
      ` : `
        <ul class="store-first-party-cart__items">${itemMarkup}</ul>
        ${cartAddOnMarkup}
        ${cartEstimateMarkup}
      `;
      const footerActions = isCheckoutPreview ? `
          <div class="store-first-party-cart__actions">
            <button type="button" class="store-first-party-cart__action store-first-party-cart__action--secondary" data-cart-back>${escapeHtml(getRuntimeMessage('cart.backToCart', 'Back to cart'))}</button>
            ${showCustomCheckoutConfirmButton ? `
              <button
                type="button"
                class="store-first-party-cart__action${checkoutUiState.status === 'confirming' || checkoutUiState.status === 'redirecting' ? ' is-busy' : ''}"
                data-cart-confirm-custom-checkout
                aria-busy="${checkoutUiState.status === 'confirming' || checkoutUiState.status === 'redirecting' ? 'true' : 'false'}"
                ${checkoutUiState.status === 'confirming' || checkoutUiState.status === 'submitting' || !isCustomCheckoutConfirmable(customCheckout) ? 'disabled' : ''}
              >${renderBusyButtonLabel(
                getCustomCheckoutConfirmButtonLabel(checkoutUiState.status, customCheckout),
                checkoutUiState.status === 'confirming' || checkoutUiState.status === 'redirecting'
              )}</button>
            ` : `
              <button
                type="button"
                class="store-first-party-cart__action"
                data-cart-start-checkout
                ${!isFirstPartyCheckoutEnabled || checkoutUiState.status === 'submitting' || (isDeferredCustomCheckoutStart && !isCustomCheckoutShippingDraftComplete(customCheckout?.shippingDraft)) || (requiresTaxLocation && !hasReadyTaxLocation) ? 'disabled' : ''}
              >${checkoutUiState.status === 'submitting'
                ? escapeHtml(getRuntimeMessage('cart.loadingSecurePayment', 'Loading secure payment...'))
                : (isFirstPartyCheckoutEnabled
                  ? escapeHtml(getRuntimeMessage('cart.continueToPayment', 'Continue to payment'))
                  : 'Legacy checkout only')}</button>
            `}
        </div>
      ` : `
        <div class="store-first-party-cart__actions">
          <button type="button" class="store-first-party-cart__action store-first-party-cart__action--secondary" data-cart-close>${escapeHtml(getRuntimeMessage('cart.keepBrowsing', 'Keep browsing'))}</button>
          <button type="button" class="store-first-party-cart__action" data-cart-continue ${items.length === 0 ? 'disabled' : ''}>${escapeHtml(getRuntimeMessage('cart.checkout', 'Checkout'))}</button>
        </div>
      `;

      if (activeCustomCheckoutMount) {
        if (isCustomCheckout && checkoutUiState.customCheckout) {
          checkoutUiState.customCheckout = {
            ...checkoutUiState.customCheckout,
            mountStatus: 'idle'
          };
        }
        teardownActiveCustomCheckoutMount();
      }

      root.innerHTML = `
        <div class="store-first-party-cart__backdrop" data-cart-close></div>
        <div
          class="store-first-party-cart__panel${isCheckoutPreview ? ' store-first-party-cart__panel--checkout' : ''}"
          role="dialog"
          aria-modal="true"
          aria-labelledby="store-first-party-cart-title"
          tabindex="-1"
        >
          <header class="store-first-party-cart__header">
            <div>
              ${isCheckoutPreview
                ? `<p id="store-first-party-cart-title" class="store-first-party-cart__section-label store-first-party-cart__section-label--header">${escapeHtml(getRuntimeMessage('cart.checkoutTitle', 'Checkout'))}</p>`
                : `<p id="store-first-party-cart-title" class="store-first-party-cart__section-label store-first-party-cart__section-label--header">${escapeHtml(getRuntimeMessage('cart.yourCart', 'Your cart'))}</p>`}
            </div>
            <button type="button" class="store-first-party-cart__close" data-cart-close aria-label="${escapeAttribute(getRuntimeMessage('cart.closeCart', 'Close cart'))}" data-cart-dialog-initial-focus>X</button>
          </header>
          <div class="store-first-party-cart__body">
            ${bodyMarkup}
          </div>
          <footer class="store-first-party-cart__footer${isCheckoutPreview ? ' store-first-party-cart__footer--checkout' : ''}">
            ${footerActions}
          </footer>
        </div>
      `;
      root.setAttribute('aria-hidden', 'false');
      activateCartDialog(root);
      emitCartSummaryUpdated();
      if (isCustomCheckout && customCheckout?.scriptStatus === 'ready') {
        mountCustomCheckoutIntoDrawer(root);
        ensureCustomCheckoutMounted(root);
      }
    }

    requestCartAddOnInventoryRerender = renderFirstPartyCart;

    function syncFirstPartyCartTipUI() {
      const root = getCartRoot();
      if (!root || !isCartOpen || currentRoute === CHECKOUT_VIEW_ROUTE) return;

      const pricing = getDisplayedFirstPartyPricing(store.getState(), {
        currentRoute,
        checkoutMode: checkoutUiState.mode,
        shippingQuote: checkoutUiState.customCheckout?.shippingQuote,
        taxQuote: checkoutUiState.customCheckout?.taxQuote
      });
      const tipAmount = root.querySelector('[data-cart-tip-amount]');
      const tipPercent = root.querySelector('[data-cart-tip-percent]');
      const tipInput = root.querySelector('[data-cart-tip]');
      const tipRow = root.querySelector('[data-cart-summary-tip-row]');
      const tipLabel = root.querySelector('[data-cart-summary-tip-label]');
      const tipSummaryAmount = root.querySelector('[data-cart-summary-tip-amount]');
      const subtotal = root.querySelector('[data-cart-summary-subtotal]');
      const taxLabel = root.querySelector('[data-cart-summary-tax-label]');
      const tax = root.querySelector('[data-cart-summary-tax]');
      let shippingRow = root.querySelector('[data-cart-summary-shipping-row]');
      let shippingLabel = root.querySelector('[data-cart-summary-shipping-label]');
      let shippingValueContainer = root.querySelector('[data-cart-summary-shipping-value]');
      let shipping = root.querySelector('[data-cart-summary-shipping]');
      const totalLabel = root.querySelector('[data-cart-summary-total-label]');
      const total = root.querySelector('[data-cart-summary-total]');
      const summary = root.querySelector('.store-first-party-cart__checkout-summary');
      const totalRow = root.querySelector('.store-first-party-cart__summary-row--total');

      if (tipAmount) tipAmount.textContent = formatCents(pricing.tipAmountCents);
      if (tipPercent) tipPercent.textContent = `${pricing.tipPercent}%`;
      if (tipInput) {
        tipInput.setAttribute('aria-valuetext', formatTipSliderValueText(pricing.tipPercent, pricing.tipAmountCents));
      }
      if (subtotal) subtotal.textContent = formatCents(pricing.subtotalCents);
      if (taxLabel) taxLabel.textContent = pricing.taxLabel || formatTaxRateLabel();
      if (tax) tax.textContent = pricing.taxDisplayValue || formatCents(pricing.taxCents);
      if (total) total.textContent = formatCents(pricing.totalCents);

      if (tipRow && tipLabel && tipSummaryAmount) {
        tipRow.hidden = pricing.tipAmountCents <= 0;
        tipLabel.textContent = getRuntimeMessage('cart.tipWithPercent', '%{platform} tip (%{percent}%)')
          .replace('%{platform}', getPlatformCompanyName())
          .replace('%{percent}', String(pricing.tipPercent));
        tipSummaryAmount.textContent = formatCents(pricing.tipAmountCents);
      }

      if (!shippingRow && pricing.showShippingRow && summary && totalRow) {
        totalRow.insertAdjacentHTML('beforebegin', renderCartSummaryShippingRow(pricing, checkoutUiState.customCheckout?.shippingQuote));
        shippingRow = root.querySelector('[data-cart-summary-shipping-row]');
        shippingLabel = root.querySelector('[data-cart-summary-shipping-label]');
        shippingValueContainer = root.querySelector('[data-cart-summary-shipping-value]');
        shipping = root.querySelector('[data-cart-summary-shipping]');
      }

      if (shippingRow) {
        shippingRow.hidden = !pricing.showShippingRow;
      }
      if (shippingLabel) {
        shippingLabel.textContent = pricing.shippingLabel || getRuntimeMessage('cart.shipping', 'Shipping');
      }
      if (shippingValueContainer) {
        shippingValueContainer.innerHTML = renderCartShippingSummaryValue(
          checkoutUiState.customCheckout?.shippingQuote || null,
          pricing.shippingCents,
          pricing.shippingDisplayValue,
          'data-cart-summary-shipping'
        );
        shipping = root.querySelector('[data-cart-summary-shipping]');
      }
      if (shipping) {
        shipping.textContent = pricing.shippingDisplayValue || formatCents(pricing.shippingCents);
      }
      if (totalLabel) {
        totalLabel.textContent = pricing.totalLabel || getRuntimeMessage('cart.orderTotal', 'Order total');
      }

      syncCartDrawerShippingOptionUI(root);
      emitCartSummaryUpdated();
    }

    function syncCartDrawerShippingOptionUI(root) {
      const shippingValueContainer = root?.querySelector('[data-cart-summary-shipping-value]');
      const shippingQuote = checkoutUiState.customCheckout?.shippingQuote || null;
      const shippingAmount = root?.querySelector('[data-cart-summary-shipping]');
      const pricing = getDisplayedFirstPartyPricing(store.getState(), {
        currentRoute,
        checkoutMode: checkoutUiState.mode,
        shippingQuote,
        taxQuote: checkoutUiState.customCheckout?.taxQuote
      });

      if (shippingValueContainer) {
        shippingValueContainer.innerHTML = renderCartShippingSummaryValue(
          shippingQuote,
          pricing.shippingCents,
          pricing.shippingDisplayValue,
          'data-cart-summary-shipping'
        );
      }

      const availableOptions = Array.isArray(shippingQuote?.availableOptions) ? shippingQuote.availableOptions : [];
      const selectedOption = shippingOptionUtils.normalizeSelection(
        availableOptions,
        shippingQuote?.selectedOption,
        shippingQuote?.defaultOption
      );
      const refreshedShippingOptionSelect = root?.querySelector('[data-cart-custom-shipping-option]');
      if (!refreshedShippingOptionSelect) {
        if (shippingAmount && !shouldShowCartShippingOptions(shippingQuote)) {
          shippingAmount.textContent = pricing.shippingDisplayValue || formatCents(
            Number.isFinite(Number(shippingQuote?.amountCents))
              ? Math.max(0, Number(shippingQuote.amountCents))
              : getStoreFallbackShippingCents(store.getState()?.cart?.items?.items || [])
          );
        }
        return;
      }

      if (!shouldShowCartShippingOptions(shippingQuote)) {
        return;
      }

      refreshedShippingOptionSelect.innerHTML = renderCartShippingOptionChoices({
        availableOptions,
        selectedOption,
        defaultOption: shippingQuote?.defaultOption || 'standard'
      });
      refreshedShippingOptionSelect.value = selectedOption;
    }

    function syncCheckoutPreviewSummaryUI() {
      const root = getCartRoot();
      if (!root || !isCartOpen || currentRoute !== CHECKOUT_VIEW_ROUTE) return;

      const state = store.getState();
      const pricing = getDisplayedFirstPartyPricing(store.getState(), {
        currentRoute,
        checkoutMode: checkoutUiState.mode,
        shippingQuote: checkoutUiState.customCheckout?.shippingQuote,
        taxQuote: checkoutUiState.customCheckout?.taxQuote
      });
      const subtotal = root.querySelector('[data-cart-checkout-summary-subtotal]');
      const tipRow = root.querySelector('[data-cart-checkout-summary-tip-row]');
      const tipLabel = root.querySelector('[data-cart-checkout-summary-tip-label]');
      const tipAmount = root.querySelector('[data-cart-checkout-summary-tip-amount]');
      const taxLabel = root.querySelector('[data-cart-checkout-summary-tax-label]');
      const tax = root.querySelector('[data-cart-checkout-summary-tax]');
      let shippingLabel = root.querySelector('[data-cart-checkout-summary-shipping-label]');
      let shippingAmount = root.querySelector('[data-cart-checkout-summary-shipping]');
      const totalLabel = root.querySelector('[data-cart-checkout-summary-total-label]');
      const total = root.querySelector('[data-cart-checkout-summary-total]');
      let shippingRow = root.querySelector('[data-cart-checkout-summary-shipping-row]');
      const checkoutSummary = root.querySelectorAll('.store-first-party-cart__checkout-summary')[0];
      const totalRow = root.querySelector('.store-first-party-cart__summary-row--total');
      if (subtotal) {
        subtotal.textContent = formatCents(pricing.subtotalCents);
      }
      if (tipRow && tipLabel && tipAmount) {
        tipRow.hidden = pricing.tipAmountCents <= 0;
        tipLabel.textContent = getRuntimeMessage('cart.tipWithPercent', '%{platform} tip (%{percent}%)')
          .replace('%{platform}', getPlatformCompanyName())
          .replace('%{percent}', String(pricing.tipPercent));
        tipAmount.textContent = formatCents(pricing.tipAmountCents);
      }
      if (taxLabel) {
        taxLabel.textContent = pricing.taxLabel || formatTaxRateLabel();
      }
      if (tax) {
        tax.textContent = pricing.taxDisplayValue || formatCents(pricing.taxCents);
      }
      if (!shippingRow && pricing.showShippingRow && checkoutSummary && totalRow) {
        totalRow.insertAdjacentHTML(
          'beforebegin',
          renderCheckoutSummaryShippingRow(pricing, checkoutUiState.customCheckout?.shippingQuote)
        );
        shippingRow = root.querySelector('[data-cart-checkout-summary-shipping-row]');
        shippingLabel = root.querySelector('[data-cart-checkout-summary-shipping-label]');
        shippingAmount = root.querySelector('[data-cart-checkout-summary-shipping]');
      }
      if (shippingRow) {
        shippingRow.hidden = !pricing.showShippingRow;
      }
      if (shippingLabel) {
        shippingLabel.textContent = pricing.shippingLabel || getRuntimeMessage('cart.shipping', 'Shipping');
      }
      if (shippingAmount) {
        shippingAmount.textContent = pricing.shippingDisplayValue || formatCents(pricing.shippingCents);
      }
      if (totalLabel) {
        totalLabel.textContent = pricing.totalLabel || getRuntimeMessage('cart.orderTotal', 'Order total');
      }
      if (total) {
        total.textContent = formatCents(pricing.totalCents);
      }
      syncCustomCheckoutShippingOptionUI(root);
      emitCartSummaryUpdated();
    }

    function syncCustomCheckoutShippingOptionUI(root) {
      const shippingValueContainer = root?.querySelector('[data-cart-checkout-summary-shipping-value]');
      const shippingOptionSelect = root?.querySelector('[data-cart-custom-shipping-option]');
      const shippingQuote = checkoutUiState.customCheckout?.shippingQuote || null;
      const shippingAmount = root?.querySelector('[data-cart-checkout-summary-shipping]');
      const pricing = getDisplayedFirstPartyPricing(store.getState(), {
        currentRoute,
        checkoutMode: checkoutUiState.mode,
        shippingQuote,
        taxQuote: checkoutUiState.customCheckout?.taxQuote
      });

      if (shippingValueContainer) {
        shippingValueContainer.innerHTML = renderCartShippingSummaryValue(
          shippingQuote,
          pricing.shippingCents,
          pricing.shippingDisplayValue
        );
      }

      const availableOptions = Array.isArray(shippingQuote?.availableOptions) ? shippingQuote.availableOptions : [];
      const selectedOption = shippingOptionUtils.normalizeSelection(
        availableOptions,
        shippingQuote?.selectedOption,
        shippingQuote?.defaultOption
      );

      const refreshedShippingOptionSelect = root?.querySelector('[data-cart-custom-shipping-option]');
      if (!refreshedShippingOptionSelect) {
        if (shippingAmount && !shouldShowCartShippingOptions(shippingQuote)) {
          shippingAmount.textContent = pricing.shippingDisplayValue || formatCents(
            Number.isFinite(Number(shippingQuote?.amountCents))
              ? Math.max(0, Number(shippingQuote.amountCents))
              : getStoreFallbackShippingCents(store.getState()?.cart?.items?.items || [])
          );
        }
        return;
      }

      if (!shouldShowCartShippingOptions(shippingQuote)) {
        return;
      }

      refreshedShippingOptionSelect.innerHTML = renderCartShippingOptionChoices({
        availableOptions,
        selectedOption,
        defaultOption: shippingQuote?.defaultOption || 'standard'
      });
      refreshedShippingOptionSelect.value = selectedOption;
    }

    function openFirstPartyCart(focusTarget) {
      const wasOpen = isCartOpen;
      currentRoute = currentRoute || CART_VIEW_ROUTE;
      isCartOpen = true;
      rememberCartReturnFocus(focusTarget);
      cartShouldFocusAfterRender = true;
      scheduleStripeJsPrewarm();
      renderFirstPartyCart();
      refreshCustomCheckoutEstimates();
      if (!wasOpen) {
        eventBus.emit('cart.opened');
      }
    }

    function closeFirstPartyCart() {
      if (!isCartOpen) return;
      clearCustomCheckoutTaxDraftSyncTimer();
      isCartOpen = false;
      renderFirstPartyCart();
      restoreCartReturnFocus();
      eventBus.emit('cart.closed');
    }

    function setCheckoutUiState(nextState) {
      checkoutUiState = {
        ...checkoutUiState,
        ...(nextState || {})
      };
      renderFirstPartyCart();
    }

  function teardownActiveCustomCheckoutMount() {
      if (!activeCustomCheckoutMount || typeof activeCustomCheckoutMount.unmount !== 'function') {
        activeCustomCheckoutMount = null;
        return;
      }

      try {
        activeCustomCheckoutMount.unmount();
      } catch (_error) {}
      activeCustomCheckoutMount = null;
    }

    function invalidateCustomCheckoutFlow() {
      customCheckoutFlowToken += 1;
      return customCheckoutFlowToken;
    }

    function isActiveCustomCheckoutFlow(flowToken) {
      return flowToken === customCheckoutFlowToken &&
        currentRoute === CHECKOUT_VIEW_ROUTE &&
        checkoutUiState.mode === 'custom' &&
        Boolean(checkoutUiState.customCheckout);
    }

    function getActiveCustomCheckoutOrderId() {
      return String(checkoutUiState?.customCheckout?.orderId || readActiveCustomCheckoutOrderId() || '').trim();
    }

    async function abandonActiveCustomCheckoutIntent(orderId = getActiveCustomCheckoutOrderId()) {
      const nextOrderId = String(orderId || '').trim();
      if (!nextOrderId) return;

      writeActiveCustomCheckoutOrderId('');
      clearFirstPartyCheckoutSnapshot();
      clearPendingOrderFlag();
    }

    function clearStoreCartAfterOrder() {
      persistedAbandonedCheckoutConsentDraft = false;
      updateCartState((state) => {
        const totals = calculateCartTotals([], 0, '');
        return {
          ...state,
          customer: {
            ...(state.customer || {}),
            email: ''
          },
          cart: {
            ...state.cart,
            ...totals,
            email: '',
            couponCode: '',
            coupon: null,
            couponStatus: '',
            couponError: '',
            tipPercent: getDefaultPlatformTipPercent(),
            tipTouched: false,
            items: {
              count: 0,
              items: []
            }
          }
        };
      });
      clearPersistedFirstPartyCartState();
      clearFirstPartyCheckoutSnapshot();
      clearPendingOrderFlag();
      writeActiveCustomCheckoutOrderId('');
      try {
        removeStorageValue(getLocalStorageSafe(), CART_SUMMARY_CACHE_KEY);
      } catch (_error) {}
    }

    function updateCustomCheckoutStatus(statusText, footerLabel) {
      const root = getCartRoot();
      if (!root) return;

      const button = root.querySelector('[data-cart-confirm-custom-checkout], [data-cart-start-checkout]');
      if (button && footerLabel) {
        button.textContent = footerLabel;
      }
    }

    function isCustomCheckoutBusy() {
      return checkoutUiState.status === 'confirming' || checkoutUiState.status === 'redirecting';
    }

    function isStorePaymentIntentCheckout(customCheckout = checkoutUiState.customCheckout) {
      return String(customCheckout?.checkoutUiMode || '').trim().toLowerCase() === 'payment_intent';
    }

    function isCustomCheckoutConfirmable(customCheckout = checkoutUiState.customCheckout) {
      if (!customCheckout || customCheckout.mountStatus !== 'mounted') return false;
      if (isStorePaymentIntentCheckout(customCheckout)) {
        return customCheckout.canConfirm === true;
      }
      if (Object.prototype.hasOwnProperty.call(customCheckout, 'canConfirm')) {
        return customCheckout.canConfirm === true;
      }
      return true;
    }

    function getCustomCheckoutConfirmButtonLabel(status, customCheckout = checkoutUiState.customCheckout) {
      const normalizedStatus = String(status || '').trim().toLowerCase();
      if (isStorePaymentIntentCheckout(customCheckout)) {
        if (normalizedStatus === 'confirming') {
          return getRuntimeMessage('cart.processingPayment', 'Processing payment...');
        }
        if (normalizedStatus === 'redirecting') {
          return getRuntimeMessage('cart.finishingOrder', 'Finishing order...');
        }
        if (normalizedStatus === 'submitting') {
          return getRuntimeMessage('cart.loadingSecurePayment', 'Loading secure payment...');
        }
        return getRuntimeMessage('cart.payNow', 'Pay now');
      }

      return getRuntimeMessage('cart.payNow', 'Pay now');
    }

    function syncCustomCheckoutConfirmButton() {
      const root = getCartRoot();
      const button = root?.querySelector('[data-cart-confirm-custom-checkout]');
      if (!button) return;

      const isConfirming = checkoutUiState.status === 'confirming';
      const isRedirecting = checkoutUiState.status === 'redirecting';
      const isSubmitting = checkoutUiState.status === 'submitting';
      button.disabled = isConfirming || isRedirecting || isSubmitting || !isCustomCheckoutConfirmable();
      button.classList.toggle('is-busy', isConfirming || isRedirecting);
      button.setAttribute('aria-busy', isConfirming || isRedirecting ? 'true' : 'false');
      button.innerHTML = renderBusyButtonLabel(
        getCustomCheckoutConfirmButtonLabel(checkoutUiState.status),
        isConfirming || isRedirecting
      );
    }

    function syncCheckoutStartButton() {
      const root = getCartRoot();
      const button = root?.querySelector('[data-cart-start-checkout]');
      if (!button) return;

      const shouldDeferCustomCheckout = shouldDeferPhysicalCustomCheckoutStart(store.getState(), {
        currentRoute,
        checkoutMode: checkoutUiState.mode,
        hasCustomCheckoutSession: Boolean(checkoutUiState.customCheckout?.sessionId || checkoutUiState.customCheckout?.clientSecret)
      });
      const shippingDraft = shouldDeferCustomCheckout
        ? readCustomCheckoutShippingDraft()
        : checkoutUiState.customCheckout?.shippingDraft || null;
      const requiresTaxLocation = cartRequiresCustomCheckoutTaxLocation(store.getState());
      const hasReadyTaxLocation = Boolean(readReadyTaxDestination(store.getState()));

      button.disabled = checkoutUiState.status === 'submitting' ||
        getRequestedCheckoutProvider() !== FIRST_PARTY_CHECKOUT_PROVIDER ||
        (shouldDeferCustomCheckout && !isCustomCheckoutShippingDraftComplete(shippingDraft)) ||
        (requiresTaxLocation && !hasReadyTaxLocation);
      button.textContent = checkoutUiState.status === 'submitting'
        ? getRuntimeMessage('cart.loadingSecurePayment', 'Loading secure payment...')
        : getRuntimeMessage('cart.continueToPayment', 'Continue to payment');
    }

    function requestCloseFirstPartyCart() {
      if (isCustomCheckoutBusy()) return;
      const activeOrderId = getActiveCustomCheckoutOrderId();
      if (currentRoute === CHECKOUT_VIEW_ROUTE && activeOrderId) {
        void abandonActiveCustomCheckoutIntent(activeOrderId).finally(() => {
          closeFirstPartyCart();
        });
        return;
      }
      closeFirstPartyCart();
    }

    function requestBackToCart() {
      if (isCustomCheckoutBusy()) return;
      const goBackToCart = function() {
        setCheckoutUiState({
          status: 'idle',
          error: ''
        });
        cartShouldFocusAfterRender = true;
        apiRoot.api.theme.cart.navigate(CART_VIEW_ROUTE);
      };

      const activeOrderId = getActiveCustomCheckoutOrderId();
      if (activeOrderId) {
        void abandonActiveCustomCheckoutIntent(activeOrderId).finally(goBackToCart);
        return;
      }

      goBackToCart();
    }

    function takeAbandonedCheckoutResumeToken() {
      let url;
      try {
        url = new URL(window.location.href);
      } catch (_error) {
        return '';
      }
      const token = String(url.searchParams.get(ABANDONED_CHECKOUT_RESUME_PARAM) || '').trim();
      if (!token) return '';
      url.searchParams.delete(ABANDONED_CHECKOUT_RESUME_PARAM);
      try {
        window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
      } catch (_error) {}
      return token;
    }

    async function consumeAbandonedCheckoutResumeToken() {
      const token = takeAbandonedCheckoutResumeToken();
      if (!token) return false;

      try {
        const response = await fetch(
          `${getWorkerBase()}/abandoned-cart/resume?t=${encodeURIComponent(token)}`,
          { cache: 'no-store' }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success !== true) return false;
        if (!writeFirstPartyCheckoutSnapshotPayload(payload.snapshot)) return false;
        writeFirstPartyCartDraftPayload(payload.draft || {});
        persistCustomCheckoutDraftState(payload.draft?.email, payload.draft?.shippingDraft || null);
        persistAbandonedCheckoutConsentDraft(payload.draft?.abandonedCartConsent === true);
        const snapshot = readFirstPartyCheckoutSnapshot();
        if (!restoreCheckoutFromSnapshot(snapshot)) return false;
        setCheckoutUiState({
          status: 'idle',
          error: '',
          customCheckout: {
            ...(checkoutUiState.customCheckout || {}),
            shippingDraft: payload.draft?.shippingDraft || checkoutUiState.customCheckout?.shippingDraft || null,
            abandonedCartConsent: payload.draft?.abandonedCartConsent === true,
            shippingError: '',
            emailError: ''
          }
        });
        await apiRoot.api.theme.cart.open();
        await apiRoot.api.theme.cart.navigate(CHECKOUT_VIEW_ROUTE);
        return true;
      } catch (_error) {
        return false;
      }
    }

    function getPersistedCustomCheckoutEmailDraft() {
      return String(checkoutUiState.customCheckout?.emailDraft || persistedCustomCheckoutEmailDraft || '');
    }

    function getPersistedCustomCheckoutShippingDraft() {
      return checkoutUiState.customCheckout?.shippingDraft || persistedCustomCheckoutShippingDraft || null;
    }

    function persistCustomCheckoutDraftState(emailDraft, shippingDraft) {
      if (emailDraft !== undefined) {
        persistedCustomCheckoutEmailDraft = String(emailDraft || '').trim();
      }
      if (shippingDraft !== undefined) {
        persistedCustomCheckoutShippingDraft = shippingDraft || null;
      }
    }

    function persistAbandonedCheckoutConsentDraft(value) {
      persistedAbandonedCheckoutConsentDraft = value === true;
      checkoutUiState.customCheckout = {
        ...(checkoutUiState.customCheckout || {}),
        abandonedCartConsent: persistedAbandonedCheckoutConsentDraft
      };
    }

    function readAbandonedCheckoutConsentDraft() {
      const field = getCartRoot()?.querySelector('[data-cart-abandoned-consent]');
      if (field instanceof HTMLInputElement) return field.checked === true;
      return checkoutUiState.customCheckout?.abandonedCartConsent === true ||
        persistedAbandonedCheckoutConsentDraft === true;
    }

    function getCustomCheckoutShippingSignature(state) {
      if (currentRoute !== CHECKOUT_VIEW_ROUTE && currentRoute !== CART_VIEW_ROUTE) {
        return '';
      }
      if (currentRoute === CHECKOUT_VIEW_ROUTE && checkoutUiState.mode !== 'custom') {
        return '';
      }

      const items = Array.isArray(state?.cart?.items?.items) ? state.cart.items.items : [];
      const normalizedItems = items
        .map((item) => `${String(item?.id || '')}:${Math.max(1, Number(item?.quantity || 1))}`)
        .sort()
        .join('|');

      return [
        normalizedItems,
        cartHasPhysicalItems(items) ? 'physical' : 'digital'
      ].join('::');
    }

    function focusCustomCheckoutEmailField() {
      const input = getCartRoot()?.querySelector('[data-cart-custom-checkout-email]');
      if (!(input instanceof HTMLInputElement)) return;
      input.focus();
      if (typeof input.select === 'function' && input.value) {
        input.select();
      }
      if (typeof input.scrollIntoView === 'function') {
        input.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }

    function focusCustomCheckoutTaxField() {
      const root = getCartRoot();
      const state = store.getState();
      const billingDestination = normalizeTaxDestination(getCurrentBillingAddress(state));
      const line1Field = root?.querySelector('[data-cart-tax-destination-field="line1"]');
      const cityField = root?.querySelector('[data-cart-tax-destination-field="city"]');
      const stateField = root?.querySelector('[data-cart-tax-destination-field="state"]');
      const postalField = root?.querySelector('[data-cart-tax-destination-field="postal_code"]');
      const countryField = root?.querySelector('[data-cart-tax-destination-field="country"]');
      const target = taxDestinationNeedsDetailedStreetAddress(billingDestination) && line1Field instanceof HTMLInputElement && !String(line1Field.value || '').trim()
        ? line1Field
        : taxDestinationNeedsDetailedStreetAddress(billingDestination) && cityField instanceof HTMLInputElement && !String(cityField.value || '').trim()
          ? cityField
          : taxDestinationNeedsDetailedStreetAddress(billingDestination) && stateField instanceof HTMLInputElement && !String(stateField.value || '').trim()
            ? stateField
            : postalField instanceof HTMLInputElement
        ? postalField
        : countryField instanceof HTMLSelectElement
          ? countryField
          : null;
      if (!target) return;
      target.focus();
      if (typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }

    function getCustomCheckoutEmailFieldMessage(errorLike) {
      const rawMessage = String(errorLike?.error?.message || errorLike?.message || '').trim();
      const message = rawMessage.toLowerCase();
      if (!message || !message.includes('email')) {
        return '';
      }
      if (message.includes('required') || message.includes('updateemail') || message.includes('provide an email address')) {
        return getRuntimeMessage('cart.emailRequired', 'Enter an email address to continue.');
      }
      if (message.includes('valid email')) {
        return getRuntimeMessage('cart.emailInvalid', 'Enter a valid email address to continue.');
      }
      return rawMessage || getRuntimeMessage('cart.emailRequired', 'Enter an email address to continue.');
    }

    function setCustomCheckoutEmailError(message) {
      const root = getCartRoot();
      const errorNode = root?.querySelector('[data-cart-custom-checkout-email-error]');
      const input = root?.querySelector('[data-cart-custom-checkout-email]');
      if (!errorNode) return;

      const nextMessage = String(message || '');
      errorNode.textContent = nextMessage;
      errorNode.hidden = !nextMessage;
      if (input instanceof HTMLInputElement) {
        input.setAttribute('aria-invalid', nextMessage ? 'true' : 'false');
      }
    }

    function setCustomCheckoutTaxError(message) {
      const root = getCartRoot();
      const errorNode = root?.querySelector('[data-cart-custom-tax-error]');
      const fields = root ? Array.from(root.querySelectorAll('[data-cart-tax-destination-field]')) : [];
      if (!errorNode) return;

      const nextMessage = String(message || '');
      errorNode.textContent = nextMessage;
      errorNode.hidden = !nextMessage;
      fields.forEach((field) => {
        if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
          field.setAttribute('aria-invalid', nextMessage ? 'true' : 'false');
        }
      });
    }

    function syncCustomCheckoutTaxLocationNote(destination) {
      const root = getCartRoot();
      const note = root?.querySelector('[data-cart-tax-location-note]');
      if (!(note instanceof HTMLElement)) return;
      note.textContent = getTaxLocationNote(destination || readCustomCheckoutTaxDraft());
    }

    function setCheckoutUiError(message) {
      const root = getCartRoot();
      const errorNode = root?.querySelector('[data-cart-checkout-error]');
      const nextMessage = String(message || '');
      checkoutUiState.error = nextMessage;
      if (!errorNode) return;
      errorNode.textContent = nextMessage;
      errorNode.hidden = !nextMessage;
    }

    function isCustomCheckoutShippingDraftComplete(shippingDraft) {
      const draft = shippingDraft || readCustomCheckoutShippingDraft();
      return Boolean(
        draft?.name &&
        draft?.address?.line1 &&
        draft?.address?.city &&
        draft?.address?.state &&
        draft?.address?.postal_code &&
        draft?.address?.country
      );
    }

    function shouldShowCheckoutLevelStripeError(errorLike) {
      const type = String(errorLike?.type || errorLike?.error?.type || '').trim().toLowerCase();
      const code = String(errorLike?.code || errorLike?.error?.code || '').trim().toLowerCase();
      const message = String(errorLike?.message || errorLike?.error?.message || '').trim();

      if (type === 'validation_error') return false;
      if (code === 'incomplete_number' || code === 'incomplete_cvc' || code === 'incomplete_expiry') return false;
      if (/(incomplete|invalid|required|empty)/i.test(message)) return false;
      return true;
    }

    function setCustomCheckoutShippingError(message) {
      const root = getCartRoot();
      const errorNode = root?.querySelector('[data-cart-custom-shipping-error]');
      const fields = root ? Array.from(root.querySelectorAll('[data-cart-custom-shipping-field]')) : [];
      if (!errorNode) return;

      const nextMessage = String(message || '');
      errorNode.textContent = nextMessage;
      errorNode.hidden = !nextMessage;
      fields.forEach((field) => {
        if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
          field.setAttribute('aria-invalid', nextMessage ? 'true' : 'false');
        }
      });
    }

    function readCustomCheckoutShippingDraft() {
      const root = getCartRoot();
      const fields = root ? Array.from(root.querySelectorAll('[data-cart-custom-shipping-field]')) : [];
      const read = function(name) {
        const field = fields.find((node) => node.getAttribute('data-cart-custom-shipping-field') === name);
        if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
          return String(field.value || '').trim();
        }
        return '';
      };

      return {
        name: read('name'),
        address: {
          line1: read('line1'),
          line2: read('line2'),
          city: read('city'),
          state: read('state'),
          postal_code: read('postal_code'),
          country: (read('country') || 'US').toUpperCase()
        }
      };
    }

    function hasCheckoutAddressDetails(address) {
      return Boolean(
        address?.line1 ||
        address?.city ||
        address?.state ||
        address?.postal_code ||
        address?.postalCode
      );
    }

    function buildStripeBillingAddress(address) {
      const source = address && typeof address === 'object' ? address : {};
      const country = String(source.country || DEFAULT_SHIPPING_COUNTRY).trim().toUpperCase();
      const billingAddress = {
        country: /^[A-Z]{2}$/.test(country) ? country : DEFAULT_SHIPPING_COUNTRY
      };
      const line1 = String(source.line1 || '').trim();
      const line2 = String(source.line2 || '').trim();
      const city = String(source.city || '').trim();
      const state = String(source.state || '').trim();
      const postalCode = String(source.postal_code || source.postalCode || '').trim();

      if (line1) billingAddress.line1 = line1;
      if (line2) billingAddress.line2 = line2;
      if (city) billingAddress.city = city;
      if (state) billingAddress.state = state;
      if (postalCode) billingAddress.postal_code = postalCode;

      return billingAddress;
    }

    function buildStorePaymentIntentConfirmOptions(emailValue) {
      const email = String(emailValue || readCustomCheckoutEmailDraft() || '').trim();
      const persistedShippingDraft = getPersistedCustomCheckoutShippingDraft();
      const currentShippingDraft = readCustomCheckoutShippingDraft();
      const storedShippingDraft = checkoutUiState.customCheckout?.shippingDraft || persistedShippingDraft;
      const shippingDraftHasCurrentDetails = Boolean(
        currentShippingDraft?.name ||
        hasCheckoutAddressDetails(currentShippingDraft?.address)
      );
      const shippingDraft = shippingDraftHasCurrentDetails
        ? mergeShippingDraftWithDefaults(
            currentShippingDraft,
            checkoutUiState.customCheckout?.shippingDraft,
            persistedShippingDraft
          )
        : storedShippingDraft || currentShippingDraft;
      const taxDestination = normalizeTaxDestination(getCurrentBillingAddress(store.getState()));
      const shippingAddress = shippingDraft?.address || {};
      const taxAddress = {
        line1: taxDestination.line1,
        line2: taxDestination.line2,
        city: taxDestination.city,
        state: taxDestination.state,
        postal_code: taxDestination.postalCode,
        country: taxDestination.country || DEFAULT_SHIPPING_COUNTRY
      };
      const addressSource = hasCheckoutAddressDetails(shippingAddress)
        ? shippingAddress
        : taxAddress;
      const billingDetails = {
        name: String(shippingDraft?.name || '').trim() || 'Customer',
        address: buildStripeBillingAddress(addressSource)
      };
      if (email) {
        billingDetails.email = email;
      }

      const confirmParams = {
        payment_method_data: {
          billing_details: billingDetails
        }
      };
      if (email) {
        confirmParams.receipt_email = email;
      }

      return { confirmParams };
    }

    function readCartShippingEstimateDraft() {
      const root = getCartRoot();
      const postalField = root?.querySelector('[data-cart-estimate-postal]');
      const postalCode = postalField instanceof HTMLInputElement
        ? String(postalField.value || '').trim()
        : getPersistedShippingEstimatePostalCode(
            checkoutUiState?.customCheckout?.shippingDraft,
            persistedCustomCheckoutShippingDraft
          );

      return mergeShippingDraftWithDefaults({
        address: {
          postal_code: postalCode,
          country: getPersistedShippingEstimateCountry(
            checkoutUiState?.customCheckout?.shippingDraft,
            persistedCustomCheckoutShippingDraft
          )
        }
      }, checkoutUiState?.customCheckout?.shippingDraft, persistedCustomCheckoutShippingDraft);
    }

    function readCustomCheckoutEmailDraft() {
      const field = getCartRoot()?.querySelector('[data-cart-custom-checkout-email]');
      if (field instanceof HTMLInputElement) {
        return String(field.value || '').trim();
      }
      return String(checkoutUiState.customCheckout?.emailDraft || persistedCustomCheckoutEmailDraft || '').trim();
    }

    function readCustomCheckoutTaxDraft() {
      const root = getCartRoot();
      const fields = root ? Array.from(root.querySelectorAll('[data-cart-tax-destination-field]')) : [];
      const read = function(name) {
        const field = fields.find((node) => node.getAttribute('data-cart-tax-destination-field') === name);
        if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
          return String(field.value || '').trim();
        }
        return '';
      };

      return {
        country: (read('country') || DEFAULT_SHIPPING_COUNTRY).toUpperCase(),
        postal_code: read('postal_code'),
        state: read('state'),
        city: read('city'),
        line1: read('line1'),
        line2: read('line2')
      };
    }

    function syncCustomCheckoutTaxDraft(options) {
      const settings = options && typeof options === 'object' ? options : {};
      const nextBillingAddress = settings.draft && typeof settings.draft === 'object'
        ? { ...settings.draft }
        : readCustomCheckoutTaxDraft();
      return apiRoot.api.cart.update({
        billingAddress: nextBillingAddress
      }).then(() => {
        if (settings.refreshEstimate === false) {
          syncCheckoutStartButton();
          return null;
        }

        return refreshCustomCheckoutTaxEstimate().finally(() => {
          syncCheckoutStartButton();
          ensureCustomCheckoutBootstrapped();
        });
      });
    }

    function scheduleCustomCheckoutTaxDraftSync(draft) {
      pendingCustomCheckoutTaxDraft = draft && typeof draft === 'object'
        ? { ...draft }
        : readCustomCheckoutTaxDraft();
      clearCustomCheckoutTaxDraftSyncTimer();
      customCheckoutTaxDraftSyncTimer = window.setTimeout(() => {
        const nextDraft = pendingCustomCheckoutTaxDraft;
        pendingCustomCheckoutTaxDraft = null;
        customCheckoutTaxDraftSyncTimer = 0;
        void syncCustomCheckoutTaxDraft({ draft: nextDraft });
      }, 180);
    }

    async function refreshCustomCheckoutShippingEstimate() {
      const isCheckoutRoute = currentRoute === CHECKOUT_VIEW_ROUTE;
      const isCartRoute = currentRoute === CART_VIEW_ROUTE;
      if (!isCheckoutRoute && !isCartRoute) return;
      const state = store.getState();
      const cartItems = state?.cart?.items?.items || [];
      if (!cartHasPhysicalItems(cartItems)) {
        customCheckoutShippingQuoteToken += 1;
        checkoutUiState.customCheckout = {
          ...(checkoutUiState.customCheckout || {}),
          shippingQuote: {
            status: 'idle',
            amountCents: 0,
            source: 'none',
            availableOptions: [],
            defaultOption: 'standard',
            selectedOption: 'standard'
          }
        };
        syncFirstPartyCartTipUI();
        syncCheckoutPreviewSummaryUI();
        return;
      }

      if (!cartRequiresQuotedShipping(cartItems)) {
        customCheckoutShippingQuoteToken += 1;
        checkoutUiState.customCheckout = {
          ...(checkoutUiState.customCheckout || {}),
          shippingQuote: {
            status: 'idle',
            amountCents: 0,
            source: 'none',
            availableOptions: [],
            defaultOption: 'standard',
            selectedOption: 'standard'
          }
        };
        syncFirstPartyCartTipUI();
        syncCheckoutPreviewSummaryUI();
        return;
      }

      const shippingDraft = isCheckoutRoute && checkoutUiState.mode === 'custom'
        ? readCustomCheckoutShippingDraft()
        : readCartShippingEstimateDraft();
      persistCustomCheckoutDraftState(undefined, shippingDraft);
      checkoutUiState.customCheckout = {
        ...(checkoutUiState.customCheckout || {}),
        shippingDraft
      };

      if (!isShippingPostalCodeQuoteReady(shippingDraft?.address?.country, shippingDraft?.address?.postal_code)) {
        customCheckoutShippingQuoteToken += 1;
        checkoutUiState.customCheckout = {
          ...(checkoutUiState.customCheckout || {}),
          shippingQuote: {
            status: 'needs_input',
            amountCents: 0,
            source: 'none',
            availableOptions: [],
            defaultOption: 'standard',
            selectedOption: 'standard'
          }
        };
        syncFirstPartyCartTipUI();
        syncCheckoutPreviewSummaryUI();
        return;
      }

      checkoutUiState.customCheckout = {
        ...(checkoutUiState.customCheckout || {}),
          shippingQuote: {
            status: 'loading',
            amountCents: Number.isFinite(Number(checkoutUiState.customCheckout?.shippingQuote?.amountCents))
              ? Math.max(0, Number(checkoutUiState.customCheckout.shippingQuote.amountCents))
              : 0,
            source: checkoutUiState.customCheckout?.shippingQuote?.source || 'none',
            availableOptions: Array.isArray(checkoutUiState.customCheckout?.shippingQuote?.availableOptions)
              ? checkoutUiState.customCheckout.shippingQuote.availableOptions
              : [],
            defaultOption: checkoutUiState.customCheckout?.shippingQuote?.defaultOption || 'standard',
            selectedOption: checkoutUiState.customCheckout?.shippingQuote?.selectedOption || 'standard'
          }
      };
      const quoteToken = customCheckoutShippingQuoteToken + 1;
      customCheckoutShippingQuoteToken = quoteToken;
      syncFirstPartyCartTipUI();
      syncCheckoutPreviewSummaryUI();

      const payloadResult = buildFirstPartyCheckoutPayload(store.getState());
      if (!payloadResult.valid) {
        if (quoteToken === customCheckoutShippingQuoteToken) {
          checkoutUiState.customCheckout = {
            ...(checkoutUiState.customCheckout || {}),
            shippingQuote: {
              status: 'error',
              amountCents: getStoreFallbackShippingCents(store.getState()?.cart?.items?.items || []),
              source: 'fallback_flat_rate',
              availableOptions: [],
              defaultOption: 'standard',
              selectedOption: 'standard'
            }
          };
          syncFirstPartyCartTipUI();
          syncCheckoutPreviewSummaryUI();
        }
        return;
      }

      try {
        const response = await fetch(`${getWorkerBase()}/shipping/quote`, {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ...payloadResult.payload,
            shippingAddress: {
              country: shippingDraft.address.country,
              postalCode: shippingDraft.address.postal_code
            },
            shippingOption: checkoutUiState.customCheckout?.shippingQuote?.selectedOption || 'standard'
          })
        });

        const data = await response.json().catch(() => ({}));
        if (quoteToken !== customCheckoutShippingQuoteToken) return;

        checkoutUiState.customCheckout = {
          ...(checkoutUiState.customCheckout || {}),
          shippingQuote: response.ok
            ? buildCartShippingQuoteState(
                data,
                getStoreFallbackShippingCents(store.getState()?.cart?.items?.items || []),
                checkoutUiState.customCheckout?.shippingQuote
              )
            : {
                status: 'error',
                amountCents: getStoreFallbackShippingCents(store.getState()?.cart?.items?.items || []),
                source: 'fallback_flat_rate',
                availableOptions: [],
                defaultOption: 'standard',
                selectedOption: 'standard'
              }
        };
      } catch (_error) {
        if (quoteToken !== customCheckoutShippingQuoteToken) return;
        checkoutUiState.customCheckout = {
          ...(checkoutUiState.customCheckout || {}),
          shippingQuote: {
            status: 'error',
            amountCents: getStoreFallbackShippingCents(store.getState()?.cart?.items?.items || []),
            source: 'fallback_flat_rate',
            availableOptions: [],
            defaultOption: 'standard',
            selectedOption: 'standard'
          }
        };
      }

      syncFirstPartyCartTipUI();
      syncCheckoutPreviewSummaryUI();
      ensureCustomCheckoutBootstrapped();
    }

    async function refreshCustomCheckoutTaxEstimate(options) {
      const isCheckoutRoute = currentRoute === CHECKOUT_VIEW_ROUTE;
      const isCartRoute = currentRoute === CART_VIEW_ROUTE;
      if (!isCheckoutRoute && !isCartRoute) return;

      const state = store.getState();
      const subtotalCents = buildFirstPartyPricing(state).discountedSubtotalCents;
      if (subtotalCents <= 0) {
        customCheckoutTaxQuoteToken += 1;
        checkoutUiState.customCheckout = {
          ...(checkoutUiState.customCheckout || {}),
          taxQuote: {
            status: 'idle',
            amountCents: 0,
            taxDetails: null,
            label: formatTaxPendingLabel()
          }
        };
        syncFirstPartyCartTipUI();
        syncCheckoutPreviewSummaryUI();
        return;
      }

      const billingDestination = normalizeTaxDestination(getCurrentBillingAddress(state));
      const shippingDraft = options?.shippingDraft ||
        (isCheckoutRoute && checkoutUiState.mode === 'custom'
          ? readCustomCheckoutShippingDraft()
          : readCartShippingEstimateDraft());
      const shippingDestination = normalizeTaxDestination({
        country: shippingDraft?.address?.country,
        postal_code: shippingDraft?.address?.postal_code,
        state: shippingDraft?.address?.state,
        city: shippingDraft?.address?.city,
        line1: shippingDraft?.address?.line1,
        line2: shippingDraft?.address?.line2
      });
      const taxDestinationReady = isTaxDestinationReadyForQuote(billingDestination) || isTaxDestinationReadyForQuote(shippingDestination);

      if (!taxDestinationReady) {
        customCheckoutTaxQuoteToken += 1;
        checkoutUiState.customCheckout = {
          ...(checkoutUiState.customCheckout || {}),
          taxQuote: {
            status: 'needs_input',
            amountCents: 0,
            taxDetails: null,
            label: formatTaxPendingLabel()
          }
        };
        syncFirstPartyCartTipUI();
        syncCheckoutPreviewSummaryUI();
        return;
      }

      checkoutUiState.customCheckout = {
        ...(checkoutUiState.customCheckout || {}),
        taxQuote: {
          status: 'loading',
          amountCents: Number.isFinite(Number(checkoutUiState.customCheckout?.taxQuote?.amountCents))
            ? Math.max(0, Number(checkoutUiState.customCheckout.taxQuote.amountCents))
            : 0,
          taxDetails: checkoutUiState.customCheckout?.taxQuote?.taxDetails || null,
          label: checkoutUiState.customCheckout?.taxQuote?.label || formatTaxPendingLabel()
        }
      };
      const quoteToken = customCheckoutTaxQuoteToken + 1;
      customCheckoutTaxQuoteToken = quoteToken;
      syncFirstPartyCartTipUI();
      syncCheckoutPreviewSummaryUI();

      const cartItems = state?.cart?.items?.items || [];
      let shippingCents = 0;
      if (cartHasPhysicalItems(cartItems)) {
        const shippingQuote = checkoutUiState.customCheckout?.shippingQuote || null;
        const shippingStatus = String(shippingQuote?.status || '').trim().toLowerCase();
        const hasFallbackQuote = isFallbackShippingSource(shippingQuote?.source);
        if (shippingStatus === 'ready' && !hasFallbackQuote && Number.isFinite(Number(shippingQuote?.amountCents))) {
          shippingCents = Math.max(0, Number(shippingQuote.amountCents));
        } else if (!cartRequiresQuotedShipping(cartItems)) {
          shippingCents = getStoreFallbackShippingCents(cartItems);
        }
      }

      try {
        const response = await fetch(`${getWorkerBase()}/tax/quote`, {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            subtotalCents,
            shippingCents,
            billingAddress: isTaxDestinationReadyForQuote(billingDestination) ? billingDestination : undefined,
            shippingAddress: isTaxDestinationReadyForQuote(shippingDestination) ? shippingDestination : undefined
          })
        });

        const data = await response.json().catch(() => ({}));
        if (quoteToken !== customCheckoutTaxQuoteToken) return;

        checkoutUiState.customCheckout = {
          ...(checkoutUiState.customCheckout || {}),
          taxQuote: response.ok
            ? buildCartTaxQuoteState(data, checkoutUiState.customCheckout?.taxQuote)
            : {
                status: 'error',
                amountCents: 0,
                taxDetails: null,
                label: formatTaxPendingLabel()
              }
        };
      } catch (_error) {
        if (quoteToken !== customCheckoutTaxQuoteToken) return;
        checkoutUiState.customCheckout = {
          ...(checkoutUiState.customCheckout || {}),
          taxQuote: {
            status: 'error',
            amountCents: 0,
            taxDetails: null,
            label: formatTaxPendingLabel()
          }
        };
      }

      syncFirstPartyCartTipUI();
      syncCheckoutPreviewSummaryUI();
    }

    async function quoteStoreCheckoutTaxForSubmit(shippingDraft, shippingCents) {
      const state = store.getState();
      const subtotalCents = buildFirstPartyPricing(state).discountedSubtotalCents;
      if (subtotalCents <= 0) return null;

      const billingDestination = normalizeTaxDestination(getCurrentBillingAddress(state));
      const shippingDestination = normalizeTaxDestination({
        country: shippingDraft?.address?.country,
        postal_code: shippingDraft?.address?.postal_code,
        state: shippingDraft?.address?.state,
        city: shippingDraft?.address?.city,
        line1: shippingDraft?.address?.line1,
        line2: shippingDraft?.address?.line2
      });
      const hasBillingDestination = isTaxDestinationReadyForQuote(billingDestination);
      const hasShippingDestination = isTaxDestinationReadyForQuote(shippingDestination);
      if (!hasBillingDestination && !hasShippingDestination) return null;

      try {
        const response = await fetch(`${getWorkerBase()}/tax/quote`, {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            subtotalCents,
            shippingCents: Math.max(0, Math.round(Number(shippingCents || 0))),
            billingAddress: hasBillingDestination ? billingDestination : undefined,
            shippingAddress: hasShippingDestination ? shippingDestination : undefined
          })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) return null;

        const taxQuote = buildCartTaxQuoteState(data, checkoutUiState.customCheckout?.taxQuote);
        checkoutUiState.customCheckout = {
          ...(checkoutUiState.customCheckout || {}),
          taxQuote
        };
        syncCheckoutPreviewSummaryUI();
        return taxQuote;
      } catch (_error) {
        return null;
      }
    }

    async function refreshCustomCheckoutEstimates() {
      await refreshCustomCheckoutShippingEstimate();
      await refreshCustomCheckoutTaxEstimate();
      syncCheckoutStartButton();
    }

    async function syncCustomCheckoutShippingToStripe(options) {
      const shippingDraft = readCustomCheckoutShippingDraft();
      persistCustomCheckoutDraftState(undefined, shippingDraft);
      checkoutUiState.customCheckout = {
        ...(checkoutUiState.customCheckout || {}),
        shippingDraft,
        shippingError: ''
      };

      const missingRequiredField = !shippingDraft.name ||
        !shippingDraft.address.line1 ||
        !shippingDraft.address.city ||
        !shippingDraft.address.state ||
        !shippingDraft.address.postal_code ||
        !shippingDraft.address.country;

      if (missingRequiredField) {
        const message = getRuntimeMessage('cart.shippingAddressRequired', 'Enter a complete shipping address to continue.');
        checkoutUiState.customCheckout.shippingError = message;
        setCustomCheckoutShippingError(message);
        return {
          ok: false,
          message
        };
      }

      if (!activeCustomCheckoutMount || typeof activeCustomCheckoutMount.updateShippingAddress !== 'function') {
        setCustomCheckoutShippingError('');
        return { ok: true };
      }

      const result = await activeCustomCheckoutMount.updateShippingAddress(shippingDraft);
      const message = result?.error?.message || '';
      checkoutUiState.customCheckout.shippingError = message;
      setCustomCheckoutShippingError(message);

      if (message && options?.raise) {
        throw new Error(message);
      }

      return {
        ok: !message,
        message
      };
    }

    async function syncCustomCheckoutEmailToStripe(email, options) {
      const trimmedEmail = String(email || '').trim();
      persistCustomCheckoutDraftState(trimmedEmail, undefined);
      checkoutUiState.customCheckout = {
        ...(checkoutUiState.customCheckout || {}),
        emailDraft: trimmedEmail,
        emailError: ''
      };

      if (!trimmedEmail) {
        const message = getRuntimeMessage('cart.emailRequired', 'Enter an email address to continue.');
        checkoutUiState.customCheckout.emailError = message;
        setCustomCheckoutEmailError(message);
        return {
          ok: false,
          message
        };
      }

      if (!activeCustomCheckoutMount || typeof activeCustomCheckoutMount.updateEmail !== 'function') {
        setCustomCheckoutEmailError('');
        return { ok: true };
      }

      const result = await activeCustomCheckoutMount.updateEmail(trimmedEmail);
      const message = result?.error?.message || '';
      checkoutUiState.customCheckout.emailError = message;
      setCustomCheckoutEmailError(message);

      if (message && options?.raise) {
        throw new Error(message);
      }

      return {
        ok: !message,
        message
      };
    }

    async function mountCustomCheckoutIntoDrawer(root) {
      if (!root || currentRoute !== CHECKOUT_VIEW_ROUTE || checkoutUiState.mode !== 'custom') return;
      if (!checkoutUiState.customCheckout || checkoutUiState.customCheckout.scriptStatus !== 'ready') return;
      const paymentContainer = root.querySelector('[data-cart-custom-checkout-region="payment"]');
      const shippingContainer = root.querySelector('[data-cart-custom-checkout-region="address"]');
      const mountStatus = checkoutUiState.customCheckout.mountStatus || 'idle';
      const livePaymentUiMissing = !paymentContainer || paymentContainer.childElementCount === 0;

      if (mountStatus !== 'idle') {
        if ((mountStatus === 'mounting' || mountStatus === 'mounted') && livePaymentUiMissing) {
          invalidateCustomCheckoutFlow();
          teardownActiveCustomCheckoutMount();
          checkoutUiState.customCheckout = {
            ...(checkoutUiState.customCheckout || {}),
            mountStatus: 'idle'
          };
        } else {
          return;
        }
      }

      const useStorePaymentIntent = isStorePaymentIntentCheckout();
      const stripeSidecar = getStripeCheckoutSidecar();
      const mountStripeCheckout = useStorePaymentIntent
        ? stripeSidecar?.mountPaymentIntent
        : stripeSidecar?.mount;
      if (typeof mountStripeCheckout !== 'function') return;
      const flowToken = customCheckoutFlowToken;

      checkoutUiState.customCheckout.mountStatus = 'mounting';
      syncCustomCheckoutConfirmButton();

      try {
        const mountResult = await mountStripeCheckout({
          publishableKey: checkoutUiState.customCheckout.publishableKey,
          clientSecret: checkoutUiState.customCheckout.clientSecret,
          locale: getCurrentLang(),
          returnUrl: useStorePaymentIntent
            ? buildStoreOrderSuccessUrl(checkoutUiState.customCheckout.orderId)
            : undefined,
          paymentContainer,
          shippingContainer,
          useShippingAddressElement: Boolean(shippingContainer),
          allowedCountries: SHIPPING_COUNTRY_OPTIONS.map((option) => option.value),
          defaultCountry: DEFAULT_SHIPPING_COUNTRY,
          onChange: function(event) {
            if (!isActiveCustomCheckoutFlow(flowToken)) return;
            checkoutUiState.customCheckout = {
              ...(checkoutUiState.customCheckout || {}),
              canConfirm: useStorePaymentIntent
                ? event?.complete === true
                : Boolean(event?.session?.canConfirm)
            };
            syncCustomCheckoutConfirmButton();
          },
          onLoadError: function(message) {
            if (!isActiveCustomCheckoutFlow(flowToken)) return;
            activeCustomCheckoutMount = null;
            void abandonActiveCustomCheckoutIntent(getActiveCustomCheckoutOrderId());
            checkoutUiState.status = 'idle';
            checkoutUiState.customCheckout = {
              ...(checkoutUiState.customCheckout || {}),
              mountStatus: 'error',
              canConfirm: false
            };
            setCheckoutUiError(message || getRuntimeMessage('cart.secureCheckoutMountError', 'Secure checkout could not be mounted.'));
            syncCustomCheckoutConfirmButton();
          }
        });

        if (!isActiveCustomCheckoutFlow(flowToken)) {
          try {
            mountResult?.unmount?.();
          } catch (_error) {}
          return;
        }

        activeCustomCheckoutMount = mountResult;
        checkoutUiState.customCheckout.mountStatus = 'mounted';
        if (shippingContainer && !mountResult?.supportsShippingAddressElement) {
          shippingContainer.hidden = true;
          const fallbackShipping = root.querySelector('[data-cart-custom-shipping-fallback]');
          if (fallbackShipping) {
            fallbackShipping.hidden = false;
          }
        }
        syncCustomCheckoutConfirmButton();
      } catch (error) {
        if (!isActiveCustomCheckoutFlow(flowToken)) return;
        activeCustomCheckoutMount = null;
        await abandonActiveCustomCheckoutIntent(getActiveCustomCheckoutOrderId());
        setCheckoutUiState({
          status: 'idle',
          mode: 'custom',
          error: error?.message || 'Secure checkout could not be mounted.',
          customCheckout: {
            ...(checkoutUiState.customCheckout || {}),
            mountStatus: 'error',
            canConfirm: false
          }
        });
      }
    }

    async function confirmCustomCheckout() {
      if (isCustomCheckoutBusy()) return;
      if (!activeCustomCheckoutMount || typeof activeCustomCheckoutMount.confirm !== 'function') {
        setCheckoutUiState({
          ...checkoutUiState,
          status: 'idle',
          error: getRuntimeMessage('cart.secureCheckoutNotReady', 'Secure checkout is not ready yet.')
        });
        return;
      }

      const root = getCartRoot();
      const emailInput = root?.querySelector('[data-cart-custom-checkout-email]');
      const emailFallbackVisible = Boolean(root?.querySelector('[data-cart-custom-checkout-email-fallback]:not([hidden])'));
      const emailValue = emailInput instanceof HTMLInputElement ? emailInput.value : '';
      const mount = activeCustomCheckoutMount;
      const flowToken = customCheckoutFlowToken;
      const orderId = String(checkoutUiState.customCheckout?.orderId || '');
      const confirmingStorePaymentIntent = isStorePaymentIntentCheckout();
      if (!isCustomCheckoutConfirmable()) {
        setCheckoutUiState({
          ...checkoutUiState,
          status: 'idle',
          error: getRuntimeMessage('cart.secureCheckoutNotReady', 'Secure checkout is not ready yet.')
        });
        syncCustomCheckoutConfirmButton();
        return;
      }

      try {
        checkoutUiState.status = 'confirming';
        setCheckoutUiError('');
        checkoutUiState.customCheckout = {
          ...(checkoutUiState.customCheckout || {}),
          emailDraft: String(emailValue || '').trim(),
          emailError: ''
        };
        syncCustomCheckoutConfirmButton();
        setCustomCheckoutEmailError('');

        if (emailFallbackVisible) {
          const emailResult = await syncCustomCheckoutEmailToStripe(emailValue, { raise: true });
          if (!emailResult.ok) {
            checkoutUiState.status = 'idle';
            checkoutUiState.customCheckout = {
              ...(checkoutUiState.customCheckout || {}),
              emailDraft: String(emailValue || '').trim(),
              emailError: emailResult.message || ''
            };
            focusCustomCheckoutEmailField();
            syncCustomCheckoutConfirmButton();
            return;
          }
        }

        if (getCartRoot()?.querySelector('[data-cart-custom-shipping-fallback]:not([hidden])')) {
          const shippingResult = await syncCustomCheckoutShippingToStripe({ raise: true });
          if (!shippingResult.ok) {
            checkoutUiState.status = 'idle';
            syncCustomCheckoutConfirmButton();
            return;
          }
        }

        const result = await mount.confirm(confirmingStorePaymentIntent
          ? buildStorePaymentIntentConfirmOptions(emailValue)
          : undefined);
        if (result?.type === 'error' || result?.error) {
          checkoutUiState.status = 'idle';
          const emailFieldMessage = getCustomCheckoutEmailFieldMessage(result);
          if (emailFieldMessage) {
            checkoutUiState.customCheckout = {
              ...(checkoutUiState.customCheckout || {}),
              emailError: emailFieldMessage
            };
            setCustomCheckoutEmailError(emailFieldMessage);
            setCheckoutUiError('');
            focusCustomCheckoutEmailField();
            syncCustomCheckoutConfirmButton();
            return;
          }
          if (shouldShowCheckoutLevelStripeError(result)) {
            setCheckoutUiError(result?.error?.message || (confirmingStorePaymentIntent
              ? 'Stripe could not confirm the payment.'
              : 'Stripe could not confirm the setup.'));
          } else {
            setCheckoutUiError('');
          }
          syncCustomCheckoutConfirmButton();
          return;
        }

        if (!isActiveCustomCheckoutFlow(flowToken)) {
          return;
        }

        checkoutUiState.status = 'redirecting';
        syncCustomCheckoutConfirmButton();

        if (!confirmingStorePaymentIntent) {
          throw new Error('Store payment confirmation was not active.');
        }

        clearStoreCartAfterOrder();
        redirectWindow(buildStoreOrderSuccessPath(orderId));
        return;
      } catch (error) {
        checkoutUiState.status = 'idle';
        const emailFieldMessage = getCustomCheckoutEmailFieldMessage(error);
        if (emailFieldMessage) {
          checkoutUiState.customCheckout = {
            ...(checkoutUiState.customCheckout || {}),
            emailError: emailFieldMessage
          };
          setCustomCheckoutEmailError(emailFieldMessage);
          setCheckoutUiError('');
          focusCustomCheckoutEmailField();
          syncCustomCheckoutConfirmButton();
          return;
        }
        setCheckoutUiError(error?.message || (confirmingStorePaymentIntent
          ? getRuntimeMessage('cart.paymentConfirmError', 'There was an error confirming your payment.')
          : getRuntimeMessage('cart.savePaymentError', 'There was an error saving your payment method.')));
        syncCustomCheckoutConfirmButton();
      }
    }

    async function bootstrapCustomCheckout(data, stripeReadyPromise) {
      const flowToken = invalidateCustomCheckoutFlow();
      const existingCustomCheckout = checkoutUiState.customCheckout || {};
      const nextCustomCheckout = {
        ...existingCustomCheckout,
        checkoutUiMode: 'custom',
        sessionId: String(data?.sessionId || ''),
        clientSecret: String(data?.clientSecret || ''),
        publishableKey: String(data?.publishableKey || ''),
        orderId: String(data?.orderId || ''),
        scriptStatus: 'loading',
        mountStatus: 'idle'
      };

      setCheckoutUiState({
        status: 'idle',
        error: '',
        mode: 'custom',
        customCheckout: nextCustomCheckout
      });
      writeActiveCustomCheckoutOrderId(nextCustomCheckout.orderId);

      try {
        if (stripeReadyPromise) {
          await stripeReadyPromise.catch(() => loadStripeJs());
        } else {
          await loadStripeJs();
        }
        if (!isActiveCustomCheckoutFlow(flowToken)) return;
        const refreshedCustomCheckout = checkoutUiState.customCheckout || nextCustomCheckout;
        setCheckoutUiState({
          status: 'idle',
          error: '',
          mode: 'custom',
          customCheckout: {
            ...refreshedCustomCheckout,
            sessionId: nextCustomCheckout.sessionId,
            clientSecret: nextCustomCheckout.clientSecret,
            publishableKey: nextCustomCheckout.publishableKey,
            orderId: nextCustomCheckout.orderId,
            checkoutUiMode: nextCustomCheckout.checkoutUiMode,
            scriptStatus: 'ready',
            mountStatus: 'idle'
          }
        });
      } catch (error) {
        if (!isActiveCustomCheckoutFlow(flowToken)) return;
        await abandonActiveCustomCheckoutIntent(nextCustomCheckout.orderId);
        const refreshedCustomCheckout = checkoutUiState.customCheckout || nextCustomCheckout;
        setCheckoutUiState({
          status: 'idle',
          mode: 'custom',
          error: error?.message || getRuntimeMessage('cart.secureCheckoutMountError', 'Secure checkout could not be mounted.'),
          customCheckout: {
            ...refreshedCustomCheckout,
            sessionId: nextCustomCheckout.sessionId,
            clientSecret: nextCustomCheckout.clientSecret,
            publishableKey: nextCustomCheckout.publishableKey,
            orderId: nextCustomCheckout.orderId,
            checkoutUiMode: nextCustomCheckout.checkoutUiMode,
            scriptStatus: 'error',
            mountStatus: 'error'
          }
        });
      }
    }

    async function bootstrapStorePaymentIntentCheckout(data, stripeReadyPromise) {
      const flowToken = invalidateCustomCheckoutFlow();
      const existingCustomCheckout = checkoutUiState.customCheckout || {};
      const nextCustomCheckout = {
        ...existingCustomCheckout,
        checkoutUiMode: 'payment_intent',
        sessionId: '',
        paymentIntentId: String(data?.paymentIntentId || ''),
        clientSecret: String(data?.clientSecret || ''),
        publishableKey: String(data?.publishableKey || ''),
        orderId: String(data?.orderToken || data?.orderId || ''),
        scriptStatus: 'loading',
        mountStatus: 'idle',
        canConfirm: false
      };

      setCheckoutUiState({
        status: 'idle',
        error: '',
        mode: 'custom',
        customCheckout: nextCustomCheckout
      });
      writeActiveCustomCheckoutOrderId(nextCustomCheckout.orderId);

      try {
        if (stripeReadyPromise) {
          await stripeReadyPromise.catch(() => loadStripeJs());
        } else {
          await loadStripeJs();
        }
        if (!isActiveCustomCheckoutFlow(flowToken)) return;
        const refreshedCustomCheckout = checkoutUiState.customCheckout || nextCustomCheckout;
        setCheckoutUiState({
          status: 'idle',
          error: '',
          mode: 'custom',
          customCheckout: {
            ...refreshedCustomCheckout,
            checkoutUiMode: nextCustomCheckout.checkoutUiMode,
            sessionId: '',
            paymentIntentId: nextCustomCheckout.paymentIntentId,
            clientSecret: nextCustomCheckout.clientSecret,
            publishableKey: nextCustomCheckout.publishableKey,
            orderId: nextCustomCheckout.orderId,
            scriptStatus: 'ready',
            mountStatus: 'idle'
          }
        });
      } catch (error) {
        if (!isActiveCustomCheckoutFlow(flowToken)) return;
        await abandonActiveCustomCheckoutIntent(nextCustomCheckout.orderId);
        const refreshedCustomCheckout = checkoutUiState.customCheckout || nextCustomCheckout;
        setCheckoutUiState({
          status: 'idle',
          mode: 'custom',
          error: error?.message || getRuntimeMessage('cart.secureCheckoutMountError', 'Secure checkout could not be mounted.'),
          customCheckout: {
            ...refreshedCustomCheckout,
            checkoutUiMode: nextCustomCheckout.checkoutUiMode,
            sessionId: '',
            paymentIntentId: nextCustomCheckout.paymentIntentId,
            clientSecret: nextCustomCheckout.clientSecret,
            publishableKey: nextCustomCheckout.publishableKey,
            orderId: nextCustomCheckout.orderId,
            scriptStatus: 'error',
            mountStatus: 'error'
          }
        });
      }
    }

    async function startFirstPartyCheckout() {
      if (checkoutUiState.status === 'submitting') return;

      if (getRequestedCheckoutProvider() !== FIRST_PARTY_CHECKOUT_PROVIDER) {
        setCheckoutUiState({
          status: 'idle',
          error: getRuntimeMessage('cart.firstPartyDisabled', 'First-party checkout is not enabled for this build.')
        });
        return;
      }

      const state = store.getState();
      const startsStoreCheckout = cartHasStoreItems(state?.cart?.items?.items || []);
      const shouldDeferCustomCheckout = shouldDeferPhysicalCustomCheckoutStart(state, {
        currentRoute,
        checkoutMode: checkoutUiState.mode,
        hasCustomCheckoutSession: Boolean(checkoutUiState.customCheckout?.sessionId || checkoutUiState.customCheckout?.clientSecret)
      });
      const shippingDraft = shouldDeferCustomCheckout ? readCustomCheckoutShippingDraft() : null;
      const requiresTaxLocation = cartRequiresCustomCheckoutTaxLocation(state);

      if (requiresTaxLocation) {
        clearCustomCheckoutTaxDraftSyncTimer();
        await syncCustomCheckoutTaxDraft({ refreshEstimate: false });
      }

      const billingDestination = readReadyTaxDestination(store.getState());
      const emailField = getCartRoot()?.querySelector('[data-cart-custom-checkout-email]');
      const emailValue = emailField instanceof HTMLInputElement
        ? String(emailField.value || '').trim()
        : readCustomCheckoutEmailDraft();

      if (shouldDeferCustomCheckout && !isCustomCheckoutShippingDraftComplete(shippingDraft)) {
        const message = getRuntimeMessage('cart.shippingAddressRequired', 'Enter a complete shipping address to continue.');
        checkoutUiState.customCheckout = {
          ...(checkoutUiState.customCheckout || {}),
          shippingDraft,
          shippingError: message
        };
        setCustomCheckoutShippingError(message);
        syncCheckoutPreviewSummaryUI();
        return;
      }

      if (requiresTaxLocation && !billingDestination) {
        const message = getTaxLocationRequiredMessage(getCurrentBillingAddress(state));
        checkoutUiState.customCheckout = {
          ...(checkoutUiState.customCheckout || {}),
          taxError: message
        };
        setCustomCheckoutTaxError(message);
        focusCustomCheckoutTaxField();
        return;
      }

      setCheckoutUiState({
        status: 'submitting',
        error: ''
      });

      if ((requiresTaxLocation && billingDestination) || startsStoreCheckout) {
        await refreshCustomCheckoutTaxEstimate({
          shippingDraft
        });
      }

      const payloadResult = buildFirstPartyCheckoutPayload(state);
      if (!payloadResult.valid) {
        setCheckoutUiState({
          status: 'idle',
          error: payloadResult.error
        });
        return;
      }

      if (shouldDeferCustomCheckout && shippingDraft) {
        payloadResult.payload.shippingAddress = {
          name: shippingDraft.name,
          country: shippingDraft.address.country,
          postalCode: shippingDraft.address.postal_code,
          state: shippingDraft.address.state,
          city: shippingDraft.address.city,
          line1: shippingDraft.address.line1,
          line2: shippingDraft.address.line2
        };
        if (payloadResult.kind === 'store' && shippingDraft.name) {
          payloadResult.payload.customer = {
            ...(payloadResult.payload.customer || {}),
            name: shippingDraft.name
          };
        }
      }

      payloadResult.payload.shippingOption = checkoutUiState.customCheckout?.shippingQuote?.selectedOption || 'standard';

      if (emailValue) {
        payloadResult.payload.email = emailValue;
        if (payloadResult.kind === 'store') {
          payloadResult.payload.customer = {
            ...(payloadResult.payload.customer || {}),
            email: emailValue
          };
        }
      }
      payloadResult.payload.abandonedCartConsent = readAbandonedCheckoutConsentDraft();

      if (payloadResult.kind === 'store') {
        const displayedPricing = getDisplayedFirstPartyPricing(store.getState(), {
          currentRoute,
          checkoutMode: checkoutUiState.mode,
          shippingQuote: checkoutUiState.customCheckout?.shippingQuote,
          taxQuote: checkoutUiState.customCheckout?.taxQuote
        });
        payloadResult.payload.shippingCents = Math.max(0, Math.round(Number(displayedPricing.shippingCents || 0)));
        const submitTaxQuote = await quoteStoreCheckoutTaxForSubmit(
          shouldDeferCustomCheckout ? shippingDraft : null,
          payloadResult.payload.shippingCents
        );
        payloadResult.payload.taxCents = submitTaxQuote
          ? Math.max(0, Math.round(Number(submitTaxQuote.amountCents || 0)))
          : Math.max(0, Math.round(Number(displayedPricing.taxCents || 0)));
      }

      try {
        const stripeReadyPromise = canUseCustomCheckoutUi() ? prewarmStripeJs() : null;
        const existingOrderId = getActiveCustomCheckoutOrderId();
        if (existingOrderId) {
          await abandonActiveCustomCheckoutIntent(existingOrderId);
        }

        const response = await fetch(`${getWorkerBase()}${payloadResult.endpoint || STORE_CHECKOUT_INTENT_ENDPOINT}`, {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payloadResult.payload)
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error || `Worker returned ${response.status}`);
        }

        if (data?.nextAction === 'order_confirmed' || data?.requiresPayment === false) {
          clearStoreCartAfterOrder();
          redirectWindow(buildStoreOrderSuccessPath(data?.orderToken || ''));
          return;
        }

        if (data?.checkoutUiMode === 'payment_intent') {
          if (!data?.clientSecret || !data?.publishableKey || !data?.paymentIntentId || !data?.orderToken) {
            throw new Error('Store payment bootstrap was incomplete.');
          }

          await bootstrapStorePaymentIntentCheckout(data, stripeReadyPromise);
          return;
        }

        throw new Error('Store checkout returned an unsupported payment flow.');
      } catch (error) {
        invalidateCustomCheckoutFlow();
        const errorMessage = error?.message || getRuntimeMessage('cart.startOrderError', 'There was an error starting your order.');
        const preservedCustomCheckout = checkoutUiState.customCheckout || null;
        setCheckoutUiState({
          status: 'idle',
          error: errorMessage,
          mode: getCheckoutUiMode(),
          customCheckout: preservedCustomCheckout
        });
        setCheckoutUiError(errorMessage);
      }
    }

    function shouldBootstrapCustomCheckoutSession() {
      const state = store.getState();
      return (
        currentRoute === CHECKOUT_VIEW_ROUTE &&
        getRequestedCheckoutProvider() === FIRST_PARTY_CHECKOUT_PROVIDER &&
        getCheckoutUiMode() === 'custom' &&
        checkoutUiState.status === 'idle' &&
        (!cartRequiresCustomCheckoutTaxLocation(state) || Boolean(readReadyTaxDestination(state))) &&
        !checkoutUiState.customCheckout?.sessionId &&
        !checkoutUiState.customCheckout?.clientSecret
      );
    }

    function ensureCustomCheckoutBootstrapped() {
      if (!shouldBootstrapCustomCheckoutSession()) return;
      void startFirstPartyCheckout();
    }

    function ensureCustomCheckoutMounted(root) {
      if (!root || currentRoute !== CHECKOUT_VIEW_ROUTE || checkoutUiState.mode !== 'custom') return;
      const customCheckout = checkoutUiState.customCheckout || null;
      const hasBootstrapSecret = isStorePaymentIntentCheckout(customCheckout)
        ? Boolean(customCheckout?.clientSecret)
        : Boolean(customCheckout?.sessionId && customCheckout?.clientSecret);
      if (!hasBootstrapSecret) return;
      if (checkoutUiState.customCheckout?.scriptStatus !== 'ready') return;
      if (checkoutUiState.customCheckout?.mountStatus !== 'mounted') return;

      const paymentContainer = root.querySelector('[data-cart-custom-checkout-region="payment"]');
      const paymentUiMissing = !paymentContainer || paymentContainer.childElementCount === 0;
      if (!paymentUiMissing) return;

      checkoutUiState.customCheckout = {
        ...(checkoutUiState.customCheckout || {}),
        mountStatus: 'idle'
      };
      mountCustomCheckoutIntoDrawer(root);
    }

    async function applyCartCouponFromForm(form) {
      const input = form ? form.querySelector('[data-cart-coupon-code]') : null;
      const code = normalizeCouponCodeInput(input ? input.value : '');
      if (!code) {
        updateCartState((state) => ({
          ...state,
          cart: {
            ...state.cart,
            couponCode: '',
            coupon: null,
            couponStatus: '',
            couponError: getRuntimeMessage('cart.couponRequired', 'Enter a coupon code.')
          }
        }));
        return;
      }

      updateCartState((state) => ({
        ...state,
        cart: {
          ...state.cart,
          couponCode: code,
          couponStatus: 'loading',
          couponError: ''
        }
      }));

      const payloadResult = buildStoreCheckoutPayload(store.getState());
      if (!payloadResult.valid) {
        updateCartState((state) => ({
          ...state,
          cart: {
            ...state.cart,
            couponStatus: '',
            couponError: payloadResult.error || getRuntimeMessage('cart.couponApplyError', 'Coupon could not be applied.')
          }
        }));
        return;
      }
      payloadResult.payload.couponCode = code;

      try {
        const response = await fetch(`${getWorkerBase()}/api/cart/validate`, {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payloadResult.payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
          throw new Error(data.error || (Array.isArray(data.errors) && data.errors[0]?.message) || getRuntimeMessage('cart.couponInvalid', 'Coupon code could not be applied.'));
        }
        const coupon = normalizeAppliedCoupon(data.coupon || data.totals?.coupon);
        if (!coupon) {
          throw new Error(getRuntimeMessage('cart.couponNotEligible', 'Coupon code does not apply to this cart.'));
        }
        updateCartState((state) => ({
          ...state,
          cart: {
            ...state.cart,
            couponCode: coupon.code,
            coupon,
            couponStatus: 'applied',
            couponError: ''
          }
        }));
        refreshCustomCheckoutEstimates();
      } catch (error) {
        updateCartState((state) => ({
          ...state,
          cart: {
            ...state.cart,
            couponCode: code,
            coupon: null,
            couponStatus: '',
            couponError: error?.message || getRuntimeMessage('cart.couponApplyError', 'Coupon could not be applied.')
          }
        }));
      }
    }

    function removeCartCoupon() {
      updateCartState((state) => ({
        ...state,
        cart: {
          ...state.cart,
          couponCode: '',
          coupon: null,
          couponStatus: '',
          couponError: ''
        }
      }));
      refreshCustomCheckoutEstimates();
    }

    function bindFirstPartyCartChrome() {
      if (document._storeFirstPartyCartChromeHandler) {
        document.removeEventListener('click', document._storeFirstPartyCartChromeHandler);
      }

      document._storeFirstPartyCartChromeHandler = function handleFirstPartyCartChrome(event) {
        const closeTrigger = event.target?.closest?.('[data-cart-close]');
        if (closeTrigger) {
          event.preventDefault();
          requestCloseFirstPartyCart();
          return;
        }

        const couponApplyTrigger = event.target?.closest?.('[data-cart-coupon-apply]');
        if (couponApplyTrigger) {
          event.preventDefault();
          applyCartCouponFromForm(couponApplyTrigger.closest('[data-cart-coupon-form]'));
          return;
        }

        const couponRemoveTrigger = event.target?.closest?.('[data-cart-coupon-remove]');
        if (couponRemoveTrigger) {
          event.preventDefault();
          removeCartCoupon();
          return;
        }

        const continueTrigger = event.target?.closest?.('[data-cart-continue]');
        if (continueTrigger) {
          event.preventDefault();
          eventBus.emit('summary.checkout_clicked');
          const prewarm = prewarmStripeJs();
          if (prewarm && typeof prewarm.catch === 'function') {
            void prewarm.catch(() => {});
          }
          cartShouldFocusAfterRender = true;
          apiRoot.api.theme.cart.navigate(CHECKOUT_VIEW_ROUTE);
          return;
        }

        const backTrigger = event.target?.closest?.('[data-cart-back]');
        if (backTrigger) {
          event.preventDefault();
          requestBackToCart();
          return;
        }

        const startCheckoutTrigger = event.target?.closest?.('[data-cart-start-checkout]');
        if (startCheckoutTrigger) {
          event.preventDefault();
          startFirstPartyCheckout();
          return;
        }

        const confirmCustomCheckoutTrigger = event.target?.closest?.('[data-cart-confirm-custom-checkout]');
        if (confirmCustomCheckoutTrigger) {
          event.preventDefault();
          confirmCustomCheckout();
          return;
        }

        const addOnAddTrigger = event.target?.closest?.('[data-cart-addon-add]');
        if (addOnAddTrigger) {
          event.preventDefault();
          const productId = String(addOnAddTrigger.getAttribute('data-addon-product-id') || '');
          const card = addOnAddTrigger.closest('[data-cart-addon-product]');
          const variantField = card?.querySelector('[data-cart-addon-variant]');
          const quantityField = card?.querySelector('[data-cart-addon-product-quantity]');
          const variantId = variantField instanceof HTMLSelectElement ? String(variantField.value || '') : '';
          const quantity = quantityField instanceof HTMLInputElement
            ? Math.min(
                Math.max(1, parseInt(quantityField.max, 10) || 1),
                Math.max(1, parseInt(quantityField.value, 10) || 1)
              )
            : 1;
          if (quantityField instanceof HTMLInputElement) {
            quantityField.value = String(quantity);
          }
          setCartAddOnDraft(productId, { variantId, quantity });
          applyCartBundleAddOnSelections(
            buildCartAddOnSelectionsFromProductState(
              store.getState()?.cart?.items?.items || [],
              productId,
              variantId,
              quantity
            )
          );
          return;
        }

        const addOnRemoveTrigger = event.target?.closest?.('[data-cart-addon-remove]');
        if (addOnRemoveTrigger) {
          event.preventDefault();
          const productId = String(addOnRemoveTrigger.getAttribute('data-addon-product-id') || '');
          const card = addOnRemoveTrigger.closest('[data-cart-addon-product]');
          const variantField = card?.querySelector('[data-cart-addon-variant]');
          setCartAddOnDraft(productId, {
            variantId: variantField instanceof HTMLSelectElement ? String(variantField.value || '') : '',
            quantity: 1
          });
          applyCartBundleAddOnSelections(
            buildCartAddOnSelectionsFromProductState(
              store.getState()?.cart?.items?.items || [],
              productId,
              '',
              0
            )
          );
          return;
        }

        const quantityStepTrigger = event.target?.closest?.('[data-cart-item-quantity-step]');
        if (quantityStepTrigger) {
          event.preventDefault();
          const uniqueId = String(quantityStepTrigger.getAttribute('data-cart-item-id') || '');
          const step = Number(quantityStepTrigger.getAttribute('data-cart-item-quantity-step') || 0);
          if (!uniqueId || !Number.isFinite(step) || step === 0) return;

          const item = (store.getState()?.cart?.items?.items || []).find((entry) => entry.uniqueId === uniqueId);
          if (!item) return;

          const currentQuantity = Math.max(1, Number(item.quantity || 1));
          const nextQuantity = Math.max(1, currentQuantity + step);
          if (nextQuantity === currentQuantity) return;

          apiRoot.api.cart.items.update(uniqueId, { quantity: nextQuantity });
          return;
        }

        const removeTrigger = event.target?.closest?.('[data-remove-item]');
        if (!removeTrigger) return;

        event.preventDefault();
        const uniqueId = removeTrigger.getAttribute('data-remove-item');
        if (!uniqueId) return;

        apiRoot.api.cart.items.remove(uniqueId);
      };

      document.addEventListener('click', document._storeFirstPartyCartChromeHandler);
    }

    function bindFirstPartyCartInputs() {
      if (document._storeFirstPartyCartInputHandler) {
        document.removeEventListener('input', document._storeFirstPartyCartInputHandler);
      }
      if (document._storeFirstPartyCartChangeHandler) {
        document.removeEventListener('change', document._storeFirstPartyCartChangeHandler);
      }
      if (document._storeFirstPartyCartSubmitHandler) {
        document.removeEventListener('submit', document._storeFirstPartyCartSubmitHandler);
      }

      document._storeFirstPartyCartInputHandler = function handleFirstPartyCartInput(event) {
        const tipField = event.target?.closest?.('[data-cart-tip]');
        if (tipField) {
          suppressDrawerRerender = true;
          apiRoot.api.cart.update({
            tipPercent: tipField.value
          });
          syncFirstPartyCartTipUI();
          return;
        }

        const addOnQuantityField = event.target?.closest?.('[data-cart-addon-product-quantity]');
        if (addOnQuantityField instanceof HTMLInputElement) {
          const quantity = Math.max(1, parseInt(addOnQuantityField.value, 10) || 1);
          const maxQuantity = Math.max(1, parseInt(addOnQuantityField.max, 10) || quantity);
          const clampedQuantity = Math.min(maxQuantity, quantity);
          if (String(clampedQuantity) !== String(addOnQuantityField.value || '')) {
            addOnQuantityField.value = String(clampedQuantity);
          }
          const productId = String(addOnQuantityField.getAttribute('data-addon-product-id') || '');
          const card = addOnQuantityField.closest('[data-cart-addon-product]');
          const variantField = card?.querySelector('[data-cart-addon-variant]');
          const variantId = variantField instanceof HTMLSelectElement ? String(variantField.value || '') : '';
          setCartAddOnDraft(productId, { variantId, quantity: clampedQuantity });
          if (card?.getAttribute('data-cart-addon-active') === 'true') {
            applyCartBundleAddOnSelections(
              buildCartAddOnSelectionsFromProductState(
                store.getState()?.cart?.items?.items || [],
                productId,
                variantId,
                clampedQuantity
              )
            );
          }
          return;
        }

        const cartEstimatePostalField = event.target?.closest?.('[data-cart-estimate-postal]');
        if (cartEstimatePostalField instanceof HTMLInputElement) {
          persistCustomCheckoutDraftState(undefined, mergeShippingDraftWithDefaults({
            address: {
              postal_code: cartEstimatePostalField.value,
              country: getPersistedShippingEstimateCountry(
                checkoutUiState?.customCheckout?.shippingDraft,
                persistedCustomCheckoutShippingDraft
              )
            }
          }, checkoutUiState?.customCheckout?.shippingDraft, persistedCustomCheckoutShippingDraft));
          refreshCustomCheckoutEstimates();
          return;
        }

        const shippingField = event.target?.closest?.('[data-cart-custom-shipping-field]');
        if (shippingField instanceof HTMLInputElement || shippingField instanceof HTMLSelectElement) {
          checkoutUiState.customCheckout = {
            ...(checkoutUiState.customCheckout || {}),
            shippingError: ''
          };
          setCustomCheckoutShippingError('');
          syncCheckoutStartButton();
          return;
        }

        const taxDestinationField = event.target?.closest?.('[data-cart-tax-destination-field]');
        if (taxDestinationField instanceof HTMLInputElement || taxDestinationField instanceof HTMLSelectElement) {
          const taxDraft = readCustomCheckoutTaxDraft();
          checkoutUiState.customCheckout = {
            ...(checkoutUiState.customCheckout || {}),
            taxError: ''
          };
          setCustomCheckoutTaxError('');
          syncCustomCheckoutTaxLocationNote(taxDraft);
          syncCheckoutStartButton();
          return;
        }

        const emailField = event.target?.closest?.('[data-cart-email]');
        if (!emailField) return;

        apiRoot.api.cart.update({
          email: emailField.value
        });
      };

      document._storeFirstPartyCartChangeHandler = function handleFirstPartyCartChange(event) {
        const tipField = event.target?.closest?.('[data-cart-tip]');
        if (tipField) {
          suppressDrawerRerender = false;
          syncFirstPartyCartTipUI();
          return;
        }

        const cartItemQuantityField = event.target?.closest?.('[data-cart-item-quantity]');
        if (cartItemQuantityField instanceof HTMLInputElement) {
          const uniqueId = String(cartItemQuantityField.getAttribute('data-cart-item-id') || '');
          const requestedQuantity = Math.max(1, parseInt(cartItemQuantityField.value || '1', 10) || 1);
          if (!uniqueId) return;

          const item = (store.getState()?.cart?.items?.items || []).find((entry) => entry.uniqueId === uniqueId);
          const maxQuantity = item ? getItemQuantityCap(item) : Infinity;
          const nextQuantity = Number.isFinite(maxQuantity)
            ? Math.min(maxQuantity, requestedQuantity)
            : requestedQuantity;
          cartItemQuantityField.value = String(nextQuantity);
          apiRoot.api.cart.items.update(uniqueId, { quantity: nextQuantity });
          return;
        }

        const emailField = event.target?.closest?.('[data-cart-email]');
        if (emailField) {
          apiRoot.api.cart.update({
            email: emailField.value
          });
          return;
        }

        const addOnVariantField = event.target?.closest?.('[data-cart-addon-variant]');
        if (addOnVariantField instanceof HTMLSelectElement) {
          const productId = String(addOnVariantField.getAttribute('data-addon-product-id') || '');
          const card = addOnVariantField.closest('[data-cart-addon-product]');
          const quantityField = card?.querySelector('[data-cart-addon-product-quantity]');
          syncCartAddOnCardVariantState(card);
          const quantity = quantityField instanceof HTMLInputElement
            ? Math.min(
                Math.max(1, parseInt(quantityField.max, 10) || 1),
                Math.max(1, parseInt(quantityField.value, 10) || 1)
              )
            : 1;
          if (quantityField instanceof HTMLInputElement) {
            quantityField.value = String(quantity);
          }
          setCartAddOnDraft(productId, { variantId: addOnVariantField.value, quantity });
          if (card?.getAttribute('data-cart-addon-active') === 'true') {
            applyCartBundleAddOnSelections(
              buildCartAddOnSelectionsFromProductState(
                store.getState()?.cart?.items?.items || [],
                productId,
                addOnVariantField.value,
                quantity
              )
            );
          }
          return;
        }

        const shippingField = event.target?.closest?.('[data-cart-custom-shipping-field]');
        if (shippingField) {
          syncCheckoutStartButton();
          void refreshCustomCheckoutEstimates().finally(() => {
            ensureCustomCheckoutBootstrapped();
          });
          syncCustomCheckoutShippingToStripe().catch((error) => {
            checkoutUiState.status = 'idle';
            setCheckoutUiError(error?.message || 'Shipping validation failed.');
            syncCustomCheckoutConfirmButton();
          });
          return;
        }

        const cartEstimatePostalField = event.target?.closest?.('[data-cart-estimate-postal]');
        if (cartEstimatePostalField instanceof HTMLInputElement) {
          persistCustomCheckoutDraftState(undefined, mergeShippingDraftWithDefaults({
            address: {
              postal_code: cartEstimatePostalField.value,
              country: getPersistedShippingEstimateCountry(
                checkoutUiState?.customCheckout?.shippingDraft,
                persistedCustomCheckoutShippingDraft
              )
            }
          }, checkoutUiState?.customCheckout?.shippingDraft, persistedCustomCheckoutShippingDraft));
          refreshCustomCheckoutEstimates();
          return;
        }

        const shippingOptionField = event.target?.closest?.('[data-cart-custom-shipping-option]');
        if (shippingOptionField instanceof HTMLSelectElement) {
          const currentQuote = checkoutUiState.customCheckout?.shippingQuote || {};
          const availableOptions = Array.isArray(currentQuote.availableOptions) ? currentQuote.availableOptions : [];
          const selectedOption = shippingOptionUtils.normalizeSelection(
            availableOptions,
            shippingOptionField.value,
            currentQuote.defaultOption
          );
          const selectedDetails = availableOptions.find((option) => option?.id === selectedOption) || null;
          checkoutUiState.customCheckout = {
            ...(checkoutUiState.customCheckout || {}),
            shippingQuote: {
              ...currentQuote,
              selectedOption,
              amountCents: Math.max(
                0,
                Number(
                  selectedDetails?.shippingCents ??
                  currentQuote.amountCents ??
                  getStoreFallbackShippingCents(store.getState()?.cart?.items?.items || [])
                ) || 0
              )
            }
          };
          if (currentRoute === CHECKOUT_VIEW_ROUTE) {
            syncCheckoutPreviewSummaryUI();
          } else {
            syncFirstPartyCartTipUI();
          }
          return;
        }

        const taxDestinationField = event.target?.closest?.('[data-cart-tax-destination-field]');
        if (taxDestinationField instanceof HTMLInputElement || taxDestinationField instanceof HTMLSelectElement) {
          const taxDraft = readCustomCheckoutTaxDraft();
          checkoutUiState.customCheckout = {
            ...(checkoutUiState.customCheckout || {}),
            taxError: ''
          };
          setCustomCheckoutTaxError('');
          syncCustomCheckoutTaxLocationNote(taxDraft);
          syncCheckoutStartButton();
          scheduleCustomCheckoutTaxDraftSync(taxDraft);
          return;
        }

        const abandonedConsentField = event.target?.closest?.('[data-cart-abandoned-consent]');
        if (abandonedConsentField instanceof HTMLInputElement) {
          persistAbandonedCheckoutConsentDraft(abandonedConsentField.checked === true);
          return;
        }

        const customCheckoutEmailField = event.target?.closest?.('[data-cart-custom-checkout-email]');
        if (!customCheckoutEmailField) return;

        syncCheckoutStartButton();
        syncCustomCheckoutEmailToStripe(customCheckoutEmailField.value).catch((error) => {
          checkoutUiState.status = 'idle';
          setCheckoutUiError(error?.message || 'Email validation failed.');
          syncCustomCheckoutConfirmButton();
        });
      };

      document._storeFirstPartyCartSubmitHandler = function handleFirstPartyCartSubmit(event) {
        const form = event.target?.closest?.('[data-cart-coupon-form]');
        if (!form) return;
        event.preventDefault();
        applyCartCouponFromForm(form);
      };

      document.addEventListener('input', document._storeFirstPartyCartInputHandler);
      document.addEventListener('change', document._storeFirstPartyCartChangeHandler);
      document.addEventListener('submit', document._storeFirstPartyCartSubmitHandler);
    }

    const apiRoot = {
      version: 'storecart-first-party',
      summary: {
        getDisplay: function() {
          return getDisplayedCartSummary();
        }
      },
      store: {
        getState: function() {
          return store.getState();
        },
        subscribe: function(handler) {
          return store.subscribe(handler);
        }
      },
      events: {
        on: function(eventName, handler) {
          return eventBus.on(eventName, handler);
        }
      },
      api: {
        cart: {
          update: function(payload) {
            const currentState = store.getState();
            const hasTipPercent = Object.prototype.hasOwnProperty.call(payload || {}, 'tipPercent');
            const nextEmail = Object.prototype.hasOwnProperty.call(payload || {}, 'email')
              ? String(payload?.email || '')
              : String(currentState.cart?.email || '');
            const nextTipPercent = hasTipPercent
              ? sanitizeTipPercent(payload?.tipPercent, currentState.cart?.tipPercent ?? getDefaultPlatformTipPercent())
              : (currentState.cart?.tipPercent ?? getDefaultPlatformTipPercent());
            const nextTipTouched = hasTipPercent ? true : currentState.cart?.tipTouched === true;
            const nextItems = currentState.cart?.items?.items || [];
            const totals = calculateCartTotals(
              nextItems,
              nextTipPercent
            );

            updateCartState((state) => ({
              ...state,
              customer: {
                ...state.customer,
                email: nextEmail
              },
              cart: {
                ...state.cart,
                ...totals,
                ...payload,
                email: nextEmail,
                tipPercent: nextTipPercent,
                tipTouched: nextTipTouched,
                billingAddress: {
                  ...(state.cart?.billingAddress || {}),
                  ...(payload?.billingAddress || {})
                }
              }
            }));
            return Promise.resolve(store.getState().cart);
          },
          items: {
            add: function(item) {
              const normalizedItem = normalizeCartItem(item);
              const previousItems = store.getState().cart.items.items || [];
              const hadItems = previousItems.length > 0;
              const existingItem = previousItems.find((currentItem) => shouldMergeCartItem(currentItem, normalizedItem));

              if (existingItem) {
                const nextQuantity = Math.min(
                  existingItem.quantity + normalizedItem.quantity,
                  getItemQuantityCap(normalizedItem)
                );
                const updatedItem = {
                  ...existingItem,
                  ...normalizedItem,
                  uniqueId: existingItem.uniqueId,
                  quantity: nextQuantity
                };

                updateCartState((state) => {
                  const nextItems = coerceBundleAddOnCartItems(
                    previousItems.map((currentItem) => currentItem.uniqueId === existingItem.uniqueId ? updatedItem : currentItem)
                  );
                  const totals = calculateCartTotals(
                    nextItems,
                    state.cart?.tipPercent
                  );

                  return {
                    ...state,
                    cart: {
                      ...state.cart,
                      ...totals,
                      couponCode: '',
                      coupon: null,
                      couponStatus: '',
                      couponError: '',
                      items: {
                        count: nextItems.length,
                        items: nextItems
                      }
                    }
                  };
                });

                if (updatedItem.quantity !== existingItem.quantity) {
                  eventBus.emit('item.updated', updatedItem);
                }

                return Promise.resolve(updatedItem);
              }

              updateCartState((state) => {
                const nextItems = coerceBundleAddOnCartItems(previousItems.concat(normalizedItem));
                const totals = calculateCartTotals(
                  nextItems,
                  state.cart?.tipPercent
                );

                return {
                  ...state,
                  cart: {
                    ...state.cart,
                    ...totals,
                    couponCode: '',
                    coupon: null,
                    couponStatus: '',
                    couponError: '',
                    items: {
                      count: nextItems.length,
                      items: nextItems
                    }
                  }
                };
              });

              if (!hadItems) {
                eventBus.emit('cart.created', normalizedItem);
              }
              eventBus.emit('item.added', normalizedItem);
              return Promise.resolve(normalizedItem);
            },
            remove: function(uniqueId) {
              let removedItem = null;

              updateCartState((state) => {
                const currentItems = state.cart.items.items || [];
                const nextItems = coerceBundleAddOnCartItems(currentItems.filter((item) => {
                  const shouldKeep = item.uniqueId !== uniqueId;
                  if (!shouldKeep) removedItem = item;
                  return shouldKeep;
                }));
                const totals = calculateCartTotals(
                  nextItems,
                  state.cart?.tipPercent
                );

                return {
                  ...state,
                  cart: {
                    ...state.cart,
                    ...totals,
                    couponCode: '',
                    coupon: null,
                    couponStatus: '',
                    couponError: '',
                    items: {
                      count: nextItems.length,
                      items: nextItems
                    }
                  }
                };
              });

              if (removedItem) {
                eventBus.emit('item.removed', removedItem);
              }
              return Promise.resolve(removedItem);
            },
            update: function(uniqueId, updates) {
              let updatedItem = null;

              updateCartState((state) => {
                const currentItems = state.cart.items.items || [];
                const nextItems = coerceBundleAddOnCartItems(currentItems.map((item) => {
                  if (item.uniqueId !== uniqueId) return item;

                  const requestedQuantity = updates?.quantity ?? item.quantity ?? 1;
                  const cappedQuantity = Math.min(
                    Math.max(1, Number(requestedQuantity)),
                    getItemQuantityCap(item)
                  );

                  updatedItem = {
                    ...item,
                    ...updates,
                    quantity: cappedQuantity
                  };

                  return updatedItem;
                }));
                const totals = calculateCartTotals(
                  nextItems,
                  state.cart?.tipPercent
                );

                return {
                  ...state,
                  cart: {
                    ...state.cart,
                    ...totals,
                    couponCode: '',
                    coupon: null,
                    couponStatus: '',
                    couponError: '',
                    items: {
                      count: nextItems.length,
                      items: nextItems
                    }
                  }
                };
              });

              if (updatedItem) {
                eventBus.emit('item.updated', updatedItem);
              }

              return Promise.resolve(updatedItem);
            }
          }
        },
        theme: {
          cart: {
            open: function() {
              const focusTarget = arguments.length > 0 ? arguments[0] : undefined;
              openFirstPartyCart(focusTarget);
              return Promise.resolve();
            },
            close: function() {
              closeFirstPartyCart();
              return Promise.resolve();
            },
            navigate: function(route) {
              const previousRoute = currentRoute;
              clearCustomCheckoutTaxDraftSyncTimer();
              if (currentRoute === CHECKOUT_VIEW_ROUTE && checkoutUiState.mode === 'custom') {
                persistCustomCheckoutDraftState(
                  readCustomCheckoutEmailDraft(),
                  readCustomCheckoutShippingDraft()
                );
              }
              currentRoute = route || null;
              if (previousRoute !== currentRoute) {
                cartShouldFocusAfterRender = true;
              }
              if (currentRoute !== CHECKOUT_VIEW_ROUTE) {
                lastCustomCheckoutShippingSignature = '';
                invalidateCustomCheckoutFlow();
                teardownActiveCustomCheckoutMount();
                checkoutUiState = {
                  status: 'idle',
                  error: '',
                  mode: getCheckoutUiMode(),
                  customCheckout: null
                };
              }
              const payload = {
                from: previousRoute,
                to: currentRoute
              };
              renderFirstPartyCart();
              eventBus.emit('theme.routechanged', payload);
              ensureCustomCheckoutBootstrapped();
              if (currentRoute === CHECKOUT_VIEW_ROUTE) {
                refreshCustomCheckoutEstimates();
              }
              if (currentRoute === CART_VIEW_ROUTE) {
                refreshCustomCheckoutEstimates();
              }
              return Promise.resolve(payload);
            }
          }
        }
      }
    };

    function bindFirstPartyButtons() {
      const existingHandler = document._storeFirstPartyAddButtonHandler;
      if (existingHandler) {
        document.removeEventListener('click', existingHandler);
      }

      document._storeFirstPartyAddButtonHandler = function handleFirstPartyAddButton(event) {
        const button = event.target?.closest?.('.store-add-item');
        if (!button) return;
        if (button.disabled) return;

        event.preventDefault();
        event.stopPropagation();

        if (button.hasAttribute('data-redirect-url')) {
          const redirectUrl = button.getAttribute('data-redirect-url');
          const pendingItem = buildPendingCartItemFromButton(button);
          localStorage.setItem('pendingCartItem', JSON.stringify(pendingItem));
          redirectWindow(redirectUrl);
          return;
        }

        if (hasInteractiveCustomFields(button)) return;

        apiRoot.api.cart.items.add(buildCartItemFromButton(button)).then(() => {
          apiRoot.api.theme.cart.open();
        });
      };
      document.addEventListener('click', document._storeFirstPartyAddButtonHandler);
    }

    bindFirstPartyCartChrome();
    bindFirstPartyCartInputs();
    bindFirstPartyButtons();
    store.subscribe(() => {
      const state = store.getState();
      const nextShippingSignature = getCustomCheckoutShippingSignature(state);
      const shouldRefreshCustomCheckoutShipping =
        Boolean(nextShippingSignature) &&
        nextShippingSignature !== lastCustomCheckoutShippingSignature;

      lastCustomCheckoutShippingSignature = nextShippingSignature;
      writePersistedFirstPartyCartState(state);
      if (suppressDrawerRerender && isCartOpen && currentRoute !== CHECKOUT_VIEW_ROUTE) {
        syncFirstPartyCartTipUI();
        return;
      }
      renderFirstPartyCart();

      if (shouldRefreshCustomCheckoutShipping) {
        refreshCustomCheckoutEstimates();
      }
    });

    if (isStoreOrderSuccessPath()) {
      clearStoreCartAfterOrder();
      clearPersistedFirstPartyCartState();
      clearFirstPartyCheckoutSnapshot();
      clearPendingOrderFlag();
      writeActiveCustomCheckoutOrderId('');
    }

    void consumeAbandonedCheckoutResumeToken();

    const readyPromise = Promise.resolve(apiRoot);

    return {
      requestedRuntime: FIRST_PARTY_RUNTIME,
      activeRuntime: FIRST_PARTY_RUNTIME,
      getLegacyGlobal: function() {
        return null;
      },
      getApi: function() {
        return apiRoot;
      },
      getDisplaySummary: function() {
        return getDisplayedCartSummary();
      },
      onReady: function(handler) {
        if (typeof handler !== 'function') return;
        return readyPromise.then(handler);
      },
      whenReady: function() {
        return readyPromise;
      },
      store: {
        getState: function() {
          return store.getState();
        },
        subscribe: function(handler) {
          return store.subscribe(handler);
        }
      },
      events: {
        on: function(eventName, handler) {
          return eventBus.on(eventName, handler);
        }
      }
    };
  }

  captureStoreMarketingAttribution();
  const provider = buildFirstPartyProvider();
  window.StoreCartProvider = provider;
  window.Store = window.Store || {};
  window.Store.cart = provider;
  window.Store.provider = provider;
  window.Store.whenReady = function(handler) {
    return provider.whenReady().then(function(api) {
      if (typeof handler === 'function') {
        handler(api);
      }
      return api;
    });
  };

  const readyDetail = {
    requestedRuntime: provider.requestedRuntime,
    activeRuntime: provider.activeRuntime
  };

  dispatchProviderReady(readyDetail);
  dispatchCartReady({ activeRuntime: provider.activeRuntime });
})();
