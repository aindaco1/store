(function() {
  'use strict';

  var script = document.currentScript || document.querySelector('script[data-admin-dashboard-script]');
  var config = window.STORE_CONFIG || window.StoreConfig || {};
  var logger = window.StoreLogger && window.StoreLogger.createLogger
    ? window.StoreLogger.createLogger('admin')
    : { error: function() {}, warn: function() {}, info: function() {}, debug: function() {} };
  var currentLang = (config.i18n && config.i18n.currentLang) || document.documentElement.lang || 'en';
  var adminLoginForm = document.getElementById('admin-login-form');
  var adminTurnstileSiteKey = String(
    adminLoginForm && adminLoginForm.dataset
      ? adminLoginForm.dataset.adminTurnstileSiteKey || ''
      : ''
  ).trim();
  var adminTurnstileWidgetRoot = document.querySelector('[data-admin-turnstile-widget]');
  var adminTurnstileLoadPromise = null;
  var adminTurnstileWidgetId = null;
  var adminTurnstileToken = '';
  var adminLoginAttemptStarted = false;
  var workerBase = normalizeBase(
    (config.platform && config.platform.workerUrl) ||
    config.workerBase ||
    (script && script.dataset ? script.dataset.canonicalWorkerBase : '') ||
    ''
  );
  var csrfToken = '';
  var currentUser = null;
  var settingsSections = [];
  var marketingSettingsSection = null;
  var currentSettingsSection = 0;
  var settingsLoaded = false;
  var storeAnalyticsLoaded = false;
  var storeOrdersLoaded = false;
  var storeProductsLoaded = false;
  var storeCouponsLoaded = false;
  var storeDownloadsLoaded = false;
  var currentStoreProducts = [];
  var currentStoreCoupons = [];
  var currentStoreCouponProducts = [];
  var editingStoreCouponCode = '';
  var currentStoreDownloadFiles = [];
  var currentStoreProductRows = [];
  var currentStoreProductTotals = {};
  var currentStoreShippingPresets = [];
  var selectedStoreProductIds = new Set();
  var editingProductId = '';
  var STORE_PRODUCT_CREATE_ID = '__new_store_product__';
  var storeProductsSavedOrderIds = [];
  var storeProductDraggingId = '';
  var storeProductTouchDrag = null;
  var STORE_PRODUCT_TOUCH_DRAG_DELAY = 350;
  var STORE_PRODUCT_TOUCH_DRAG_SLOP = 8;
  var storeProductPreviewTimers = new Map();
  var storeProductAddressLookupCache = new Map();
  var storeProductPreviewRequestCounter = 0;
  var storeProductMediaCache = new Map();
  var SNIPCART_IMPORT_MAX_CSV_BYTES = 1024 * 1024;
  var storeOrderNextCursor = null;
  var storeOrderLoadTimer = null;
  var adminFieldIdCounter = 0;
  var storeProductDescriptionEditorCounter = 0;
  var storeProductDescriptionUploadCounter = 0;
  var settingOriginalValues = new Map();
  var storeMarketingCurrentQr = null;
  var storeMarketingCurrentQrUrl = '';
  var storeMarketingEditingOriginalCode = '';
  var storeMarketingAbandonedHealthRoot = document.getElementById('admin-store-marketing-abandoned-health');
  var storeMarketingReferralsLoaded = false;
  var storeMarketingReferralsLoading = false;
  var storeMarketingAbandonedHealthLoaded = false;
  var storeMarketingAbandonedHealthLoading = false;

  var labels = {
	    en: {
      settings: 'Settings',
      'store-products': 'Products',
      'store-coupons': 'Coupons',
      'store-downloads': 'Downloads',
      'store-orders': 'Orders',
      'store-analytics': 'Analytics',
      'store-marketing': 'Marketing'
    },
	    es: {
      settings: 'Configuracion',
      'store-products': 'Productos',
      'store-coupons': 'Cupones',
      'store-downloads': 'Descargas',
      'store-orders': 'Pedidos',
      'store-analytics': 'Analitica',
      'store-marketing': 'Marketing'
    }
  };
  var compactLabels = {
	    en: {
      settings: 'Settings',
      'store-products': 'Products',
      'store-coupons': 'Coupons',
      'store-downloads': 'Downloads',
      'store-orders': 'Orders',
      'store-analytics': 'Stats',
      'store-marketing': 'Mktg'
    },
	    es: {
      settings: 'Config.',
      'store-products': 'Productos',
      'store-coupons': 'Cupones',
      'store-downloads': 'Descargas',
      'store-orders': 'Pedidos',
      'store-analytics': 'Datos',
      'store-marketing': 'Mktg'
    }
  };
  var headingHelpText = {
    platform: 'Basic shop identity and operations defaults. Start here when public copy or sender details are wrong.',
    'brand & seo': 'Assets and metadata used by browsers, search results, and social share cards.',
    'canonical urls': 'The public site and Worker origins used for checkout, admin calls, redirects, and email links.',
    checkout: 'Stripe and checkout-mode settings for the first-party cart.',
    pricing: 'Default tax and tip behavior used when totals are estimated or submitted.',
    tax: 'Tax provider, origin address, and fallback behavior for checkout tax.',
    shipping: 'Shipping origin, USPS settings, fallback rates, and cache timing for physical products.',
    marketing: 'Default UTM and referral values used as placeholders in the Marketing link builder.',
    design: 'Shared visual tokens used by public pages, emails, and admin previews.',
    users: 'Who can sign in to admin and what each limited admin can access.',
    'store readiness': 'Launch checks for secrets, webhooks, downloads, inventory, catalog data, and exports.',
    'plan usage': 'Read-only usage snapshots for services with quotas or monthly limits.',
    'advanced performance': 'Caching and prefetch behavior. Change these only when testing page speed or freshness.',
    debug: 'Temporary logging switches for local troubleshooting.',
    'secrets & credentials': 'Presence checks only. Secret values stay in Worker secrets and are never displayed.',
    'runtime diagnostics': 'The Worker/site origins and CORS decisions this browser session is using.',
    fulfillment: 'Orders grouped by fulfillment type so physical, digital, ticket, and RSVP volume are easy to compare.',
    'order status': 'Orders grouped by lifecycle state: draft, pending, failed, confirmed, or related states.',
    'payment status': 'Orders grouped by payment state from the Store record and Stripe.',
    'referral codes': 'Orders attributed to saved or incoming referral codes.',
    'utm sources': 'Orders grouped by the UTM source in the customer link.',
    'utm mediums': 'Orders grouped by the UTM medium in the customer link.',
    'utm campaigns': 'Orders grouped by UTM campaign names.',
    'utm contents': 'Orders grouped by UTM content labels.',
    'top products': 'Best-selling products in the current analytics window, ranked by quantity and revenue.',
    'saved referrals': 'Reusable Store links with UTM parameters and downloadable QR codes.',
    'abandoned-checkout reminders': 'Opt-in reminder emails for shoppers who start checkout but do not finish.',
    'reminder suppression': 'Block reminder emails for one or more addresses without changing past orders.',
    'recent reminder outcomes': 'Recent reminder queue, send, suppression, completion, and failure activity.',
    attendance: 'Ticket and RSVP check-in totals grouped by event.',
    preview: 'Live rendering of the product description before it is published.',
    variants: 'Product options with separate labels, SKUs, prices, inventory, and statuses.'
  };
  var settingFieldHelpText = {
    title: 'Browser and share-card title for the public site.',
    'platform.name': 'The public shop label, such as Store or Shop.',
    'platform.company_name': 'The brand name shown before the shop label and in customer-facing copy.',
    author: 'Default author name for metadata and generated content.',
    'platform.default_creator_name': 'Fallback creator or brand attribution for products and order copy.',
    'platform.timezone': 'Timezone used for reports, event times, and admin timestamps.',
    'platform.support_email': 'Customer support address shown in policies, order emails, and help copy.',
    description: 'Default search and social description for public pages.',
    'platform.orders_email_from': 'From address for receipts, order lookups, and fulfillment emails.',
    'platform.updates_email_from': 'From address for admin, reminder, and notification emails.',
    'add_ons.enabled': 'Turns same-type cart recommendations on or off.',
    'add_ons.product_count': 'Maximum add-on suggestions to show when matching products exist.',
    'app.mode': 'Current runtime mode. Test mode uses test credentials; live mode uses production credentials.',
    'marketing.default_utm_source': 'Placeholder source for new Marketing links.',
    'marketing.default_utm_medium': 'Placeholder medium for new Marketing links.',
    'marketing.default_utm_campaign': 'Placeholder campaign for new Marketing links.',
    'marketing.default_utm_content': 'Placeholder content label for new Marketing links.',
    'marketing.default_ref': 'Placeholder referral code when a referrer name is entered.',
    'marketing.landing_page_path': 'Default destination path for newly generated marketing links.'
  };

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function normalizeBase(value) {
    return String(value || '').replace(/\/+$/, '');
  }

  function apiUrl(path, params) {
    var pathname = path.charAt(0) === '/' ? path : '/' + path;
    var url = workerBase ? workerBase + pathname : pathname;
    if (!params) return url;
    var search = new URLSearchParams();
    Object.keys(params).forEach(function(key) {
      var value = params[key];
      if (value === undefined || value === null || value === '' || value === 'all') return;
      search.set(key, String(value));
    });
    var query = search.toString();
    return query ? url + '?' + query : url;
  }

  function mediaPreviewUrl(path) {
    var value = String(path || '').trim();
    if (!value) return '';
    if (/^(?:https?:|data:|blob:)/i.test(value)) return value;
    if (value.charAt(0) === '/') return value;
    try {
      return new URL(value, window.location.origin + '/').toString();
    } catch (_error) {
      return value;
    }
  }

  function setStatus(element, message, prominent) {
    if (!element) return;
    element.textContent = message || '';
    if (prominent) element.setAttribute('data-admin-prominent-status', 'true');
    else element.removeAttribute('data-admin-prominent-status');
  }

  function setDirtyButtonState(button, dirty, cleanText, dirtyText, options) {
    if (!(button instanceof HTMLButtonElement)) return;
    var opts = options || {};
    button.classList.toggle('is-dirty', Boolean(dirty));
    button.dataset.dirtyState = dirty ? 'dirty' : 'clean';
    button.textContent = dirty ? dirtyText : cleanText;
    if (opts.disableWhenClean !== false) {
      button.disabled = !dirty || Boolean(opts.forceDisabled);
    }
  }

  function setAdminLoginStartStatus(data) {
    var status = $('#admin-auth-status');
    if (!status) return;
    var loginUrl = data && data.loginUrl ? String(data.loginUrl) : '';
    if (!loginUrl) {
      setStatus(status, 'Check your email for a login link.');
      return;
    }

    status.textContent = '';
    status.removeAttribute('data-admin-prominent-status');
    status.appendChild(document.createTextNode('Local login link ready. '));
    var link = document.createElement('a');
    link.href = loginUrl;
    link.textContent = 'Open admin';
    status.appendChild(link);
  }

  function hasAdminTurnstile() {
    return Boolean(adminTurnstileSiteKey && adminTurnstileWidgetRoot);
  }

  function renderAdminTurnstile() {
    if (!hasAdminTurnstile() || adminTurnstileWidgetId !== null || !window.turnstile || !window.turnstile.render) {
      return;
    }
    adminTurnstileWidgetId = window.turnstile.render(adminTurnstileWidgetRoot, {
      sitekey: adminTurnstileSiteKey,
      action: 'admin_login',
      appearance: 'always',
      execution: 'render',
      size: 'flexible',
      theme: 'light',
      callback: function(token) {
        adminTurnstileToken = String(token || '');
      },
      'expired-callback': function() {
        if (adminLoginAttemptStarted) return;
        adminTurnstileToken = '';
        setStatus($('#admin-auth-status'), 'Security check expired. Please try again.', true);
      },
      'error-callback': function() {
        if (adminLoginAttemptStarted) return;
        adminTurnstileToken = '';
        setStatus($('#admin-auth-status'), 'Security check failed. Please try again.', true);
      }
    });
  }

  function ensureAdminTurnstile() {
    if (!hasAdminTurnstile()) return Promise.resolve();
    if (adminTurnstileWidgetId !== null) return Promise.resolve();
    if (window.turnstile && window.turnstile.render) {
      renderAdminTurnstile();
      return Promise.resolve();
    }
    if (adminTurnstileLoadPromise) return adminTurnstileLoadPromise;
    adminTurnstileLoadPromise = new Promise(function(resolve, reject) {
      var scriptNode = document.createElement('script');
      scriptNode.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      scriptNode.async = true;
      scriptNode.defer = true;
      scriptNode.onload = function() {
        renderAdminTurnstile();
        resolve();
      };
      scriptNode.onerror = function() {
        reject(new Error('Turnstile failed to load'));
      };
      document.head.appendChild(scriptNode);
    });
    return adminTurnstileLoadPromise;
  }

  function adminTurnstileTokenForSubmit() {
    if (!hasAdminTurnstile()) return Promise.resolve('');
    return ensureAdminTurnstile().then(function() {
      if (!adminTurnstileToken && adminTurnstileWidgetId !== null && window.turnstile && window.turnstile.getResponse) {
        adminTurnstileToken = String(window.turnstile.getResponse(adminTurnstileWidgetId) || '');
      }
      return adminTurnstileToken;
    });
  }

  function resetAdminTurnstile() {
    if (!hasAdminTurnstile() || adminTurnstileWidgetId === null || !window.turnstile || !window.turnstile.reset) return;
    adminTurnstileToken = '';
    window.turnstile.reset(adminTurnstileWidgetId);
  }

  function parseJsonSafely(text) {
    try {
      return JSON.parse(text);
    } catch (_error) {
      return {};
    }
  }

  function requestJson(path, options) {
    var opts = options || {};
    var method = String(opts.method || 'GET').toUpperCase();
    var headers = new Headers(opts.headers || {});
    headers.set('Accept', 'application/json');
    if (method !== 'GET' && method !== 'HEAD' && csrfToken) {
      headers.set('x-store-admin-csrf', csrfToken);
    }
    var body = opts.body;
    if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }
    return fetch(apiUrl(path, opts.params), {
      method: method,
      headers: headers,
      body: body,
      credentials: 'include'
    }).then(function(response) {
      return response.text().then(function(text) {
        var data = text ? parseJsonSafely(text) : {};
        if (!response.ok) {
          var message = data.error || data.message || 'Request failed.';
          throw Object.assign(new Error(message), { status: response.status, data: data });
        }
        return data;
      });
    });
  }

  function requestBlob(path, options) {
    var opts = options || {};
    var headers = new Headers(opts.headers || {});
    headers.set('Accept', opts.accept || 'text/csv');
    return fetch(apiUrl(path, opts.params), {
      method: opts.method || 'GET',
      headers: headers,
      credentials: 'include'
    }).then(function(response) {
      if (!response.ok) throw new Error('Download failed.');
      return response.blob().then(function(blob) {
        return { blob: blob, response: response };
      });
    });
  }

  function downloadAdminCsv(options) {
    var opts = options || {};
    var status = opts.status || null;
    setStatus(status, opts.loadingMessage || 'Preparing CSV...');
    requestBlob(opts.path, { params: opts.params || {}, accept: opts.accept || 'text/csv' }).then(function(result) {
      var disposition = result.response.headers.get('content-disposition') || '';
      var filename = (disposition.match(/filename="?([^";]+)"?/i) || [])[1] || opts.fallbackFilename || 'store-export.csv';
      var url = URL.createObjectURL(result.blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
      setStatus(status, opts.completeMessage || 'CSV download started.');
    }).catch(function(error) {
      setStatus(status, formatError(error), true);
    });
  }

  function preferredLang() {
    return currentLang || 'en';
  }

  function formatError(error) {
    return error && error.message ? error.message : 'Something went wrong.';
  }

  function createElement(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function createLabeledTableCell(label, content, className) {
    var cell = document.createElement('td');
    cell.dataset.label = label;
    if (className) cell.className = className;
    if (typeof Node !== 'undefined' && content instanceof Node) {
      cell.appendChild(content);
    } else if (content !== undefined && content !== null) {
      cell.textContent = String(content);
    }
    return cell;
  }

  function ensureElementId(element, prefix) {
    if (element.id) return element.id;
    element.id = String(prefix || 'admin-control') + '-' + String(++adminFieldIdCounter);
    return element.id;
  }

  function adminFilePickerFilenameNode(input) {
    if (!input || !input.id) return null;
    return $all('[data-admin-file-picker-filename-for]').find(function(node) {
      return node.dataset.adminFilePickerFilenameFor === input.id;
    }) || null;
  }

  function updateAdminFilePickerFilename(input, file) {
    var filename = adminFilePickerFilenameNode(input);
    if (!filename) return;
    var selected = file || input && input.files && input.files[0];
    filename.textContent = selected && selected.name
      ? selected.name
      : (input.dataset.adminFilePickerEmptyLabel || 'No file chosen');
  }

  function createAdminFilePicker(input, options) {
    var opts = options || {};
    var inputId = ensureElementId(input, opts.idPrefix || 'admin-file-picker');
    var picker = createElement('div', 'admin-file-picker' + (opts.className ? ' ' + opts.className : ''));
    var button = createElement('label', 'btn btn--secondary admin-file-picker__button' + (opts.buttonClass ? ' ' + opts.buttonClass : ''), opts.buttonLabel || 'Choose file');
    var filename = createElement('span', 'admin-file-picker__filename', opts.emptyLabel || 'No file chosen');
    input.classList.add('admin-file-picker__input');
    input.dataset.adminFilePickerInput = 'true';
    input.dataset.adminFilePickerEmptyLabel = opts.emptyLabel || 'No file chosen';
    button.setAttribute('for', inputId);
    button.setAttribute('role', 'button');
    button.tabIndex = 0;
    filename.dataset.adminFilePickerFilenameFor = inputId;
    if (opts.filenameClass) filename.classList.add(opts.filenameClass);
    input.addEventListener('change', function() {
      updateAdminFilePickerFilename(input);
    });
    picker.appendChild(input);
    picker.appendChild(button);
    picker.appendChild(filename);
    return picker;
  }

  function setupAdminFilePickerEvents() {
    document.addEventListener('keydown', function(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var label = event.target && event.target.closest
        ? event.target.closest('.admin-file-picker__button[for]')
        : null;
      if (!label) return;
      var input = document.getElementById(label.getAttribute('for') || '');
      if (!input) return;
      event.preventDefault();
      input.click();
    });
  }

  function imageUploadOptions(row) {
    var isLogo = row.path === 'platform.logo_path';
    return {
      accept: isLogo ? 'image/png,image/jpeg,image/webp' : 'image/png,image/jpeg,image/webp,image/gif',
      allowedTypes: isLogo ? ['image/png', 'image/jpeg', 'image/webp'] : ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      maxBytes: isLogo ? 512 * 1024 : 8 * 1024 * 1024,
      uploadPath: isLogo ? '/admin/settings/logo-upload' : '/admin/settings/image-upload',
      uploadLabel: isLogo ? 'Upload logo' : 'Upload image',
      uploadedText: isLogo ? 'Logo uploaded. Publish settings to use it.' : 'Image uploaded. Publish settings to use it.',
      typeError: isLogo ? 'Use a PNG, JPEG, or WebP logo.' : 'Use a PNG, JPEG, WebP, or GIF image.',
      sizeError: isLogo ? 'Logo must be 512 KB or smaller.' : 'Image must be 8 MB or smaller.',
      uploadDataset: isLogo ? 'logoUploadInput' : 'settingsImageUploadInput'
    };
  }

  function updateImagePreview(preview, path, label) {
    clear(preview);
    var value = String(path || '').trim();
    if (!value) {
      preview.appendChild(createElement('span', '', 'No image selected.'));
      return;
    }
    var image = document.createElement('img');
    image.loading = 'lazy';
    image.src = mediaPreviewUrl(value);
    image.alt = (label || 'Image') + ' preview';
    preview.appendChild(image);
  }

  function createImageUploadField(row, control) {
    var options = imageUploadOptions(row);
    var wrapper = createElement('div', 'admin-settings__image-field');
    var preview = createElement('div', 'admin-settings__image-preview');
    var uploadRow = createElement('div', 'admin-settings__image-upload');
    var uploadInput = document.createElement('input');
    var uploadStatus = createElement('span', 'admin-settings__image-status', '');

    if (control.tagName === 'INPUT') control.type = 'hidden';
    control.classList.add('admin-settings__image-value');
    control.setAttribute('aria-hidden', 'true');

    uploadInput.type = 'file';
    uploadInput.accept = options.accept;
    uploadInput.dataset[options.uploadDataset] = 'true';
    uploadInput.setAttribute('aria-label', options.uploadLabel);

    updateImagePreview(preview, control.value, row.label);
    control.addEventListener('input', function() {
      updateImagePreview(preview, control.value, row.label);
    });

    uploadInput.addEventListener('change', function() {
      var file = uploadInput.files && uploadInput.files[0];
      if (!file) return;
      if (options.allowedTypes.indexOf(file.type) < 0) {
        setStatus(uploadStatus, options.typeError, true);
        return;
      }
      if (file.size > options.maxBytes) {
        setStatus(uploadStatus, options.sizeError, true);
        return;
      }
      setStatus(uploadStatus, 'Uploading ' + file.name + '...');
      fileToDataUrl(file).then(function(content) {
        return requestJson(options.uploadPath, {
          method: 'POST',
          body: {
            filename: file.name,
            contentType: file.type,
            content: content,
            kind: row.path === 'platform.logo_path' ? 'logo' : 'admin',
            fieldPath: row.path || '',
            filenameBase: row.label || ''
          }
        });
      }).then(function(data) {
        var nextPath = data.path || data.publicPath || '';
        if (!nextPath) throw new Error('Upload did not return an asset path.');
        control.value = nextPath;
        updateImagePreview(preview, nextPath, row.label);
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
        setStatus(uploadStatus, options.uploadedText);
      }).catch(function(error) {
        logger.error('Failed to upload admin image', error);
        setStatus(uploadStatus, formatError(error), true);
      }).finally(function() {
        uploadInput.value = '';
        updateAdminFilePickerFilename(uploadInput);
      });
    });

    wrapper.appendChild(control);
    uploadRow.appendChild(createAdminFilePicker(uploadInput, {
      buttonLabel: options.uploadLabel,
      className: 'admin-file-picker--full',
      emptyLabel: 'No file chosen',
      idPrefix: 'admin-settings-image-upload'
    }));
    uploadRow.appendChild(uploadStatus);
    wrapper.appendChild(preview);
    wrapper.appendChild(uploadRow);
    return wrapper;
  }

  function clear(element) {
    if (!element) return;
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function isTruthy(value) {
    if (value === true) return true;
    if (value === false || value === null || value === undefined) return false;
    return String(value).trim().toLowerCase() === 'true';
  }

  function moneyFromCents(cents) {
    var amount = Math.round(Number(cents) || 0) / 100;
    return '$' + (Number.isInteger(amount) ? amount.toString() : amount.toFixed(2));
  }

  function formatNumber(value) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value || 0) || 0);
  }

  function statCard(baseClass, label, value) {
    var item = createElement('article', 'admin-stat-card ' + baseClass);
    item.appendChild(createElement('strong', 'admin-stat-card__value ' + baseClass + '-value', value));
    item.appendChild(createElement('span', 'admin-stat-card__label ' + baseClass + '-label', label));
    return item;
  }

  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function normalizeInputValue(value) {
    if (Array.isArray(value) || (value && typeof value === 'object')) return JSON.stringify(value);
    if (value === true) return 'true';
    if (value === false) return 'false';
    return String(value === undefined || value === null ? '' : value);
  }

  function getTabLabel(key) {
    var langLabels = labels[currentLang] || labels[currentLang.split('-')[0]] || labels.en;
    return langLabels[key] || key;
  }

  function getCompactLabel(key) {
    var langLabels = compactLabels[currentLang] || compactLabels[currentLang.split('-')[0]] || compactLabels.en;
    return langLabels[key] || getTabLabel(key);
  }

  function prepareTabButton(button, labelClassName) {
    if (!button || button.dataset.adminPrepared === 'true') return;
    var key = button.dataset.adminTab || button.dataset.settingsSectionKey || '';
    var originalText = button.textContent.trim();
    var label = originalText || (key ? getTabLabel(key) : '');
    if (button.dataset.settingsSectionLabel) label = button.dataset.settingsSectionLabel;
    button.setAttribute('aria-label', label);
    button.dataset.compactLabel = key ? getCompactLabel(key) : label;
    button.textContent = '';
    button.appendChild(createElement('span', labelClassName, label));
    button.dataset.adminPrepared = 'true';
  }

  function ensureMobileSelect(tabList, labelText, onChange) {
    if (!tabList) return null;
    var sibling = tabList.nextElementSibling;
    var wrapper = sibling && sibling.classList.contains('admin-mobile-tab-select') ? sibling : null;
    if (!wrapper) {
      wrapper = createElement('label', 'admin-mobile-tab-select');
      var label = createElement('span', 'admin-mobile-tab-select__label', labelText || 'Section');
      var select = document.createElement('select');
      wrapper.appendChild(label);
      wrapper.appendChild(select);
      tabList.insertAdjacentElement('afterend', wrapper);
      select.addEventListener('change', function() {
        if (onChange) onChange(select.value);
      });
    }
    return wrapper.querySelector('select');
  }

  function syncMobileSelect(tabList, selector, activeValue, labelText, onChange) {
    var select = ensureMobileSelect(tabList, labelText, onChange);
    if (!select) return;
    clear(select);
    $all(selector, tabList).forEach(function(button) {
      if (button.hidden) return;
      var option = document.createElement('option');
      option.value = button.dataset.adminTab || button.dataset.settingsSectionIndex || '';
      option.textContent = button.getAttribute('aria-label') || button.textContent.trim();
      select.appendChild(option);
    });
    select.value = activeValue || '';
  }

  function setupAdminTabs() {
    var tabList = $('[data-admin-tabs] > .admin-tabs__list');
    if (!tabList) return;
    $all('[data-admin-tab]', tabList).forEach(function(button) {
      prepareTabButton(button, 'admin-tabs__label');
      if (button.dataset.adminTabListener !== 'true') {
        button.dataset.adminTabListener = 'true';
        button.addEventListener('click', function() {
          selectAdminTab(button.dataset.adminTab);
        });
        button.addEventListener('keydown', function(event) {
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
          event.preventDefault();
          var tabs = $all('[data-admin-tab]', tabList).filter(function(tab) { return !tab.hidden; });
          var index = tabs.indexOf(button);
          var offset = event.key === 'ArrowRight' ? 1 : -1;
          var next = tabs[(index + offset + tabs.length) % tabs.length];
          if (next) {
            next.focus();
            selectAdminTab(next.dataset.adminTab);
          }
        });
      }
    });
    syncMobileSelect(tabList, '[data-admin-tab]', getActiveAdminTab(), 'Admin section', selectAdminTab);
  }

  function getActiveAdminTab() {
    var active = $('[data-admin-tab][aria-selected="true"]');
    return active ? active.dataset.adminTab : '';
  }

  function selectAdminTab(key) {
    var tabList = $('[data-admin-tabs] > .admin-tabs__list');
    var target = $('[data-admin-tab="' + key + '"]');
    if (!target || target.hidden) {
      target = $all('[data-admin-tab]').find(function(tab) { return !tab.hidden; });
      key = target ? target.dataset.adminTab : '';
    }
    $all('[data-admin-tab]').forEach(function(tab) {
      var selected = tab.dataset.adminTab === key;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
    });
    $all('[data-admin-tab-panel]').forEach(function(panel) {
      panel.hidden = panel.dataset.adminTabPanel !== key;
    });
    syncMobileSelect(tabList, '[data-admin-tab]', key, 'Admin section', selectAdminTab);
    if (key === 'settings' && !settingsLoaded) loadSettings();
    if (key === 'store-analytics' && !storeAnalyticsLoaded) loadStoreAnalytics();
    if (key === 'store-marketing') {
      updateStoreMarketingBuilder();
      loadStoreMarketingData();
    }
    if (key === 'store-orders' && !storeOrdersLoaded) loadStoreOrders();
    if (key === 'store-products' && !storeProductsLoaded) loadStoreProducts();
    if (key === 'store-coupons' && !storeCouponsLoaded) loadStoreCoupons();
    if (key === 'store-downloads' && !storeDownloadsLoaded) loadStoreDownloads();
  }

  function configureTabsForRole(user) {
    var isSuperAdmin = user && user.role === 'super_admin';
    ['settings'].forEach(function(key) {
      var tab = $('[data-admin-tab="' + key + '"]');
      var panel = $('[data-admin-tab-panel="' + key + '"]');
      if (tab) tab.hidden = !isSuperAdmin;
      if (panel && !isSuperAdmin) panel.hidden = true;
    });
    setupAdminTabs();
    selectAdminTab(isSuperAdmin ? 'settings' : 'store-orders');
  }

  function showAuth(message) {
    var authPanel = $('#admin-auth-panel');
    var app = $('#admin-app');
    if (authPanel) authPanel.hidden = false;
    if (app) app.hidden = true;
    if (message) setStatus($('#admin-auth-status'), message);
  }

  function showApp(data) {
    currentUser = data.user || currentUser || {};
    csrfToken = data.csrfToken || csrfToken || '';
    var authPanel = $('#admin-auth-panel');
    var app = $('#admin-app');
    var logout = $('#admin-logout');
    if (authPanel) authPanel.hidden = true;
    if (app) app.hidden = false;
    if (logout) logout.hidden = false;
    var email = currentUser.email || 'admin';
    $('#admin-session-summary').textContent = 'Signed in as ' + email;
    configureTabsForRole(currentUser);
    loadDashboardSummary();
  }

  function loadDashboardSummary() {
    requestJson('/admin/dashboard/summary').catch(function(error) {
      logger.warn('Admin summary failed', error);
    });
  }

  function exchangeLoginToken(token) {
    return requestJson('/admin/auth/exchange', {
      method: 'POST',
      body: { token: token, preferredLang: preferredLang() }
    }).then(function(data) {
      showApp(data);
      if (window.history && window.history.replaceState) {
        var url = new URL(window.location.href);
        url.searchParams.delete('admin_login');
        window.history.replaceState({}, '', url.toString());
      }
    }).catch(function(error) {
      showAuth(formatError(error));
    });
  }

  function loadSession() {
    requestJson('/admin/session').then(showApp).catch(function() {
      showAuth('');
    });
  }

  function setupAuth() {
    var form = adminLoginForm || $('#admin-login-form');
    if (!form) return;
    if (hasAdminTurnstile()) {
      ensureAdminTurnstile().catch(function(error) {
        logger.warn('Admin challenge failed to load', error);
        setStatus($('#admin-auth-status'), 'Security check failed. Please try again.', true);
      });
    }
    form.addEventListener('submit', function(event) {
      event.preventDefault();
      var emailField = $('#admin-email');
      var email = emailField ? emailField.value.trim() : '';
      if (!email) return;
      setStatus($('#admin-auth-status'), 'Sending login link...');
      adminTurnstileTokenForSubmit().then(function(challengeToken) {
        if (hasAdminTurnstile() && !challengeToken) {
          setStatus($('#admin-auth-status'), 'Complete the security check before requesting a sign-in link.', true);
          return null;
        }
        adminLoginAttemptStarted = true;
        return requestJson('/admin/auth/start', {
          method: 'POST',
          body: { email: email, preferredLang: preferredLang(), turnstileToken: challengeToken || undefined }
        }).then(function(data) {
          setAdminLoginStartStatus(data);
        });
      }).catch(function(error) {
        var code = error && error.data ? String(error.data.code || '') : '';
        if (code === 'admin_challenge_required') {
          setStatus($('#admin-auth-status'), 'Complete the security check before requesting a sign-in link.', true);
        } else if (code.indexOf('admin_challenge') === 0) {
          setStatus($('#admin-auth-status'), 'Security check failed. Please try again.', true);
        } else {
          setStatus($('#admin-auth-status'), formatError(error), true);
        }
        resetAdminTurnstile();
      }).finally(function() {
        adminLoginAttemptStarted = false;
      });
    });

    var params = new URLSearchParams(window.location.search);
    var token = params.get('admin_login');
    if (token) exchangeLoginToken(token);
    else loadSession();
  }

  function setupLogout() {
    var button = $('#admin-logout');
    if (!button) return;
    button.addEventListener('click', function() {
      requestJson('/admin/logout', { method: 'POST', body: {} }).finally(function() {
        csrfToken = '';
        currentUser = null;
        showAuth('Signed out.');
      });
    });
  }

  function sectionHasEditableRows(section, includeUsers) {
    return (section.rows || []).some(function(row) {
      if (!row || !row.editable) return false;
      if (!includeUsers && row.path === 'admin.users') return false;
      return true;
    });
  }

  function settingsRowsForRender(rows) {
    var output = [];
    var index = 0;
    var source = rows || [];
    while (index < source.length) {
      var row = source[index];
      var group = row && row.layoutGroup ? row.layoutGroup : '';
      if (!group) {
        output.push(row);
        index += 1;
        continue;
      }
      var grouped = [];
      while (index < source.length && source[index] && source[index].layoutGroup === group) {
        grouped.push(source[index]);
        index += 1;
      }
      output.push(grouped.length > 1
        ? {
          input: 'settings-field-grid',
          rows: grouped,
          label: grouped.map(function(item) { return item.label; }).join(', '),
          layoutGroup: group
        }
        : grouped[0]);
    }
    return output;
  }

  function selectSettingsSection(index) {
    currentSettingsSection = Math.max(0, Number(index) || 0);
    var tabList = $('#admin-settings-section-tabs');
    $all('[data-settings-section-index]', tabList).forEach(function(tab) {
      var selected = Number(tab.dataset.settingsSectionIndex) === currentSettingsSection;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
    });
    syncMobileSelect(tabList, '[data-settings-section-index]', String(currentSettingsSection), 'Settings section', function(value) {
      selectSettingsSection(Number(value));
    });
    renderSettingsSection(settingsSections[currentSettingsSection]);
  }

  function renderSettingsTabs() {
    var tabList = $('#admin-settings-section-tabs');
    if (!tabList) return;
    clear(tabList);
    settingsSections.forEach(function(section, index) {
      var title = section.title || 'Section';
      var button = createElement('button', 'admin-settings-tabs__tab', '');
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.dataset.settingsSectionIndex = String(index);
      button.dataset.settingsSectionLabel = title;
      button.setAttribute('aria-selected', index === currentSettingsSection ? 'true' : 'false');
      button.tabIndex = index === currentSettingsSection ? 0 : -1;
      button.dataset.compactLabel = title;
      button.appendChild(createElement('span', 'admin-settings-tabs__label', title));
      button.addEventListener('click', function() { selectSettingsSection(index); });
      tabList.appendChild(button);
    });
    syncMobileSelect(tabList, '[data-settings-section-index]', String(currentSettingsSection), 'Settings section', function(value) {
      selectSettingsSection(Number(value));
    });
  }

  function safeHelpId(prefix, value) {
    var slug = String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return String(prefix || 'admin-setting-help') + '-' + (slug || 'field') + '-' + String(++adminFieldIdCounter);
  }

  function appendBreakableTooltipText(node, text) {
    var buffer = '';
    String(text || '').split('').forEach(function(character) {
      buffer += character;
      if (character === '/') {
        node.appendChild(document.createTextNode(buffer));
        node.appendChild(document.createElement('wbr'));
        buffer = '';
      }
    });
    if (buffer) node.appendChild(document.createTextNode(buffer));
  }

  function createHelpIcon() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('admin-settings__help-icon');
    ['M12 16v-4', 'M12 8h.01', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'].forEach(function(pathData) {
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData);
      svg.appendChild(path);
    });
    return svg;
  }

  function clampHelpPosition(value, min, max) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
  }

  function resetHelpTooltipPosition(tooltip) {
    [
      'bottom',
      'left',
      'maxHeight',
      'maxWidth',
      'overflowY',
      'position',
      'right',
      'top',
      'transform',
      'visibility',
      'width',
      'zIndex'
    ].forEach(function(property) {
      tooltip.style[property] = '';
    });
  }

  function positionHelpTooltip(wrapper, button, tooltip) {
    if (!wrapper || !button || !tooltip) return;
    var viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    var margin = 16;
    var gap = 8;
    var buttonRect = button.getBoundingClientRect();
    tooltip.style.position = 'fixed';
    tooltip.style.transform = 'none';
    tooltip.style.visibility = 'hidden';
    tooltip.style.zIndex = '1000';
    tooltip.style.maxHeight = Math.max(120, viewportHeight - margin * 2) + 'px';
    tooltip.style.overflowY = 'auto';

    if (viewportWidth <= 900) {
      tooltip.style.left = margin + 'px';
      tooltip.style.right = margin + 'px';
      tooltip.style.top = 'auto';
      tooltip.style.bottom = margin + 'px';
      tooltip.style.width = 'auto';
      tooltip.style.maxWidth = 'none';
      tooltip.style.visibility = '';
      return;
    }

    tooltip.style.left = '0px';
    tooltip.style.right = 'auto';
    tooltip.style.top = '0px';
    tooltip.style.bottom = 'auto';
    tooltip.style.width = 'max-content';
    tooltip.style.maxWidth = Math.min(352, Math.max(160, viewportWidth - margin * 2)) + 'px';

    var tooltipRect = tooltip.getBoundingClientRect();
    var tooltipWidth = tooltipRect.width;
    var tooltipHeight = tooltipRect.height;
    var left = buttonRect.left + buttonRect.width / 2 - tooltipWidth / 2;
    if (wrapper.classList.contains('admin-settings__help--edge-start')) {
      left = buttonRect.left;
    } else if (wrapper.classList.contains('admin-settings__help--edge-end')) {
      left = buttonRect.right - tooltipWidth;
    }
    var top = buttonRect.bottom + gap;
    if (top + tooltipHeight > viewportHeight - margin) {
      top = buttonRect.top - tooltipHeight - gap;
    }
    tooltip.style.left = clampHelpPosition(left, margin, viewportWidth - tooltipWidth - margin) + 'px';
    tooltip.style.top = clampHelpPosition(top, margin, viewportHeight - tooltipHeight - margin) + 'px';
    tooltip.style.visibility = '';
  }

  function wireHelpTooltip(wrapper, button, tooltip) {
    if (!wrapper || !button || !tooltip) return;
    var active = false;
    var reposition = function() {
      if (active) positionHelpTooltip(wrapper, button, tooltip);
    };
    var show = function() {
      active = true;
      tooltip.classList.add('is-visible');
      positionHelpTooltip(wrapper, button, tooltip);
      window.addEventListener('resize', reposition);
      window.addEventListener('scroll', reposition, true);
    };
    var hide = function() {
      active = false;
      tooltip.classList.remove('is-visible');
      resetHelpTooltipPosition(tooltip);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
    var scheduleHide = function() {
      window.setTimeout(function() {
        if (!wrapper.matches(':hover') && !wrapper.contains(document.activeElement)) hide();
      }, 0);
    };
    wrapper.addEventListener('mouseenter', show);
    wrapper.addEventListener('mouseleave', scheduleHide);
    wrapper.addEventListener('focusin', show);
    wrapper.addEventListener('focusout', scheduleHide);
    button.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') {
        hide();
        button.blur();
      }
    });
  }

  function normalizedHeadingKey(label) {
    return String(label || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function helpForHeading(label, fallback) {
    var explicit = String(fallback || '').trim();
    if (explicit) return explicit;
    return headingHelpText[normalizedHeadingKey(label)] || '';
  }

  function createHelp(row, describedElement, options) {
    var text = String(row.help || '').trim();
    if (!text) return null;
    var opts = options || {};
    var id = safeHelpId('admin-setting-help', row.path || row.label || 'setting');
    var wrapper = createElement('span', 'admin-settings__help');
    if (opts.className) {
      String(opts.className).split(/\s+/).filter(Boolean).forEach(function(className) {
        wrapper.classList.add(className);
      });
    }
    var button = createElement('button', 'admin-settings__help-button');
    var help = createElement('span', 'admin-settings__help-tooltip');
    button.type = 'button';
    button.setAttribute('aria-label', 'About ' + (row.label || 'setting'));
    button.setAttribute('aria-describedby', id);
    button.appendChild(createHelpIcon());
    help.id = id;
    help.setAttribute('role', 'tooltip');
    appendBreakableTooltipText(help, text);
    if (describedElement) describedElement.setAttribute('aria-describedby', id);
    wrapper.appendChild(button);
    wrapper.appendChild(help);
    wireHelpTooltip(wrapper, button, help);
    return wrapper;
  }

	  function settingFieldHelp(row) {
	    var explicit = String(row && row.help || '').trim();
	    if (explicit) return explicit;
	    var path = String(row && row.path || '').trim();
	    if (path && settingFieldHelpText[path]) return settingFieldHelpText[path];
	    var label = String(row && (row.label || row.path) || 'setting').trim() || 'setting';
	    return row && row.editable
	      ? 'Change this when the shop needs a different ' + label.toLowerCase() + '.'
	      : 'Read-only status for ' + label.toLowerCase() + '.';
	  }

	  function rowWithSettingFieldHelp(row) {
	    return {
	      ...(row || {}),
	      help: settingFieldHelp(row || {})
	    };
	  }

  function createHeadingWithHelp(tag, className, label, options) {
    var wrapper = createElement('div', className || '');
    wrapper.classList.add('admin-heading-with-help');
    var heading = createElement(tag || 'h3', 'admin-heading-with-help__heading', label || '');
    wrapper.appendChild(heading);
    var opts = options || {};
    var help = createHelp({
      label: label || 'heading',
      path: opts.path || ('heading-' + normalizedHeadingKey(label || 'heading')),
      help: helpForHeading(label, opts.help)
    }, null);
    if (help) wrapper.appendChild(help);
    return wrapper;
  }

  function createEmailListInput(row) {
    var root = document.createElement('div');
    root.className = 'admin-settings__email-list';
    var list = document.createElement('div');
    list.className = 'admin-settings__email-list-items';
    var input = document.createElement('input');
    input.type = 'email';
    input.inputMode = 'email';
    input.autocomplete = 'email';
    input.id = row.inputId || row.id || 'admin-email-list-' + String(++adminFieldIdCounter);
    input.name = row.name || input.id;
    input.className = 'admin-settings__email-list-input';
    if (row.placeholder) input.placeholder = row.placeholder;
    input.setAttribute('aria-label', row.label || 'Email');
    if (row.describedBy) input.setAttribute('aria-describedby', row.describedBy);
    root.value = '';

    function values() {
      return Array.from(list.querySelectorAll('[data-email-list-value]')).map(function(item) {
        return item.dataset.emailListValue || '';
      }).filter(Boolean);
    }

    function syncValue() {
      root.value = values().join(', ');
      root.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function syncFocusState() {
      root.classList.toggle('is-focused', root.contains(document.activeElement));
    }

    function addEmail(value) {
      var email = String(value || '').trim().replace(/,+$/g, '');
      if (!email || values().includes(email)) return;
      var item = document.createElement('span');
      item.className = 'admin-settings__email-token';
      item.dataset.emailListValue = email;
      var text = document.createElement('span');
      text.textContent = email;
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove email ' + email);
      remove.textContent = 'x';
      remove.addEventListener('click', function() {
        item.remove();
        syncValue();
        input.focus();
      });
      item.appendChild(text);
      item.appendChild(remove);
      list.appendChild(item);
      syncValue();
    }

    (Array.isArray(row.rawValue) ? row.rawValue : String(row.rawValue || '').split(',')).forEach(addEmail);
    input.addEventListener('keydown', function(event) {
      if (event.key === ',' || event.key === 'Enter') {
        event.preventDefault();
        addEmail(input.value);
        input.value = '';
      } else if (event.key === 'Backspace' && !input.value) {
        if (list.lastElementChild) {
          list.lastElementChild.remove();
          syncValue();
        }
      }
    });
    input.addEventListener('input', function() {
      if (!input.value.includes(',')) return;
      input.value.split(',').forEach(addEmail);
      input.value = '';
    });
    input.addEventListener('blur', function() {
      addEmail(input.value);
      input.value = '';
      window.setTimeout(syncFocusState, 0);
    });
    root.addEventListener('focusin', syncFocusState);
    root.addEventListener('focusout', function() {
      window.setTimeout(syncFocusState, 0);
    });
    root.commitPending = function() {
      addEmail(input.value);
      input.value = '';
    };
    root.clear = function() {
      clear(list);
      input.value = '';
      syncValue();
    };
    root.emailValues = values;
    root.appendChild(list);
    root.appendChild(input);
    syncValue();
    return root;
  }

  function valueForSettingInput(row) {
    var raw = row.rawValue !== undefined ? row.rawValue : row.value;
    if (row.displayMultiplier) {
      var multiplied = Number(raw || 0) * Number(row.displayMultiplier || 1);
      return Number.isFinite(multiplied) ? String(multiplied).replace(/\.0+$/, '') : '';
    }
    if (row.input === 'boolean' || row.type === 'boolean') return isTruthy(raw) ? 'true' : 'false';
    if (row.type === 'list' && Array.isArray(raw)) return raw.join('\n');
    if (row.input === 'add-on-products' || row.type === 'add_on_products') return JSON.stringify(raw || [], null, 2);
    return normalizeInputValue(raw);
  }

  function submitValueForControl(control, row) {
    if (!control) return undefined;
    if (row.input === 'boolean' || row.type === 'boolean') return control.value === 'true';
    if (row.type === 'number') {
      var value = Number(control.value || 0);
      if (row.submitDivisor) value = value / Number(row.submitDivisor || 1);
      return value;
    }
    if (row.type === 'list') {
      return control.value.split(/\n|,/).map(function(item) { return item.trim(); }).filter(Boolean);
    }
    if (row.input === 'add-on-products' || row.type === 'add_on_products') {
      try {
        return JSON.parse(control.value || '[]');
      } catch (_error) {
        return control.value;
      }
    }
    return control.value;
  }

  function originalValueKey(row, value) {
    return JSON.stringify(submittedSettingValue(row, value));
  }

  function submittedSettingValue(row, explicitValue) {
    if (explicitValue !== undefined) {
      if (row.displayMultiplier && row.submitDivisor && row.type === 'number') {
        return Number(explicitValue || 0) / Number(row.submitDivisor || 1);
      }
      return explicitValue;
    }
    var raw = row.rawValue !== undefined ? row.rawValue : row.value;
    if (row.displayMultiplier && row.submitDivisor && row.type === 'number') return Number(raw || 0);
    if (row.input === 'boolean' || row.type === 'boolean') return isTruthy(raw);
    return raw === undefined ? '' : raw;
  }

  function createSettingControl(row, originalMap) {
    var path = row.path || '';
    var value = valueForSettingInput(row);
    var control;
    if (row.input === 'select' && Array.isArray(row.options)) {
      control = document.createElement('select');
      row.options.forEach(function(option) {
        var opt = document.createElement('option');
        opt.value = String(option.value);
        opt.textContent = option.label || option.value;
        control.appendChild(opt);
      });
      control.value = value;
    } else if (row.input === 'boolean' || row.type === 'boolean') {
      control = document.createElement('select');
      [['true', 'Yes'], ['false', 'No']].forEach(function(pair) {
        var opt = document.createElement('option');
        opt.value = pair[0];
        opt.textContent = pair[1];
        control.appendChild(opt);
      });
      control.value = value;
    } else if (row.input === 'textarea' || row.input === 'add-on-products' || row.type === 'list' || row.type === 'add_on_products') {
      control = document.createElement('textarea');
      control.rows = row.input === 'add-on-products' || row.type === 'add_on_products' ? 12 : 4;
      control.value = value;
    } else {
      control = document.createElement('input');
      control.type = row.input === 'url' ? 'url' : row.input === 'email' ? 'email' : row.type === 'number' || row.input === 'integer' || row.input === 'percent' ? 'number' : 'text';
      control.value = value;
      if (row.min !== undefined) control.min = String(row.min);
      if (row.max !== undefined) control.max = String(row.max);
      if (row.step !== undefined) control.step = String(row.step);
      if (row.input === 'color') {
        control.autocomplete = 'off';
        control.inputMode = 'text';
        control.pattern = '#[0-9a-fA-F]{6}';
      }
    }
    control.className = 'admin-settings__input';
    if (row.input === 'color') control.className += ' admin-settings__input--color-text';
    control.dataset.settingsPath = path;
    if (row.placeholder) control.placeholder = row.placeholder;
    if (path) originalMap.set(path, originalValueKey(row));
    control.addEventListener('input', function() {
      updateConditionalRows(settingsScopeRoot(control));
      updatePublishButtons();
    });
    control.addEventListener('change', function() {
      updateConditionalRows(settingsScopeRoot(control));
      updatePublishButtons();
    });
    return control;
  }

  function normalizeHexColor(value) {
    var text = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(text) ? text : '';
  }

  function createColorField(row, control) {
    var wrapper = createElement('div', 'admin-settings__color-field');
    var picker = document.createElement('input');
    var initial = normalizeHexColor(control.value) || '#000000';
    picker.type = 'color';
    picker.className = 'admin-settings__input admin-settings__input--color';
    picker.value = initial;
    picker.setAttribute('aria-label', 'Pick ' + (row.label || 'color'));
    picker.addEventListener('input', function() {
      control.value = picker.value;
      control.dispatchEvent(new Event('input', { bubbles: true }));
    });
    picker.addEventListener('change', function() {
      control.value = picker.value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    });
    control.addEventListener('input', function() {
      var next = normalizeHexColor(control.value);
      if (next) picker.value = next;
    });
    wrapper.appendChild(picker);
    wrapper.appendChild(control);
    return wrapper;
  }

  function settingsScopeRoot(control) {
    return control.closest('[data-settings-section-panel], #admin-settings-results') || document;
  }

  function applyVisibleWhenDataset(element, row) {
    if (!element || !row || !row.visibleWhen) return;
    element.dataset.visibleWhenPath = row.visibleWhen.path || '';
    element.dataset.visibleWhenValue = String(row.visibleWhen.value);
  }

	  function renderSettingRow(row, originalMap, scope, options) {
	    var opts = options || {};
	    var helpRow = rowWithSettingFieldHelp(row);
	    var wrapper = createElement('div', opts.fieldGridItem ? 'admin-settings__row admin-settings__field-grid-item' : 'admin-settings__row');
    wrapper.dataset.settingsRowLabel = row.label || '';
    wrapper.dataset.settingsScope = scope || 'settings';
    applyVisibleWhenDataset(wrapper, row);
    var header = createElement('div', 'admin-settings__row-header');
    var label = document.createElement('label');
    label.textContent = row.label || row.path || 'Setting';
    header.appendChild(label);
    var body = createElement('div', 'admin-settings__row-body');
    if (row.input === 'plan-usage' || row.input === 'store-readiness') {
      wrapper.classList.add('admin-settings__row--custom');
      if (row.hideLabel) wrapper.classList.add('admin-settings__row--hide-label');
      body.appendChild(row.input === 'plan-usage' ? createPlanUsageTracker() : createStoreReadinessTracker());
      if (!row.hideLabel) wrapper.appendChild(header);
      wrapper.appendChild(body);
      return wrapper;
    }
	    if (row.editable && row.path === 'admin.users') {
	      var usersEditor = renderAdminUsersEditor(row);
	      usersEditor.dataset.settingsPath = 'admin.users';
	      body.appendChild(usersEditor);
	      var usersHelp = createHelp(helpRow, null);
	      if (usersHelp) header.appendChild(usersHelp);
	    } else if (row.editable) {
	      var control = createSettingControl(row, originalMap);
      var controlId = 'admin-setting-' + String(row.path || '').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
      control.id = controlId;
      if (row.input !== 'image-upload') label.setAttribute('for', controlId);
      if (row.input === 'image-upload') {
        body.appendChild(createImageUploadField(row, control));
      } else if (row.input === 'color') {
        body.appendChild(createColorField(row, control));
      } else {
        body.appendChild(control);
      }
	      var help = createHelp(helpRow, control);
	      if (help) header.appendChild(help);
	    } else {
	      body.appendChild(createElement('p', 'admin-settings__value', Array.isArray(row.value) ? row.value.join(', ') : row.value));
	      var readOnlyHelp = createHelp(helpRow, null);
	      if (readOnlyHelp) header.appendChild(readOnlyHelp);
	    }
    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
  }

  function renderSettingsRows(panel, rows, originalMap, scope) {
    settingsRowsForRender(rows || []).forEach(function(row) {
      if (!row) return;
      if (row.input === 'settings-field-grid') {
        var grid = createElement('div', 'admin-settings__field-grid admin-settings__field-grid--count-' + String(row.rows.length));
        grid.dataset.settingsRowLabel = row.label || '';
        grid.dataset.settingsScope = scope || 'settings';
        row.rows.forEach(function(childRow) {
          grid.appendChild(renderSettingRow(childRow, originalMap, scope, { fieldGridItem: true }));
        });
        panel.appendChild(grid);
        return;
      }
      panel.appendChild(renderSettingRow(row, originalMap, scope));
    });
  }

  function renderSettingsSection(section) {
    var results = $('#admin-settings-results');
    if (!results) return;
    clear(results);
    if (!section) return;
	    var panel = createElement('section', 'admin-settings__section');
	    panel.dataset.settingsSectionPanel = section.title || '';
	    panel.dataset.settingsScope = 'settings';
	    renderSettingsRows(panel, section.rows, settingOriginalValues, 'settings');
    results.appendChild(panel);
    updateConditionalRows(panel);
    loadSettingsCustomControls(panel);
    updatePublishButtons();
  }

  function storeMarketingDatasetKey(path) {
    switch (String(path || '')) {
      case 'marketing.default_utm_source': return 'marketingDefaultUtmSource';
      case 'marketing.default_utm_medium': return 'marketingDefaultUtmMedium';
      case 'marketing.default_utm_campaign': return 'marketingDefaultUtmCampaign';
      case 'marketing.default_utm_content': return 'marketingDefaultUtmContent';
      case 'marketing.default_ref': return 'marketingDefaultRef';
      case 'marketing.landing_page_path': return 'marketingLandingPagePath';
      case 'marketing.share_title': return 'marketingShareTitle';
      case 'marketing.share_text': return 'marketingShareText';
      default: return '';
    }
  }

  function syncStoreMarketingDefaultsFromRows(rows) {
    if (!script || !script.dataset) return false;
    var changed = false;
    (rows || []).forEach(function(row) {
      var key = storeMarketingDatasetKey(row && row.path);
      if (!key) return;
      var value = normalizeInputValue(row.rawValue !== undefined ? row.rawValue : row.value);
      if (script.dataset[key] !== value) changed = true;
      script.dataset[key] = value;
    });
    return changed;
  }

  function applyStoreMarketingPlaceholders() {
    [
      ['path', 'marketingLandingPagePath', '/'],
      ['ref', 'marketingDefaultRef', ''],
      ['source', 'marketingDefaultUtmSource', 'dustwave'],
      ['medium', 'marketingDefaultUtmMedium', 'social'],
      ['campaign', 'marketingDefaultUtmCampaign', 'shop'],
      ['content', 'marketingDefaultUtmContent', '']
    ].forEach(function(entry) {
      var field = storeMarketingField(entry[0]);
      if (field) field.placeholder = marketingDefault(entry[1], entry[2]);
    });
  }

  function hydrateStoreMarketingDefaults(section) {
    var rows = section && Array.isArray(section.rows) ? section.rows : [];
    if (rows.length) syncStoreMarketingDefaultsFromRows(rows);
    applyStoreMarketingPlaceholders();
  }

  function updateConditionalRows(root) {
    $all('[data-visible-when-path]', root || document).forEach(function(row) {
      var path = row.dataset.visibleWhenPath;
      var expected = row.dataset.visibleWhenValue;
      var control = $('[data-settings-path="' + path + '"]');
      var actual = control ? control.value : '';
      row.hidden = String(actual) !== String(expected);
    });
  }

  function collectSettingChanges(root, originalMap) {
    var changes = [];
    $all('[data-settings-path]', root).forEach(function(control) {
      if (!control.matches('input, select, textarea')) return;
      var path = control.dataset.settingsPath;
      if (!path || path === 'admin.users') return;
      var row = findSettingRow(path);
      if (!row) return;
      var value = submitValueForControl(control, row);
      var nextKey = JSON.stringify(value);
      if (originalMap.get(path) !== nextKey) {
        changes.push({ path: path, value: value });
      }
    });
    return changes;
  }

  function findSettingRow(path) {
    var allSections = settingsSections
      .concat(marketingSettingsSection ? [marketingSettingsSection] : []);
    for (var i = 0; i < allSections.length; i += 1) {
      var rows = allSections[i].rows || [];
      for (var j = 0; j < rows.length; j += 1) {
        if (rows[j].path === path) return rows[j];
      }
    }
    return null;
  }

  function updatePublishButtons() {
    var section = settingsSections[currentSettingsSection];
    var settingsPublish = $('#admin-settings-publish');
    if (settingsPublish) {
      preserveSettingsHeaderHeight();
      var settingsRoot = $('#admin-settings-results');
      var changes = settingsRoot ? collectSettingChanges(settingsRoot, settingOriginalValues) : [];
      var publishable = sectionHasEditableRows(section || {}, false);
      settingsPublish.hidden = !publishable;
      setDirtyButtonState(settingsPublish, changes.length > 0, 'Publish', 'Publish', {
        forceDisabled: !publishable
      });
    }
  }

  function preserveSettingsHeaderHeight() {
    var header = $('#admin-panel-settings .admin-settings__header');
    if (!header) return;
    var current = Math.round(header.getBoundingClientRect().height || header.offsetHeight || 0);
    var previous = Number(header.dataset.minMeasuredHeight || 0);
    var next = Math.max(previous, current);
    if (next > 0) {
      header.dataset.minMeasuredHeight = String(next);
      header.style.minHeight = next + 'px';
    }
  }

  function publishSettings(root, originalMap, statusElement, button) {
    var changes = collectSettingChanges(root, originalMap);
    if (!changes.length) return;
    button.disabled = true;
    setStatus(statusElement, 'Publishing settings...');
    requestJson('/admin/settings/publish', {
      method: 'POST',
      body: { changes: changes, preferredLang: preferredLang() }
    }).then(function(data) {
      setStatus(statusElement, data.deployNotice || data.message || 'Settings published.');
      changes.forEach(function(change) {
        originalMap.set(change.path, JSON.stringify(change.value));
      });
      updatePublishButtons();
    }).catch(function(error) {
      setStatus(statusElement, formatError(error), true);
      updatePublishButtons();
    });
  }

  function loadSettings() {
    var status = $('#admin-settings-status');
    setStatus(status, 'Loading settings...');
    return requestJson('/admin/settings').then(function(data) {
      settingsLoaded = true;
      currentUser = data.user || currentUser;
      var sections = Array.isArray(data.sections) ? data.sections : [];
      marketingSettingsSection = sections.find(function(section) { return section.title === 'Marketing'; }) || null;
      settingsSections = sections.filter(function(section) {
        return section.title !== 'Marketing';
      });
      currentSettingsSection = Math.min(currentSettingsSection, Math.max(0, settingsSections.length - 1));
      settingOriginalValues.clear();
      renderSettingsTabs();
      selectSettingsSection(currentSettingsSection);
      hydrateStoreMarketingDefaults(marketingSettingsSection);
      setStatus(status, '');
    }).catch(function(error) {
      setStatus(status, formatError(error), true);
    });
  }

  function setupSettingsEvents() {
    var settingsButton = $('#admin-settings-publish');
    if (settingsButton) {
      settingsButton.addEventListener('click', function() {
        publishSettings($('#admin-settings-results'), settingOriginalValues, $('#admin-settings-status'), settingsButton);
      });
    }
  }

  function renderAdminUsersEditor(row) {
    var users = Array.isArray(row.rawValue) ? row.rawValue.slice() : [];
    var accessOptions = Array.isArray(row.accessOptions) ? row.accessOptions : [{ label: 'Store', value: 'store' }];
    var currentEmail = String(row.currentUserEmail || '').toLowerCase();
    var wrapper = createElement('div', 'admin-settings__products-editor admin-settings__users-editor');
    var cards = createElement('div', 'admin-settings__products-list admin-settings__users-list');
    var actions = createElement('div', 'admin-settings__actions admin-settings__user-actions');
    var status = createElement('p', 'admin-dashboard__status admin-users-editor__status');
    status.dataset.adminUsersStatus = 'true';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    wrapper.dataset.adminUsersEditor = 'true';

    function syncValue() {
      users = $all('[data-admin-user-card]', cards).map(readAdminUserCard);
      wrapper.value = JSON.stringify(users);
      updateAdminUsersSaveState(wrapper);
      updatePublishButtons();
    }

    function renderCards() {
      clear(cards);
      users.forEach(function(user, index) {
        cards.appendChild(renderAdminUserCard(user, index, currentEmail, accessOptions, syncValue));
      });
      syncValue();
    }

    var add = createElement('button', 'btn btn--secondary', 'Add user');
    add.type = 'button';
    add.addEventListener('click', function() {
      users.unshift({ name: '', email: '', role: 'limited_admin', accessScopes: [] });
      renderCards();
    });
    var save = createElement('button', 'btn', 'Save users');
    save.type = 'button';
    save.dataset.adminUsersSave = 'true';
    save.disabled = true;
    save.addEventListener('click', function() {
      var payload = readAdminUsers(cards);
      save.disabled = true;
      status.textContent = 'Saving users...';
      requestJson('/admin/users', {
        method: 'POST',
        body: { users: payload, preferredLang: preferredLang() }
      }).then(function(data) {
        users = Array.isArray(data.users) ? data.users : payload;
        status.textContent = 'Users saved. Changes take effect immediately.';
        renderCards();
        wrapper.dataset.adminUsersSavedValue = wrapper.value || '[]';
        updateAdminUsersSaveState(wrapper);
      }).catch(function(error) {
        status.textContent = formatError(error);
      }).finally(function() {
        updateAdminUsersSaveState(wrapper);
      });
    });
    actions.appendChild(status);
    actions.appendChild(save);
    renderCards();
    wrapper.dataset.adminUsersSavedValue = wrapper.value || '[]';
    updateAdminUsersSaveState(wrapper);
    wrapper.appendChild(add);
    wrapper.appendChild(cards);
    wrapper.appendChild(actions);
    return wrapper;
  }

  function updateAdminUsersSaveState(root) {
    if (!root) return;
    var save = $('[data-admin-users-save]', root);
    if (!save) return;
    var dirty = String(root.value || '[]') !== String(root.dataset.adminUsersSavedValue || '[]');
    setDirtyButtonState(save, dirty, 'Save users', 'Save users');
  }

  function adminUserHelp(key) {
    var help = {
      name: 'Internal display name for this admin account.',
      email: 'Email address used for admin magic-link sign-in.',
      role: 'Super admins can manage all dashboard sections. Limited admins can manage only selected access areas.',
      access: 'Dashboard areas this limited admin can view and manage. Super admins automatically have full access.'
    };
    return help[key] || '';
  }

  function adminUserField(labelText, field, value, options) {
    var opts = options || {};
    var wrapper = createElement('div', 'admin-settings__product-field admin-settings__user-field');
    var labelRow = createElement('div', 'admin-settings__product-label');
    var controlId = 'admin-user-field-' + String(++adminFieldIdCounter);
    var labelTextNode = document.createElement('label');
    var control;
    labelTextNode.setAttribute('for', controlId);
    labelTextNode.textContent = labelText;
    labelRow.appendChild(labelTextNode);
    if (adminUserHelp(field)) {
      labelRow.appendChild(createHelp({ label: labelText, path: 'admin-user-' + field + '-' + String(adminFieldIdCounter), help: adminUserHelp(field) }, null));
    }

    if (opts.select) {
      control = document.createElement('select');
      opts.select.forEach(function(optionConfig) {
        var option = document.createElement('option');
        option.value = optionConfig.value;
        option.textContent = optionConfig.label;
        control.appendChild(option);
      });
      control.value = value || opts.select[0].value;
    } else {
      control = document.createElement('input');
      control.type = opts.type || 'text';
      control.value = value || '';
    }
    control.id = controlId;
    control.dataset.adminUserField = field;
    if (opts.required) control.required = true;
    if (opts.disabled) control.disabled = true;
    if (opts.readOnly && 'readOnly' in control) {
      control.readOnly = true;
      control.classList.add('admin-settings__input--readonly');
    }
    wrapper.appendChild(labelRow);
    wrapper.appendChild(control);
    return wrapper;
  }

  function adminUserAccessList(user, accessOptions) {
    var field = createElement('div', 'admin-settings__product-field admin-settings__product-field--wide admin-settings__user-access');
    var labelRow = createElement('span', 'admin-settings__product-label');
    var labelId = 'admin-user-access-' + String(++adminFieldIdCounter);
    var selected = new Set((Array.isArray(user.accessScopes) ? user.accessScopes : []).map(String));
    var list = createElement('div', 'admin-settings__checkbox-list admin-settings__user-access-list');
    labelRow.id = labelId;
    labelRow.appendChild(createElement('span', '', 'Access'));
    labelRow.appendChild(createHelp({ label: 'Access', path: 'admin-user-access-' + String(adminFieldIdCounter), help: adminUserHelp('access') }, null));
    list.setAttribute('role', 'group');
    list.setAttribute('aria-labelledby', labelId);
    accessOptions.forEach(function(option) {
      var label = createElement('label', 'admin-settings__checkbox-option admin-settings__user-access-option');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = option.value;
      checkbox.dataset.adminUserAccessScope = option.value;
      checkbox.checked = selected.has(String(option.value));
      label.appendChild(checkbox);
      label.appendChild(createElement('span', '', option.label || option.value));
      list.appendChild(label);
    });
    if (!accessOptions.length) {
      list.appendChild(createElement('p', 'admin-settings__empty-note', 'No access scopes are configured.'));
    }
    field.appendChild(labelRow);
    field.appendChild(list);
    return field;
  }

  function updateAdminUserCardConditionalFields(card) {
    var role = $('[data-admin-user-field="role"]', card);
    var access = $('.admin-settings__user-access', card);
    if (access) access.hidden = role && role.value === 'super_admin';
  }

  function renderAdminUserCard(user, index, currentEmail, accessOptions, syncValue) {
    var email = String(user.email || '').toLowerCase();
    var isSelf = email && email === currentEmail;
    var card = createElement('section', 'admin-settings__product-card admin-settings__user-card');
    card.dataset.adminUserCard = 'true';
    card.dataset.adminUserIndex = String(index);
    if (isSelf) card.dataset.adminCurrentUser = 'true';
    card.appendChild(adminUserField('Name', 'name', user.name || '', { type: 'text' }));
    card.appendChild(adminUserField('Email', 'email', user.email || '', { type: 'email', required: true, readOnly: isSelf }));
    card.appendChild(adminUserField('Role', 'role', user.role === 'super_admin' ? 'super_admin' : 'limited_admin', {
      select: [
        { value: 'limited_admin', label: 'Limited admin' },
        { value: 'super_admin', label: 'Super admin' }
      ],
      required: true,
      disabled: isSelf
    }));
    card.appendChild(adminUserAccessList(user, accessOptions));
    updateAdminUserCardConditionalFields(card);
    var del = createElement('button', 'btn btn--secondary admin-settings__collection-delete', 'Delete');
    del.type = 'button';
    del.disabled = isSelf;
    del.setAttribute('aria-label', 'Delete admin user ' + (user.email || ''));
    if (isSelf) del.title = 'You cannot delete your own admin account.';
    del.addEventListener('click', function() {
      if (del.disabled) return;
      card.remove();
      syncValue();
    });
    card.appendChild(del);
    card.addEventListener('input', syncValue);
    card.addEventListener('change', function(event) {
      if (event.target && event.target.dataset && event.target.dataset.adminUserField === 'role') {
        updateAdminUserCardConditionalFields(card);
      }
      syncValue();
    });
    return card;
  }

  function readAdminUserCard(card) {
    var role = ($('[data-admin-user-field="role"]', card) || {}).value || 'limited_admin';
    var accessScopes = role === 'super_admin' ? [] : $all('[data-admin-user-access-scope]', card)
      .filter(function(input) { return input.checked; })
      .map(function(input) { return input.value; });
    return {
      name: (($('[data-admin-user-field="name"]', card) || {}).value || '').trim(),
      email: (($('[data-admin-user-field="email"]', card) || {}).value || '').trim().toLowerCase(),
      role: role,
      accessScopes: accessScopes
    };
  }

  function readAdminUsers(root) {
    return $all('[data-admin-user-card]', root).map(readAdminUserCard);
  }

  function orderFilters(cursor) {
    return {
      status: ($('#admin-store-order-status') || {}).value || 'all',
      fulfillment: ($('#admin-store-order-fulfillment') || {}).value || 'all',
      q: ($('#admin-store-order-query') || {}).value || '',
      cursor: cursor || 0,
      limit: 25
    };
  }

  function planUsagePeriodLabel(period) {
    var labels = {
      daily: 'Daily',
      monthly: 'Monthly',
      rate_limit: 'Rate window'
    };
    return labels[period] || String(period || '');
  }

  function planUsageUnitLabel(unit) {
    var labels = {
      emails: 'emails',
      operations: 'operations',
      requests: 'requests',
      count: 'items'
    };
    return labels[unit] || String(unit || '');
  }

  function formatPlanUsageNumber(value) {
    return value === null || value === undefined ? 'Not available' : formatNumber(value);
  }

  function planUsageMetricText(metric) {
    if (metric && metric.unlimited === true) return 'Unlimited';
    var used = formatPlanUsageNumber(metric && metric.used);
    var unit = planUsageUnitLabel(metric && metric.unit);
    if (!metric || metric.limit === null || metric.limit === undefined) {
      return !metric || metric.used === null || metric.used === undefined ? 'Not available' : used + ' ' + unit;
    }
    if (metric.used === null || metric.used === undefined) {
      return formatNumber(metric.limit) + ' ' + unit + ' limit';
    }
    return used + ' of ' + formatNumber(metric.limit) + ' ' + unit;
  }

  function planUsageProviderSeverity(provider) {
    if (provider && provider.status && provider.status !== 'ok') return provider.status;
    var metrics = Array.isArray(provider && provider.metrics) ? provider.metrics : [];
    if (metrics.some(function(metric) { return metric && metric.severity === 'critical'; })) return 'critical';
    if (metrics.some(function(metric) { return metric && metric.severity === 'warning'; })) return 'warning';
    return 'ok';
  }

  function planUsageMetricHelp(metric) {
    var helps = {
      'cloudflare-workers-requests': 'Worker invocation requests for the selected period.',
      'cloudflare-kv-reads': 'Workers KV read operations for the selected period.',
      'cloudflare-kv-writes': 'Workers KV write operations for the selected period.',
      'cloudflare-kv-deletes': 'Workers KV delete operations for the selected period.',
      'cloudflare-kv-lists': 'Workers KV list operations for the selected period.',
      'resend-monthly-emails': 'Sent and received emails counted against the current monthly quota. If Resend omits the usage header, only the inferred plan limit is shown.',
      'resend-daily-emails': 'Daily email quota usage. Paid Resend transactional plans do not have a daily email quota.',
      'resend-api-rate-window': 'Current per-second Resend API request window. The dashboard usage check counts as one request.'
    };
    return helps[String(metric && metric.id || '')] || (metric && metric.help) || '';
  }

  function planUsageProviderHelp(provider) {
    if (provider && provider.id === 'cloudflare') {
      return 'Shows how close this Worker and its KV storage are to the Cloudflare plan limits. Free/Paid is detected automatically when the usage token can read billing; otherwise use the plan override.';
    }
    if (provider && provider.id === 'resend') {
      return 'Shows the Resend email quota and current API request window for this team. Resend may only provide the plan limit, so monthly sent usage can be unavailable.';
    }
    return '';
  }

  function planUsageProviderScopeText(provider) {
    var scope = String(provider && provider.scope || '');
    if (provider && provider.id === 'cloudflare' && scope.indexOf('Worker script: ') === 0) return scope;
    if (provider && provider.id === 'cloudflare') return 'Account-wide Workers and KV usage';
    if (provider && provider.id === 'resend') return 'Team email quota';
    return scope;
  }

  function renderPlanUsageMetric(metric) {
    var item = createElement('div', 'admin-plan-usage__metric admin-plan-usage__metric--' + String(metric && metric.severity || 'unknown'));
    var header = createElement('div', 'admin-plan-usage__metric-header');
    header.appendChild(createElement('strong', '', (metric && metric.label) || 'Metric'));
    header.appendChild(createElement('span', '', planUsagePeriodLabel(metric && metric.period)));

    var value = createElement('p', 'admin-plan-usage__metric-value', planUsageMetricText(metric || {}));
    var percent = Number(metric && metric.percent);
    var bar = createElement('div', 'admin-plan-usage__bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    if (metric && metric.unlimited === true) {
      bar.setAttribute('aria-valuetext', 'Unlimited');
      bar.style.setProperty('--admin-plan-usage-percent', '0%');
    } else if (Number.isFinite(percent)) {
      var clampedPercent = Math.max(0, Math.min(100, percent));
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', String(Math.round(clampedPercent)));
      bar.setAttribute('aria-valuetext', String(Math.round(percent)) + '% used');
      bar.style.setProperty('--admin-plan-usage-percent', clampedPercent + '%');
    } else {
      bar.setAttribute('aria-valuetext', 'Usage unavailable');
      bar.style.setProperty('--admin-plan-usage-percent', '0%');
    }
    bar.appendChild(createElement('span', 'admin-plan-usage__bar-fill'));

    item.appendChild(header);
    item.appendChild(value);
    item.appendChild(bar);
    var helpText = planUsageMetricHelp(metric || {});
    if (helpText) item.appendChild(createElement('p', 'admin-plan-usage__metric-help', helpText));
    return item;
  }

  function renderPlanUsageProvider(provider) {
    var severity = planUsageProviderSeverity(provider || {});
    var card = createElement('section', 'admin-plan-usage__provider admin-plan-usage__provider--' + severity);
    var header = createElement('div', 'admin-plan-usage__provider-header');
    var title = createHeadingWithHelp('h4', 'admin-settings__label admin-plan-usage__provider-title', (provider && provider.name) || 'Provider', {
      help: planUsageProviderHelp(provider || {}),
      path: 'plan-usage-' + String(provider && provider.id || 'provider')
    });
    header.appendChild(title);
    header.appendChild(createElement('span', '', (provider && provider.planName) || 'Plan unknown'));
    card.appendChild(header);

    if (provider && provider.status && provider.status !== 'ok' && provider.statusMessage) {
      card.appendChild(createElement('p', 'admin-plan-usage__provider-status', provider.statusMessage));
    }
    var scope = planUsageProviderScopeText(provider || {});
    if (scope) card.appendChild(createElement('p', 'admin-plan-usage__scope', scope));

    var metrics = createElement('div', 'admin-plan-usage__metrics');
    (Array.isArray(provider && provider.metrics) ? provider.metrics : []).forEach(function(metric) {
      metrics.appendChild(renderPlanUsageMetric(metric));
    });
    card.appendChild(metrics);

    var links = createElement('div', 'admin-plan-usage__links');
    (Array.isArray(provider && provider.links) ? provider.links : []).forEach(function(linkConfig) {
      if (!linkConfig || !linkConfig.url || !linkConfig.label) return;
      var providerLink = createElement('a', 'admin-plan-usage__link', linkConfig.label);
      providerLink.href = linkConfig.url;
      providerLink.rel = 'noopener noreferrer';
      providerLink.target = '_blank';
      links.appendChild(providerLink);
    });
    if (provider && provider.upgradeUrl) {
      var upgrade = createElement('a', 'admin-plan-usage__link admin-plan-usage__upgrade', 'Manage plan');
      upgrade.href = provider.upgradeUrl;
      upgrade.rel = 'noopener noreferrer';
      upgrade.target = '_blank';
      links.appendChild(upgrade);
    }
    if (links.childElementCount) card.appendChild(links);
    return card;
  }

  function renderPlanUsageResults(root, data) {
    var results = $('[data-plan-usage-results]', root);
    if (!results) return;
    clear(results);
    var providers = Array.isArray(data && data.providers) ? data.providers : [];
    if (!providers.length) {
      results.appendChild(createElement('p', 'admin-app__muted', 'No provider usage was returned.'));
      return;
    }
    providers.forEach(function(provider) {
      results.appendChild(renderPlanUsageProvider(provider));
    });
  }

  function loadPlanUsageTracker(root) {
    if (!(root instanceof HTMLElement)) return;
    if (root.dataset.planUsageState === 'loading' || root.dataset.planUsageState === 'loaded') return;
    var status = $('[data-plan-usage-status]', root);
    root.dataset.planUsageState = 'loading';
    setStatus(status, 'Loading plan usage...');
    return requestJson('/admin/plan-usage').then(function(data) {
      renderPlanUsageResults(root, data);
      root.dataset.planUsageState = 'loaded';
      setStatus(status, '');
      if (status) status.hidden = true;
    }).catch(function(error) {
      root.dataset.planUsageState = 'failed';
      if (status) status.hidden = false;
      setStatus(status, formatError(error), true);
    });
  }

  function createPlanUsageTracker() {
    var root = createElement('div', 'admin-plan-usage');
    root.dataset.planUsageTracker = 'true';
    var status = createElement('p', 'admin-plan-usage__status admin-app__muted', '');
    status.dataset.planUsageStatus = 'true';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    var results = createElement('div', 'admin-plan-usage__results');
    results.dataset.planUsageResults = 'true';
    root.appendChild(status);
    root.appendChild(results);
    return root;
  }

  function storeHealthStatusLabel(status) {
    switch (String(status || '').toLowerCase()) {
      case 'ok': return 'Ready';
      case 'warning': return 'Watch';
      case 'action': return 'Needs action';
      default: return 'Info';
    }
  }

  function renderStoreHealthSummary(root, data) {
    var summary = $('[data-store-readiness-summary]', root);
    if (!summary) return;
    clear(summary);
    summary.classList.add('admin-stat-grid');
    var totals = data.totals || {};
    [
      ['Overall', storeHealthStatusLabel(data.overallStatus), data.overallStatus || 'info'],
      ['Needs action', totals.action || 0, 'action'],
      ['Watch', totals.warning || 0, 'warning'],
      ['Ready', totals.ok || 0, 'ok']
    ].forEach(function(card) {
      var item = statCard('admin-store-readiness__card', card[0], card[1]);
      item.dataset.healthStatus = String(card[2] || 'info');
      summary.appendChild(item);
    });
  }

  function storeHealthCheckUpdatedAt(check) {
    var meta = check && check.meta ? check.meta : {};
    return meta.updatedAt || meta.lastRun || meta.overridesUpdatedAt || '';
  }

  function renderStoreReadiness(root, data) {
    var results = $('[data-store-readiness-results]', root);
    if (!results) return;
    clear(results);
    renderStoreHealthSummary(root, data);
    var checks = Array.isArray(data.checks) ? data.checks : [];
    if (!checks.length) {
      results.appendChild(createElement('p', 'admin-app__muted', 'No Store readiness checks are available.'));
      return;
    }
    var table = createElement('table', 'admin-store-readiness__table');
    var thead = document.createElement('thead');
    var header = document.createElement('tr');
    ['Check', 'Status', 'Detail', 'Last checked'].forEach(function(text) {
      header.appendChild(createElement('th', '', text));
    });
    thead.appendChild(header);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    checks.forEach(function(check) {
      var status = String(check.status || 'info');
      var tr = document.createElement('tr');
      tr.dataset.healthStatus = status;
      tr.appendChild(createElement('td', '', check.label || check.key || 'Check'));
      var statusCell = document.createElement('td');
      statusCell.appendChild(createElement('span', 'admin-store-readiness__status-badge admin-store-readiness__status-badge--' + status, storeHealthStatusLabel(status)));
      tr.appendChild(statusCell);
      var detailCell = document.createElement('td');
      detailCell.appendChild(createElement('span', '', check.detail || ''));
      if (check.meta && check.meta.sourceHash) {
        detailCell.appendChild(createElement('span', 'admin-store-readiness__meta', 'Catalog hash ' + String(check.meta.sourceHash).slice(0, 10)));
      }
      tr.appendChild(detailCell);
      tr.appendChild(createElement('td', '', formatDate(storeHealthCheckUpdatedAt(check))));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    results.appendChild(table);
  }

  function loadStoreReadinessTracker(root, options) {
    if (!(root instanceof HTMLElement)) return;
    var force = options && options.force === true;
    if (!force && (root.dataset.storeReadinessState === 'loading' || root.dataset.storeReadinessState === 'loaded')) return;
    var status = $('[data-store-readiness-status]', root);
    root.dataset.storeReadinessState = 'loading';
    setStatus(status, 'Loading Store readiness...');
    return requestJson('/admin/store/health').then(function(data) {
      root.dataset.storeReadinessState = 'loaded';
      renderStoreReadiness(root, data);
      setStatus(status, '');
    }).catch(function(error) {
      root.dataset.storeReadinessState = 'failed';
      setStatus(status, formatError(error), true);
    });
  }

  function createStoreReadinessTracker() {
    var root = createElement('div', 'admin-store-readiness');
    root.dataset.storeReadinessTracker = 'true';
    var intro = createElement('p', 'admin-app__muted admin-store-readiness__intro', 'Review launch readiness for secrets, webhooks, downloads, inventory, and the generated Store catalog snapshot.');
    var actions = createElement('div', 'admin-store-readiness__actions');
    var status = createElement('p', 'admin-dashboard__status admin-store-readiness__status');
    status.dataset.storeReadinessStatus = 'true';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    var audit = createElement('button', 'btn btn--secondary', 'Export audit');
    audit.type = 'button';
    audit.hidden = !(currentUser && currentUser.role === 'super_admin');
    audit.addEventListener('click', function() {
      downloadAdminCsv({
        path: '/admin/audit.csv',
        status: status,
        fallbackFilename: 'admin-audit.csv',
        loadingMessage: 'Preparing audit CSV...',
        completeMessage: 'Audit CSV download started.'
      });
    });

    var reconciliation = createElement('button', 'btn btn--secondary', 'Export reconciliation');
    reconciliation.type = 'button';
    reconciliation.addEventListener('click', function() {
      downloadAdminCsv({
        path: '/admin/store/reconciliation.csv',
        status: status,
        fallbackFilename: 'store-reconciliation.csv',
        loadingMessage: 'Preparing reconciliation CSV...',
        completeMessage: 'Reconciliation CSV download started.'
      });
    });

    var refresh = createElement('button', 'btn btn--secondary', 'Refresh readiness');
    refresh.type = 'button';
    refresh.addEventListener('click', function() {
      loadStoreReadinessTracker(root, { force: true });
    });

    actions.appendChild(audit);
    actions.appendChild(reconciliation);
    actions.appendChild(refresh);

    var summary = createElement('div', 'admin-store-readiness__summary');
    summary.dataset.storeReadinessSummary = 'true';
    summary.setAttribute('aria-live', 'polite');
    var results = createElement('div', 'admin-store-readiness__results');
    results.dataset.storeReadinessResults = 'true';
    root.appendChild(intro);
    root.appendChild(actions);
    root.appendChild(status);
    root.appendChild(summary);
    root.appendChild(results);
    return root;
  }

  function loadSettingsCustomControls(root) {
    $all('[data-plan-usage-tracker]', root).forEach(loadPlanUsageTracker);
    $all('[data-store-readiness-tracker]', root).forEach(function(tracker) {
      loadStoreReadinessTracker(tracker);
    });
  }

  function storeAnalyticsCard(label, value) {
    return statCard('admin-store-analytics__card', label, value);
  }

  function renderStoreAnalyticsBreakdown(title, rows, valueLabel, labels) {
    var section = createElement('section', 'admin-section-panel admin-store-analytics__breakdown');
    section.appendChild(createHeadingWithHelp('h3', 'admin-card-heading admin-store-analytics__breakdown-title', title, {
      path: 'store-analytics-' + title
    }));
    var list = createElement('ul', 'admin-store-analytics__breakdown-list');
    var source = Array.isArray(rows) ? rows : [];
    if (!source.length) {
      list.appendChild(createElement('li', '', 'No data yet'));
    } else {
      source.slice(0, 6).forEach(function(row) {
        var key = String(row.key || 'Unknown');
        var displayKey = labels && labels[key] ? labels[key] + ' (' + key + ')' : key;
        var text = [
          displayKey,
          formatNumber(row.quantity || row.count || 0),
          valueLabel ? moneyFromCents(row.revenueCents || 0) : ''
        ].filter(Boolean).join(' / ');
        list.appendChild(createElement('li', '', text));
      });
    }
    section.appendChild(list);
    return section;
  }

  function renderStoreAnalyticsProductTable(rows) {
    var source = Array.isArray(rows) ? rows : [];
    var section = createElement('section', 'admin-section-panel admin-store-analytics__table-section');
    var header = createElement('div', 'admin-store-analytics__table-actions');
    header.appendChild(createHeadingWithHelp('h3', 'admin-report-heading admin-store-analytics__breakdown-title', 'Top products', {
      path: 'store-analytics-top-products'
    }));
    var exportButton = createElement('button', 'btn btn--secondary', 'Export CSV');
    exportButton.type = 'button';
    exportButton.dataset.storeAnalyticsExport = 'products';
    header.appendChild(exportButton);
    section.appendChild(header);

    var wrap = createElement('div', 'admin-store-analytics__table-wrap');
    var table = createElement('table', 'admin-store-analytics__table');
    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    ['Product', 'Quantity', 'Revenue'].forEach(function(text) {
      headerRow.appendChild(createElement('th', '', text));
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    source.slice(0, 12).forEach(function(row) {
      var tr = document.createElement('tr');
      tr.appendChild(createElement('td', '', row.key || 'Unknown product'));
      tr.appendChild(createElement('td', '', formatNumber(row.quantity || 0)));
      tr.appendChild(createElement('td', '', moneyFromCents(row.revenueCents || 0)));
      tbody.appendChild(tr);
    });
    if (!source.length) {
      var emptyRow = document.createElement('tr');
      var empty = createElement('td', '', 'No product analytics yet.');
      empty.colSpan = 3;
      emptyRow.appendChild(empty);
      tbody.appendChild(emptyRow);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    section.appendChild(wrap);
    return section;
  }

  function renderStoreAnalytics(data) {
    var root = $('#admin-store-analytics-results');
    if (!root) return;
    clear(root);
    var totals = data.totals || {};
    var summary = createElement('div', 'admin-stat-grid admin-store-analytics__summary');
    [
      ['Revenue', moneyFromCents(totals.revenueCents || 0)],
      ['Orders', formatNumber(totals.orders || 0)],
      ['Average order', moneyFromCents(totals.averageOrderCents || 0)],
      ['Items', formatNumber(totals.itemQuantity || 0)],
      ['Physical', formatNumber(totals.physicalQuantity || 0)],
      ['Digital', formatNumber(totals.digitalQuantity || 0)],
      ['Tickets', formatNumber(totals.ticketQuantity || 0)],
      ['Checked in', formatNumber(totals.checkedInQuantity || 0) + ' / ' + formatNumber(totals.ticketQuantity || 0)]
    ].forEach(function(card) {
      summary.appendChild(storeAnalyticsCard(card[0], card[1]));
    });
    root.appendChild(summary);

    var breakdowns = createElement('div', 'admin-store-analytics__breakdowns');
    var dataBreakdowns = data.breakdowns || {};
    var referralLabels = data.referralLabels || {};
    breakdowns.appendChild(renderStoreAnalyticsBreakdown('Fulfillment', dataBreakdowns.fulfillment || [], true));
    breakdowns.appendChild(renderStoreAnalyticsBreakdown('Order status', dataBreakdowns.status || [], true));
    breakdowns.appendChild(renderStoreAnalyticsBreakdown('Payment status', dataBreakdowns.payment || [], true));
    breakdowns.appendChild(renderStoreAnalyticsBreakdown('Referral codes', dataBreakdowns.referral || [], true, referralLabels));
    breakdowns.appendChild(renderStoreAnalyticsBreakdown('UTM sources', dataBreakdowns.utmSource || [], true));
    breakdowns.appendChild(renderStoreAnalyticsBreakdown('UTM mediums', dataBreakdowns.utmMedium || [], true));
    breakdowns.appendChild(renderStoreAnalyticsBreakdown('UTM campaigns', dataBreakdowns.utmCampaign || [], true));
    breakdowns.appendChild(renderStoreAnalyticsBreakdown('UTM contents', dataBreakdowns.utmContent || [], true));
    root.appendChild(breakdowns);
    root.appendChild(renderStoreAnalyticsProductTable(dataBreakdowns.products || []));
  }

  function loadStoreAnalytics() {
    var status = $('#admin-store-analytics-status');
    setStatus(status, 'Loading Store analytics...');
    return requestJson('/admin/store/analytics').then(function(data) {
      storeAnalyticsLoaded = true;
      renderStoreAnalytics(data);
      setStatus(status, '');
    }).catch(function(error) {
      setStatus(status, formatError(error), true);
    });
  }

  function normalizeMarketingReferralCode(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  function storeMarketingBaseUrl() {
    var siteUrl = (config.platform && config.platform.siteUrl) || (script && script.dataset ? script.dataset.canonicalSiteUrl : '') || window.location.origin;
    return normalizeBase(siteUrl || window.location.origin);
  }

  function storeProductPreviewBaseUrl() {
    var current = normalizeBase(window.location.origin);
    try {
      var parsed = new URL(current);
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') {
        return current;
      }
    } catch (_error) {
      return current;
    }
    return storeMarketingBaseUrl() || current;
  }

  function escapeStoreProductRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function storeProductPreviewOrigin(value) {
    try {
      return new URL(normalizeBase(value || '')).origin;
    } catch (_error) {
      return '';
    }
  }

  function storeProductPreviewReturnedBaseOrigin(markup) {
    var match = String(markup || '').match(/<base\b[^>]*\bhref=(["'])(.*?)\1/i);
    return match ? storeProductPreviewOrigin(match[2]) : '';
  }

  function storeProductPreviewKnownOrigins() {
    return [
      storeMarketingBaseUrl(),
      script && script.dataset ? script.dataset.canonicalSiteUrl : '',
      window.location.origin
    ].map(storeProductPreviewOrigin).filter(Boolean).filter(function(origin, index, origins) {
      return origins.indexOf(origin) === index;
    });
  }

  function storeProductPreviewAssetUrl(value) {
    var raw = String(value || '').trim();
    if (!raw || /^(?:data:|blob:)/i.test(raw)) return raw;
    var base = normalizeBase(storeProductPreviewBaseUrl());
    var previewOrigin = storeProductPreviewOrigin(base);
    if (!previewOrigin) return raw;
    try {
      var parsed = new URL(raw, base + '/');
      var knownOrigins = storeProductPreviewKnownOrigins();
      var isKnownSiteAsset = knownOrigins.indexOf(parsed.origin) >= 0 && parsed.pathname.indexOf('/assets/') === 0;
      var isRelativeAsset = raw.charAt(0) === '/' && parsed.pathname.indexOf('/assets/') === 0;
      if (isKnownSiteAsset || isRelativeAsset) {
        return previewOrigin + parsed.pathname + parsed.search + parsed.hash;
      }
      return raw;
    } catch (_error) {
      return raw;
    }
  }

  function repairStoreProductPreviewFrameImages(frame) {
    if (!frame || !frame.contentDocument) return;
    sanitizeStoreProductPreviewDocument(frame.contentDocument);
    $all('img', frame.contentDocument).forEach(function(image) {
      var current = image.getAttribute('src') || '';
      var next = storeProductPreviewAssetUrl(current);
      image.loading = 'eager';
      image.decoding = 'sync';
      if (next && next !== current) image.setAttribute('src', next);
    });
  }

  function marketingDefault(name, fallback) {
    if (!script || !script.dataset) return fallback || '';
    return script.dataset[name] || fallback || '';
  }

  function storeMarketingField(id) {
    return document.getElementById('admin-store-marketing-' + id);
  }

  function storeMarketingStatus(id) {
    return document.getElementById('admin-store-marketing-' + id + '-status');
  }

  function safeStoreMarketingFilename(value, fallback) {
    return String(value || fallback || 'store')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || fallback || 'store';
  }

  function downloadTextFile(filename, text, type) {
    var blob = new Blob([String(text || '')], { type: type || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  }

  function qrSvgMarkup(qr, cellSize, margin) {
    if (!qr) return '';
    var moduleCount = qr.getModuleCount();
    var size = (moduleCount + (margin * 2)) * cellSize;
    var parts = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img">',
      '<rect width="100%" height="100%" fill="#fff"/>'
    ];
    for (var row = 0; row < moduleCount; row += 1) {
      for (var col = 0; col < moduleCount; col += 1) {
        if (!qr.isDark(row, col)) continue;
        parts.push('<rect x="' + ((col + margin) * cellSize) + '" y="' + ((row + margin) * cellSize) + '" width="' + cellSize + '" height="' + cellSize + '" fill="#000"/>');
      }
    }
    parts.push('</svg>');
    return parts.join('');
  }

  function drawQrCanvas(qr, canvas, cellSize, margin) {
    if (!qr || !(canvas instanceof HTMLCanvasElement)) return;
    var moduleCount = qr.getModuleCount();
    var size = (moduleCount + (margin * 2)) * cellSize;
    canvas.width = size;
    canvas.height = size;
    var context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, size, size);
    context.fillStyle = '#000';
    for (var row = 0; row < moduleCount; row += 1) {
      for (var col = 0; col < moduleCount; col += 1) {
        if (qr.isDark(row, col)) {
          context.fillRect((col + margin) * cellSize, (row + margin) * cellSize, cellSize, cellSize);
        }
      }
    }
  }

  function createStoreMarketingQr(url) {
    var value = String(url || '').trim();
    if (!value || typeof window.qrcode !== 'function') return null;
    var qr = window.qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    return qr;
  }

  function renderStoreMarketingQr(url) {
    var preview = $('#admin-store-marketing-qr-preview');
    var status = $('#admin-store-marketing-qr-status');
    storeMarketingCurrentQr = null;
    storeMarketingCurrentQrUrl = String(url || '').trim();
    if (!preview) return;
    clear(preview);
    if (!storeMarketingCurrentQrUrl) {
      setStatus(status, '');
      return;
    }
    if (typeof window.qrcode !== 'function') {
      setStatus(status, 'QR generation is unavailable.');
      return;
    }
    try {
      var qr = createStoreMarketingQr(storeMarketingCurrentQrUrl);
      if (!qr) {
        setStatus(status, 'QR generation is unavailable.');
        return;
      }
      storeMarketingCurrentQr = qr;
      var canvas = document.createElement('canvas');
      canvas.setAttribute('aria-label', 'Store marketing QR code');
      drawQrCanvas(qr, canvas, 8, 4);
      preview.appendChild(canvas);
      setStatus(status, '');
    } catch (error) {
      logger.warn('Failed to render Store marketing QR code', error);
      setStatus(status, 'QR generation is unavailable.');
    }
  }

  function storeMarketingQrFilename(extension, row) {
    var campaign = String((row && row.utmCampaign) || (storeMarketingField('campaign') || {}).value || 'store').trim();
    var ref = normalizeMarketingReferralCode((row && row.code) || (storeMarketingField('ref') || {}).value || '');
    var base = safeStoreMarketingFilename([campaign || 'store', ref || 'qr'].filter(Boolean).join('-'), 'store-qr');
    return base + '.' + extension;
  }

  function downloadStoreMarketingQrForUrl(url, extension, options) {
    var status = options && options.status ? options.status : $('#admin-store-marketing-qr-status');
    var qr = createStoreMarketingQr(url);
    if (!qr) {
      setStatus(status, 'QR generation is unavailable.');
      return;
    }
    if (extension === 'png') {
      var canvas = document.createElement('canvas');
      drawQrCanvas(qr, canvas, 12, 4);
      var link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = storeMarketingQrFilename('png', options && options.row);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } else {
      downloadTextFile(storeMarketingQrFilename('svg', options && options.row), qrSvgMarkup(qr, 8, 4), 'image/svg+xml;charset=utf-8');
    }
    setStatus(status, 'QR code downloaded.');
  }

  function downloadStoreMarketingQrPng() {
    downloadStoreMarketingQrForUrl(storeMarketingCurrentQrUrl, 'png', { status: $('#admin-store-marketing-qr-status') });
  }

  function downloadStoreMarketingQrSvg() {
    downloadStoreMarketingQrForUrl(storeMarketingCurrentQrUrl, 'svg', { status: $('#admin-store-marketing-qr-status') });
  }

  function storeMarketingUrlFromFields() {
    var pathInput = storeMarketingField('path');
    var referrerInput = storeMarketingField('referrer');
    var refInput = storeMarketingField('ref');
    var sourceInput = storeMarketingField('source');
    var mediumInput = storeMarketingField('medium');
    var campaignInput = storeMarketingField('campaign');
    var contentInput = storeMarketingField('content');
    var path = String(pathInput && pathInput.value ? pathInput.value : '/').trim() || '/';
    var base = storeMarketingBaseUrl();
    var url;
    try {
      url = new URL(path, base + '/');
    } catch (_error) {
      url = new URL('/', base + '/');
    }
    var ref = normalizeMarketingReferralCode((refInput && refInput.value) || (referrerInput && referrerInput.value) || '');
    if (refInput) refInput.value = ref;
    [
      ['utm_source', sourceInput && sourceInput.value],
      ['utm_medium', mediumInput && mediumInput.value],
      ['utm_campaign', campaignInput && campaignInput.value],
      ['utm_content', contentInput && contentInput.value],
      ['ref', ref]
    ].forEach(function(pair) {
      var value = String(pair[1] || '').trim();
      if (value) url.searchParams.set(pair[0], value);
      else url.searchParams.delete(pair[0]);
    });
    return url.toString();
  }

  function currentStoreMarketingDraft() {
    return {
      path: (storeMarketingField('path') || {}).value || '/',
      referrer: (storeMarketingField('referrer') || {}).value || '',
      ref: normalizeMarketingReferralCode((storeMarketingField('ref') || {}).value || (storeMarketingField('referrer') || {}).value || ''),
      source: (storeMarketingField('source') || {}).value || '',
      medium: (storeMarketingField('medium') || {}).value || '',
      campaign: (storeMarketingField('campaign') || {}).value || '',
      content: (storeMarketingField('content') || {}).value || ''
    };
  }

  function applyStoreMarketingDraft(draft) {
    if (!draft || typeof draft !== 'object') return;
    ['path', 'referrer', 'ref', 'source', 'medium', 'campaign', 'content'].forEach(function(key) {
      var field = storeMarketingField(key);
      if (field) field.value = draft[key] || (key === 'path' ? '/' : '');
    });
    if (storeMarketingField('ref')) {
      storeMarketingField('ref').value = normalizeMarketingReferralCode(draft.ref || draft.referrer || '');
    }
    updateStoreMarketingBuilder();
  }

  function setStoreMarketingEditingState(code) {
    storeMarketingEditingOriginalCode = String(code || '');
    var cancel = $('#admin-store-marketing-cancel-edit');
    if (cancel) cancel.hidden = !storeMarketingEditingOriginalCode;
  }

  function editStoreMarketingReferral(row) {
    applyStoreMarketingDraft({
      path: row.path || '/',
      referrer: row.referrer || row.name || '',
      ref: row.code || '',
      source: row.utmSource || '',
      medium: row.utmMedium || '',
      campaign: row.utmCampaign || '',
      content: row.utmContent || ''
    });
    setStoreMarketingEditingState(row.code || '');
    setStatus($('#admin-store-marketing-status'), 'Editing saved referral.');
  }

  function storeMarketingReferralQrUrl(row) {
    return String((row && row.qrCode && row.qrCode.url) || (row && row.url) || '').trim();
  }

  function downloadStoreMarketingReferralQr(row, extension) {
    var url = storeMarketingReferralQrUrl(row);
    downloadStoreMarketingQrForUrl(url, extension, {
      row: row,
      status: $('#admin-store-marketing-status')
    });
  }

  function renderStoreMarketingReferrals(rows) {
    var root = $('#admin-store-marketing-referrals');
    if (!root) return;
    clear(root);
    var heading = createHeadingWithHelp('h3', 'admin-report-heading admin-store-marketing__referrals-title', 'Saved referrals', {
      path: 'store-marketing-saved-referrals'
    });
    root.appendChild(heading);
    var referrals = Array.isArray(rows) ? rows : [];
    if (!referrals.length) {
      root.appendChild(createElement('p', 'admin-app__muted', 'No saved referral links yet.'));
      return;
    }
    var wrap = createElement('div', 'admin-store-marketing__referrals-table-wrap');
    var table = createElement('table', 'admin-store-marketing__referrals-table');
    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    ['Link', 'QR', 'Created', 'Actions'].forEach(function(label) {
      var th = document.createElement('th');
      th.textContent = label;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    var tbody = document.createElement('tbody');
    referrals.forEach(function(row) {
      var tr = document.createElement('tr');
      var linkCell = document.createElement('td');
      var url = String(row.url || '');
      var label = row.referrer || row.name || row.code || url;
      if (url) {
        var link = document.createElement('a');
        link.className = 'admin-store-marketing__referral-link';
        link.href = url;
        link.title = url;
        link.textContent = label;
        linkCell.appendChild(link);
      } else {
        linkCell.textContent = label;
      }

      var qrCell = document.createElement('td');
      if (storeMarketingReferralQrUrl(row)) {
        var qrActions = createElement('div', 'admin-store-marketing__referral-qr-actions');
        var png = createElement('button', 'btn btn--secondary btn--small', 'PNG');
        png.type = 'button';
        png.addEventListener('click', function() {
          downloadStoreMarketingReferralQr(row, 'png');
        });
        var svg = createElement('button', 'btn btn--secondary btn--small', 'SVG');
        svg.type = 'button';
        svg.addEventListener('click', function() {
          downloadStoreMarketingReferralQr(row, 'svg');
        });
        qrActions.appendChild(png);
        qrActions.appendChild(svg);
        qrCell.appendChild(qrActions);
      }

      var createdCell = document.createElement('td');
      createdCell.textContent = row.createdAt ? formatDate(row.createdAt) : '';
      var actionsCell = document.createElement('td');
      var actions = createElement('div', 'admin-store-marketing__referral-actions');
      var edit = createElement('button', 'btn btn--secondary btn--small', 'Edit');
      edit.type = 'button';
      edit.addEventListener('click', function() {
        editStoreMarketingReferral(row);
      });
      var remove = createElement('button', 'btn btn--secondary btn--small', 'Delete');
      remove.type = 'button';
      remove.addEventListener('click', function() {
        deleteStoreMarketingReferral(row);
      });
      actions.appendChild(edit);
      actions.appendChild(remove);
      actionsCell.appendChild(actions);
      tr.appendChild(linkCell);
      tr.appendChild(qrCell);
      tr.appendChild(createdCell);
      tr.appendChild(actionsCell);
      tbody.appendChild(tr);
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    root.appendChild(wrap);
  }

  function loadStoreMarketingReferrals() {
    if (storeMarketingReferralsLoading) return Promise.resolve();
    storeMarketingReferralsLoading = true;
    return requestJson('/admin/store/marketing/referrals').then(function(data) {
      storeMarketingReferralsLoaded = true;
      renderStoreMarketingReferrals(data.referrals || []);
    }).catch(function(error) {
      logger.error('Failed to load Store marketing referrals', error);
      renderStoreMarketingReferrals([]);
      setStatus($('#admin-store-marketing-status'), formatError(error), true);
    }).finally(function() {
      storeMarketingReferralsLoading = false;
    });
  }

  function storeAbandonedMetricLabel(key) {
    var labels = {
      queued: 'Queued',
      sent: 'Sent',
      suppressed: 'Suppressed',
      completed: 'Completed',
      failed: 'Failed',
      alreadySent: 'Already sent'
    };
    return labels[key] || String(key || '');
  }

  function storeAbandonedOutcomeLabel(value) {
    return String(value || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b[a-z]/g, function(letter) { return letter.toUpperCase(); });
  }

  function renderStoreAbandonedMetrics(container, totals) {
    var metrics = createElement('div', 'admin-stat-grid admin-store-marketing__summary');
    ['queued', 'sent', 'suppressed', 'completed', 'failed'].forEach(function(key) {
      metrics.appendChild(statCard('admin-store-marketing__stat', storeAbandonedMetricLabel(key), formatNumber(totals && totals[key] || 0)));
    });
    container.appendChild(metrics);
  }

  function renderStoreAbandonedSuppression(container) {
    var form = createElement('form', 'admin-store-marketing__suppression');
    form.appendChild(createHeadingWithHelp('h3', 'admin-card-heading admin-store-marketing__suppression-title', 'Reminder suppression', {
      path: 'store-marketing-reminder-suppression'
    }));
    var field = createElement('div', 'admin-store-marketing__field admin-store-marketing__field--full');
    var inputId = 'admin-store-abandoned-suppression-email';
    var label = document.createElement('label');
    label.setAttribute('for', inputId);
    label.textContent = 'Email addresses';
    var input = createEmailListInput({
      label: 'Email addresses',
      name: 'abandonedCheckoutEmail',
      inputId: inputId,
      placeholder: 'buyer@example.com, another@example.com'
    });
    input.classList.add('admin-store-marketing__suppression-email-list');
    field.appendChild(label);
    field.appendChild(input);
    var actions = createElement('div', 'admin-store-marketing__suppression-actions');
    var suppress = createElement('button', 'btn btn--secondary', 'Suppress');
    suppress.type = 'submit';
    actions.appendChild(suppress);
    var status = createElement('p', 'admin-dashboard__status admin-store-marketing__outcomes-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    form.appendChild(field);
    form.appendChild(actions);
    form.appendChild(status);
    form.addEventListener('submit', function(event) {
      event.preventDefault();
      if (typeof input.commitPending === 'function') input.commitPending();
      mutateStoreAbandonedSuppression(input.value, true, status, input);
    });
    container.appendChild(form);
  }

  function canClearStoreAbandonedOutcome(row) {
    return String(row && row.type || '') === 'suppressed' &&
      String(row && row.reason || '') === 'admin_suppression' &&
      (
        /^[a-f0-9]{64}$/i.test(String(row && row.emailHash || '').trim()) ||
        String(row && row.email || '').trim().includes('@')
      );
  }

  function renderStoreAbandonedOutcomes(container, outcomes) {
    var rows = Array.isArray(outcomes) ? outcomes.slice(0, 8) : [];
    container.appendChild(createHeadingWithHelp('h3', 'admin-card-heading admin-store-marketing__outcomes-title', 'Recent reminder outcomes', {
      path: 'store-marketing-reminder-outcomes'
    }));
    if (!rows.length) {
      container.appendChild(createElement('p', 'admin-app__muted', 'No checkout reminder activity yet.'));
      return;
    }
    var wrap = createElement('div', 'admin-store-marketing__outcomes-table-wrap');
    var table = createElement('table', 'admin-store-marketing__outcomes-table');
    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    ['Email', 'Reason', 'Order', 'Date', 'Actions'].forEach(function(label) {
      headerRow.appendChild(createElement('th', '', label));
    });
    thead.appendChild(headerRow);
    var tbody = document.createElement('tbody');
    var status = createElement('p', 'admin-dashboard__status admin-store-marketing__outcomes-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    rows.forEach(function(row) {
      var tr = document.createElement('tr');
      tr.appendChild(createElement('td', '', String(row.email || '').trim() || (row.type === 'suppressed' ? 'Email hidden' : storeAbandonedOutcomeLabel(row.type))));
      tr.appendChild(createElement('td', '', storeAbandonedOutcomeLabel(row.reason)));
      tr.appendChild(createElement('td', '', [
        row.itemCount ? formatNumber(row.itemCount) + ' item' + (Number(row.itemCount) === 1 ? '' : 's') : '',
        row.totalCents ? moneyFromCents(row.totalCents) : ''
      ].filter(Boolean).join(' / ')));
      tr.appendChild(createElement('td', '', row.at ? formatDate(row.at) : ''));
      var actionsCell = document.createElement('td');
      if (row.type === 'suppressed') {
        var clear = createElement('button', 'btn btn--secondary btn--small', 'Clear');
        clear.type = 'button';
        clear.disabled = !canClearStoreAbandonedOutcome(row);
        clear.addEventListener('click', function() {
          mutateStoreAbandonedSuppression(String(row.email || ''), false, status, null, {
            emailHash: String(row.emailHash || '').trim()
          });
        });
        actionsCell.appendChild(clear);
      }
      tr.appendChild(actionsCell);
      tbody.appendChild(tr);
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
    container.appendChild(status);
  }

  function renderStoreAbandonedHealth(data) {
    var root = storeMarketingAbandonedHealthRoot;
    if (!root) return;
    clear(root);
    root.appendChild(createHeadingWithHelp('h3', 'admin-report-heading admin-store-marketing__abandoned-title', 'Abandoned-checkout reminders', {
      path: 'store-marketing-abandoned-checkout'
    }));
    var intro = createElement('p', 'admin-app__muted', 'Track opted-in checkout reminder emails and suppress addresses when needed.');
    root.appendChild(intro);
    if (!data || data.error) {
      root.appendChild(createElement('p', 'admin-app__muted', data && data.error || 'Abandoned-checkout health is not available yet.'));
      renderStoreAbandonedSuppression(root);
      return;
    }
    renderStoreAbandonedMetrics(root, data.totals || {});
    renderStoreAbandonedSuppression(root);
    renderStoreAbandonedOutcomes(root, data.recentOutcomes || []);
  }

  function loadStoreAbandonedHealth() {
    if (!storeMarketingAbandonedHealthRoot || storeMarketingAbandonedHealthLoading) return Promise.resolve();
    storeMarketingAbandonedHealthLoading = true;
    setStatus(storeMarketingAbandonedHealthRoot, 'Loading abandoned-checkout health...');
    return requestJson('/admin/store/marketing/abandoned-checkout/health').then(function(data) {
      storeMarketingAbandonedHealthLoaded = true;
      renderStoreAbandonedHealth(data);
    }).catch(function(error) {
      logger.error('Failed to load Store abandoned checkout health', error);
      renderStoreAbandonedHealth({ error: formatError(error) });
    }).finally(function() {
      storeMarketingAbandonedHealthLoading = false;
    });
  }

  function mutateStoreAbandonedSuppression(email, suppress, status, input, options) {
    var emailHash = String(options && options.emailHash || '').trim().toLowerCase();
    var canClearByHash = suppress !== true && /^[a-f0-9]{64}$/i.test(emailHash);
    var emails = Array.from(new Set(String(email || '')
      .split(',')
      .map(function(value) { return value.trim(); })
      .filter(Boolean)));
    if (!emails.length && !canClearByHash) {
      setStatus(status, 'Enter an email address.');
      return;
    }
    setStatus(status, suppress ? 'Saving reminder suppression...' : 'Clearing reminder suppression...');
    var payloads = canClearByHash
      ? [{ emailHash: emailHash }]
      : emails.map(function(value) { return { email: value }; });
    Promise.all(payloads.map(function(payload) {
      return requestJson('/admin/store/marketing/abandoned-checkout/suppression', {
        method: suppress ? 'POST' : 'DELETE',
        body: payload
      });
    })).then(function() {
      setStatus(status, suppress ? 'Reminder suppression saved.' : 'Reminder suppression cleared.');
      if (input && typeof input.clear === 'function') input.clear();
      else if (input) input.value = '';
      loadStoreAbandonedHealth();
    }).catch(function(error) {
      logger.error('Failed to update Store abandoned checkout suppression', error);
      setStatus(status, formatError(error), true);
    });
  }

  function canLoadStoreMarketingData() {
    return Boolean(currentUser && currentUser.email && csrfToken);
  }

  function loadStoreMarketingData() {
    if (!canLoadStoreMarketingData()) return;
    if (!storeMarketingReferralsLoaded) loadStoreMarketingReferrals();
    if (!storeMarketingAbandonedHealthLoaded) loadStoreAbandonedHealth();
  }

  function saveStoreMarketingReferral() {
    updateStoreMarketingBuilder();
    var draft = currentStoreMarketingDraft();
    var url = String((storeMarketingField('url') || {}).value || '').trim();
    if (!draft.ref || !draft.referrer || !url) {
      setStatus($('#admin-store-marketing-status'), 'Add a referrer and generated URL before saving.');
      return;
    }
    setStatus($('#admin-store-marketing-status'), 'Saving referral...');
    requestJson('/admin/store/marketing/referrals', {
      method: 'POST',
      body: {
        originalCode: storeMarketingEditingOriginalCode || undefined,
        code: draft.ref,
        name: draft.referrer,
        referrer: draft.referrer,
        url: url,
        path: draft.path,
        utmSource: draft.source,
        utmMedium: draft.medium,
        utmCampaign: draft.campaign,
        utmContent: draft.content
      }
    }).then(function(data) {
      setStoreMarketingEditingState('');
      storeMarketingReferralsLoaded = true;
      renderStoreMarketingReferrals(data.referrals || []);
      setStatus($('#admin-store-marketing-status'), 'Referral saved.');
    }).catch(function(error) {
      logger.error('Failed to save Store marketing referral', error);
      setStatus($('#admin-store-marketing-status'), formatError(error), true);
    });
  }

  function deleteStoreMarketingReferral(row) {
    var code = normalizeMarketingReferralCode(row && row.code);
    if (!code || !window.confirm('Delete this saved referral?')) return;
    setStatus($('#admin-store-marketing-status'), 'Deleting referral...');
    requestJson('/admin/store/marketing/referrals', {
      method: 'DELETE',
      body: { code: code }
    }).then(function(data) {
      if (storeMarketingEditingOriginalCode === code) setStoreMarketingEditingState('');
      storeMarketingReferralsLoaded = true;
      renderStoreMarketingReferrals(data.referrals || []);
      setStatus($('#admin-store-marketing-status'), 'Referral deleted.');
    }).catch(function(error) {
      logger.error('Failed to delete Store marketing referral', error);
      setStatus($('#admin-store-marketing-status'), formatError(error), true);
    });
  }

  function updateStoreMarketingBuilder() {
    var urlField = storeMarketingField('url');
    if (!urlField) return;
    var url = storeMarketingUrlFromFields();
    urlField.value = url;
    renderStoreMarketingQr(url);
  }

  function resetStoreMarketingBuilder() {
    applyStoreMarketingPlaceholders();
    var defaults = {
      path: '',
      referrer: '',
      ref: '',
      source: '',
      medium: '',
      campaign: '',
      content: ''
    };
    Object.keys(defaults).forEach(function(key) {
      var field = storeMarketingField(key);
      if (field) field.value = defaults[key];
    });
    updateStoreMarketingBuilder();
  }

  function copyTextToClipboard(text) {
    var value = String(text || '');
    if (!value) return Promise.resolve(false);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).then(function() { return true; }, function() { return false; });
    }
    return Promise.resolve(false);
  }

  function setupStoreAnalyticsEvents() {
    var root = $('#admin-store-analytics-results');
    if (!root) return;
    root.addEventListener('click', function(event) {
      var button = event.target.closest('[data-store-analytics-export]');
      if (!button) return;
      var rows = $all('.admin-store-analytics__table tbody tr', root).map(function(row) {
        return $all('td', row).map(function(cell) { return '"' + String(cell.textContent || '').replace(/"/g, '""') + '"'; }).join(',');
      });
      var csv = ['"Product","Quantity","Revenue"'].concat(rows).join('\n') + '\n';
      var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      var link = document.createElement('a');
      link.href = url;
      link.download = 'store-product-analytics.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
      setStatus($('#admin-store-analytics-status'), 'Analytics CSV download started.');
    });
  }

  function setupStoreMarketingEvents() {
    var form = $('#admin-store-marketing-builder');
    if (!form) return;
    form.addEventListener('input', updateStoreMarketingBuilder);
    form.addEventListener('change', updateStoreMarketingBuilder);
    var copyUrl = $('#admin-store-marketing-copy-url');
    if (copyUrl) {
      copyUrl.addEventListener('click', function() {
        copyTextToClipboard((storeMarketingField('url') || {}).value || '').then(function(copied) {
          setStatus($('#admin-store-marketing-status'), copied ? 'Copied.' : 'Unable to copy.');
        });
      });
    }
    var reset = $('#admin-store-marketing-reset');
    if (reset) {
      reset.addEventListener('click', function() {
        setStoreMarketingEditingState('');
        resetStoreMarketingBuilder();
      });
    }
    var qrPng = $('#admin-store-marketing-qr-download-png');
    if (qrPng) qrPng.addEventListener('click', downloadStoreMarketingQrPng);
    var qrSvg = $('#admin-store-marketing-qr-download-svg');
    if (qrSvg) qrSvg.addEventListener('click', downloadStoreMarketingQrSvg);
    var saveReferral = $('#admin-store-marketing-save-referral');
    if (saveReferral) saveReferral.addEventListener('click', saveStoreMarketingReferral);
    var cancelEdit = $('#admin-store-marketing-cancel-edit');
    if (cancelEdit) {
      cancelEdit.addEventListener('click', function() {
        setStoreMarketingEditingState('');
        setStatus($('#admin-store-marketing-status'), '');
      });
    }
    resetStoreMarketingBuilder();
  }

  function renderStoreOrdersSummary(data) {
    var root = $('#admin-store-orders-summary');
    if (!root) return;
    clear(root);
    root.classList.add('admin-stat-grid');
    var totals = data.totals || {};
    [
      ['Orders', totals.orders || 0],
      ['Items', totals.fulfillmentRows || 0],
      ['Tickets', totals.ticketQuantity || 0],
      ['Checked in', totals.checkedInQuantity || 0]
    ].forEach(function(card) {
      root.appendChild(statCard('admin-store-orders__card', card[0], formatNumber(card[1])));
    });
  }

  function renderStoreOrdersAttendance(data) {
    var root = $('#admin-store-orders-attendance');
    if (!root) return;
    clear(root);
    var attendance = data.attendance || {};
    var totals = attendance.totals || {};
    var events = Array.isArray(attendance.events) ? attendance.events : [];
    if (!events.length) {
      root.hidden = true;
      return;
    }

    root.hidden = false;
    var header = createElement('div', 'admin-store-orders__attendance-header');
    header.appendChild(createHeadingWithHelp('h3', 'admin-store-orders__attendance-title', 'Attendance', {
      path: 'store-orders-attendance'
    }));
    header.appendChild(createElement(
      'p',
      'admin-store-orders__attendance-summary',
      [
        (totals.eventCount || 0) + ' event' + (totals.eventCount === 1 ? '' : 's'),
        (totals.orderCount || 0) + ' order' + (totals.orderCount === 1 ? '' : 's'),
        (totals.checkedInQuantity || 0) + '/' + (totals.quantity || 0) + ' checked in'
      ].join(' / ')
    ));
    root.appendChild(header);

    var table = createElement('table', 'admin-store-orders__attendance-table');
    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    ['Event', 'Venue', 'Orders', 'Checked in', 'Rate'].forEach(function(text) {
      headerRow.appendChild(createElement('th', '', text));
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    events.forEach(function(event) {
      var tr = document.createElement('tr');
      var eventCell = createLabeledTableCell('Event');
      eventCell.appendChild(document.createTextNode([event.itemName, event.variantLabel].filter(Boolean).join(' - ')));
      if (event.eventStartsAt) eventCell.appendChild(createElement('span', 'admin-store-orders__meta', formatDate(event.eventStartsAt)));
      tr.appendChild(eventCell);
      var venueCell = createLabeledTableCell('Venue');
      venueCell.appendChild(document.createTextNode(event.eventVenue || ''));
      if (event.eventAddress) venueCell.appendChild(createElement('span', 'admin-store-orders__meta', event.eventAddress));
      tr.appendChild(venueCell);
      tr.appendChild(createLabeledTableCell('Orders', String(event.orderCount || 0)));
      tr.appendChild(createLabeledTableCell('Checked in', String(event.checkedInQuantity || 0) + ' / ' + String(event.quantity || 0)));
      tr.appendChild(createLabeledTableCell('Rate', String(event.checkedInRate || 0) + '%'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    root.appendChild(table);
  }

  function formatStoreDownloadAccessNote(row) {
    var access = row.downloadAccess || {};
    var status = String(access.status || row.downloadAccessStatus || '').toLowerCase();
    if (status === 'expired') {
      return access.expiredAt ? 'Expired ' + formatDate(access.expiredAt) : 'Expired';
    }
    if (access.expiresAt || row.downloadAccessExpiresAt) {
      return 'Expires ' + formatDate(access.expiresAt || row.downloadAccessExpiresAt);
    }
    return 'Active';
  }

  function appendStoreOrderDownloadAccessControls(parent, row) {
    var access = row.downloadAccess || {};
    var note = createElement('span', 'admin-store-orders__action-note', formatStoreDownloadAccessNote(row));
    parent.appendChild(note);
    if (!row.downloadAccessManageable) return;

    if (String(access.status || row.downloadAccessStatus || '').toLowerCase() !== 'expired') {
      var expireButton = createElement('button', 'btn btn--secondary', 'Expire now');
      expireButton.type = 'button';
      expireButton.dataset.storeOrderAction = 'download-expire';
      expireButton.dataset.orderToken = row.orderToken || '';
      expireButton.dataset.itemId = row.itemId || '';
      parent.appendChild(expireButton);
    }

    var expiresHours = Number(access.expiresHours || row.downloadAccessExpiresHours || 72) || 72;
    var reissueButton = createElement('button', 'btn btn--secondary', 'Reissue ' + expiresHours + 'h');
    reissueButton.type = 'button';
    reissueButton.dataset.storeOrderAction = 'download-reissue';
    reissueButton.dataset.orderToken = row.orderToken || '';
    reissueButton.dataset.itemId = row.itemId || '';
    reissueButton.dataset.expiresHours = String(expiresHours);
    parent.appendChild(reissueButton);
  }

  function renderStoreOrders(data, append) {
    var root = $('#admin-store-orders-results');
    if (!root) return;
    if (!append) clear(root);
    renderStoreOrdersSummary(data);
    if (!append) renderStoreOrdersAttendance(data);
    var rows = Array.isArray(data.fulfillments) ? data.fulfillments : [];
    if (!rows.length && !append) {
      root.appendChild(createElement('p', 'admin-app__muted', 'No Store orders match these filters.'));
      return;
    }
    var table = append ? $('table', root) : null;
    if (!table) {
      table = createElement('table', 'admin-store-orders__table');
      var thead = document.createElement('thead');
      var header = document.createElement('tr');
      ['Order', 'Customer', 'Item', 'Status', 'Total', 'Actions'].forEach(function(text) {
        header.appendChild(createElement('th', '', text));
      });
      thead.appendChild(header);
      table.appendChild(thead);
      table.appendChild(document.createElement('tbody'));
      root.appendChild(table);
    }
    var tbody = $('tbody', table);
    rows.forEach(function(row) {
      var tr = document.createElement('tr');
      tr.appendChild(createLabeledTableCell('Order', row.orderToken || ''));
      tr.appendChild(createLabeledTableCell('Customer', [row.customerName, row.customerEmail].filter(Boolean).join(' / ')));
      tr.appendChild(createLabeledTableCell('Item', [row.itemName, row.variantLabel].filter(Boolean).join(' - ')));
      tr.appendChild(createLabeledTableCell('Status', [row.status, row.paymentStatus, row.fulfillmentType].filter(Boolean).join(' / ')));
      tr.appendChild(createLabeledTableCell('Total', moneyFromCents(row.totalCents)));
      var action = createLabeledTableCell('Actions', null, 'admin-store-orders__actions');
      if (row.checkInAvailable) {
        var button = createElement('button', 'btn btn--secondary', row.checkedIn ? 'Undo check-in' : 'Check in');
        button.type = 'button';
        button.dataset.orderToken = row.orderToken || '';
        button.dataset.itemId = row.itemId || '';
        button.dataset.storeOrderAction = 'check-in';
        button.dataset.checkedIn = row.checkedIn ? 'false' : 'true';
        button.dataset.quantity = String(row.quantity || 1);
        action.appendChild(button);
      } else if (row.downloadAccess || row.fulfillmentType === 'digital') {
        appendStoreOrderDownloadAccessControls(action, row);
      } else {
        action.textContent = 'Not available';
      }
      tr.appendChild(action);
      tbody.appendChild(tr);
    });
  }

  function loadStoreOrders(options) {
    var opts = options || {};
    var status = $('#admin-store-orders-status');
    setStatus(status, opts.append ? 'Loading more orders...' : 'Loading Store orders...');
    return requestJson('/admin/store/orders', { params: orderFilters(opts.cursor || 0) }).then(function(data) {
      storeOrdersLoaded = true;
      storeOrderNextCursor = data.page ? data.page.nextCursor : null;
      renderStoreOrders(data, opts.append);
      var next = $('#admin-store-orders-next');
      if (next) next.hidden = storeOrderNextCursor === null || storeOrderNextCursor === undefined;
      setStatus(status, '');
    }).catch(function(error) {
      setStatus(status, formatError(error), true);
    });
  }

  function scheduleStoreOrderLoad() {
    clearTimeout(storeOrderLoadTimer);
    storeOrderLoadTimer = setTimeout(function() {
      loadStoreOrders();
    }, 150);
  }

  function downloadStoreCsv(path, fallbackFilename, loadingMessage, completeMessage) {
    clearTimeout(storeOrderLoadTimer);
    downloadAdminCsv({
      path: path,
      params: orderFilters(0),
      status: $('#admin-store-orders-status'),
      fallbackFilename: fallbackFilename,
      loadingMessage: loadingMessage,
      completeMessage: completeMessage
    });
  }

  function downloadStoreOrdersCsv() {
    downloadStoreCsv('/admin/store/orders.csv', 'store-orders.csv', 'Preparing order CSV...', 'Order CSV download started.');
  }

  function downloadStoreAttendeesCsv() {
    downloadStoreCsv('/admin/store/attendees.csv', 'store-attendees.csv', 'Preparing attendee CSV...', 'Attendee CSV download started.');
  }

  function setupStoreOrdersFieldHelp() {
    $all('[data-store-orders-help]').forEach(function(label) {
      if (label.dataset.storeOrdersHelpEnhanced === 'true') return;
      var control = label.htmlFor ? document.getElementById(label.htmlFor) : null;
      var help = createHelp({
        label: label.dataset.storeOrdersHelpLabel || label.textContent || 'Orders field',
        path: label.dataset.storeOrdersHelpPath || label.htmlFor || 'store-orders-field',
        help: label.dataset.storeOrdersHelpText || ''
      }, control, {
        className: 'admin-settings__help--edge-start'
      });
      if (help) {
        var parent = label.parentNode;
        var row = parent && parent.classList && parent.classList.contains('admin-store-orders__label-row')
          ? parent
          : createElement('div', 'admin-store-orders__label-row');
        if (parent !== row && parent) {
          parent.insertBefore(row, label);
          row.appendChild(label);
        }
        row.appendChild(help);
      }
      label.dataset.storeOrdersHelpEnhanced = 'true';
    });
  }

  function formatSnipcartImportSummary(data) {
    var parts = [];
    if (data && data.rowCount !== undefined && data.parsedOrderCount !== undefined) {
      parts.push(String(data.rowCount || 0) + ' CSV row' + (data.rowCount === 1 ? '' : 's'));
      parts.push(String(data.parsedOrderCount || 0) + ' legacy order' + (data.parsedOrderCount === 1 ? '' : 's'));
    }
    if (data && data.skippedOrderCount) {
      parts.push(String(data.skippedOrderCount) + ' skipped');
    }
    if (data && data.failedOrderCount) {
      parts.push(String(data.failedOrderCount) + ' failed');
    }
    if (data && Array.isArray(data.warnings) && data.warnings.length) {
      parts.push(String(data.warnings.length) + ' warning' + (data.warnings.length === 1 ? '' : 's'));
    }
    return parts.join(' / ');
  }

  function updateSnipcartImportFilename(file) {
    var input = $('#admin-store-orders-snipcart-file');
    if (input) updateAdminFilePickerFilename(input, file);
  }

  function importSnipcartOrders() {
    var input = $('#admin-store-orders-snipcart-file');
    var button = $('#admin-store-orders-snipcart-import');
    var status = $('#admin-store-orders-status');
    var summary = $('#admin-store-orders-import-summary');
    var file = input && input.files ? input.files[0] : null;
    if (!file) {
      setStatus(status, 'Choose a Snipcart CSV file before importing.', true);
      return;
    }
    if (file.size > SNIPCART_IMPORT_MAX_CSV_BYTES) {
      setStatus(status, 'Snipcart CSV must be 1 MB or smaller.', true);
      return;
    }

    if (button) button.disabled = true;
    setStatus(status, 'Reading Snipcart CSV...');
    if (summary) summary.textContent = '';
    fileToText(file).then(function(csv) {
      setStatus(status, 'Importing Snipcart orders...');
      return requestJson('/admin/store/orders/import-snipcart', {
        method: 'POST',
        body: {
          filename: file.name,
          csv: csv
        }
      });
    }).then(function(data) {
      var message = data.message || 'Snipcart import complete.';
      var summaryText = formatSnipcartImportSummary(data);
      if (summary) summary.textContent = summaryText;
      if (input) input.value = '';
      updateSnipcartImportFilename(null);
      if (Number(data.importedOrderCount || 0) > 0) {
        return loadStoreOrders().then(function() {
          setStatus(status, message, Number(data.failedOrderCount || 0) > 0);
        });
      }
      setStatus(status, message, Number(data.failedOrderCount || 0) > 0);
      return null;
    }).catch(function(error) {
      setStatus(status, formatError(error), true);
    }).finally(function() {
      if (button) button.disabled = false;
    });
  }

  function setupStoreOrdersEvents() {
    setupStoreOrdersFieldHelp();
    var filters = $('#admin-store-order-filters');
    if (filters) {
      filters.addEventListener('submit', function(event) {
        event.preventDefault();
        loadStoreOrders();
      });
      filters.addEventListener('change', scheduleStoreOrderLoad);
      filters.addEventListener('input', scheduleStoreOrderLoad);
    }
    var exportButton = $('#admin-store-orders-export');
    if (exportButton) exportButton.addEventListener('click', downloadStoreOrdersCsv);
    var attendeeExportButton = $('#admin-store-attendees-export');
    if (attendeeExportButton) attendeeExportButton.addEventListener('click', downloadStoreAttendeesCsv);
    var snipcartImportButton = $('#admin-store-orders-snipcart-import');
    if (snipcartImportButton) snipcartImportButton.addEventListener('click', importSnipcartOrders);
    var snipcartFileInput = $('#admin-store-orders-snipcart-file');
    if (snipcartFileInput) {
      snipcartFileInput.addEventListener('change', function() {
        var file = snipcartFileInput.files && snipcartFileInput.files[0];
        updateSnipcartImportFilename(file);
      });
    }
    var next = $('#admin-store-orders-next');
    if (next) {
      next.addEventListener('click', function() {
        if (storeOrderNextCursor !== null && storeOrderNextCursor !== undefined) {
          loadStoreOrders({ append: true, cursor: storeOrderNextCursor });
        }
      });
    }
    var root = $('#admin-store-orders-results');
    if (root) {
      root.addEventListener('click', function(event) {
        var button = event.target.closest('button[data-order-token]');
        if (!button) return;
        button.disabled = true;
        var action = button.dataset.storeOrderAction || 'check-in';
        if (action === 'download-expire' || action === 'download-reissue') {
          var mutationAction = action === 'download-expire' ? 'expire' : 'reissue';
          var body = {
            orderToken: button.dataset.orderToken,
            itemId: button.dataset.itemId,
            action: mutationAction
          };
          if (mutationAction === 'reissue') {
            body.expiresHours = Number(button.dataset.expiresHours || 72) || 72;
          }
          requestJson('/admin/store/orders/download-access', {
            method: 'POST',
            body: body
          }).then(function(data) {
            return loadStoreOrders().then(function() {
              setStatus($('#admin-store-orders-status'), data.message || 'Download access updated.');
            });
          }).catch(function(error) {
            setStatus($('#admin-store-orders-status'), formatError(error), true);
          }).finally(function() {
            button.disabled = false;
          });
          return;
        }

        requestJson('/admin/store/orders/check-in', {
          method: 'POST',
          body: {
            orderToken: button.dataset.orderToken,
            itemId: button.dataset.itemId,
            checkedIn: button.dataset.checkedIn === 'true',
            quantity: Number(button.dataset.quantity || 1)
          }
        }).then(function() {
          setStatus($('#admin-store-orders-status'), 'Check-in saved.');
          button.textContent = button.dataset.checkedIn === 'true' ? 'Undo check-in' : 'Check in';
          button.dataset.checkedIn = button.dataset.checkedIn === 'true' ? 'false' : 'true';
        }).catch(function(error) {
          setStatus($('#admin-store-orders-status'), formatError(error), true);
        }).finally(function() {
          button.disabled = false;
        });
      });
    }
  }

  function renderStoreProductsSummary(data) {
    var root = $('#admin-store-products-summary');
    if (!root) return;
    clear(root);
    root.classList.add('admin-stat-grid');
    var totals = data.totals || {};
    [
      ['Products', totals.products || 0],
      ['Variants', totals.variants || 0],
      ['Inventory tracked', totals.trackingInventory || 0]
    ].forEach(function(card) {
      root.appendChild(statCard('admin-store-products__card', card[0], formatNumber(card[1])));
    });
  }

  function pruneSelectedStoreProducts(products) {
    var available = new Set((products || []).map(function(product) {
      return product.productId;
    }).filter(Boolean));
    Array.from(selectedStoreProductIds).forEach(function(productId) {
      if (!available.has(productId)) selectedStoreProductIds.delete(productId);
    });
  }

  function storeProductOrderIds(products) {
    return (products || currentStoreProducts || []).map(function(product) {
      return String(product && product.productId || '').trim();
    }).filter(Boolean);
  }

  function storeProductsOrderIsDirty() {
    var current = storeProductOrderIds(currentStoreProducts);
    if (current.length !== storeProductsSavedOrderIds.length) return false;
    return current.some(function(productId, index) {
      return productId !== storeProductsSavedOrderIds[index];
    });
  }

  function syncStoreProductsOrderControls(root) {
    var scope = root || $('#admin-store-products-results');
    var save = scope ? $('[data-store-products-order-save]', scope) : null;
    if (!save) return;
    var dirty = storeProductsOrderIsDirty();
    save.disabled = !dirty;
    save.classList.toggle('is-dirty', dirty);
    save.dataset.dirtyState = dirty ? 'dirty' : 'clean';
  }

  function syncStoreProductsControls(root) {
    syncStoreProductsBulkControls(root);
    syncStoreProductsOrderControls(root);
  }

  function moveStoreProductById(items, draggedId, targetId, beforeTarget) {
    var list = (items || []).slice();
    var from = list.findIndex(function(item) { return String(item && item.productId || '') === draggedId; });
    var to = list.findIndex(function(item) { return String(item && item.productId || '') === targetId; });
    if (from < 0 || to < 0 || from === to) return list;
    var moved = list.splice(from, 1)[0];
    if (from < to) to -= 1;
    if (!beforeTarget) to += 1;
    to = Math.max(0, Math.min(to, list.length));
    list.splice(to, 0, moved);
    return list;
  }

  function reorderStoreProducts(draggedId, targetId, beforeTarget) {
    var source = String(draggedId || '').trim();
    var target = String(targetId || '').trim();
    if (!source || !target || source === target) return;
    currentStoreProducts = moveStoreProductById(currentStoreProducts, source, target, beforeTarget);
    currentStoreProductRows = moveStoreProductById(currentStoreProductRows, source, target, beforeTarget);
    renderStoreProducts({
      products: currentStoreProducts,
      rows: currentStoreProductRows,
      totals: currentStoreProductTotals,
      catalog: { shippingPresets: currentStoreShippingPresets }
    }, { preserveOrderBaseline: true });
    setStatus($('#admin-store-products-status'), 'Product order changed. Save order to publish it.');
  }

  function moveStoreProductOneStep(productId, direction) {
    var ids = storeProductOrderIds(currentStoreProducts);
    var index = ids.indexOf(String(productId || '').trim());
    var targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= ids.length) return;
    reorderStoreProducts(ids[index], ids[targetIndex], direction < 0);
  }

  function isStoreProductControlTarget(target) {
    return Boolean(target && target.closest && target.closest(
      'a, button, input, select, textarea, label, summary, [contenteditable="true"], [data-admin-info-toggle]'
    ));
  }

  function storeProductRowDropBefore(row, clientY) {
    var rect = row.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  }

  function clearStoreProductDropIndicators(root) {
    $all('[data-store-product-order-row]', root || document).forEach(function(row) {
      row.classList.remove('is-drop-before', 'is-drop-after');
    });
  }

  function markStoreProductDropTarget(root, row, beforeTarget) {
    clearStoreProductDropIndicators(root);
    if (!row) return;
    row.classList.toggle('is-drop-before', beforeTarget);
    row.classList.toggle('is-drop-after', !beforeTarget);
  }

  function storeProductOrderRowFromPoint(clientX, clientY) {
    var element = document.elementFromPoint(clientX, clientY);
    return element && element.closest ? element.closest('[data-store-product-order-row]') : null;
  }

  function resetStoreProductTouchDrag(root) {
    if (storeProductTouchDrag && storeProductTouchDrag.timer) {
      window.clearTimeout(storeProductTouchDrag.timer);
    }
    if (storeProductTouchDrag && storeProductTouchDrag.row) {
      storeProductTouchDrag.row.classList.remove('is-dragging', 'is-touch-pending');
    }
    storeProductTouchDrag = null;
    storeProductDraggingId = '';
    clearStoreProductDropIndicators(root || $('#admin-store-products-results'));
  }

  function updateStoreProductTouchTarget(root, touch) {
    if (!storeProductTouchDrag || !storeProductTouchDrag.active) return;
    var row = storeProductOrderRowFromPoint(touch.clientX, touch.clientY);
    if (!row || row.dataset.storeProductOrderRow === storeProductTouchDrag.sourceId) {
      clearStoreProductDropIndicators(root);
      storeProductTouchDrag.targetId = '';
      return;
    }
    var beforeTarget = storeProductRowDropBefore(row, touch.clientY);
    storeProductTouchDrag.targetId = String(row.dataset.storeProductOrderRow || '').trim();
    storeProductTouchDrag.beforeTarget = beforeTarget;
    markStoreProductDropTarget(root, row, beforeTarget);
  }

  function saveStoreProductOrder(button) {
    var orderIds = storeProductOrderIds(currentStoreProducts);
    if (!storeProductsOrderIsDirty()) {
      setStatus($('#admin-store-products-status'), 'Product order has no changes to save.');
      syncStoreProductsOrderControls($('#admin-store-products-results'));
      return;
    }
    if (button) button.disabled = true;
    setStatus($('#admin-store-products-status'), 'Saving product order...');
    requestJson('/admin/store/products/order', {
      method: 'POST',
      body: {
        intent: 'order_publish',
        productIds: orderIds
      }
    }).then(function(data) {
      var message = data.deployNotice || 'Product order saved.';
      storeProductsSavedOrderIds = orderIds.slice();
      return loadStoreProducts().finally(function() {
        setStatus($('#admin-store-products-status'), message);
      });
    }).catch(function(error) {
      setStatus($('#admin-store-products-status'), formatError(error), true);
      syncStoreProductsOrderControls($('#admin-store-products-results'));
    });
  }

  function renderStoreProductsBulkActions() {
    var wrapper = createElement('div', 'admin-store-products__bulk-actions');
    var selectedCount = selectedStoreProductIds.size;
    var statusGroup = createElement('div', 'admin-store-products__bulk-group admin-store-products__bulk-group--status');

    var count = createElement(
      'span',
      'admin-store-products__bulk-count',
      selectedCount === 1 ? '1 selected' : selectedCount + ' selected'
    );
    statusGroup.appendChild(count);

    var statusLabel = createElement('label', 'admin-store-products__bulk-field');
    var statusSelect = document.createElement('select');
    statusSelect.className = 'admin-settings__input';
    statusSelect.dataset.storeProductsBulkStatus = 'true';
    statusSelect.setAttribute('aria-label', 'Bulk product status');
    [
      ['', 'Choose status'],
      ['active', 'Active'],
      ['draft', 'Draft'],
      ['archived', 'Archived'],
      ['sold_out', 'Sold out']
    ].forEach(function(pair) {
      var option = document.createElement('option');
      option.value = pair[0];
      option.textContent = pair[1];
      statusSelect.appendChild(option);
    });
    statusLabel.appendChild(statusSelect);
    statusGroup.appendChild(statusLabel);

    var apply = createElement('button', 'btn btn--secondary', 'Apply to selected');
    apply.type = 'button';
    apply.dataset.storeProductsBulkApply = 'true';
    apply.disabled = selectedCount === 0;
    statusGroup.appendChild(apply);
    wrapper.appendChild(statusGroup);

    var orderGroup = createElement('div', 'admin-store-products__bulk-group admin-store-products__bulk-group--order');
    var saveOrder = createElement('button', 'btn btn--secondary admin-store-products__order-save', 'Save order');
    saveOrder.type = 'button';
    saveOrder.dataset.storeProductsOrderSave = 'true';
    saveOrder.disabled = !storeProductsOrderIsDirty();
    orderGroup.appendChild(saveOrder);
    wrapper.appendChild(orderGroup);

    var createGroup = createElement('div', 'admin-store-products__bulk-group admin-store-products__bulk-group--create');
    var create = createElement('button', 'btn btn--secondary admin-store-products__create', 'Create product');
    create.id = 'admin-store-product-create';
    create.type = 'button';
    create.dataset.storeProductCreate = 'true';
    createGroup.appendChild(create);
    wrapper.appendChild(createGroup);

    return wrapper;
  }

  function syncStoreProductsBulkControls(root) {
    var productCount = currentStoreProducts.length;
    $all('[data-store-product-select]', root).forEach(function(input) {
      input.checked = selectedStoreProductIds.has(input.dataset.storeProductSelect);
    });
    $all('[data-store-products-select-all]', root).forEach(function(input) {
      input.checked = productCount > 0 && selectedStoreProductIds.size === productCount;
      input.indeterminate = selectedStoreProductIds.size > 0 && selectedStoreProductIds.size < productCount;
    });
    var count = $('.admin-store-products__bulk-count', root);
    if (count) {
      count.textContent = selectedStoreProductIds.size === 1
        ? '1 selected'
        : selectedStoreProductIds.size + ' selected';
    }
    var statusSelect = $('[data-store-products-bulk-status]', root);
    var hasStatus = Boolean(statusSelect && statusSelect.value);
    $all('[data-store-products-bulk-apply]', root).forEach(function(button) {
      setDirtyButtonState(button, selectedStoreProductIds.size > 0 && hasStatus, 'Apply to selected', 'Apply to selected');
    });
  }

  function storeProductRowImage(row) {
    return String(row && (row.image || row.imageUrl || row.productImage) || '').trim();
  }

  var storeProductFieldHelpText = {
    name: 'Public product name shown on product cards, checkout, receipts, and admin lists.',
    sku: 'Legacy product SKU used for historical orders and grandfathered product IDs. Read-only.',
    price: 'Base product price in US dollars. Variants can override this when Variant Based is Yes.',
    status: 'Controls whether the product is public, draft-only, archived, or sold out.',
    fulfillmentType: 'Determines whether this product ships, unlocks a download, creates a ticket, or records an RSVP.',
    shippingPreset: 'Package type used for shipping estimates. Hidden when the product does not ship.',
    taxCategory: 'Standard is taxable merchandise. Digital is downloads/files. Ticket / admission is event access or RSVPs. Tax exempt skips sales tax.',
    variantBased: 'Turns variant rows on or off for sizes, formats, ticket tiers, or other product options.',
    inventoryTracking: 'Turns live inventory counts on or off for this product and its variants.',
    inventory: 'Available quantity for non-variant products. Variant quantities are managed in the Variants section.',
    downloadFileKey: 'Existing download file delivered after checkout for digital products.',
    eventStartsAt: 'Event start date and time used for tickets, product pages, and calendar files.',
    eventEndsAt: 'Optional event end date and time used by calendar files when present.',
    eventVenue: 'Public venue name shown on event products, confirmations, and tickets.',
    eventAddress: 'Optional event address shown on the product page and embedded in calendar files.',
    eventIcs: 'Adds an iCalendar file link to event order confirmations when a start time is set.',
    image: 'Primary product image used on public product cards, cart rows, receipts, and previews.',
    preview: 'Live product-card preview generated from the current editor values.',
    description: 'Public product copy. Use the block editor for text, media, embeds, and galleries.'
  };

  function storeProductFieldHelp(field, fallback) {
    return storeProductFieldHelpText[field] || fallback || '';
  }

  function slugifyStoreProductValue(value, fallback) {
    return String(value || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback || 'new-variant';
  }

  function storeProductReservedSkus() {
    var values = new Set();
    currentStoreProducts.forEach(function(product) {
      [product.productId, product.sku, product.slug].forEach(function(value) {
        var normalized = String(value || '').trim();
        if (normalized) values.add(normalized);
      });
    });
    return values;
  }

  function uniqueStoreProductSku(value, fallback) {
    var base = slugifyStoreProductValue(value, fallback || 'new-product');
    var reserved = storeProductReservedSkus();
    var candidate = base;
    var index = 2;
    while (reserved.has(candidate)) {
      candidate = base + '-' + index;
      index += 1;
    }
    return candidate;
  }

  function defaultStoreProductShippingPreset() {
    return currentStoreShippingPresets.indexOf('parcel') >= 0
      ? 'parcel'
      : currentStoreShippingPresets[0] || '';
  }

  function createStoreProductDraft() {
    var name = 'New Product';
    var sku = uniqueStoreProductSku(name, 'new-product');
    return {
      productId: STORE_PRODUCT_CREATE_ID,
      sku: sku,
      name: name,
      description: '',
      longContent: [],
      priceCents: 0,
      status: 'draft',
      fulfillmentType: 'physical',
      image: '',
      shippingPreset: defaultStoreProductShippingPreset(),
      taxCategory: 'standard',
      inventoryTracking: false,
      inventory: '',
      variants: [],
      isNew: true
    };
  }

  function storeProductIsCreateForm(form) {
    return Boolean(form && form.dataset.storeProductNew === 'true');
  }

  function currentStoreProductEditorProduct(form, fallbackProduct) {
    if (!storeProductIsCreateForm(form)) return fallbackProduct || {};
    var name = $('[data-store-product-field="name"]', form);
    var sku = $('[data-store-product-readonly-field="sku"]', form);
    return {
      productId: sku ? sku.value : '',
      sku: sku ? sku.value : '',
      name: name ? name.value : ''
    };
  }

  function syncStoreProductDerivedSku(form) {
    if (!storeProductIsCreateForm(form)) return '';
    var name = $('[data-store-product-field="name"]', form);
    var sku = $('[data-store-product-readonly-field="sku"]', form);
    var next = uniqueStoreProductSku(name ? name.value : '', 'new-product');
    if (sku) sku.value = next;
    $all('[data-store-product-variant]', form).forEach(function(row) {
      updateStoreProductVariantDerivedFields(row, currentStoreProductEditorProduct(form));
    });
    return next;
  }

  function derivedStoreVariantId(label, fallback) {
    return slugifyStoreProductValue(label, fallback || 'new-variant');
  }

  function derivedStoreVariantSku(product, label, fallback) {
    var productId = slugifyStoreProductValue(product && product.productId || product && product.name || '', 'product');
    return productId + '-' + derivedStoreVariantId(label, fallback);
  }

  function createStoreProductFieldLabel(labelText, field, describedElement, helpText) {
    var labelRow = createElement('span', 'admin-store-products__field-label');
    labelRow.appendChild(document.createTextNode(labelText));
    if (helpText === false) return labelRow;
    var help = createHelp({
      label: labelText,
      path: 'store-product-field-' + String(field || labelText).replace(/[^a-z0-9_-]+/gi, '-'),
      help: helpText || storeProductFieldHelp(field)
    }, describedElement || null, {
      className: storeProductFieldHelpClass(field)
    });
    if (help) labelRow.appendChild(help);
    return labelRow;
  }

  function storeProductFieldHelpClass(field) {
    var edgeStartFields = ['sku', 'shippingPreset', 'image', 'eventStartsAt'];
    var edgeEndFields = ['fulfillmentType', 'inventoryTracking', 'inventory', 'preview', 'eventAddress', 'eventIcs'];
    var key = String(field || '');
    if (edgeStartFields.indexOf(key) >= 0) return 'admin-settings__help--edge-start';
    if (edgeEndFields.indexOf(key) >= 0) return 'admin-settings__help--edge-end';
    return '';
  }

  function createStoreProductReadonlyField(labelText, field, value) {
    var label = createElement('label', 'admin-store-products__field admin-store-products__field--readonly');
    label.dataset.storeProductFieldWrapper = field;
    var input = document.createElement('input');
    input.className = 'admin-settings__input admin-settings__input--readonly';
    input.type = 'text';
    input.value = String(value || '');
    input.readOnly = true;
    input.dataset.storeProductReadonlyField = field;
    input.setAttribute('aria-readonly', 'true');
    label.appendChild(createStoreProductFieldLabel(labelText, field, input));
    label.appendChild(input);
    return label;
  }

  function shippingPresetLabel(value) {
    var key = String(value || '').trim();
    if (!key) return 'None';
    var special = {
      tshirt: 'T-shirt',
      sticker: 'Sticker',
      poster: 'Poster',
      parcel: 'Parcel',
      mug: 'Mug',
      ticket: 'Ticket / digital'
    };
    if (special[key]) return special[key];
    return key.replace(/[_-]+/g, ' ').replace(/\b\w/g, function(letter) {
      return letter.toUpperCase();
    });
  }

  function shippingPresetOptions(current) {
    var values = [''].concat(currentStoreShippingPresets || []);
    var currentValue = String(current || '').trim();
    if (currentValue && values.indexOf(currentValue) < 0) values.push(currentValue);
    return values.map(function(value) {
      return [value, shippingPresetLabel(value)];
    });
  }

  function downloadFileLabel(file) {
    var filename = String(file && file.filename || '').trim();
    var fileKey = String(file && file.fileKey || '').trim();
    if (!filename && !fileKey) return 'No file selected';
    if (filename && fileKey && filename !== fileKey) return filename + ' (' + fileKey + ')';
    return filename || fileKey;
  }

  function downloadFileOptions(currentFileKey, currentFilename) {
    var current = String(currentFileKey || '').trim();
    var seen = new Set(['']);
    var options = [{
      value: '',
      label: 'No file selected',
      filename: ''
    }];
    (currentStoreDownloadFiles || []).forEach(function(file) {
      var fileKey = String(file && file.fileKey || '').trim();
      if (!fileKey || seen.has(fileKey)) return;
      seen.add(fileKey);
      options.push({
        value: fileKey,
        label: downloadFileLabel(file),
        filename: String(file.filename || fileKey).trim()
      });
    });
    if (current && !seen.has(current)) {
      options.push({
        value: current,
        label: (currentFilename || current) + ' (missing from library)',
        filename: currentFilename || current
      });
    }
    return options;
  }

  function defaultTaxCategoryForFulfillment(fulfillmentType) {
    var type = String(fulfillmentType || '').trim().toLowerCase();
    if (type === 'digital') return 'digital';
    if (type === 'ticket' || type === 'rsvp') return 'admission';
    return 'standard';
  }

  function isPhysicalFulfillment(fulfillmentType) {
    return String(fulfillmentType || '').trim().toLowerCase() === 'physical';
  }

  function isDigitalFulfillment(fulfillmentType) {
    return String(fulfillmentType || '').trim().toLowerCase() === 'digital';
  }

  function isEventFulfillment(fulfillmentType) {
    var type = String(fulfillmentType || '').trim().toLowerCase();
    return type === 'ticket' || type === 'rsvp';
  }

  function storeProductDateTimeLocalValue(value) {
    var text = String(value || '').trim();
    var match = text.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/);
    return match ? match[1] : text.slice(0, 16);
  }

  function storeProductDateTimeOffset(value) {
    var text = String(value || '').trim();
    var match = text.match(/(Z|[+-]\d{2}:?\d{2})$/);
    if (!match) return '';
    if (match[1] === 'Z') return 'Z';
    return match[1].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
  }

  function browserDateTimeOffset(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    var offset = -date.getTimezoneOffset();
    var sign = offset >= 0 ? '+' : '-';
    var absolute = Math.abs(offset);
    var hours = String(Math.floor(absolute / 60)).padStart(2, '0');
    var minutes = String(absolute % 60).padStart(2, '0');
    return sign + hours + ':' + minutes;
  }

  function storeProductDateTimePublishValue(input) {
    var value = String(input && input.value || '').trim();
    if (!value) return '';
    var secondsValue = value.length === 16 ? value + ':00' : value;
    var initialValue = String(input.dataset.storeDateTimeInitialValue || '').trim();
    var originalOffset = String(input.dataset.storeDateTimeOffset || '').trim();
    var offset = initialValue && value === initialValue && originalOffset
      ? originalOffset
      : browserDateTimeOffset(value);
    return offset ? secondsValue + offset : secondsValue;
  }

  function taxCategoryLabel(value) {
    var labels = {
      standard: 'Standard',
      digital: 'Digital download',
      admission: 'Ticket / admission',
      exempt: 'Tax exempt'
    };
    return labels[value] || value;
  }

  function normalizeStoreProductTaxCategory(value, fulfillmentType) {
    var current = String(value || '').trim().toLowerCase();
    var allowed = ['standard', 'digital', 'admission', 'exempt'];
    return allowed.indexOf(current) >= 0 ? current : defaultTaxCategoryForFulfillment(fulfillmentType);
  }

  function taxCategoryOptions() {
    return ['standard', 'digital', 'admission', 'exempt'].map(function(value) {
      return [value, taxCategoryLabel(value)];
    });
  }

  function renderStoreProductIdentityCell(row) {
    var cell = document.createElement('td');
    var identity = createElement('div', 'admin-store-products__identity');
    var thumb = createElement('span', 'admin-store-products__thumb');
    var imagePath = storeProductRowImage(row);
    if (imagePath) {
      var image = document.createElement('img');
      image.src = mediaPreviewUrl(imagePath);
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      thumb.appendChild(image);
    } else {
      thumb.classList.add('admin-store-products__thumb--empty');
      thumb.setAttribute('aria-hidden', 'true');
      thumb.textContent = 'No image';
    }
    var text = createElement('span', 'admin-store-products__identity-text');
    text.appendChild(createElement('strong', '', row.label || row.productId || 'Product'));
    var variantText = Number(row.variantCount || 0) > 0
      ? Number(row.variantCount || 0) + ' variant' + (Number(row.variantCount || 0) === 1 ? '' : 's')
      : row.variantLabel;
    var meta = [row.sku, variantText].filter(Boolean).join(' / ');
    if (meta) text.appendChild(createElement('small', '', meta));
    identity.appendChild(thumb);
    identity.appendChild(text);
    cell.appendChild(identity);
    return cell;
  }

  function renderStoreProductPriceCell(row) {
    var cell = document.createElement('td');
    var min = Number(row.priceMinCents ?? row.priceCents ?? 0);
    var max = Number(row.priceMaxCents ?? row.priceCents ?? min);
    var price = createElement('div', 'admin-store-products__price');
    if (max > min) {
      price.appendChild(createElement('strong', '', moneyFromCents(min) + '-' + moneyFromCents(max)));
    } else {
      price.appendChild(createElement('strong', '', moneyFromCents(min)));
    }
    if (Number(row.variantCount || 0) > 0) {
      price.appendChild(createElement('small', '', 'Variant pricing'));
    }
    cell.appendChild(price);
    return cell;
  }

  function renderStoreProductStatusCell(row) {
    var cell = document.createElement('td');
    var state = createElement('div', 'admin-store-products__status');
    var isTest = row.launchTest === true || row.launch_test === true || row.testOnly === true;
    var isPrivate = row.public === false || row.isPublic === false;
    var label = isTest ? 'Test fixture' : isPrivate ? 'Private' : (row.status || 'active');
    state.appendChild(createElement('strong', 'admin-store-products__status-label', label));
    var details = [];
    if (isTest || isPrivate) {
      if (row.status) details.push(row.status);
      if (isPrivate) details.push('not public');
    }
    if (details.length) state.appendChild(createElement('small', '', details.join(' / ')));
    cell.appendChild(state);
    return cell;
  }

  function storeInventoryValueLabel(value) {
    if (value === null || value === undefined || value === '') return 'Unlimited';
    return formatNumber(Number(value || 0));
  }

  function renderStoreProductInventoryCell(row) {
    var cell = document.createElement('td');
    if (!row.inventoryTracking) {
      cell.appendChild(createElement('span', 'admin-store-products__meta', 'Not tracked'));
      return cell;
    }

    if (Number(row.variantCount || 0) > 0) {
      var variantSummary = createElement('div', 'admin-store-products__inventory-summary admin-store-products__inventory-summary--stacked');
      var count = Number(row.variantCount || 0);
      variantSummary.appendChild(createElement('strong', '', count + ' variant' + (count === 1 ? '' : 's')));
      variantSummary.appendChild(createElement('span', '', 'Inventory ' + storeInventoryValueLabel(row.inventory ?? row.configuredInventory ?? '')));
      if (row.hasOverride) {
        var overrideLabel = Number(row.variantOverrideCount || 0) > 0
          ? Number(row.variantOverrideCount || 0) + ' override' + (Number(row.variantOverrideCount || 0) === 1 ? '' : 's')
          : 'Override';
        variantSummary.appendChild(createElement('span', 'admin-store-products__inventory-flag', overrideLabel));
      }
      cell.appendChild(variantSummary);
      return cell;
    }

    var controls = createElement('div', 'admin-store-products__inventory-controls');
    controls.dataset.storeProductInventoryControls = 'true';
    controls.dataset.productId = row.productId || '';
    controls.dataset.variantId = row.variantId || '';
    var currentInventory = row.inventory ?? row.configuredInventory ?? '';

    var summary = createElement('div', 'admin-store-products__inventory-summary');
    summary.appendChild(createElement('strong', '', 'Current ' + storeInventoryValueLabel(currentInventory)));
    [
      ['Configured', row.configuredInventory],
      ['Sold', row.sold],
      ['Remaining', row.remaining]
    ].forEach(function(pair) {
      if (pair[1] !== undefined) {
        summary.appendChild(createElement('span', '', pair[0] + ' ' + storeInventoryValueLabel(pair[1])));
      }
    });
    if (row.hasOverride) summary.appendChild(createElement('span', 'admin-store-products__inventory-flag', 'Override'));

    var adjust = createElement('div', 'admin-store-products__inventory-adjust');
    var input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.value = currentInventory === null || currentInventory === undefined ? '' : String(currentInventory);
    input.className = 'admin-settings__input admin-store-products__inventory-input';
    input.dataset.storeProductInventoryInput = 'true';
    input.setAttribute('aria-label', 'Inventory for ' + (row.label || row.productId || 'product'));
    adjust.appendChild(input);

    [
      ['set', 'Set'],
      ['reset', 'Reset']
    ].forEach(function(pair) {
      var button = createElement('button', 'btn btn--secondary btn--small', pair[1]);
      button.type = 'button';
      button.dataset.storeProductInventoryAction = pair[0];
      adjust.appendChild(button);
    });

    controls.appendChild(summary);
    controls.appendChild(adjust);
    cell.appendChild(controls);
    return cell;
  }

  function updateStoreProductInventory(button) {
    var controls = button.closest('[data-store-product-inventory-controls]');
    var input = $('[data-store-product-inventory-input]', controls);
    var action = button.dataset.storeProductInventoryAction || '';
    var body = {
      action: action,
      productId: controls ? controls.dataset.productId || '' : '',
      variantId: controls ? controls.dataset.variantId || '' : ''
    };
    if (action === 'set') body.inventory = Number(input && input.value || 0);
    button.disabled = true;
    setStatus($('#admin-store-products-status'), 'Updating inventory...');
    requestJson('/admin/store/inventory', { method: 'POST', body: body }).then(function() {
      return loadStoreProducts().finally(function() {
        setStatus($('#admin-store-products-status'), 'Inventory updated.');
      });
    }).catch(function(error) {
      button.disabled = false;
      setStatus($('#admin-store-products-status'), formatError(error), true);
    });
  }

  function renderStoreProducts(data, options) {
    var opts = options || {};
    var root = $('#admin-store-products-results');
    if (!root) return;
    clear(root);
    currentStoreProducts = Array.isArray(data.products) ? data.products : [];
    var rows = Array.isArray(data.rows) ? data.rows : [];
    currentStoreProductRows = rows;
    currentStoreProductTotals = data.totals || {};
    currentStoreDownloadFiles = data && data.downloads && Array.isArray(data.downloads.files)
      ? data.downloads.files
      : currentStoreDownloadFiles;
    currentStoreShippingPresets = data && data.catalog && Array.isArray(data.catalog.shippingPresets)
      ? data.catalog.shippingPresets.map(function(value) { return String(value || '').trim(); }).filter(Boolean)
      : currentStoreShippingPresets;
    if (!opts.preserveOrderBaseline) {
      storeProductsSavedOrderIds = storeProductOrderIds(currentStoreProducts);
    }
    pruneSelectedStoreProducts(currentStoreProducts);
    renderStoreProductsSummary(data);
    root.appendChild(renderStoreProductsBulkActions());
    var table = createElement('table', 'admin-store-products__table');
    var thead = document.createElement('thead');
    var header = document.createElement('tr');
    var selectHeader = document.createElement('th');
    var selectAll = document.createElement('input');
    selectAll.type = 'checkbox';
    selectAll.dataset.storeProductsSelectAll = 'true';
    selectAll.setAttribute('aria-label', 'Select all products');
    selectAll.checked = currentStoreProducts.length > 0 && selectedStoreProductIds.size === currentStoreProducts.length;
    selectAll.indeterminate = selectedStoreProductIds.size > 0 && selectedStoreProductIds.size < currentStoreProducts.length;
    selectHeader.appendChild(selectAll);
    header.appendChild(selectHeader);
    ['Product', 'Fulfillment', 'Price', 'Inventory', 'Status', 'Actions'].forEach(function(text) {
      header.appendChild(createElement('th', '', text));
    });
    thead.appendChild(header);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    var columnCount = header.children.length;
    if (editingProductId === STORE_PRODUCT_CREATE_ID) {
      var createRow = document.createElement('tr');
      createRow.className = 'admin-store-products__editor-row admin-store-products__editor-row--create';
      createRow.dataset.storeProductEditorRow = STORE_PRODUCT_CREATE_ID;
      var createCell = document.createElement('td');
      createCell.colSpan = columnCount;
      createCell.appendChild(renderStoreProductEditor(createStoreProductDraft()));
      createRow.appendChild(createCell);
      tbody.appendChild(createRow);
    }
    rows.forEach(function(row) {
      var tr = document.createElement('tr');
      tr.dataset.storeProductOrderRow = row.productId || '';
      tr.draggable = true;
      tr.tabIndex = 0;
      tr.setAttribute('aria-label', 'Product row for ' + (row.productName || row.label || row.productId || 'product') + '. Drag to reorder. Use Arrow Up or Arrow Down to move while focused.');
      tr.setAttribute('title', 'Drag row to reorder. On touch, hold briefly before dragging.');
      if (row.productId === editingProductId) tr.classList.add('is-editing');
      var selectCell = document.createElement('td');
      var select = document.createElement('input');
      select.type = 'checkbox';
      select.dataset.storeProductSelect = row.productId || '';
      select.checked = selectedStoreProductIds.has(row.productId);
      select.setAttribute('aria-label', 'Select ' + (row.productName || row.label || row.productId || 'product'));
      selectCell.appendChild(select);
      tr.appendChild(selectCell);
      tr.appendChild(renderStoreProductIdentityCell(row));
      tr.appendChild(createElement('td', '', row.fulfillmentType || ''));
      tr.appendChild(renderStoreProductPriceCell(row));
      tr.appendChild(renderStoreProductInventoryCell(row));
      tr.appendChild(renderStoreProductStatusCell(row));
      var actions = document.createElement('td');
      var edit = createElement('button', 'btn btn--secondary btn--small', 'Edit');
      edit.type = 'button';
      edit.dataset.storeProductEdit = row.productId || '';
      actions.appendChild(edit);
      tr.appendChild(actions);
      tbody.appendChild(tr);
      if (row.productId === editingProductId) {
        var editing = currentStoreProducts.find(function(product) { return product.productId === editingProductId; });
        if (editing) {
          var editorRow = document.createElement('tr');
          editorRow.className = 'admin-store-products__editor-row';
          editorRow.dataset.storeProductEditorRow = row.productId || '';
          var editorCell = document.createElement('td');
          editorCell.colSpan = columnCount;
          editorCell.appendChild(renderStoreProductEditor(editing));
          editorRow.appendChild(editorCell);
          tbody.appendChild(editorRow);
        }
      }
    });
    table.appendChild(tbody);
    root.appendChild(table);
  }

  function scrollStoreProductEditorIntoView(productId) {
    window.requestAnimationFrame(function() {
      var editor = $all('[data-store-product-editor]').find(function(form) {
        return form.dataset.storeProductEditor === productId;
      });
      if (!editor || typeof editor.scrollIntoView !== 'function') return;
      var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      editor.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
        inline: 'nearest'
      });
    });
  }

  function productPrice(product) {
    if (product.priceCents !== undefined) return Number(product.priceCents || 0) / 100;
    return Number(product.price || 0);
  }

  function productUploadStatus(status, message, prominent) {
    if (status) setStatus(status, message, prominent);
  }

  function rememberStoreProductMedia(product, path, label) {
    var productId = product.productId || '';
    var value = String(path || '').trim();
    if (!value) return;
    var cached = storeProductMediaCache.get(productId) || [];
    if (cached.some(function(item) { return item.path === value; })) return;
    cached.unshift({
      path: value,
      label: label || product.name || value,
      productId: productId,
      currentProduct: true
    });
    storeProductMediaCache.set(productId, cached);
  }

  function uploadStoreProductImage(product, file, status) {
    var allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (allowedTypes.indexOf(file.type) < 0) {
      return Promise.reject(new Error('Use a PNG, JPEG, WebP, or GIF image.'));
    }
    if (file.size > 8 * 1024 * 1024) {
      return Promise.reject(new Error('Image must be 8 MB or smaller.'));
    }
    productUploadStatus(status, 'Uploading ' + file.name + '...');
    return fileToDataUrl(file).then(function(content) {
      return requestJson('/admin/settings/image-upload', {
        method: 'POST',
        body: {
          filename: file.name,
          contentType: file.type,
          content: content,
          kind: 'store-product',
          productId: product.productId || '',
          filenameBase: product.name || product.productId || file.name,
          createProduct: product.isNew === true
        }
      });
    }).then(function(data) {
      var nextPath = data.path || data.publicPath || '';
      if (!nextPath) throw new Error('Upload did not return an asset path.');
      rememberStoreProductMedia(product, nextPath, file.name || product.name);
      productUploadStatus(status, 'Image uploaded. Publish product to use it.');
      return nextPath;
    });
  }

  function renderStoreProductMediaLibrary(container, media, onSelect) {
    clear(container);
    var items = Array.isArray(media) ? media : [];
    if (!items.length) {
      container.appendChild(createElement('p', 'admin-app__muted', 'No product media found yet.'));
      return;
    }
    var list = createElement('div', 'admin-store-products__media-list');
    items.forEach(function(item) {
      var button = createElement('button', 'admin-store-products__media-item');
      button.type = 'button';
      button.dataset.storeProductMediaPath = item.path || '';
      var thumb = createElement('span', 'admin-store-products__media-thumb');
      var image = document.createElement('img');
      image.loading = 'lazy';
      image.src = mediaPreviewUrl(item.path || '');
      image.alt = '';
      thumb.appendChild(image);
      var text = createElement('span', 'admin-store-products__media-text');
      text.appendChild(createElement('strong', '', item.label || item.path || 'Image'));
      text.appendChild(createElement('small', '', item.path || ''));
      button.appendChild(thumb);
      button.appendChild(text);
      button.addEventListener('click', function() {
        onSelect(item);
      });
      list.appendChild(button);
    });
    container.appendChild(list);
  }

  function loadStoreProductMediaLibrary(product, container, status, onSelect) {
    var productId = product.productId || '';
    var cached = storeProductMediaCache.get(productId);
    container.hidden = false;
    if (cached) {
      renderStoreProductMediaLibrary(container, cached, onSelect);
      return Promise.resolve(cached);
    }
    clear(container);
    container.appendChild(createElement('p', 'admin-app__muted', 'Loading product media...'));
    return requestJson('/admin/store/products/media', {
      params: { productId: productId }
    }).then(function(data) {
      var media = data.media || data.images || [];
      storeProductMediaCache.set(productId, media);
      renderStoreProductMediaLibrary(container, media, onSelect);
      return media;
    }).catch(function(error) {
      productUploadStatus(status, formatError(error), true);
      clear(container);
      container.appendChild(createElement('p', 'admin-app__muted', 'Unable to load product media.'));
      return [];
    });
  }

  function createStoreProductImageField(product) {
    var label = createElement('div', 'admin-store-products__field admin-store-products__field--wide admin-store-products__field--image');
    label.dataset.storeProductFieldWrapper = 'image';
    var wrapper = createElement('div', 'admin-store-products__image-field');
    var control = document.createElement('input');
    control.type = 'hidden';
    control.className = 'admin-settings__input';
    control.dataset.storeProductField = 'image';
    control.value = product.image || '';
    var preview = createElement('div', 'admin-settings__image-preview admin-store-products__image-preview');
    var actions = createElement('div', 'admin-store-products__image-actions');
    var uploadInput = document.createElement('input');
    var choose = createElement('button', 'btn btn--secondary', 'Choose existing');
    var status = createElement('span', 'admin-settings__image-status', '');
    var library = createElement('div', 'admin-store-products__media-library');

    library.hidden = true;
    uploadInput.type = 'file';
    uploadInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
    uploadInput.dataset.storeProductImageUpload = 'true';
    uploadInput.setAttribute('aria-label', 'Upload product image');
    choose.type = 'button';

    function setImage(path) {
      control.value = path || '';
      updateImagePreview(preview, control.value, product.name || 'Product image');
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
    }

    updateImagePreview(preview, control.value, product.name || 'Product image');
    control.addEventListener('input', function() {
      updateImagePreview(preview, control.value, product.name || 'Product image');
    });

    uploadInput.addEventListener('change', function() {
      var file = uploadInput.files && uploadInput.files[0];
      if (!file) return;
      var form = uploadInput.closest('[data-store-product-editor]');
      var uploadProduct = currentStoreProductEditorProduct(form, product);
      if (storeProductIsCreateForm(form)) uploadProduct.isNew = true;
      uploadStoreProductImage(uploadProduct, file, status).then(setImage).catch(function(error) {
        logger.error('Failed to upload Store product image', error);
        productUploadStatus(status, formatError(error), true);
      }).finally(function() {
        uploadInput.value = '';
        updateAdminFilePickerFilename(uploadInput);
      });
    });

    choose.addEventListener('click', function() {
      if (!library.hidden) {
        library.hidden = true;
        return;
      }
      loadStoreProductMediaLibrary(product, library, status, function(item) {
        setImage(item.path || '');
        library.hidden = true;
        productUploadStatus(status, 'Image selected.');
      });
    });

    actions.appendChild(createAdminFilePicker(uploadInput, {
      buttonLabel: 'Upload image',
      className: 'admin-file-picker--compact',
      emptyLabel: 'No file chosen',
      idPrefix: 'admin-store-product-image-upload'
    }));
    actions.appendChild(choose);
    actions.appendChild(status);
    wrapper.appendChild(control);
    wrapper.appendChild(preview);
    wrapper.appendChild(actions);
    wrapper.appendChild(library);
    label.appendChild(createStoreProductFieldLabel('Image', 'image', control));
    label.appendChild(wrapper);
    return label;
  }

  function escapeStoreProductEditorHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeStoreProductEditorAttribute(value) {
    return escapeStoreProductEditorHtml(value).replace(/"/g, '&quot;');
  }

  function isSafeStoreProductEditorHref(value) {
    return /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(String(value || '').trim());
  }

  function isSafeStoreProductEditorMediaSrc(value) {
    return /^(https?:\/\/|\/(?!\/)|data:image\/(?:png|jpe?g|webp|gif);base64,|blob:)/i.test(String(value || '').trim());
  }

  function renderStoreProductInlineMarkdown(value) {
    var html = escapeStoreProductEditorHtml(value);
    html = html.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    html = html.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/(?!\/)[^)\s]+|data:image\/(?:png|jpe?g|webp|gif);base64,[^)\s]+)\)/gi, function(match, alt, src) {
      var normalizedSrc = String(src || '').replace(/&amp;/g, '&');
      return isSafeStoreProductEditorMediaSrc(normalizedSrc)
        ? '<img src="' + escapeStoreProductEditorAttribute(normalizedSrc) + '" alt="' + escapeStoreProductEditorAttribute(alt) + '">'
        : match;
    });
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+|\/(?!\/)[^)\s]+|#[^)\s]+)\)/gi, function(match, label, href) {
      var normalizedHref = String(href || '').replace(/&amp;/g, '&');
      return isSafeStoreProductEditorHref(normalizedHref)
        ? '<a href="' + escapeStoreProductEditorAttribute(normalizedHref) + '">' + label + '</a>'
        : match;
    });
    html = html.replace(/\*\*_([^_\n]+)_\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/___([^_\n]+)___/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    html = html.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
    return html;
  }

  function storeProductMarkdownToEditorHtml(value) {
    var lines = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    var chunks = [];
    var paragraph = [];
    var listItems = [];
    var listTag = 'ul';

    function flushParagraph() {
      if (!paragraph.length) return;
      chunks.push('<p>' + renderStoreProductInlineMarkdown(paragraph.join(' ')) + '</p>');
      paragraph = [];
    }

    function flushList() {
      if (!listItems.length) return;
      chunks.push('<' + listTag + '>' + listItems.map(function(item) {
        return '<li>' + renderStoreProductInlineMarkdown(item) + '</li>';
      }).join('') + '</' + listTag + '>');
      listItems = [];
      listTag = 'ul';
    }

    lines.forEach(function(line) {
      var trimmed = line.trim();
      if (!trimmed) {
        flushParagraph();
        flushList();
        return;
      }
      var image = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
      if (image && isSafeStoreProductEditorMediaSrc(image[2])) {
        flushParagraph();
        flushList();
        chunks.push('<p><img src="' + escapeStoreProductEditorAttribute(image[2]) + '" alt="' + escapeStoreProductEditorAttribute(image[1]) + '"></p>');
        return;
      }
      var heading = trimmed.match(/^(#{2,4})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        chunks.push('<h' + heading[1].length + '>' + renderStoreProductInlineMarkdown(heading[2]) + '</h' + heading[1].length + '>');
        return;
      }
      var unorderedListItem = trimmed.match(/^[-*]\s+(.+)$/);
      if (unorderedListItem) {
        flushParagraph();
        if (listItems.length && listTag !== 'ul') flushList();
        listTag = 'ul';
        listItems.push(unorderedListItem[1]);
        return;
      }
      var orderedListItem = trimmed.match(/^\d+[.)]\s+(.+)$/);
      if (orderedListItem) {
        flushParagraph();
        if (listItems.length && listTag !== 'ol') flushList();
        listTag = 'ol';
        listItems.push(orderedListItem[1]);
        return;
      }
      flushList();
      paragraph.push(trimmed);
    });
    flushParagraph();
    flushList();
    return chunks.join('');
  }

  function normalizeStoreProductPastedPlainText(value) {
    return String(value || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/^\s*[•◦▪]\s+/gm, '- ')
      .replace(/^\s*([a-zA-Z])[\.)]\s+/gm, function(_match, letter) {
        var index = letter.toLowerCase().charCodeAt(0) - 96;
        return (index > 0 ? index : 1) + '. ';
      })
      .trim();
  }

  function storeProductClipboardElementHasStyle(element, styleName) {
    var style = (element.getAttribute('style') || '').toLowerCase();
    if (styleName === 'bold') return /font-weight\s*:\s*(bold|[6-9]00)/.test(style);
    if (styleName === 'italic') return /font-style\s*:\s*italic/.test(style);
    return false;
  }

  function sanitizeStoreProductClipboardHtml(html) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(String(html || ''), 'text/html');
    var unsafeTags = new Set(['script', 'style', 'meta', 'link', 'object', 'embed', 'iframe', 'svg']);
    var blockTags = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'blockquote']);

    function cleanChildren(node) {
      return Array.from(node.childNodes).map(cleanNode).join('');
    }

    function cleanNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return escapeStoreProductEditorHtml(node.textContent || '');
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      var element = node;
      var tag = element.tagName.toLowerCase();
      if (unsafeTags.has(tag)) return '';
      if (tag === 'br') return '<br>';
      if (tag === 'img') {
        var src = element.getAttribute('src') || '';
        if (!isSafeStoreProductEditorMediaSrc(src)) return '';
        return '<img src="' + escapeStoreProductEditorAttribute(src) + '" alt="' + escapeStoreProductEditorAttribute(element.getAttribute('alt') || '') + '">';
      }
      var inner = cleanChildren(element);
      if (!inner.trim()) return '';
      if (tag === 'a') {
        var href = element.getAttribute('href') || '';
        return isSafeStoreProductEditorHref(href) ? '<a href="' + escapeStoreProductEditorAttribute(href) + '">' + inner + '</a>' : inner;
      }
      if (tag === 'ul' || tag === 'ol') return '<' + tag + '>' + cleanChildren(element) + '</' + tag + '>';
      if (tag === 'li') return '<li>' + inner.trim() + '</li>';
      if (/^h[1-6]$/.test(tag)) {
        var level = Math.min(4, Math.max(2, Number(tag.slice(1))));
        return '<h' + level + '>' + inner.trim() + '</h' + level + '>';
      }
      if (tag === 'strong' || tag === 'b' || storeProductClipboardElementHasStyle(element, 'bold')) return '<strong>' + inner + '</strong>';
      if (tag === 'em' || tag === 'i' || storeProductClipboardElementHasStyle(element, 'italic')) return '<em>' + inner + '</em>';
      if (blockTags.has(tag)) return '<p>' + inner.trim() + '</p>';
      return inner;
    }

    return cleanChildren(doc.body).replace(/(<br>\s*){3,}/g, '<br><br>').trim();
  }

  function sanitizedStoreProductClipboardHtml(event) {
    var html = event && event.clipboardData ? event.clipboardData.getData('text/html') : '';
    if (html) {
      var sanitized = sanitizeStoreProductClipboardHtml(html);
      if (sanitized) return sanitized;
    }
    var text = normalizeStoreProductPastedPlainText(event && event.clipboardData ? event.clipboardData.getData('text/plain') : '');
    return storeProductMarkdownToEditorHtml(text);
  }

  function wrapStoreProductMarkdownInline(inner, openMarker, closeMarker) {
    var text = String(inner || '');
    var leading = (text.match(/^\s+/) || [''])[0];
    var trailing = (text.match(/\s+$/) || [''])[0];
    var core = text.slice(leading.length, text.length - trailing.length);
    if (!core) return text;
    return leading + openMarker + core + closeMarker + trailing;
  }

  function storeProductEditorNodeToMarkdown(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return String(node.textContent || '').replace(/\u00a0/g, ' ');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    var element = node;
    var tag = element.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    if (tag === 'img') {
      var src = element.getAttribute('src') || '';
      var alt = String(element.getAttribute('alt') || 'Product image').replace(/[\[\]\n\r]/g, '').trim() || 'Product image';
      return isSafeStoreProductEditorMediaSrc(src) ? '![' + alt + '](' + src + ')' : '';
    }
    var inner = Array.from(element.childNodes).map(storeProductEditorNodeToMarkdown).join('');
    if (tag === 'a') {
      var href = element.getAttribute('href') || '';
      return isSafeStoreProductEditorHref(href) ? '[' + inner + '](' + href + ')' : inner;
    }
    if (tag === 'strong' || tag === 'b') return wrapStoreProductMarkdownInline(inner, '**', '**');
    if (tag === 'em' || tag === 'i') return wrapStoreProductMarkdownInline(inner, '*', '*');
    if (tag === 'h2') return '## ' + inner.trim();
    if (tag === 'h3') return '### ' + inner.trim();
    if (tag === 'h4') return '#### ' + inner.trim();
    if (tag === 'ul') {
      return Array.from(element.children).filter(function(child) {
        return child.tagName && child.tagName.toLowerCase() === 'li';
      }).map(function(child) {
        return '- ' + storeProductEditorNodeToMarkdown(child).trim().replace(/\n+/g, ' ');
      }).join('\n');
    }
    if (tag === 'ol') {
      return Array.from(element.children).filter(function(child) {
        return child.tagName && child.tagName.toLowerCase() === 'li';
      }).map(function(child, index) {
        return String(index + 1) + '. ' + storeProductEditorNodeToMarkdown(child).trim().replace(/\n+/g, ' ');
      }).join('\n');
    }
    if (tag === 'li') return inner.trim();
    return inner;
  }

  function storeProductEditorHtmlToMarkdown(editor) {
    var blocks = [];
    Array.from(editor.childNodes).forEach(function(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        var text = (node.textContent || '').trim();
        if (text) blocks.push(text);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      var tag = node.tagName.toLowerCase();
      var markdown = storeProductEditorNodeToMarkdown(node).trim();
      if (!markdown && tag !== 'br') return;
      blocks.push(markdown);
    });
    if (!blocks.length) return String(editor.innerText || editor.textContent || '').replace(/\u00a0/g, ' ').trim();
    return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function syncStoreProductRichDescription(textarea, editor) {
    textarea.value = storeProductEditorHtmlToMarkdown(editor);
    editor.dataset.empty = textarea.value.trim() ? 'false' : 'true';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function storeProductEditorHasSelection(editor) {
    var selection = window.getSelection && window.getSelection();
    if (!selection || !selection.rangeCount) return false;
    return editor.contains(selection.anchorNode) && editor.contains(selection.focusNode);
  }

  function focusStoreProductEditorAtEnd(editor, preserveSelection) {
    editor.focus();
    if (preserveSelection && storeProductEditorHasSelection(editor)) return;
    var range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    var selection = window.getSelection && window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertStoreProductEditorHtml(editor, html, preserveSelection) {
    focusStoreProductEditorAtEnd(editor, preserveSelection);
    if (document.queryCommandSupported && document.queryCommandSupported('insertHTML')) {
      document.execCommand('insertHTML', false, html);
    } else {
      var fragment = document.createRange().createContextualFragment(html);
      editor.appendChild(fragment);
    }
  }

  function applyStoreProductRichDescriptionFormat(editor, textarea, action, value) {
    var preserveSelection = editor.dataset.storeProductSelectionReady === 'true';
    focusStoreProductEditorAtEnd(editor, preserveSelection);
    if (action === 'format') {
      document.execCommand('formatBlock', false, value || 'p');
    } else if (action === 'link') {
      var href = window.prompt('Link URL', 'https://');
      if (!href || !isSafeStoreProductEditorHref(href)) {
        syncStoreProductRichDescription(textarea, editor);
        return;
      }
      var selection = window.getSelection && window.getSelection();
      if (selection && selection.rangeCount && selection.isCollapsed) {
        insertStoreProductEditorHtml(editor, '<a href="' + escapeStoreProductEditorAttribute(href) + '">' + escapeStoreProductEditorHtml(href) + '</a>', preserveSelection);
      } else {
        document.execCommand('createLink', false, href);
      }
    } else if (action === 'bold') {
      document.execCommand('bold', false, null);
    } else if (action === 'italic') {
      document.execCommand('italic', false, null);
    } else if (action === 'bullet') {
      document.execCommand('insertUnorderedList', false, null);
    } else if (action === 'numbered') {
      document.execCommand('insertOrderedList', false, null);
    }
    editor.dataset.storeProductSelectionReady = 'true';
    syncStoreProductRichDescription(textarea, editor);
  }

  function insertStoreProductRichDescriptionImage(editor, textarea, path, label) {
    var src = String(path || '').trim();
    if (!src || !isSafeStoreProductEditorMediaSrc(src)) return;
    var alt = String(label || 'Product image').replace(/[\[\]\n\r]/g, '').trim() || 'Product image';
    insertStoreProductEditorHtml(editor, '<p><img src="' + escapeStoreProductEditorAttribute(src) + '" alt="' + escapeStoreProductEditorAttribute(alt) + '"></p>', editor.dataset.storeProductSelectionReady === 'true');
    editor.dataset.storeProductSelectionReady = 'true';
    syncStoreProductRichDescription(textarea, editor);
  }

  var storeProductDescriptionBlockTypes = ['text', 'quote', 'image', 'gallery', 'video', 'audio', 'embed', 'divider'];
  var storeProductDescriptionAlignments = ['left', 'center', 'right', 'justify'];
  var storeProductDescriptionTextFormats = ['p', 'h2', 'h3', 'h4'];

  function storeProductDescriptionBlockLabel(type) {
    var labels = {
      text: 'Text',
      quote: 'Quote',
      image: 'Image',
      gallery: 'Gallery',
      video: 'Video',
      audio: 'Audio',
      embed: 'Embed',
      divider: 'Divider'
    };
    return labels[type] || labels.text;
  }

  function storeProductDescriptionBlockCommand(value) {
    var type = String(value || '').trim().replace(/^\/+/, '').toLowerCase();
    return storeProductDescriptionBlockTypes.indexOf(type) >= 0 ? type : 'text';
  }

  function storeProductDescriptionAlignment(value) {
    var align = String(value || '').trim().toLowerCase();
    return storeProductDescriptionAlignments.indexOf(align) >= 0 ? align : 'left';
  }

  function storeProductDescriptionGalleryLayout(value) {
    return String(value || '').trim().toLowerCase() === 'carousel' ? 'carousel' : 'grid';
  }

  function storeProductDescriptionGalleryCaptionStyle(value) {
    return String(value || '').trim().toLowerCase() === 'overlay' ? 'overlay' : 'inline';
  }

  function storeProductDescriptionVideoProvider(value) {
    var provider = String(value || '').trim().toLowerCase();
    return ['youtube', 'vimeo', 'local'].indexOf(provider) >= 0 ? provider : 'youtube';
  }

  function storeProductDescriptionDefaultBlock(type) {
    var align = 'left';
    switch (storeProductDescriptionBlockCommand(type)) {
      case 'quote':
        return { type: 'quote', text: '', author: '', align: align };
      case 'image':
        return { type: 'image', src: '', alt: '', caption: '', align: align };
      case 'gallery':
        return { type: 'gallery', layout: 'grid', caption_style: 'inline', images: [], caption: '', align: align };
      case 'video':
        return { type: 'video', provider: 'youtube', video_id: '', src: '', poster: '', caption: '', align: align };
      case 'audio':
        return { type: 'audio', src: '', title: '', caption: '', align: align };
      case 'embed':
        return { type: 'embed', provider: 'spotify', src: '', title: '', caption: '', align: align };
      case 'divider':
        return { type: 'divider', align: align };
      default:
        return { type: 'text', body: '', align: align };
    }
  }

  function storeProductDescriptionNormalizeBlock(block) {
    if (!block || typeof block !== 'object') return storeProductDescriptionDefaultBlock('text');
    var type = storeProductDescriptionBlockCommand(block.type);
    var normalized = storeProductDescriptionDefaultBlock(type);
    Object.keys(normalized).forEach(function(key) {
      if (key === 'type') return;
      if (key === 'images') {
        normalized.images = Array.isArray(block.images) ? block.images.map(function(image) {
          return {
            src: String(image && image.src || ''),
            alt: String(image && image.alt || ''),
            caption: String(image && image.caption || '')
          };
        }) : [];
        return;
      }
      if (key === 'layout') {
        normalized.layout = storeProductDescriptionGalleryLayout(block.layout);
        return;
      }
      if (key === 'caption_style') {
        normalized.caption_style = storeProductDescriptionGalleryCaptionStyle(block.caption_style);
        return;
      }
      if (key === 'provider' && type === 'video') {
        normalized.provider = storeProductDescriptionVideoProvider(block.provider);
        return;
      }
      normalized[key] = String(block[key] || '');
    });
    normalized.align = storeProductDescriptionAlignment(block.align);
    return normalized;
  }

  function storeProductDescriptionParseBlocks(value) {
    if (Array.isArray(value)) return value.map(storeProductDescriptionNormalizeBlock);
    if (typeof value === 'string' && value.trim()) {
      try {
        var parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(storeProductDescriptionNormalizeBlock) : [];
      } catch (_error) {
        return [];
      }
    }
    return [];
  }

  function storeProductDescriptionBlocksFromMarkdown(value) {
    var markdown = String(value || '').trim();
    if (!markdown) return [storeProductDescriptionDefaultBlock('text')];
    var blocks = [];
    var textLines = [];

    function flushText() {
      var body = textLines.join('\n').trim();
      if (body) blocks.push({ type: 'text', body: body, align: 'left' });
      textLines = [];
    }

    markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').forEach(function(line) {
      var image = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
      if (image) {
        flushText();
        blocks.push({ type: 'image', src: image[2], alt: image[1], caption: '', align: 'left' });
        return;
      }
      if (/^---+$/.test(line.trim())) {
        flushText();
        blocks.push(storeProductDescriptionDefaultBlock('divider'));
        return;
      }
      textLines.push(line);
    });
    flushText();
    return blocks.length ? blocks : [storeProductDescriptionDefaultBlock('text')];
  }

  function storeProductDescriptionBlocksFromProduct(product) {
    var blocks = storeProductDescriptionParseBlocks(product.longContent || product.long_content || []);
    return blocks.length ? blocks : storeProductDescriptionBlocksFromMarkdown(product.description || '');
  }

  function storeProductDescriptionSerializableBlocks(blocks) {
    return (Array.isArray(blocks) ? blocks : []).map(function(block) {
      var normalized = storeProductDescriptionNormalizeBlock(block);
      if (normalized.type === 'gallery') {
        normalized.images = normalized.images.filter(function(image) {
          return image.src || image.alt || image.caption;
        });
      }
      return normalized;
    }).filter(function(block) {
      if (block.type === 'text') return String(block.body || '').trim();
      if (block.type === 'quote') return String(block.text || '').trim() || String(block.author || '').trim();
      if (block.type === 'image') return String(block.src || '').trim() || String(block.caption || '').trim();
      if (block.type === 'gallery') return block.images.length || String(block.caption || '').trim();
      if (block.type === 'video') return String(block.video_id || block.src || block.caption || '').trim();
      if (block.type === 'audio') return String(block.src || block.title || block.caption || '').trim();
      if (block.type === 'embed') return String(block.src || block.title || block.caption || '').trim();
      return true;
    });
  }

  function storeProductMarkdownLinkEscape(value) {
    return String(value || '').replace(/[\[\]\n\r]/g, '').trim();
  }

  function storeProductDescriptionVideoUrl(block) {
    var provider = storeProductDescriptionVideoProvider(block.provider);
    var id = String(block.video_id || '').trim();
    if (provider === 'local') return String(block.src || '').trim();
    if (!id) return '';
    if (provider === 'vimeo') return 'https://vimeo.com/' + encodeURIComponent(id);
    return 'https://www.youtube.com/watch?v=' + encodeURIComponent(id);
  }

  function storeProductDescriptionBlocksToMarkdown(blocks) {
    return storeProductDescriptionSerializableBlocks(blocks).map(function(block) {
      if (block.type === 'text') return String(block.body || '').trim();
      if (block.type === 'quote') {
        var quote = String(block.text || '').trim().split('\n').map(function(line) {
          return line ? '> ' + line : '>';
        }).join('\n');
        return [quote, block.author ? '> - ' + storeProductMarkdownLinkEscape(block.author) : ''].filter(Boolean).join('\n');
      }
      if (block.type === 'image') {
        var image = block.src ? '![' + storeProductMarkdownLinkEscape(block.alt || block.caption || 'Product image') + '](' + block.src + ')' : '';
        return [image, block.caption ? '*' + storeProductMarkdownLinkEscape(block.caption) + '*' : ''].filter(Boolean).join('\n\n');
      }
      if (block.type === 'gallery') {
        return (block.images || []).map(function(image) {
          return ['![' + storeProductMarkdownLinkEscape(image.alt || image.caption || 'Gallery image') + '](' + image.src + ')', image.caption ? '*' + storeProductMarkdownLinkEscape(image.caption) + '*' : ''].filter(Boolean).join('\n\n');
        }).concat(block.caption ? ['*' + storeProductMarkdownLinkEscape(block.caption) + '*'] : []).filter(Boolean).join('\n\n');
      }
      if (block.type === 'video') {
        var videoUrl = storeProductDescriptionVideoUrl(block);
        return videoUrl ? '[' + storeProductMarkdownLinkEscape(block.caption || 'Video') + '](' + videoUrl + ')' : String(block.caption || '').trim();
      }
      if (block.type === 'audio') {
        return block.src ? '[' + storeProductMarkdownLinkEscape(block.title || block.caption || 'Audio') + '](' + block.src + ')' : String(block.caption || block.title || '').trim();
      }
      if (block.type === 'embed') {
        return block.src ? '[' + storeProductMarkdownLinkEscape(block.title || block.caption || block.provider || 'Embedded content') + '](' + block.src + ')' : String(block.caption || block.title || '').trim();
      }
      if (block.type === 'divider') return '---';
      return '';
    }).filter(Boolean).join('\n\n').trim();
  }

  function storeProductDescriptionSync(context) {
    var blocks = storeProductDescriptionSerializableBlocks(context.blocks);
    context.descriptionField.value = storeProductDescriptionBlocksToMarkdown(blocks);
    context.longContentField.value = JSON.stringify(blocks);
    context.root.__storeProductDescriptionBlocks = context.blocks;
    context.descriptionField.dispatchEvent(new Event('input', { bubbles: true }));
    context.longContentField.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function storeProductDescriptionCreateIcon(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('admin-content-block__icon');
    var paths = {
      alignLeft: ['M4 6h16', 'M4 10h11', 'M4 14h16', 'M4 18h11'],
      alignCenter: ['M4 6h16', 'M7 10h10', 'M4 14h16', 'M7 18h10'],
      alignRight: ['M4 6h16', 'M9 10h11', 'M4 14h16', 'M9 18h11'],
      alignJustify: ['M4 6h16', 'M4 10h16', 'M4 14h16', 'M4 18h16'],
      link: ['M10 13a5 5 0 0 0 7.1 0l1.4-1.4a5 5 0 0 0-7.1-7.1L10.5 5.4', 'M14 11a5 5 0 0 0-7.1 0L5.5 12.4a5 5 0 0 0 7.1 7.1l.9-.9'],
      list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
      listOrdered: ['M10 6h11', 'M10 12h11', 'M10 18h11', 'M4 6h1v4', 'M4 10h2', 'M6 18H4c0-1 2-2 2-3s-1-1.5-2-1'],
      trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
      settings: ['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.16.09a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.18a2 2 0 0 1-1 1.73l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.16.09a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.16-.09a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.18a2 2 0 0 1 1-1.73l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.16-.09a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z']
    };
    (paths[name] || []).forEach(function(definition) {
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', definition);
      svg.appendChild(path);
    });
    return svg;
  }

  function storeProductDescriptionToolbarGroup(label) {
    var group = createElement('div', 'admin-content-block__toolbar-group');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    return group;
  }

  function storeProductDescriptionSetEditableText(control, value, blockMode) {
    control.replaceChildren();
    var text = String(value || '');
    if (!text) {
      if (blockMode) {
        var paragraph = document.createElement('p');
        paragraph.dataset.placeholder = control.dataset.placeholder || '';
        control.appendChild(paragraph);
      }
      return;
    }
    control.innerHTML = blockMode ? storeProductMarkdownToEditorHtml(text) : renderStoreProductInlineMarkdown(text);
  }

  function storeProductDescriptionEditable(tag, block, index, field, labelText, className, options) {
    var control = document.createElement(tag);
    control.className = className || 'admin-content-block__editable';
    control.contentEditable = 'true';
    control.spellcheck = true;
    control.dataset.contentIndex = String(index);
    control.dataset.contentField = field;
    control.dataset.placeholder = (options && options.placeholder) || (field === 'body' ? 'Start writing. Use + or slash commands to add blocks.' : labelText);
    control.setAttribute('aria-label', labelText);
    control.setAttribute('role', 'textbox');
    control.setAttribute('aria-multiline', options && options.blockMode ? 'true' : 'false');
    control.setAttribute('tabindex', '0');
    storeProductDescriptionSetEditableText(control, block[field] || '', options && options.blockMode);
    return control;
  }

  function storeProductDescriptionField(context, tagName, block, index, field, labelText, options) {
    var wrap = createElement('div', 'admin-content-block__field');
    var label = createElement('label', '', '');
    var controlId = 'store-product-content-field-' + context.id + '-' + index + '-' + field + '-' + (++storeProductDescriptionEditorCounter);
    var control = document.createElement(tagName);
    label.setAttribute('for', controlId);
    label.appendChild(createElement('span', '', labelText));
    control.id = controlId;
    control.dataset.contentIndex = String(index);
    control.dataset.contentField = field;
    if (tagName === 'select') {
      (options && options.options || []).forEach(function(optionConfig) {
        var option = document.createElement('option');
        option.value = optionConfig.value;
        option.textContent = optionConfig.label;
        control.appendChild(option);
      });
    }
    control.value = String(block[field] || '');
    if (tagName === 'textarea') control.rows = options && options.rows || 3;
    if (options && options.placeholder) control.placeholder = options.placeholder;
    wrap.appendChild(label);
    wrap.appendChild(control);
    return wrap;
  }

  function storeProductDescriptionUploadField(context, block, index, options) {
    var wrap = createElement('div', 'admin-content-block__field admin-content-block__media-upload-field');
    var uploadRow = createElement('div', 'admin-settings__image-upload admin-content-block__media-upload');
    var input = document.createElement('input');
    var status = createElement('span', 'admin-settings__image-status admin-content-block__media-status', '');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.dataset.contentIndex = String(index);
    input.dataset.contentAction = options && options.action || 'select-media-upload';
    if (options && options.imageIndex !== undefined) input.dataset.contentImageIndex = String(options.imageIndex);
    input.setAttribute('aria-label', options && options.buttonLabel || 'Upload image');
    uploadRow.appendChild(createAdminFilePicker(input, {
      buttonClass: 'btn--small',
      buttonLabel: options && options.buttonLabel || 'Upload image',
      className: 'admin-file-picker--compact',
      emptyLabel: 'No file chosen',
      idPrefix: 'admin-content-media-upload'
    }));
    uploadRow.appendChild(status);
    wrap.appendChild(uploadRow);
    return wrap;
  }

  function storeProductDescriptionMediaLibraryButton(index, imageIndex) {
    var wrap = createElement('div', 'admin-content-block__field admin-content-block__media-library-field');
    var button = createElement('button', 'btn btn--secondary btn--small', 'Choose existing image');
    button.type = 'button';
    button.dataset.contentIndex = String(index);
    button.dataset.contentAction = 'choose-media-library';
    if (imageIndex !== undefined) button.dataset.contentImageIndex = String(imageIndex);
    wrap.appendChild(button);
    return wrap;
  }

  function storeProductDescriptionCreateChrome(context, block, index) {
    var chrome = createElement('div', 'admin-content-block__chrome');
    chrome.dataset.contentChrome = 'true';
    chrome.setAttribute('aria-hidden', 'true');
    chrome.addEventListener('mousedown', function(event) {
      if (event.target && event.target.closest && event.target.closest('button')) event.preventDefault();
    });
    var headerRow = createElement('div', 'admin-content-block__chrome-row admin-content-block__chrome-row--header');
    var typeLabel = createElement('label', 'admin-content-block__type admin-content-block__toolbar-group admin-content-block__toolbar-group--type');
    var typeSelect = document.createElement('select');
    typeSelect.className = 'admin-content-block__select';
    typeSelect.dataset.contentIndex = String(index);
    typeSelect.dataset.contentAction = 'type';
    typeSelect.setAttribute('aria-label', 'Block type');
    storeProductDescriptionBlockTypes.forEach(function(type) {
      var option = document.createElement('option');
      option.value = type;
      option.textContent = storeProductDescriptionBlockLabel(type);
      option.selected = block.type === type;
      typeSelect.appendChild(option);
    });
    typeLabel.appendChild(typeSelect);
    var blockGroup = storeProductDescriptionToolbarGroup('Block actions');
    blockGroup.classList.add('admin-content-block__toolbar-group--block-actions');
    [
      { action: 'up', label: 'Move block up', text: '^', disabled: index === 0 },
      { action: 'down', label: 'Move block down', text: 'v', disabled: index === context.blocks.length - 1 },
      { action: 'delete', label: 'Delete block', icon: 'trash', disabled: context.blocks.length === 1 }
    ].forEach(function(config) {
      var button = createElement('button', 'btn btn--secondary btn--small', config.icon ? '' : config.text);
      button.type = 'button';
      button.dataset.contentIndex = String(index);
      button.dataset.contentAction = config.action;
      button.setAttribute('aria-label', config.label);
      button.disabled = config.disabled;
      if (config.icon) button.appendChild(storeProductDescriptionCreateIcon(config.icon));
      blockGroup.appendChild(button);
    });
    headerRow.appendChild(typeLabel);
    headerRow.appendChild(blockGroup);
    chrome.appendChild(headerRow);

    var actions = createElement('div', 'admin-content-block__actions');
    if (block.type === 'text' || block.type === 'quote') {
      var formatGroup = storeProductDescriptionToolbarGroup('Text styling');
      [
        { action: 'format-bold', label: 'Bold', text: 'B' },
        { action: 'format-italic', label: 'Italic', text: 'I' },
        { action: 'format-underline', label: 'Underline', text: 'U' }
      ].concat(block.type === 'text' ? [
        { action: 'format-link', label: 'Link', icon: 'link' },
        { action: 'format-unordered-list', label: 'Unordered list', icon: 'list' },
        { action: 'format-ordered-list', label: 'Numbered list', icon: 'listOrdered' }
      ] : []).forEach(function(config) {
        var button = createElement('button', 'btn btn--secondary btn--small admin-content-block__format-button admin-content-block__format-button--' + config.action, config.icon ? '' : config.text);
        button.type = 'button';
        button.dataset.contentIndex = String(index);
        button.dataset.contentAction = config.action;
        button.setAttribute('aria-label', config.label);
        button.setAttribute('aria-pressed', 'false');
        if (config.icon) button.appendChild(storeProductDescriptionCreateIcon(config.icon));
        formatGroup.appendChild(button);
      });
      actions.appendChild(formatGroup);
      if (block.type === 'text') {
        var styleGroup = storeProductDescriptionToolbarGroup('Text format');
        var formatSelect = document.createElement('select');
        formatSelect.className = 'admin-content-block__select admin-content-block__format-select';
        formatSelect.dataset.contentIndex = String(index);
        formatSelect.dataset.contentAction = 'format-block';
        formatSelect.setAttribute('aria-label', 'Text format');
        [['multiple', 'Multiple'], ['p', 'Paragraph'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['h4', 'Heading 4']].forEach(function(pair) {
          var option = document.createElement('option');
          option.value = pair[0];
          option.textContent = pair[1];
          if (pair[0] === 'multiple') option.disabled = true;
          formatSelect.appendChild(option);
        });
        styleGroup.appendChild(formatSelect);
        actions.appendChild(styleGroup);
      }
    }
    var alignGroup = storeProductDescriptionToolbarGroup('Alignment');
    alignGroup.classList.add('admin-content-block__toolbar-group--alignment');
    storeProductDescriptionAlignments.forEach(function(align) {
      var button = createElement('button', 'btn btn--secondary btn--small' + (storeProductDescriptionAlignment(block.align) === align ? ' is-active' : ''));
      button.type = 'button';
      button.dataset.contentIndex = String(index);
      button.dataset.contentAction = 'align';
      button.dataset.contentAlign = align;
      button.setAttribute('aria-label', align);
      button.setAttribute('aria-pressed', storeProductDescriptionAlignment(block.align) === align ? 'true' : 'false');
      button.appendChild(storeProductDescriptionCreateIcon(align === 'left' ? 'alignLeft' : align === 'center' ? 'alignCenter' : align === 'right' ? 'alignRight' : 'alignJustify'));
      alignGroup.appendChild(button);
    });
    actions.appendChild(alignGroup);
    if (actions.children.length) {
      var formatRow = createElement('div', 'admin-content-block__chrome-row admin-content-block__chrome-row--format');
      formatRow.appendChild(actions);
      chrome.appendChild(formatRow);
    }
    if (block.type === 'text') {
      var linkPanel = createElement('div', 'admin-content-block__link-panel');
      linkPanel.dataset.contentLinkPanel = String(index);
      linkPanel.hidden = true;
      var linkLabel = document.createElement('label');
      linkLabel.appendChild(createElement('span', '', 'Link URL'));
      var linkInput = document.createElement('input');
      linkInput.type = 'text';
      linkInput.inputMode = 'url';
      linkInput.dataset.contentIndex = String(index);
      linkInput.dataset.contentAction = 'link-url';
      linkInput.setAttribute('aria-label', 'Link URL');
      linkLabel.appendChild(linkInput);
      var apply = createElement('button', 'btn btn--secondary btn--small', 'Apply');
      apply.type = 'button';
      apply.dataset.contentIndex = String(index);
      apply.dataset.contentAction = 'link-apply';
      var remove = createElement('button', 'btn btn--secondary btn--small', 'Remove link');
      remove.type = 'button';
      remove.dataset.contentIndex = String(index);
      remove.dataset.contentAction = 'link-remove';
      linkPanel.appendChild(linkLabel);
      linkPanel.appendChild(apply);
      linkPanel.appendChild(remove);
      chrome.appendChild(linkPanel);
    }
    return chrome;
  }

  function storeProductDescriptionMediaPlaceholder() {
    return createElement('div', 'admin-content-block__media-placeholder', 'Add media details in settings to preview this block.');
  }

  function storeProductDescriptionToggleSettingsButton(context, index, label, extraClass) {
    var button = createElement('button', 'btn btn--secondary btn--small admin-content-block__settings-button' + (extraClass ? ' ' + extraClass : ''));
    var panelId = 'store-product-description-settings-' + context.id + '-' + index + '-' + (++storeProductDescriptionEditorCounter);
    button.type = 'button';
    button.dataset.contentIndex = String(index);
    button.dataset.contentAction = 'toggle-media-settings';
    button.setAttribute('aria-controls', panelId);
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', label);
    button.appendChild(storeProductDescriptionCreateIcon('settings'));
    return { button: button, panelId: panelId };
  }

  function storeProductDescriptionRenderMediaSettings(card, context, block, index) {
    if (['text', 'quote', 'divider'].indexOf(block.type) >= 0) return;
    var isGallery = block.type === 'gallery';
    var setting = storeProductDescriptionToggleSettingsButton(context, index, isGallery ? 'Gallery settings' : 'Media settings', isGallery ? 'admin-content-block__settings-button--gallery-block' : '');
    var panel = createElement('div', 'admin-content-block__settings-panel' + (isGallery ? ' admin-content-block__settings-panel--gallery-block' : ''));
    panel.id = setting.panelId;
    panel.hidden = true;
    panel.dataset.contentMediaSettings = String(index);
    panel.setAttribute('role', 'group');
    panel.appendChild(createElement('h3', '', isGallery ? 'Gallery settings' : 'Media settings'));
    var fields = createElement('div', 'admin-content-block__fields');
    if (block.type === 'image') {
      fields.appendChild(storeProductDescriptionUploadField(context, block, index, { buttonLabel: 'Upload image' }));
      fields.appendChild(storeProductDescriptionMediaLibraryButton(index));
      fields.appendChild(storeProductDescriptionField(context, 'input', block, index, 'src', 'Source URL'));
      fields.appendChild(storeProductDescriptionField(context, 'input', block, index, 'alt', 'Alt text'));
    } else if (block.type === 'gallery') {
      fields.appendChild(storeProductDescriptionField(context, 'select', block, index, 'layout', 'Gallery layout', {
        options: [{ value: 'grid', label: 'Grid' }, { value: 'carousel', label: 'Carousel' }]
      }));
      fields.appendChild(storeProductDescriptionField(context, 'select', block, index, 'caption_style', 'Caption style', {
        options: [{ value: 'inline', label: 'Inline' }, { value: 'overlay', label: 'Overlay' }]
      }));
      fields.appendChild(storeProductDescriptionUploadField(context, block, index, {
        action: 'add-gallery-image-upload',
        buttonLabel: 'Add gallery image'
      }));
    } else if (block.type === 'video') {
      fields.appendChild(storeProductDescriptionField(context, 'select', block, index, 'provider', 'Provider', {
        options: [{ value: 'youtube', label: 'YouTube' }, { value: 'vimeo', label: 'Vimeo' }, { value: 'local', label: 'Uploaded video' }]
      }));
      if (storeProductDescriptionVideoProvider(block.provider) === 'local') {
        fields.appendChild(storeProductDescriptionField(context, 'input', block, index, 'src', 'Source URL', {
          placeholder: '/assets/videos/example.mp4'
        }));
        fields.appendChild(storeProductDescriptionField(context, 'input', block, index, 'poster', 'Poster image', {
          placeholder: '/assets/images/example.jpg'
        }));
      } else {
        fields.appendChild(storeProductDescriptionField(context, 'input', block, index, 'video_id', 'Video ID'));
      }
    } else if (block.type === 'audio') {
      fields.appendChild(storeProductDescriptionField(context, 'input', block, index, 'src', 'Source URL', {
        placeholder: '/assets/audio/example.mp3'
      }));
      fields.appendChild(storeProductDescriptionField(context, 'input', block, index, 'title', 'Title'));
    } else if (block.type === 'embed') {
      fields.appendChild(storeProductDescriptionField(context, 'input', block, index, 'provider', 'Provider'));
      fields.appendChild(storeProductDescriptionField(context, 'input', block, index, 'src', 'Source URL'));
      fields.appendChild(storeProductDescriptionField(context, 'input', block, index, 'title', 'Title'));
    }
    panel.appendChild(fields);
    card.appendChild(setting.button);
    card.appendChild(panel);
  }

  function storeProductDescriptionRenderGalleryImageSettings(galleryItem, context, block, index, imageIndex) {
    var setting = storeProductDescriptionToggleSettingsButton(context, index, 'Gallery image settings', 'admin-content-block__settings-button--gallery-image');
    setting.button.dataset.contentImageIndex = String(imageIndex);
    setting.button.dataset.contentAction = 'toggle-gallery-image-settings';
    var panel = createElement('div', 'admin-content-block__settings-panel admin-content-block__settings-panel--gallery-image');
    panel.id = setting.panelId;
    panel.hidden = true;
    panel.dataset.contentGalleryImageSettings = String(index) + '-' + String(imageIndex);
    panel.setAttribute('role', 'group');
    panel.appendChild(createElement('h3', '', 'Gallery image settings'));
    var image = block.images[imageIndex] || {};
    var fields = createElement('div', 'admin-content-block__fields');
    fields.appendChild(storeProductDescriptionUploadField(context, block, index, {
      buttonLabel: 'Upload image',
      imageIndex: imageIndex
    }));
    fields.appendChild(storeProductDescriptionMediaLibraryButton(index, imageIndex));
    fields.appendChild(storeProductDescriptionGalleryField(context, block, index, imageIndex, 'src', 'Source URL'));
    fields.appendChild(storeProductDescriptionGalleryField(context, block, index, imageIndex, 'alt', 'Alt text'));
    fields.appendChild(storeProductDescriptionGalleryField(context, block, index, imageIndex, 'caption', 'Caption'));
    panel.appendChild(fields);
    galleryItem.appendChild(setting.button);
    galleryItem.appendChild(panel);
  }

  function storeProductDescriptionGalleryField(context, block, index, imageIndex, field, labelText) {
    var wrap = createElement('div', 'admin-content-block__field');
    var label = document.createElement('label');
    var controlId = 'store-product-gallery-field-' + context.id + '-' + index + '-' + imageIndex + '-' + field;
    var control = document.createElement(field === 'caption' ? 'textarea' : 'input');
    label.setAttribute('for', controlId);
    label.appendChild(createElement('span', '', labelText));
    control.id = controlId;
    control.dataset.contentIndex = String(index);
    control.dataset.contentImageIndex = String(imageIndex);
    control.dataset.contentField = field;
    control.value = String(block.images && block.images[imageIndex] && block.images[imageIndex][field] || '');
    if (field === 'caption') control.rows = 2;
    wrap.appendChild(label);
    wrap.appendChild(control);
    return wrap;
  }

  function storeProductDescriptionAppendCaption(card, block, index) {
    if (['text', 'quote', 'divider'].indexOf(block.type) >= 0) return;
    card.appendChild(storeProductDescriptionEditable('figcaption', block, index, 'caption', 'Caption', 'content-block__caption admin-content-block__editable admin-content-block__editable--caption', {
      placeholder: 'Optional caption - hidden unless filled'
    }));
  }

  function storeProductDescriptionBlockElement(type) {
    return type === 'quote' ? 'blockquote' : type === 'image' || type === 'gallery' || type === 'video' || type === 'audio' || type === 'embed' ? 'figure' : 'div';
  }

  function storeProductDescriptionExternalLink(href, label) {
    var wrap = createElement('div', 'admin-content-block__media-placeholder admin-content-block__media-placeholder--external embed-container--link');
    var link = document.createElement('a');
    link.href = href || '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label || href || 'External media';
    wrap.appendChild(link);
    return wrap;
  }

  function storeProductDescriptionRenderBlockBody(card, context, block, index) {
    if (block.type === 'text') {
      card.appendChild(storeProductDescriptionEditable('div', block, index, 'body', 'Body', 'admin-content-block__editable admin-content-block__editable--prose', { blockMode: true }));
    } else if (block.type === 'quote') {
      card.appendChild(storeProductDescriptionEditable('p', block, index, 'text', 'Quote text', 'admin-content-block__editable admin-content-block__editable--quote'));
      card.appendChild(storeProductDescriptionEditable('cite', block, index, 'author', 'Author', 'admin-content-block__editable admin-content-block__editable--cite'));
    } else if (block.type === 'image') {
      if (block.src) {
        var img = document.createElement('img');
        img.src = mediaPreviewUrl(block.src);
        img.alt = block.alt || '';
        img.loading = 'lazy';
        card.appendChild(img);
      } else {
        card.appendChild(storeProductDescriptionMediaPlaceholder());
      }
      storeProductDescriptionAppendCaption(card, block, index);
      storeProductDescriptionRenderMediaSettings(card, context, block, index);
    } else if (block.type === 'gallery') {
      var container = createElement('div', 'gallery__container');
      if (block.images && block.images.length) {
        block.images.forEach(function(item, imageIndex) {
          var galleryItem = createElement('div', 'gallery__item');
          galleryItem.dataset.contentImageIndex = String(imageIndex);
          if (item.src) {
            var image = document.createElement('img');
            image.src = mediaPreviewUrl(item.src);
            image.alt = item.alt || '';
            image.loading = 'lazy';
            galleryItem.appendChild(image);
          } else {
            galleryItem.appendChild(storeProductDescriptionMediaPlaceholder());
          }
          if (item.caption) {
            var caption = createElement('span', 'gallery__item-caption');
            caption.appendChild(createElement('span', 'gallery__item-caption-text', item.caption));
            galleryItem.appendChild(caption);
          }
          storeProductDescriptionRenderGalleryImageSettings(galleryItem, context, block, index, imageIndex);
          container.appendChild(galleryItem);
        });
      } else {
        container.appendChild(storeProductDescriptionMediaPlaceholder());
      }
      card.appendChild(container);
      storeProductDescriptionAppendCaption(card, block, index);
      storeProductDescriptionRenderMediaSettings(card, context, block, index);
    } else if (block.type === 'video') {
      var provider = storeProductDescriptionVideoProvider(block.provider);
      if (provider === 'local' && block.src) {
        var videoWrap = createElement('div', 'video-embed video-embed--local');
        var video = document.createElement('video');
        video.controls = true;
        video.preload = 'none';
        video.playsInline = true;
        if (block.poster) video.poster = mediaPreviewUrl(block.poster);
        var source = document.createElement('source');
        source.src = mediaPreviewUrl(block.src);
        video.appendChild(source);
        videoWrap.appendChild(video);
        card.appendChild(videoWrap);
      } else if (block.video_id) {
        card.appendChild(storeProductDescriptionExternalLink(storeProductDescriptionVideoUrl(block), (provider === 'vimeo' ? 'Vimeo' : 'YouTube') + ': ' + block.video_id));
      } else {
        card.appendChild(storeProductDescriptionMediaPlaceholder());
      }
      storeProductDescriptionAppendCaption(card, block, index);
      storeProductDescriptionRenderMediaSettings(card, context, block, index);
    } else if (block.type === 'audio') {
      var audioWrap = createElement('div', 'audio-player');
      if (block.title) audioWrap.appendChild(createElement('span', 'audio-player__title', block.title));
      if (block.src) {
        var audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'metadata';
        var audioSource = document.createElement('source');
        audioSource.src = mediaPreviewUrl(block.src);
        audio.appendChild(audioSource);
        audioWrap.appendChild(audio);
      } else {
        audioWrap.appendChild(storeProductDescriptionMediaPlaceholder());
      }
      card.appendChild(audioWrap);
      storeProductDescriptionAppendCaption(card, block, index);
      storeProductDescriptionRenderMediaSettings(card, context, block, index);
    } else if (block.type === 'embed') {
      card.appendChild(block.src ? storeProductDescriptionExternalLink(block.src, block.title || block.provider || 'Embedded content') : storeProductDescriptionMediaPlaceholder());
      storeProductDescriptionAppendCaption(card, block, index);
      storeProductDescriptionRenderMediaSettings(card, context, block, index);
    }
  }

  function storeProductDescriptionInsertControl(index) {
    var wrap = createElement('div', 'admin-content-insert');
    var button = createElement('button', 'admin-content-insert__button', '+');
    button.type = 'button';
    button.dataset.contentAction = 'insert-block';
    button.dataset.contentIndex = String(index);
    button.setAttribute('aria-label', 'Add content block');
    wrap.appendChild(button);
    return wrap;
  }

  function storeProductDescriptionRenderBlocks(context, focusIndex) {
    var root = context.root;
    context.blocks = context.blocks && context.blocks.length ? context.blocks.map(storeProductDescriptionNormalizeBlock) : [storeProductDescriptionDefaultBlock('text')];
    root.replaceChildren();
    root.__storeProductDescriptionContext = context;
    root.__storeProductDescriptionBlocks = context.blocks;
    root.appendChild(storeProductDescriptionInsertControl(0));
    context.blocks.forEach(function(block, index) {
      if (index > 0) root.appendChild(storeProductDescriptionInsertControl(index));
      var card = document.createElement(storeProductDescriptionBlockElement(block.type));
      card.className = 'admin-content-block content-block content-block--' + block.type + ' content-block--align-' + storeProductDescriptionAlignment(block.align) + (block.type === 'gallery' ? ' gallery--' + storeProductDescriptionGalleryLayout(block.layout) + ' gallery--caption-' + storeProductDescriptionGalleryCaptionStyle(block.caption_style) : '');
      card.dataset.contentIndex = String(index);
      card.appendChild(storeProductDescriptionCreateChrome(context, block, index));
      storeProductDescriptionRenderBlockBody(card, context, block, index);
      root.appendChild(card);
    });
    root.appendChild(storeProductDescriptionInsertControl(context.blocks.length));
    storeProductDescriptionSync(context);
    storeProductDescriptionSyncChrome(root);
    if (typeof focusIndex === 'number') {
      var focusTarget = root.querySelector('[data-content-index="' + focusIndex + '"][data-content-field]');
      if (focusTarget) focusTarget.focus();
    }
  }

  function storeProductDescriptionSetChromeInteractive(chrome, active) {
    if (!(chrome instanceof HTMLElement)) return;
    chrome.setAttribute('aria-hidden', active ? 'false' : 'true');
    chrome.querySelectorAll('button, input, select, textarea').forEach(function(control) {
      if (!(control instanceof HTMLElement)) return;
      if (active) control.removeAttribute('tabindex');
      else control.tabIndex = -1;
    });
  }

  function storeProductDescriptionSyncChrome(root) {
    if (!(root instanceof HTMLElement)) return;
    root.querySelectorAll('.admin-content-block').forEach(function(block) {
      storeProductDescriptionSetChromeInteractive(block.querySelector('[data-content-chrome]'), block.classList.contains('is-active'));
    });
  }

  function storeProductDescriptionContext(root) {
    return root && root.__storeProductDescriptionContext || null;
  }

  function storeProductDescriptionEditableForNode(context, node) {
    var element = node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
    var editable = element && element.closest ? element.closest('[contenteditable="true"][data-content-field]') : null;
    return editable instanceof HTMLElement && context.root.contains(editable) ? editable : null;
  }

  function storeProductDescriptionLinkForNode(context, node) {
    var element = node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
    var link = element && element.closest ? element.closest('a') : null;
    return link instanceof HTMLAnchorElement && context.root.contains(link) ? link : null;
  }

  function storeProductDescriptionSelectedEditable(context) {
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    return storeProductDescriptionEditableForNode(context, selection.anchorNode)
      || storeProductDescriptionEditableForNode(context, selection.focusNode)
      || storeProductDescriptionEditableForNode(context, selection.getRangeAt(0).commonAncestorContainer);
  }

  function storeProductDescriptionSelectedLink(context) {
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    return storeProductDescriptionLinkForNode(context, selection.anchorNode)
      || storeProductDescriptionLinkForNode(context, selection.focusNode)
      || storeProductDescriptionLinkForNode(context, selection.getRangeAt(0).commonAncestorContainer);
  }

  function storeProductDescriptionActivateBlock(context, node) {
    var element = node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
    var block = element && element.closest ? element.closest('.admin-content-block') : null;
    context.root.querySelectorAll('.admin-content-block.is-active').forEach(function(item) {
      if (item !== block) item.classList.remove('is-active');
    });
    if (block instanceof HTMLElement && context.root.contains(block)) block.classList.add('is-active');
    storeProductDescriptionSyncChrome(context.root);
  }

  function storeProductDescriptionClosePanels(context) {
    context.root.querySelectorAll('[data-content-media-settings], [data-content-gallery-image-settings]').forEach(function(panel) {
      panel.hidden = true;
    });
    context.root.querySelectorAll('[data-content-action="toggle-media-settings"], [data-content-action="toggle-gallery-image-settings"]').forEach(function(button) {
      button.setAttribute('aria-expanded', 'false');
    });
  }

  function storeProductDescriptionToggleSettings(context, button) {
    if (!(button instanceof HTMLButtonElement)) return;
    var panelId = button.getAttribute('aria-controls');
    var panel = panelId ? document.getElementById(panelId) : null;
    if (!(panel instanceof HTMLElement)) return;
    var opening = panel.hidden;
    storeProductDescriptionClosePanels(context);
    panel.hidden = !opening;
    button.setAttribute('aria-expanded', opening ? 'true' : 'false');
    if (opening) {
      var first = panel.querySelector('input, select, textarea, button, [tabindex]:not([tabindex="-1"])');
      if (first) first.focus();
    }
  }

  function storeProductDescriptionTextFormatForNode(node, editable) {
    var element = node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
    var block = element && element.closest ? element.closest('p,h2,h3,h4') : null;
    if (block instanceof HTMLElement && editable && editable.contains(block)) {
      var tag = block.tagName.toLowerCase();
      return storeProductDescriptionTextFormats.indexOf(tag) >= 0 ? tag : 'p';
    }
    return 'p';
  }

  function storeProductDescriptionSelectedTextFormat(context, editable) {
    var selection = window.getSelection();
    if (!(editable instanceof HTMLElement) || !selection || !selection.rangeCount) return 'p';
    var range = selection.getRangeAt(0);
    if (selection.isCollapsed) return storeProductDescriptionTextFormatForNode(selection.focusNode, editable);
    var formats = [];
    editable.querySelectorAll('p,h2,h3,h4').forEach(function(block) {
      try {
        if (range.intersectsNode(block)) formats.push(block.tagName.toLowerCase());
      } catch (_error) {
      }
    });
    if (!formats.length) formats.push(storeProductDescriptionTextFormatForNode(range.commonAncestorContainer, editable));
    var unique = Array.from(new Set(formats.filter(function(format) {
      return storeProductDescriptionTextFormats.indexOf(format) >= 0;
    })));
    return unique.length > 1 ? 'multiple' : unique[0] || 'p';
  }

  function storeProductDescriptionUpdateFormatState(context) {
    var editable = storeProductDescriptionSelectedEditable(context) || context.activeEditable;
    var activeIndex = editable && editable.dataset ? editable.dataset.contentIndex : '';
    var activeLink = storeProductDescriptionSelectedLink(context) || context.activeLink;
    var commands = {
      'format-bold': 'bold',
      'format-italic': 'italic',
      'format-underline': 'underline',
      'format-unordered-list': 'insertUnorderedList',
      'format-ordered-list': 'insertOrderedList'
    };
    Object.keys(commands).forEach(function(action) {
      context.root.querySelectorAll('[data-content-action="' + action + '"]').forEach(function(button) {
        var active = false;
        if (button instanceof HTMLButtonElement && button.dataset.contentIndex === activeIndex && editable && (editable.dataset.contentField === 'body' || action.indexOf('list') < 0)) {
          try {
            active = document.queryCommandState(commands[action]);
          } catch (_error) {
            active = false;
          }
        }
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    });
    context.root.querySelectorAll('[data-content-action="format-link"]').forEach(function(button) {
      var active = button instanceof HTMLButtonElement && button.dataset.contentIndex === activeIndex && !!activeLink;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    context.root.querySelectorAll('[data-content-action="format-block"]').forEach(function(select) {
      if (!(select instanceof HTMLSelectElement)) return;
      if (select.dataset.contentIndex === activeIndex && editable && editable.dataset.contentField === 'body') {
        select.value = storeProductDescriptionSelectedTextFormat(context, editable);
      } else if (select.value === 'multiple') {
        select.value = 'p';
      }
    });
  }

  function storeProductDescriptionUpdateActiveEditable(context) {
    var active = document.activeElement;
    if (active instanceof HTMLElement && active.isContentEditable && context.root.contains(active)) {
      context.activeEditable = active;
      storeProductDescriptionActivateBlock(context, active);
    }
    storeProductDescriptionUpdateLinkPanel(context);
    storeProductDescriptionUpdateFormatState(context);
  }

  function storeProductDescriptionUpdateLinkPanel(context) {
    var selected = storeProductDescriptionSelectedLink(context);
    var link = selected || context.activeLink;
    context.root.querySelectorAll('[data-content-link-panel]').forEach(function(panel) {
      panel.hidden = true;
    });
    if (!(link instanceof HTMLAnchorElement) || !link.isConnected || !context.root.contains(link)) {
      context.activeLink = null;
      return;
    }
    context.activeLink = link;
    var editable = storeProductDescriptionEditableForNode(context, link);
    if (!editable) return;
    var panel = context.root.querySelector('[data-content-link-panel="' + editable.dataset.contentIndex + '"]');
    var input = panel && panel.querySelector('[data-content-action="link-url"]');
    if (panel instanceof HTMLElement && input instanceof HTMLInputElement) {
      input.value = link.getAttribute('href') || '';
      panel.hidden = false;
    }
  }

  function storeProductDescriptionUpdateBlockField(context, control) {
    var index = Number(control && control.dataset && control.dataset.contentIndex);
    var field = control && control.dataset && control.dataset.contentField || '';
    var block = context.blocks[index];
    if (!block || !field) return;
    if (control.dataset.contentImageIndex !== undefined && block.type === 'gallery') {
      var imageIndex = Number(control.dataset.contentImageIndex);
      if (!Number.isInteger(imageIndex) || !block.images[imageIndex]) return;
      block.images[imageIndex][field] = control.value;
    } else if (field === 'provider') {
      block.provider = block.type === 'video' ? storeProductDescriptionVideoProvider(control.value) : String(control.value || '');
      storeProductDescriptionRenderBlocks(context, index);
      return;
    } else if (control.isContentEditable) {
      block[field] = field === 'body' ? storeProductEditorHtmlToMarkdown(control) : storeProductEditorNodeToMarkdown(control).trim();
    } else {
      block[field] = control.value;
    }
    storeProductDescriptionSync(context);
  }

  function storeProductDescriptionApplyFormat(context, action, value) {
    storeProductDescriptionUpdateActiveEditable(context);
    var control = context.activeEditable;
    if (!(control instanceof HTMLElement) || !control.isContentEditable) return;
    control.focus();
    try {
      document.execCommand(action, false, value || null);
    } catch (_error) {
    }
    storeProductDescriptionUpdateBlockField(context, control);
    storeProductDescriptionUpdateFormatState(context);
  }

  function storeProductDescriptionApplyLink(context) {
    storeProductDescriptionUpdateActiveEditable(context);
    var control = context.activeEditable;
    if (!(control instanceof HTMLElement) || !control.isContentEditable) return;
    control.focus();
    var existing = storeProductDescriptionSelectedLink(context);
    var href = window.prompt('Paste a URL for this link', existing ? existing.getAttribute('href') || '' : '');
    if (href === null) return;
    href = String(href || '').trim();
    if (!isSafeStoreProductEditorHref(href)) {
      setStatus(context.status, 'Links must start with http://, https://, mailto:, /, or #.', true);
      return;
    }
    var selection = window.getSelection();
    if (existing) {
      existing.setAttribute('href', href);
      context.activeLink = existing;
    } else if (!selection || selection.isCollapsed) {
      document.execCommand('insertHTML', false, '<a href="' + escapeStoreProductEditorAttribute(href) + '">' + escapeStoreProductEditorHtml(href) + '</a>');
    } else {
      document.execCommand('createLink', false, href);
    }
    storeProductDescriptionUpdateBlockField(context, control);
    storeProductDescriptionUpdateLinkPanel(context);
  }

  function storeProductDescriptionApplyLinkPanel(context, input) {
    var link = context.activeLink || storeProductDescriptionSelectedLink(context);
    var editable = storeProductDescriptionEditableForNode(context, link);
    if (!(input instanceof HTMLInputElement) || !(link instanceof HTMLAnchorElement) || !editable) return;
    var href = input.value.trim();
    if (!isSafeStoreProductEditorHref(href)) {
      setStatus(context.status, 'Links must start with http://, https://, mailto:, /, or #.', true);
      input.value = link.getAttribute('href') || '';
      return;
    }
    link.setAttribute('href', href);
    context.activeLink = link;
    storeProductDescriptionUpdateBlockField(context, editable);
    storeProductDescriptionUpdateLinkPanel(context);
  }

  function storeProductDescriptionRemoveLink(context) {
    var link = context.activeLink || storeProductDescriptionSelectedLink(context);
    var editable = storeProductDescriptionEditableForNode(context, link);
    if (!(link instanceof HTMLAnchorElement) || !editable) return;
    var fragment = document.createDocumentFragment();
    while (link.firstChild) fragment.appendChild(link.firstChild);
    link.replaceWith(fragment);
    context.activeLink = null;
    storeProductDescriptionUpdateBlockField(context, editable);
    storeProductDescriptionUpdateLinkPanel(context);
  }

  function storeProductDescriptionUploadTarget(context, control) {
    var index = Number(control.dataset.contentIndex);
    var block = context.blocks[index];
    if (!block) return null;
    if (control.dataset.contentAction === 'add-gallery-image-upload') {
      if (block.type !== 'gallery') return null;
      if (!Array.isArray(block.images)) block.images = [];
      var image = { src: '', alt: '', caption: '' };
      block.images.push(image);
      return { block: block, target: image, index: index, imageIndex: block.images.length - 1 };
    }
    if (control.dataset.contentImageIndex !== undefined && block.type === 'gallery') {
      var imageIndex = Number(control.dataset.contentImageIndex);
      if (!Number.isInteger(imageIndex) || !block.images[imageIndex]) return null;
      return { block: block, target: block.images[imageIndex], index: index, imageIndex: imageIndex };
    }
    return { block: block, target: block, index: index };
  }

  function storeProductDescriptionApplyMediaPath(context, control, path, label) {
    var target = storeProductDescriptionUploadTarget(context, control);
    if (!target || !path) return;
    target.target.src = path;
    if (!target.target.alt) target.target.alt = label || context.product.name || 'Product image';
    storeProductDescriptionRenderBlocks(context, target.index);
    setStatus(context.status, 'Image selected.');
  }

  function storeProductDescriptionSelectUpload(context, control) {
    if (!(control instanceof HTMLInputElement)) return;
    var file = control.files && control.files[0];
    if (!file) return;
    var target = storeProductDescriptionUploadTarget(context, control);
    if (!target) {
      control.value = '';
      updateAdminFilePickerFilename(control);
      return;
    }
    uploadStoreProductImage(context.product, file, context.status).then(function(path) {
      target.target.src = path;
      if (!target.target.alt) target.target.alt = file.name || context.product.name || 'Product image';
      storeProductDescriptionRenderBlocks(context, target.index);
    }).catch(function(error) {
      logger.error('Failed to upload Store product description media', error);
      setStatus(context.status, formatError(error), true);
    }).finally(function() {
      control.value = '';
      updateAdminFilePickerFilename(control);
    });
  }

  function storeProductDescriptionOpenMediaLibrary(context, button) {
    context.library.hidden = !context.library.hidden;
    if (context.library.hidden) return;
    loadStoreProductMediaLibrary(context.product, context.library, context.status, function(item) {
      storeProductDescriptionApplyMediaPath(context, button, item.path || '', item.label || context.product.name);
      context.library.hidden = true;
    });
  }

  function storeProductDescriptionInsertSlashBlock(context, control) {
    var index = Number(control.dataset.contentIndex);
    if (!context.blocks[index] || control.dataset.contentField !== 'body') return false;
    var value = storeProductEditorHtmlToMarkdown(control);
    var match = value.match(new RegExp('(?:^|\\n|\\s)/(?:' + storeProductDescriptionBlockTypes.join('|') + ')(?=\\s*$|\\n)', 'i'));
    if (!match) return false;
    var type = storeProductDescriptionBlockCommand((match[0].match(/\/([a-z]+)/i) || [])[1] || 'text');
    var start = match.index + match[0].indexOf('/');
    var end = match.index + match[0].length;
    var before = value.slice(0, start).replace(/\s+$/, '');
    var after = value.slice(end).replace(/^\s+/, '');
    var align = storeProductDescriptionAlignment(context.blocks[index].align);
    var insertAt = index;
    if (before) {
      context.blocks[index].body = before;
      insertAt = index + 1;
    } else {
      context.blocks.splice(index, 1);
    }
    context.blocks.splice(insertAt, 0, storeProductDescriptionDefaultBlock(type));
    if (after) context.blocks.splice(insertAt + 1, 0, { type: 'text', body: after, align: align });
    storeProductDescriptionRenderBlocks(context, insertAt);
    return true;
  }

  function storeProductDescriptionAttach(root) {
    if (!(root instanceof HTMLElement) || root.dataset.storeProductDescriptionAttached === 'true') return;
    root.dataset.storeProductDescriptionAttached = 'true';
    document.addEventListener('pointerdown', function(event) {
      var context = storeProductDescriptionContext(root);
      if (!context) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      storeProductDescriptionClosePanels(context);
      root.querySelectorAll('.admin-content-block.is-active').forEach(function(item) { item.classList.remove('is-active'); });
      storeProductDescriptionSyncChrome(root);
    });
    root.addEventListener('focusin', function() {
      var context = storeProductDescriptionContext(root);
      if (context) storeProductDescriptionUpdateActiveEditable(context);
    });
    ['mouseup', 'keyup'].forEach(function(eventName) {
      root.addEventListener(eventName, function() {
        var context = storeProductDescriptionContext(root);
        if (context) {
          storeProductDescriptionUpdateLinkPanel(context);
          storeProductDescriptionUpdateFormatState(context);
        }
      });
    });
    root.addEventListener('pointerdown', function(event) {
      var context = storeProductDescriptionContext(root);
      if (!context) return;
      var settingsButton = event.target && event.target.closest && event.target.closest('[data-content-action="toggle-media-settings"], [data-content-action="toggle-gallery-image-settings"]');
      if (settingsButton) {
        event.preventDefault();
        event.stopPropagation();
        storeProductDescriptionToggleSettings(context, settingsButton);
        return;
      }
      if (!(event.target && event.target.closest && event.target.closest('[data-content-media-settings], [data-content-gallery-image-settings]'))) {
        storeProductDescriptionClosePanels(context);
      }
      storeProductDescriptionActivateBlock(context, event.target);
    });
    root.addEventListener('input', function(event) {
      var context = storeProductDescriptionContext(root);
      if (!context) return;
      var control = event.target;
      if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement || control instanceof HTMLElement && (control.isContentEditable || control.dataset.contentField)) {
        storeProductDescriptionUpdateBlockField(context, control);
      }
    });
    root.addEventListener('change', function(event) {
      var context = storeProductDescriptionContext(root);
      if (!context) return;
      var control = event.target;
      if (control instanceof HTMLSelectElement && control.dataset.contentAction === 'type') {
        var index = Number(control.dataset.contentIndex);
        var previous = context.blocks[index] || storeProductDescriptionDefaultBlock('text');
        var next = storeProductDescriptionDefaultBlock(control.value);
        next.align = storeProductDescriptionAlignment(previous.align);
        if (previous.type === 'text' && next.type === 'quote') next.text = previous.body || '';
        if (previous.type === 'quote' && next.type === 'text') next.body = previous.text || '';
        context.blocks[index] = next;
        storeProductDescriptionRenderBlocks(context, index);
      } else if (control instanceof HTMLSelectElement && control.dataset.contentAction === 'format-block') {
        var tag = storeProductDescriptionTextFormats.indexOf(control.value) >= 0 ? control.value : 'p';
        storeProductDescriptionApplyFormat(context, 'formatBlock', tag);
      } else if (control instanceof HTMLInputElement && ['select-media-upload', 'add-gallery-image-upload'].indexOf(control.dataset.contentAction || '') >= 0) {
        storeProductDescriptionSelectUpload(context, control);
      } else if (control instanceof HTMLInputElement && control.dataset.contentAction === 'link-url') {
        storeProductDescriptionApplyLinkPanel(context, control);
      } else if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
        storeProductDescriptionUpdateBlockField(context, control);
        if (control.dataset.contentField === 'layout' || control.dataset.contentField === 'caption_style') {
          storeProductDescriptionRenderBlocks(context, Number(control.dataset.contentIndex));
        }
      }
    });
    root.addEventListener('click', function(event) {
      var context = storeProductDescriptionContext(root);
      if (!context) return;
      var link = event.target && event.target.closest && event.target.closest('a');
      if (link instanceof HTMLAnchorElement && storeProductDescriptionEditableForNode(context, link)) {
        event.preventDefault();
        context.activeLink = link;
        storeProductDescriptionUpdateLinkPanel(context);
        storeProductDescriptionUpdateFormatState(context);
      }
      var button = event.target && event.target.closest && event.target.closest('[data-content-action]');
      if (!(button instanceof HTMLButtonElement)) return;
      var index = Number(button.dataset.contentIndex);
      var action = button.dataset.contentAction;
      if (action === 'format-bold') storeProductDescriptionApplyFormat(context, 'bold');
      else if (action === 'format-italic') storeProductDescriptionApplyFormat(context, 'italic');
      else if (action === 'format-underline') storeProductDescriptionApplyFormat(context, 'underline');
      else if (action === 'format-link') storeProductDescriptionApplyLink(context);
      else if (action === 'format-unordered-list') storeProductDescriptionApplyFormat(context, 'insertUnorderedList');
      else if (action === 'format-ordered-list') storeProductDescriptionApplyFormat(context, 'insertOrderedList');
      else if (action === 'link-apply') storeProductDescriptionApplyLinkPanel(context, button.closest('[data-content-link-panel]').querySelector('[data-content-action="link-url"]'));
      else if (action === 'link-remove') storeProductDescriptionRemoveLink(context);
      else if (action === 'choose-media-library') storeProductDescriptionOpenMediaLibrary(context, button);
      else if (action === 'align') {
        if (context.blocks[index]) context.blocks[index].align = storeProductDescriptionAlignment(button.dataset.contentAlign);
        storeProductDescriptionRenderBlocks(context, index);
      } else if (action === 'insert-block') {
        context.blocks.splice(Math.max(0, Math.min(index, context.blocks.length)), 0, storeProductDescriptionDefaultBlock('text'));
        storeProductDescriptionRenderBlocks(context, index);
      } else if (action === 'up' && index > 0) {
        var previous = context.blocks[index - 1];
        context.blocks[index - 1] = context.blocks[index];
        context.blocks[index] = previous;
        storeProductDescriptionRenderBlocks(context, index - 1);
      } else if (action === 'down' && index < context.blocks.length - 1) {
        var next = context.blocks[index + 1];
        context.blocks[index + 1] = context.blocks[index];
        context.blocks[index] = next;
        storeProductDescriptionRenderBlocks(context, index + 1);
      } else if (action === 'delete' && context.blocks.length > 1) {
        context.blocks.splice(index, 1);
        storeProductDescriptionRenderBlocks(context, Math.max(0, index - 1));
      }
    });
    root.addEventListener('keydown', function(event) {
      var context = storeProductDescriptionContext(root);
      if (!context) return;
      var control = event.target;
      if (control instanceof HTMLInputElement && control.dataset.contentAction === 'link-url' && event.key === 'Enter') {
        storeProductDescriptionApplyLinkPanel(context, control);
        event.preventDefault();
        return;
      }
      if (event.key === 'Escape') {
        var panel = control instanceof HTMLElement ? control.closest('[data-content-media-settings], [data-content-gallery-image-settings]') : null;
        if (panel instanceof HTMLElement) {
          panel.hidden = true;
          event.preventDefault();
          return;
        }
      }
      if (!(control instanceof HTMLElement) || !control.isContentEditable || event.key !== 'Enter') return;
      if (storeProductDescriptionInsertSlashBlock(context, control)) event.preventDefault();
    });
    root.addEventListener('paste', function(event) {
      var context = storeProductDescriptionContext(root);
      if (!context) return;
      var control = event.target;
      if (!(control instanceof HTMLElement) || !control.isContentEditable) return;
      var sanitized = sanitizedStoreProductClipboardHtml(event);
      if (!sanitized) return;
      event.preventDefault();
      insertStoreProductEditorHtml(control, sanitized, true);
      control.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function createStoreProductDescriptionEditor(product) {
    var wrapper = createElement('div', 'admin-store-products__field admin-store-products__field--wide admin-store-products__description-editor');
    var header = createElement('div', 'admin-store-products__description-header');
    var label = createElement('label', '');
    var textareaId = 'store-product-description-' + String(product.productId || '').replace(/[^a-z0-9_-]+/gi, '-');
    var textarea = document.createElement('textarea');
    var longContentField = document.createElement('textarea');
    var editor = createElement('div', 'admin-store-products__description-blocks admin-content__blocks long-content');
    var status = createElement('span', 'admin-settings__image-status', '');
    var library = createElement('div', 'admin-store-products__media-library');

    label.setAttribute('for', textareaId);
    textarea.id = textareaId;
    textarea.rows = 9;
    textarea.value = product.description || '';
    textarea.className = 'admin-settings__input';
    textarea.dataset.storeProductField = 'description';
    textarea.dataset.storeProductDescriptionSource = 'true';
    textarea.hidden = true;
    longContentField.dataset.storeProductField = 'longContent';
    longContentField.dataset.storeProductLongContentSource = 'true';
    longContentField.hidden = true;
    longContentField.value = JSON.stringify(storeProductDescriptionSerializableBlocks(storeProductDescriptionBlocksFromProduct(product)));

    library.hidden = true;
    editor.dataset.storeProductDescriptionEditor = 'true';
    editor.dataset.contentEditorId = 'store-product-description-' + String(++storeProductDescriptionEditorCounter);
    editor.setAttribute('aria-label', 'Product description blocks');
    var context = {
      id: editor.dataset.contentEditorId,
      product: product,
      root: editor,
      descriptionField: textarea,
      longContentField: longContentField,
      status: status,
      library: library,
      blocks: storeProductDescriptionBlocksFromProduct(product),
      activeEditable: null,
      activeLink: null
    };
    editor.__storeProductDescriptionContext = context;
    storeProductDescriptionAttach(editor);
    storeProductDescriptionRenderBlocks(context);

    label.appendChild(createStoreProductFieldLabel('Description', 'description', textarea));
    header.appendChild(label);
    wrapper.appendChild(header);
    wrapper.appendChild(status);
    wrapper.appendChild(editor);
    wrapper.appendChild(textarea);
    wrapper.appendChild(longContentField);
    wrapper.appendChild(library);
    return wrapper;
  }

  function createStoreProductPreviewPanel() {
    var preview = createElement('div', 'admin-store-products__preview');
    var previewHeader = createElement('div', 'admin-store-products__preview-header');
    var previewStatus = createElement('span', 'admin-dashboard__status admin-store-products__preview-status', '');
    var frame = document.createElement('iframe');
    frame.title = 'Product preview';
    frame.dataset.storeProductPreviewFrame = 'true';
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.addEventListener('load', function() {
      repairStoreProductPreviewFrameImages(frame);
    });
    previewHeader.appendChild(createStoreProductFieldLabel('Preview', 'preview', frame));
    preview.appendChild(previewHeader);
    preview.appendChild(previewStatus);
    preview.appendChild(frame);
    return preview;
  }

  function storeProductPreviewHtmlWithBase(html) {
    var markup = sanitizeStoreProductPreviewHtml(html);
    if (!markup) return markup;
    var base = storeProductPreviewBaseUrl();
    var previewOrigin = storeProductPreviewOrigin(base);
    [
      storeMarketingBaseUrl(),
      script && script.dataset ? script.dataset.canonicalSiteUrl : '',
      storeProductPreviewReturnedBaseOrigin(markup)
    ].map(storeProductPreviewOrigin).filter(Boolean).forEach(function(origin, index, origins) {
      if (!previewOrigin || origin === previewOrigin || origins.indexOf(origin) !== index) return;
      markup = markup.replace(new RegExp(escapeStoreProductRegExp(origin + '/'), 'g'), previewOrigin + '/');
    });
    var baseTag = '<base href="' + escapeStoreProductEditorAttribute(normalizeBase(base) + '/') + '">';
    if (/<base\b[^>]*>/i.test(markup)) {
      return markup.replace(/<base\b[^>]*>/i, baseTag);
    }
    if (/<head[^>]*>/i.test(markup)) {
      return markup.replace(/<head([^>]*)>/i, '<head$1>' + baseTag);
    }
    return baseTag + markup;
  }

  function sanitizeStoreProductPreviewHtml(html) {
    var markup = stripStoreProductPreviewScripts(String(html || ''));
    if (!markup) return '';
    if (typeof DOMParser === 'undefined') {
      return stripStoreProductPreviewScripts(markup);
    }
    var parsed = new DOMParser().parseFromString(markup, 'text/html');
    sanitizeStoreProductPreviewDocument(parsed);
    return '<!doctype html>\n' + stripStoreProductPreviewScripts(parsed.documentElement.outerHTML);
  }

  function sanitizeStoreProductPreviewDocument(doc) {
    if (!doc) return;
    doc.querySelectorAll('script').forEach(function(node) {
      node.remove();
    });
    doc.querySelectorAll('*').forEach(function(node) {
      Array.from(node.attributes || []).forEach(function(attribute) {
        var name = String(attribute.name || '').toLowerCase();
        var value = String(attribute.value || '').trim().toLowerCase();
        var scriptUrlAttribute = ['href', 'src', 'xlink:href', 'action', 'formaction'].indexOf(name) >= 0;
        if (name.indexOf('on') === 0 || (scriptUrlAttribute && value.indexOf('javascript:') === 0)) {
          node.removeAttribute(attribute.name);
        }
      });
    });
  }

  function stripStoreProductPreviewScripts(html) {
    return String(html || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<script\b[^>]*\/?>/gi, '');
  }

  function refreshStoreProductPreview(form) {
    if (!form) return Promise.resolve();
    var frame = $('[data-store-product-preview-frame]', form);
    var status = $('.admin-store-products__preview-status', form);
    if (!frame) return Promise.resolve();
    setStatus(status, 'Rendering preview...');
    var body = readStoreProductEditor(form, 'preview');
    var requestId = String(++storeProductPreviewRequestCounter);
    form.dataset.storeProductPreviewRequest = requestId;
    return requestJson('/admin/store/products/preview', {
      method: 'POST',
      body: body
    }).then(function(data) {
      if (form.dataset.storeProductPreviewRequest !== requestId) return;
      var html = data && data.preview ? data.preview.html : '';
      if (!html) throw new Error('Preview did not return HTML.');
      frame.srcdoc = storeProductPreviewHtmlWithBase(html);
      window.setTimeout(function() {
        repairStoreProductPreviewFrameImages(frame);
      }, 0);
      setStatus(status, 'Preview updated.');
    }).catch(function(error) {
      if (form.dataset.storeProductPreviewRequest !== requestId) return;
      setStatus(status, formatError(error), true);
    });
  }

  function scheduleStoreProductPreview(form, delay) {
    if (!form || !$('[data-store-product-preview-frame]', form)) return;
    var key = form.dataset.storeProductEditor || 'product';
    if (storeProductPreviewTimers.has(key)) {
      window.clearTimeout(storeProductPreviewTimers.get(key));
    }
    storeProductPreviewTimers.set(key, window.setTimeout(function() {
      storeProductPreviewTimers.delete(key);
      refreshStoreProductPreview(form);
    }, delay === undefined ? 500 : delay));
  }

  function renderStoreProductEditor(product) {
    var isNewProduct = product && product.isNew === true;
    var form = createElement('form', 'admin-store-products__editor');
    form.dataset.storeProductEditor = product.productId || '';
    if (isNewProduct) form.dataset.storeProductNew = 'true';
    form.dataset.storeProductActionLabel = isNewProduct ? 'Create product' : 'Publish product';
    form.appendChild(createElement('h3', 'admin-store-products__editor-title', isNewProduct ? 'Create product' : product.name || product.productId || 'Product'));
    var fields = createElement('div', 'admin-store-products__editor-fields');
    var fulfillmentValue = product.fulfillmentType || 'physical';
    var basics = createElement('div', 'admin-store-products__editor-section admin-store-products__editor-section--basics');
    var commerce = createElement('div', 'admin-store-products__editor-section admin-store-products__editor-section--commerce');
    var eventDetails = createElement('div', 'admin-store-products__editor-section admin-store-products__editor-section--event');
    var mediaDescription = createElement('div', 'admin-store-products__editor-section admin-store-products__editor-section--media-description');
    basics.appendChild(productField('Name', 'name', product.name || '', 'text', { noHelp: true, required: true }));
    basics.appendChild(productField('Price (USD)', 'price', productPrice(product), 'number', { step: '0.01', min: '0' }));
    basics.appendChild(productField('Status', 'status', product.status || 'active', 'select', {
      options: [['active', 'Active'], ['draft', 'Draft'], ['archived', 'Archived'], ['sold_out', 'Sold out']]
    }));
    basics.appendChild(productField('Fulfillment', 'fulfillmentType', fulfillmentValue, 'select', {
      options: [['physical', 'Physical'], ['digital', 'Digital'], ['ticket', 'Ticket'], ['rsvp', 'RSVP']]
    }));
    commerce.appendChild(createStoreProductReadonlyField('SKU', 'sku', product.sku || product.productId || ''));
    commerce.appendChild(productField('File', 'downloadFileKey', product.downloadFileKey || '', 'select', {
      options: downloadFileOptions(product.downloadFileKey, product.downloadFilename)
    }));
    commerce.appendChild(productField('Shipping preset', 'shippingPreset', product.shippingPreset || '', 'select', {
      options: shippingPresetOptions(product.shippingPreset || '')
    }));
    commerce.appendChild(productField('Tax category', 'taxCategory', normalizeStoreProductTaxCategory(product.taxCategory, fulfillmentValue), 'select', {
      options: taxCategoryOptions()
    }));
    commerce.appendChild(createStoreProductVariantModeField(product));
    commerce.appendChild(productField('Inventory Tracker', 'inventoryTracking', product.inventoryTracking ? 'true' : 'false', 'select', {
      options: [['true', 'Yes'], ['false', 'No']]
    }));
    commerce.appendChild(productField('Inventory', 'inventory', product.inventory ?? '', 'number', { step: '1', min: '0' }));
    commerce.appendChild(productField('Calendar', 'eventIcs', product.eventIcs === false ? 'false' : 'true', 'select', {
      options: [['true', 'Yes'], ['false', 'No']]
    }));
    eventDetails.appendChild(productField('Starts at', 'eventStartsAt', product.eventStartsAt || product.eventDetails?.startsAt || '', 'datetime-local'));
    eventDetails.appendChild(productField('Ends at', 'eventEndsAt', product.eventEndsAt || product.eventDetails?.endsAt || '', 'datetime-local'));
    eventDetails.appendChild(productField('Venue', 'eventVenue', product.eventVenue || product.eventDetails?.venue || '', 'text'));
    eventDetails.appendChild(createStoreProductEventAddressField(product));
    mediaDescription.appendChild(createStoreProductImageField(product));
    mediaDescription.appendChild(createStoreProductDescriptionEditor(product));
    fields.appendChild(basics);
    fields.appendChild(commerce);
    fields.appendChild(eventDetails);
    fields.appendChild(mediaDescription);
    form.appendChild(fields);
    form.appendChild(renderStoreProductVariants(product));
    form.appendChild(createStoreProductPreviewPanel());
    var fulfillmentControl = $('[data-store-product-field="fulfillmentType"]', form);
    if (fulfillmentControl) fulfillmentControl.dataset.previousFulfillmentType = fulfillmentControl.value;
    syncStoreProductFulfillmentDependentFields(form);
    syncStoreProductVariantsSection($('[data-store-product-variants]', form));
    var actions = createElement('div', 'admin-store-products__editor-actions');
    var publish = createElement('button', 'btn', form.dataset.storeProductActionLabel);
    publish.type = 'submit';
    publish.dataset.storeProductPublish = 'true';
    publish.disabled = true;
    var cancel = createElement('button', 'btn btn--secondary', 'Cancel');
    cancel.type = 'button';
    cancel.dataset.storeProductCancel = 'true';
    actions.appendChild(publish);
    actions.appendChild(cancel);
    form.appendChild(actions);
    if (isNewProduct) syncStoreProductDerivedSku(form);
    form.addEventListener('input', function(event) {
      if (event.target && event.target.dataset && event.target.dataset.storeVariantField === 'label') {
        updateStoreProductVariantDerivedFields(event.target.closest('[data-store-product-variant]'), currentStoreProductEditorProduct(form, product));
      }
      if (event.target && event.target.dataset && event.target.dataset.storeProductField === 'name') {
        syncStoreProductDerivedSku(form);
      }
      if (event.target.closest('[data-store-product-field], [data-store-variant-field]')) {
        scheduleStoreProductPreview(form);
      }
      updateStoreProductEditorDirtyState(form);
    });
    form.addEventListener('change', function(event) {
      if (event.target && event.target.dataset && event.target.dataset.storeProductField === 'fulfillmentType') {
        syncStoreProductTaxCategoryForFulfillment(form, event.target);
        syncStoreProductFulfillmentDependentFields(form);
      }
      if (event.target && event.target.dataset && event.target.dataset.storeProductField === 'inventoryTracking') {
        syncStoreProductFulfillmentDependentFields(form);
      }
      if (event.target && event.target.dataset && event.target.dataset.storeProductVariantsEnabled) {
        syncStoreProductFulfillmentDependentFields(form);
      }
      if (event.target.closest('[data-store-product-field], [data-store-variant-field]')) {
        scheduleStoreProductPreview(form, 150);
      }
      updateStoreProductEditorDirtyState(form);
    });
    form.addEventListener('click', function(event) {
      var lookup = event.target.closest('[data-store-product-address-lookup]');
      if (!lookup) return;
      event.preventDefault();
      lookupStoreProductEventAddress(lookup);
    });
    if (isNewProduct) updateStoreProductEditorDirtyState(form);
    else resetStoreProductEditorDirtyBaseline(form);
    window.setTimeout(function() {
      scheduleStoreProductPreview(form, 0);
    }, 0);
    return form;
  }

  function syncStoreProductTaxCategoryForFulfillment(form, fulfillmentControl) {
    var taxCategory = $('[data-store-product-field="taxCategory"]', form);
    if (!fulfillmentControl || !taxCategory) return;
    var previousFulfillment = fulfillmentControl.dataset.previousFulfillmentType || '';
    var previousDefault = defaultTaxCategoryForFulfillment(previousFulfillment);
    var nextDefault = defaultTaxCategoryForFulfillment(fulfillmentControl.value);
    if (!taxCategory.value || taxCategory.value === previousDefault) {
      taxCategory.value = nextDefault;
    }
    fulfillmentControl.dataset.previousFulfillmentType = fulfillmentControl.value;
  }

  function setStoreProductFieldVisible(form, field, visible) {
    var wrapper = $('[data-store-product-field-wrapper="' + field + '"]', form);
    var control = $('[data-store-product-field="' + field + '"]', form);
    if (wrapper) wrapper.hidden = !visible;
    if (control) control.disabled = !visible;
  }

  function syncStoreProductVariantInventoryVisible(form, visible) {
    $all('.admin-store-products__variants-table', form).forEach(function(table) {
      table.dataset.storeVariantInventoryVisible = visible ? 'true' : 'false';
    });
    $all('[data-store-product-variant-inventory-cell]', form).forEach(function(cell) {
      cell.hidden = !visible;
    });
    $all('[data-store-variant-field="inventory"]', form).forEach(function(input) {
      input.disabled = !visible;
    });
  }

  function syncStoreProductVariantDownloadVisible(form, visible) {
    $all('.admin-store-products__variants-table', form).forEach(function(table) {
      table.dataset.storeVariantDownloadVisible = visible ? 'true' : 'false';
    });
    $all('[data-store-product-variant-download-cell]', form).forEach(function(cell) {
      cell.hidden = !visible;
    });
    $all('[data-store-variant-field="downloadFileKey"]', form).forEach(function(input) {
      input.disabled = !visible;
    });
  }

  function syncStoreProductEditorSections(form) {
    $all('.admin-store-products__editor-section', form).forEach(function(section) {
      var hasVisibleFields = $all('[data-store-product-field-wrapper]', section).some(function(field) {
        return !field.hidden;
      });
      section.hidden = !hasVisibleFields;
    });
  }

  function syncStoreProductFulfillmentDependentFields(form) {
    var fulfillment = $('[data-store-product-field="fulfillmentType"]', form);
    var fulfillmentType = fulfillment ? fulfillment.value : 'physical';
    var physical = isPhysicalFulfillment(fulfillmentType);
    var digital = isDigitalFulfillment(fulfillmentType);
    var eventProduct = isEventFulfillment(fulfillmentType);
    var variantsEnabled = $('[data-store-product-variants-enabled]', form);
    var variantBased = variantsEnabled && variantsEnabled.value === 'true';
    var inventoryTracking = $('[data-store-product-field="inventoryTracking"]', form);
    var tracksInventory = !digital && (!inventoryTracking || inventoryTracking.value === 'true');
    setStoreProductFieldVisible(form, 'shippingPreset', physical);
    setStoreProductFieldVisible(form, 'downloadFileKey', digital && !variantBased);
    setStoreProductFieldVisible(form, 'inventoryTracking', !digital);
    setStoreProductFieldVisible(form, 'inventory', tracksInventory && !variantBased);
    setStoreProductFieldVisible(form, 'eventStartsAt', eventProduct);
    setStoreProductFieldVisible(form, 'eventEndsAt', eventProduct);
    setStoreProductFieldVisible(form, 'eventVenue', eventProduct);
    setStoreProductFieldVisible(form, 'eventAddress', eventProduct);
    setStoreProductFieldVisible(form, 'eventIcs', eventProduct);
    syncStoreProductVariantInventoryVisible(form, tracksInventory);
    syncStoreProductVariantDownloadVisible(form, digital && variantBased);
    syncStoreProductEditorSections(form);
  }

  function productField(labelText, field, value, type, options) {
    var opts = options || {};
    var label = createElement('label', 'admin-store-products__field');
    label.dataset.storeProductFieldWrapper = field;
    var input;
    if (type === 'select') {
      input = document.createElement('select');
      (opts.options || []).forEach(function(pair) {
        var option = document.createElement('option');
        var optionValue = Array.isArray(pair) ? pair[0] : pair.value;
        option.value = optionValue;
        option.textContent = Array.isArray(pair) ? pair[1] : pair.label;
        if (!Array.isArray(pair) && pair.filename !== undefined) option.dataset.filename = pair.filename;
        input.appendChild(option);
      });
      input.value = String(value);
    } else if (type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 5;
      input.value = value;
    } else {
      input = document.createElement('input');
      input.type = type;
      if (type === 'datetime-local') {
        input.value = storeProductDateTimeLocalValue(value);
        input.dataset.storeDateTimeOffset = storeProductDateTimeOffset(value);
        input.dataset.storeDateTimeInitialValue = input.value;
      } else {
        input.value = value;
      }
      if (opts.step) input.step = opts.step;
      if (opts.min) input.min = opts.min;
    }
    if (opts.required) input.required = true;
    input.className = 'admin-settings__input';
    input.dataset.storeProductField = field;
    label.appendChild(createStoreProductFieldLabel(labelText, field, input, opts.noHelp ? false : opts.help));
    label.appendChild(input);
    return label;
  }

  function createStoreProductEventAddressField(product) {
    var wrapper = createElement('div', 'admin-store-products__field admin-store-products__field--event-address');
    wrapper.dataset.storeProductFieldWrapper = 'eventAddress';
    var inputId = 'store-product-event-address-' + Math.random().toString(36).slice(2);
    var input = document.createElement('input');
    input.type = 'text';
    input.id = inputId;
    input.className = 'admin-settings__input';
    input.value = product.eventAddress || product.eventDetails?.address || '';
    input.dataset.storeProductField = 'eventAddress';
    var label = document.createElement('label');
    label.setAttribute('for', inputId);
    label.appendChild(createStoreProductFieldLabel('Address', 'eventAddress', input));
    var controls = createElement('div', 'admin-store-products__event-address-control');
    controls.appendChild(input);
    var lookup = createElement('button', 'btn btn--secondary btn--small', 'Find address');
    lookup.type = 'button';
    lookup.dataset.storeProductAddressLookup = 'true';
    controls.appendChild(lookup);
    var status = createElement('span', 'admin-app__muted admin-store-products__event-address-status', '');
    status.dataset.storeProductAddressStatus = 'true';
    wrapper.appendChild(label);
    wrapper.appendChild(controls);
    wrapper.appendChild(status);
    return wrapper;
  }

  async function lookupStoreProductEventAddress(button) {
    var form = button && button.closest('[data-store-product-editor]');
    if (!form) return;
    var addressInput = $('[data-store-product-field="eventAddress"]', form);
    var venueInput = $('[data-store-product-field="eventVenue"]', form);
    var status = $('[data-store-product-address-status]', form);
    var query = String(addressInput && addressInput.value || venueInput && venueInput.value || '').trim();
    if (!query) {
      if (status) status.textContent = 'Enter a venue or address first.';
      addressInput?.focus();
      return;
    }
    var cacheKey = query.replace(/\s+/g, ' ').trim().toLowerCase();
    if (storeProductAddressLookupCache.has(cacheKey)) {
      if (addressInput) {
        addressInput.value = storeProductAddressLookupCache.get(cacheKey);
        addressInput.dispatchEvent(new Event('input', { bubbles: true }));
        addressInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (status) status.textContent = 'Address found.';
      return;
    }
    button.disabled = true;
    if (status) status.textContent = 'Finding address...';
    try {
      var data = await requestJson('/admin/store/products/address-lookup', {
        params: { q: query }
      });
      var display = String(data.address || '').trim();
      if (!display) throw new Error('No matching address found.');
      storeProductAddressLookupCache.set(cacheKey, display);
      if (addressInput) {
        addressInput.value = display;
        addressInput.dispatchEvent(new Event('input', { bubbles: true }));
        addressInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (status) status.textContent = 'Address found.';
    } catch (error) {
      if (status) status.textContent = error?.message || 'Address lookup failed.';
    } finally {
      button.disabled = false;
    }
  }

  function createStoreProductVariantModeField(product) {
    var variants = Array.isArray(product.variants) ? product.variants : [];
    var label = createElement('label', 'admin-store-products__field');
    label.dataset.storeProductFieldWrapper = 'variantBased';
    var select = document.createElement('select');
    select.className = 'admin-settings__input';
    select.dataset.storeProductVariantsEnabled = 'true';
    [['false', 'No'], ['true', 'Yes']].forEach(function(pair) {
      var option = document.createElement('option');
      option.value = pair[0];
      option.textContent = pair[1];
      select.appendChild(option);
    });
    select.value = variants.length ? 'true' : 'false';
    label.appendChild(createStoreProductFieldLabel('Variant Based', 'variantBased', select));
    label.appendChild(select);
    return label;
  }

  function renderStoreProductVariants(product) {
    var variants = Array.isArray(product.variants) ? product.variants : [];
    var wrapper = createElement('div', 'admin-store-products__variants');
    wrapper.dataset.storeProductVariants = 'true';
    var header = createElement('div', 'admin-store-products__variants-header');
    header.appendChild(createHeadingWithHelp('h4', 'admin-store-products__variants-title', 'Variants', {
      path: 'store-product-variants'
    }));
    var controls = createElement('div', 'admin-store-products__variants-controls');
    var add = createElement('button', 'btn btn--secondary btn--small', 'Add variant');
    add.type = 'button';
    add.dataset.storeProductVariantAdd = 'true';
    add.disabled = !variants.length;
    controls.appendChild(add);
    header.appendChild(controls);
    wrapper.appendChild(header);

    var table = createElement('table', 'admin-store-products__variants-table');
    table.hidden = !variants.length;
    var colgroup = document.createElement('colgroup');
    storeProductVariantColumns().forEach(function(pair) {
      var col = document.createElement('col');
      applyStoreProductVariantColumnMetadata(col, pair[0]);
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);
    var thead = document.createElement('thead');
    var header = document.createElement('tr');
    storeProductVariantColumns().forEach(function(pair) {
      var text = pair[1];
      var th = createElement('th', '', text);
      applyStoreProductVariantColumnMetadata(th, pair[0]);
      header.appendChild(th);
    });
    thead.appendChild(header);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    variants.forEach(function(variant) {
      tbody.appendChild(createStoreProductVariantRow(product, variant));
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);
    var empty = createElement('p', 'admin-app__muted admin-store-products__variants-empty', 'No variants');
    empty.hidden = variants.length > 0;
    wrapper.appendChild(empty);
    return wrapper;
  }

  function storeProductVariantColumns() {
    return [
      ['label', 'Label'],
      ['id', 'ID'],
      ['sku', 'SKU'],
      ['downloadFileKey', 'File'],
      ['price', 'Price (USD)'],
      ['inventory', 'Inventory'],
      ['status', 'Status'],
      ['actions', '', 'Actions']
    ];
  }

  function applyStoreProductVariantColumnMetadata(element, column) {
    if (!element) return;
    element.dataset.storeVariantColumn = column;
    if (column === 'inventory') element.dataset.storeProductVariantInventoryCell = 'true';
    if (column === 'downloadFileKey') element.dataset.storeProductVariantDownloadCell = 'true';
  }

  function createStoreProductVariantRow(product, variant) {
    var source = variant || {};
    var tr = document.createElement('tr');
    var labels = storeProductVariantColumns().reduce(function(map, column) {
      map[column[0]] = column[2] || column[1];
      return map;
    }, {});
    var labelValue = source.label || '';
    tr.dataset.storeProductVariant = derivedStoreVariantId(labelValue, source.id || 'variant');
    [
      ['label', labelValue, 'text'],
      ['id', source.id || '', 'derived'],
      ['sku', source.sku || '', 'derived'],
      ['downloadFileKey', source.downloadFileKey || '', 'download'],
      ['price', productPrice(source.priceCents !== undefined || source.price !== undefined ? source : product), 'number'],
      ['inventory', source.inventory ?? '', 'number'],
      ['status', source.status || 'active', 'select']
    ].forEach(function(field) {
      var td = document.createElement('td');
      applyStoreProductVariantColumnMetadata(td, field[0]);
      td.dataset.label = labels[field[0]] || '';
      var input;
      if (field[2] === 'derived') {
        var derived = createStoreProductVariantDerivedField(field[0], field[1]);
        td.appendChild(derived.output);
        td.appendChild(derived.hidden);
        tr.appendChild(td);
        return;
      } else if (field[2] === 'download') {
        input = document.createElement('select');
        downloadFileOptions(field[1], source.downloadFilename).forEach(function(optionData) {
          var option = document.createElement('option');
          option.value = optionData.value;
          option.textContent = optionData.label;
          option.dataset.filename = optionData.filename || '';
          input.appendChild(option);
        });
        input.value = field[1];
      } else if (field[2] === 'select') {
        input = document.createElement('select');
        [['active', 'Active'], ['draft', 'Draft'], ['archived', 'Archived'], ['sold_out', 'Sold out']].forEach(function(pair) {
          var option = document.createElement('option');
          option.value = pair[0];
          option.textContent = pair[1];
          input.appendChild(option);
        });
        input.value = field[1];
      } else {
        input = document.createElement('input');
        input.type = field[2];
        input.value = field[1];
        if (field[0] === 'price') input.step = '0.01';
        if (field[0] === 'price' || field[0] === 'inventory') input.min = '0';
      }
      input.className = 'admin-settings__input';
      input.dataset.storeVariantField = field[0];
      td.appendChild(input);
      tr.appendChild(td);
    });
    var actionCell = document.createElement('td');
    applyStoreProductVariantColumnMetadata(actionCell, 'actions');
    actionCell.dataset.label = labels.actions || 'Actions';
    var remove = createElement('button', 'btn btn--secondary btn--small', 'Remove');
    remove.type = 'button';
    remove.dataset.storeProductVariantRemove = 'true';
    actionCell.appendChild(remove);
    tr.appendChild(actionCell);
    updateStoreProductVariantDerivedFields(tr, product);
    return tr;
  }

  function createStoreProductVariantDerivedField(field, value) {
    var output = createElement('output', 'admin-store-products__variant-derived', value || '');
    var hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.dataset.storeVariantField = field;
    hidden.dataset.storeVariantDerivedInput = field;
    hidden.value = value || '';
    output.dataset.storeVariantDerivedOutput = field;
    return { output: output, hidden: hidden };
  }

  function updateStoreProductVariantDerivedFields(row, product) {
    if (!row) return;
    var labelInput = $('[data-store-variant-field="label"]', row);
    var label = labelInput ? labelInput.value : '';
    var id = derivedStoreVariantId(label, row.dataset.storeProductVariant || 'variant');
    var sku = derivedStoreVariantSku(product || {}, label, id);
    row.dataset.storeProductVariant = id;
    [['id', id], ['sku', sku]].forEach(function(pair) {
      var output = $('[data-store-variant-derived-output="' + pair[0] + '"]', row);
      var hidden = $('[data-store-variant-derived-input="' + pair[0] + '"]', row);
      if (output) output.textContent = pair[1];
      if (hidden) hidden.value = pair[1];
    });
  }

  function nextStoreProductVariant(product, form) {
    var rows = $all('[data-store-product-variant]', form);
    var index = rows.length + 1;
    var base = 'variant-' + index;
    var existing = new Set(rows.map(function(row) {
      var idInput = $('[data-store-variant-field="id"]', row);
      return idInput ? idInput.value.trim() : '';
    }));
    while (existing.has(base)) {
      index += 1;
      base = 'variant-' + index;
    }
    return {
      id: base,
      label: 'Variant ' + index,
      sku: (product.productId || 'product') + '-' + base,
      priceCents: product.priceCents ?? Math.round(Number(product.price || 0) * 100),
      inventory: product.inventory ?? 0,
      status: 'active'
    };
  }

  function syncStoreProductVariantsSection(wrapper) {
    if (!wrapper) return;
    var form = wrapper.closest('[data-store-product-editor]');
    var enabled = form ? $('[data-store-product-variants-enabled]', form) : $('[data-store-product-variants-enabled]', wrapper);
    var table = $('.admin-store-products__variants-table', wrapper);
    var tbody = table ? $('tbody', table) : null;
    var add = $('[data-store-product-variant-add]', wrapper);
    var empty = $('.admin-store-products__variants-empty', wrapper);
    var isEnabled = enabled && enabled.value === 'true';
    var hasRows = tbody && tbody.children.length > 0;
    wrapper.hidden = !isEnabled;
    if (table) table.hidden = !isEnabled;
    if (add) add.disabled = !isEnabled;
    if (empty) empty.hidden = isEnabled && hasRows;
  }

  function readStoreProductEditor(form, intent) {
    if (storeProductIsCreateForm(form)) syncStoreProductDerivedSku(form);
    var fields = {};
    $all('[data-store-product-field]', form).forEach(function(input) {
      if (input.disabled) return;
      var key = input.dataset.storeProductField;
      if (key === 'price') fields[key] = Number(input.value || 0);
      else if (key === 'inventory') fields[key] = input.value === '' ? '' : Number(input.value);
      else if (key === 'inventoryTracking') fields[key] = input.value === 'true';
      else if (key === 'eventIcs') fields[key] = input.value === 'true';
      else if (key === 'eventStartsAt' || key === 'eventEndsAt') fields[key] = storeProductDateTimePublishValue(input);
      else if (key === 'downloadFileKey') {
        fields[key] = input.value;
        fields.downloadFilename = input.options && input.selectedIndex >= 0
          ? (input.options[input.selectedIndex].dataset.filename || input.options[input.selectedIndex].textContent || '')
          : '';
      }
      else if (key === 'longContent') {
        try {
          var parsedLongContent = JSON.parse(input.value || '[]');
          fields[key] = Array.isArray(parsedLongContent) ? parsedLongContent : [];
        } catch (_error) {
          fields[key] = [];
        }
      }
      else fields[key] = input.value;
    });
    var fulfillmentType = fields.fulfillmentType || '';
    if (!isPhysicalFulfillment(fulfillmentType)) fields.shippingPreset = '';
    if (isDigitalFulfillment(fulfillmentType)) fields.inventoryTracking = false;
    var variantsEnabled = $('[data-store-product-variants-enabled]', form);
    fields.variantBased = Boolean(variantsEnabled && variantsEnabled.value === 'true');
    var variants = variantsEnabled && variantsEnabled.value !== 'true' ? [] : $all('[data-store-product-variant]', form).map(function(row) {
      var variant = {};
      $all('[data-store-variant-field]', row).forEach(function(input) {
        if (input.disabled) return;
        var key = input.dataset.storeVariantField;
        if (key === 'price') variant[key] = Number(input.value || 0);
        else if (key === 'inventory') variant[key] = input.value === '' ? '' : Number(input.value);
        else if (key === 'downloadFileKey') {
          variant[key] = input.value;
          variant.downloadFilename = input.options && input.selectedIndex >= 0
            ? (input.options[input.selectedIndex].dataset.filename || input.options[input.selectedIndex].textContent || '')
            : '';
        }
        else variant[key] = input.value;
      });
      return variant;
    });
    var body = {
      intent: intent || 'publish',
      productId: storeProductIsCreateForm(form)
        ? (($('[data-store-product-readonly-field="sku"]', form) || {}).value || form.dataset.storeProductEditor)
        : form.dataset.storeProductEditor,
      fields: fields,
      variants: variants
    };
    if (storeProductIsCreateForm(form)) body.createProduct = true;
    return body;
  }

  function storeProductEditorSnapshot(form) {
    if (!form) return '';
    return JSON.stringify(readStoreProductEditor(form, 'publish'));
  }

  function storeProductEditorHasUnsavedChanges(form) {
    if (!form) return false;
    if (storeProductIsCreateForm(form)) return true;
    return storeProductEditorSnapshot(form) !== String(form.dataset.storeProductSavedSnapshot || '');
  }

  function updateStoreProductEditorDirtyState(form) {
    if (!form) return;
    var publish = $('[data-store-product-publish]', form);
    var label = form.dataset.storeProductActionLabel || 'Publish product';
    setDirtyButtonState(publish, storeProductEditorHasUnsavedChanges(form), label, label);
  }

  function resetStoreProductEditorDirtyBaseline(form) {
    if (!form) return;
    form.dataset.storeProductSavedSnapshot = storeProductEditorSnapshot(form);
    updateStoreProductEditorDirtyState(form);
  }

  function loadStoreProducts() {
    var status = $('#admin-store-products-status');
    setStatus(status, 'Loading Store products...');
    return requestJson('/admin/store/products').then(function(data) {
      storeProductsLoaded = true;
      renderStoreProducts(data);
      setStatus(status, '');
    }).catch(function(error) {
      setStatus(status, formatError(error), true);
    });
  }

  function setupStoreProductsEvents() {
    var root = $('#admin-store-products-results');
    if (!root) return;
    root.addEventListener('change', function(event) {
      var productSelect = event.target.closest('[data-store-product-select]');
      if (productSelect) {
        var productId = productSelect.dataset.storeProductSelect;
        if (productSelect.checked) selectedStoreProductIds.add(productId);
        else selectedStoreProductIds.delete(productId);
        syncStoreProductsControls(root);
        return;
      }

      var selectAll = event.target.closest('[data-store-products-select-all]');
      if (selectAll) {
        selectedStoreProductIds.clear();
        if (selectAll.checked) {
          currentStoreProducts.forEach(function(product) {
            if (product.productId) selectedStoreProductIds.add(product.productId);
          });
        }
        syncStoreProductsControls(root);
      }

      var bulkStatus = event.target.closest('[data-store-products-bulk-status]');
      if (bulkStatus) {
        syncStoreProductsControls(root);
      }

      var variantsEnabled = event.target.closest('[data-store-product-variants-enabled]');
      if (variantsEnabled) {
        var form = variantsEnabled.closest('[data-store-product-editor]');
        var wrapper = form ? $('[data-store-product-variants]', form) : variantsEnabled.closest('[data-store-product-variants]');
        var product = currentStoreProducts.find(function(item) {
          return item.productId === (form ? form.dataset.storeProductEditor : '');
        }) || {};
        product = currentStoreProductEditorProduct(form, product);
        var tbody = wrapper ? $('tbody', wrapper) : null;
        if (variantsEnabled.value === 'true' && tbody && tbody.children.length === 0) {
          tbody.appendChild(createStoreProductVariantRow(product, nextStoreProductVariant(product, form)));
        }
        syncStoreProductVariantsSection(wrapper);
        syncStoreProductFulfillmentDependentFields(form);
        updateStoreProductEditorDirtyState(form);
        scheduleStoreProductPreview(form, 150);
      }
    });
    root.addEventListener('click', function(event) {
      var inventoryAction = event.target.closest('[data-store-product-inventory-action]');
      if (inventoryAction) {
        updateStoreProductInventory(inventoryAction);
        return;
      }

      var orderSave = event.target.closest('[data-store-products-order-save]');
      if (orderSave) {
        saveStoreProductOrder(orderSave);
        return;
      }

      var createProduct = event.target.closest('[data-store-product-create]');
      if (createProduct) {
        editingProductId = STORE_PRODUCT_CREATE_ID;
        selectedStoreProductIds.clear();
        renderStoreProducts({
          products: currentStoreProducts,
          rows: currentStoreProductRows,
          totals: currentStoreProductTotals,
          catalog: { shippingPresets: currentStoreShippingPresets }
        }, { preserveOrderBaseline: true });
        scrollStoreProductEditorIntoView(STORE_PRODUCT_CREATE_ID);
        return;
      }

      var variantAdd = event.target.closest('[data-store-product-variant-add]');
      if (variantAdd) {
        var addForm = variantAdd.closest('[data-store-product-editor]');
        var addWrapper = variantAdd.closest('[data-store-product-variants]');
        var addTbody = addWrapper ? $('tbody', addWrapper) : null;
        var addProduct = currentStoreProducts.find(function(item) {
          return item.productId === (addForm ? addForm.dataset.storeProductEditor : '');
        }) || {};
        addProduct = currentStoreProductEditorProduct(addForm, addProduct);
        if (addTbody) {
          addTbody.appendChild(createStoreProductVariantRow(addProduct, nextStoreProductVariant(addProduct, addForm)));
          syncStoreProductVariantsSection(addWrapper);
          syncStoreProductFulfillmentDependentFields(addForm);
          updateStoreProductEditorDirtyState(addForm);
          scheduleStoreProductPreview(addForm, 150);
        }
        return;
      }

      var variantRemove = event.target.closest('[data-store-product-variant-remove]');
      if (variantRemove) {
        var removeForm = variantRemove.closest('[data-store-product-editor]');
        var removeWrapper = variantRemove.closest('[data-store-product-variants]');
        var removeRow = variantRemove.closest('[data-store-product-variant]');
        if (removeRow) removeRow.remove();
        syncStoreProductVariantsSection(removeWrapper);
        updateStoreProductEditorDirtyState(removeForm);
        scheduleStoreProductPreview(removeForm, 150);
        return;
      }

      var bulkApply = event.target.closest('[data-store-products-bulk-apply]');
      if (bulkApply) {
        var statusSelect = $('[data-store-products-bulk-status]', root);
        var status = statusSelect ? statusSelect.value : '';
        if (!selectedStoreProductIds.size) {
          setStatus($('#admin-store-products-status'), 'Select at least one product.', true);
          return;
        }
        if (!status) {
          setStatus($('#admin-store-products-status'), 'Choose a product status to apply.', true);
          return;
        }
        bulkApply.disabled = true;
        setStatus($('#admin-store-products-status'), 'Publishing bulk product edits...');
        requestJson('/admin/store/products/bulk-publish', {
          method: 'POST',
          body: {
            intent: 'bulk_publish',
            productIds: Array.from(selectedStoreProductIds),
            fields: { status: status }
          }
        }).then(function(data) {
          var message = data.deployNotice || 'Bulk product edits published.';
          selectedStoreProductIds.clear();
          return loadStoreProducts().finally(function() {
            setStatus($('#admin-store-products-status'), message);
          });
        }).catch(function(error) {
          bulkApply.disabled = false;
          setStatus($('#admin-store-products-status'), formatError(error), true);
        });
        return;
      }

      var edit = event.target.closest('[data-store-product-edit]');
      if (edit) {
        editingProductId = edit.dataset.storeProductEdit;
        renderStoreProducts({
          products: currentStoreProducts,
          rows: currentStoreProductRows,
          totals: currentStoreProductTotals,
          catalog: { shippingPresets: currentStoreShippingPresets }
        }, { preserveOrderBaseline: true });
        scrollStoreProductEditorIntoView(editingProductId);
        return;
      }
      var cancel = event.target.closest('[data-store-product-cancel]');
      if (cancel) {
        editingProductId = '';
        loadStoreProducts();
      }
    });
    root.addEventListener('dragstart', function(event) {
      var row = event.target.closest('[data-store-product-order-row]');
      if (!row || isStoreProductControlTarget(event.target)) {
        event.preventDefault();
        return;
      }
      storeProductDraggingId = String(row.dataset.storeProductOrderRow || '').trim();
      row.classList.add('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', storeProductDraggingId);
      }
    });
    root.addEventListener('dragover', function(event) {
      var row = event.target.closest('[data-store-product-order-row]');
      if (!row || !storeProductDraggingId || row.dataset.storeProductOrderRow === storeProductDraggingId) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      markStoreProductDropTarget(root, row, storeProductRowDropBefore(row, event.clientY));
    });
    root.addEventListener('dragleave', function(event) {
      var row = event.target.closest('[data-store-product-order-row]');
      if (!row) return;
      row.classList.remove('is-drop-before', 'is-drop-after');
    });
    root.addEventListener('drop', function(event) {
      var row = event.target.closest('[data-store-product-order-row]');
      if (!row) return;
      var targetId = String(row.dataset.storeProductOrderRow || '').trim();
      var sourceId = storeProductDraggingId || (event.dataTransfer ? event.dataTransfer.getData('text/plain') : '');
      row.classList.remove('is-drop-before', 'is-drop-after');
      if (!sourceId || !targetId || sourceId === targetId) return;
      event.preventDefault();
      reorderStoreProducts(sourceId, targetId, storeProductRowDropBefore(row, event.clientY));
    });
    root.addEventListener('dragend', function() {
      storeProductDraggingId = '';
      $all('[data-store-product-order-row]', root).forEach(function(row) {
        row.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after');
      });
    });
    root.addEventListener('keydown', function(event) {
      var row = event.target.closest('[data-store-product-order-row]');
      if (!row || event.target !== row || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      event.preventDefault();
      moveStoreProductOneStep(row.dataset.storeProductOrderRow, event.key === 'ArrowUp' ? -1 : 1);
    });
    root.addEventListener('touchstart', function(event) {
      if (event.touches.length !== 1 || isStoreProductControlTarget(event.target)) return;
      var row = event.target.closest('[data-store-product-order-row]');
      if (!row) return;
      resetStoreProductTouchDrag(root);
      var touch = event.touches[0];
      var sourceId = String(row.dataset.storeProductOrderRow || '').trim();
      storeProductTouchDrag = {
        active: false,
        beforeTarget: true,
        row: row,
        sourceId: sourceId,
        startX: touch.clientX,
        startY: touch.clientY,
        targetId: '',
        timer: window.setTimeout(function() {
          if (!storeProductTouchDrag || storeProductTouchDrag.sourceId !== sourceId) return;
          storeProductTouchDrag.active = true;
          storeProductDraggingId = sourceId;
          row.classList.remove('is-touch-pending');
          row.classList.add('is-dragging');
        }, STORE_PRODUCT_TOUCH_DRAG_DELAY)
      };
      row.classList.add('is-touch-pending');
    }, { passive: true });
    root.addEventListener('touchmove', function(event) {
      if (!storeProductTouchDrag || event.touches.length !== 1) return;
      var touch = event.touches[0];
      var deltaX = Math.abs(touch.clientX - storeProductTouchDrag.startX);
      var deltaY = Math.abs(touch.clientY - storeProductTouchDrag.startY);
      if (!storeProductTouchDrag.active && Math.max(deltaX, deltaY) > STORE_PRODUCT_TOUCH_DRAG_SLOP) {
        resetStoreProductTouchDrag(root);
        return;
      }
      if (!storeProductTouchDrag.active) return;
      event.preventDefault();
      updateStoreProductTouchTarget(root, touch);
    }, { passive: false });
    root.addEventListener('touchend', function() {
      if (!storeProductTouchDrag) return;
      var sourceId = storeProductTouchDrag.sourceId;
      var targetId = storeProductTouchDrag.targetId;
      var beforeTarget = storeProductTouchDrag.beforeTarget;
      var shouldReorder = storeProductTouchDrag.active && sourceId && targetId && sourceId !== targetId;
      resetStoreProductTouchDrag(root);
      if (shouldReorder) reorderStoreProducts(sourceId, targetId, beforeTarget);
    });
    root.addEventListener('touchcancel', function() {
      resetStoreProductTouchDrag(root);
    });
    root.addEventListener('submit', function(event) {
      var form = event.target.closest('[data-store-product-editor]');
      if (!form) return;
      event.preventDefault();
      var body = readStoreProductEditor(form);
      if (!storeProductEditorHasUnsavedChanges(form)) {
        updateStoreProductEditorDirtyState(form);
        setStatus($('#admin-store-products-status'), 'No product changes to publish.');
        return;
      }
      var publish = $('[data-store-product-publish]', form);
      if (publish) publish.disabled = true;
      setStatus($('#admin-store-products-status'), storeProductIsCreateForm(form) ? 'Creating product...' : 'Publishing product...');
      requestJson('/admin/store/products/publish', {
        method: 'POST',
        body: body
      }).then(function(data) {
        var message = data.deployNotice || data.message || 'Product published.';
        editingProductId = '';
        return loadStoreProducts().finally(function() {
          setStatus($('#admin-store-products-status'), message);
        });
      }).catch(function(error) {
        updateStoreProductEditorDirtyState(form);
        setStatus($('#admin-store-products-status'), formatError(error), true);
      });
    });
  }

  var storeCouponFieldHelpText = {
    code: 'Customer-entered coupon code. Codes are saved uppercase and can use letters, numbers, hyphens, or underscores.',
    description: 'Internal note shown in admin so the purpose of the coupon is clear.',
    status: 'Active coupons can be used at checkout. Draft coupons are saved but unavailable to shoppers.',
    discountType: 'Choose Percent for a percentage off or Amount for a fixed USD discount.',
    percentOff: 'Percentage taken off eligible merchandise before tax, shipping, and tip.',
    amountOff: 'Dollar amount taken off eligible merchandise, capped at the eligible subtotal.',
    appliesTo: 'Whole cart discounts all merchandise. Specific products discounts only selected products.',
    products: 'Products eligible for this coupon when the scope is Specific products.'
  };

  function storeCouponFieldHelp(field) {
    return storeCouponFieldHelpText[field] || '';
  }

  function normalizeStoreCouponCode(value) {
    return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
  }

  function formatStoreCouponDiscount(coupon) {
    if (!coupon) return '';
    if (coupon.discountType === 'amount') return moneyFromCents(coupon.amountOffCents || 0) + ' off';
    return String(Number(coupon.percentOff || 0)) + '% off';
  }

  function formatStoreCouponScope(coupon) {
    if (!coupon || coupon.appliesTo !== 'products') return 'Whole cart';
    var ids = Array.isArray(coupon.productIds) ? coupon.productIds : [];
    if (!ids.length) return 'Specific products';
    return ids.length === 1 ? '1 product' : ids.length + ' products';
  }

  function storeCouponProductLabel(productId) {
    var product = currentStoreCouponProducts.find(function(item) {
      return item.productId === productId;
    });
    return product ? product.name || product.productId : productId;
  }

  function renderStoreCouponsSummary(data) {
    var root = $('#admin-store-coupons-summary');
    if (!root) return;
    clear(root);
    root.classList.add('admin-stat-grid');
    var totals = data.totals || {};
    [
      ['Coupons', totals.coupons || 0],
      ['Active', totals.active || 0],
      ['Draft', totals.draft || 0]
    ].forEach(function(card) {
      root.appendChild(statCard('admin-store-coupons__card', card[0], formatNumber(card[1])));
    });
  }

  function createStoreCouponFieldLabel(labelText, field, control) {
    var labelRow = createElement('span', 'admin-store-coupons__field-label');
    labelRow.appendChild(document.createTextNode(labelText));
    var help = createHelp({
      label: labelText,
      path: 'store-coupon-field-' + field,
      help: storeCouponFieldHelp(field)
    }, control || null, {
      className: ['status', 'products'].indexOf(field) >= 0 ? 'admin-settings__help--edge-end' : ''
    });
    if (help) labelRow.appendChild(help);
    return labelRow;
  }

  function createStoreCouponInputField(labelText, field, control, options) {
    var opts = options || {};
    var wrap = createElement(opts.block ? 'div' : 'label', 'admin-store-coupons__field');
    wrap.dataset.storeCouponFieldWrapper = field;
    if (opts.full) wrap.classList.add('admin-store-coupons__field--full');
    control.dataset.storeCouponField = field;
    if (!control.classList.contains('admin-settings__input')) {
      control.classList.add('admin-settings__input');
    }
    wrap.appendChild(createStoreCouponFieldLabel(labelText, field, control));
    wrap.appendChild(control);
    return wrap;
  }

  function createStoreCouponSelect(options, value) {
    var select = document.createElement('select');
    options.forEach(function(pair) {
      var option = document.createElement('option');
      option.value = pair[0];
      option.textContent = pair[1];
      select.appendChild(option);
    });
    select.value = String(value || options[0][0]);
    return select;
  }

  function createStoreCouponDraft() {
    return {
      id: '',
      code: '',
      description: '',
      status: 'draft',
      discountType: 'percent',
      percentOff: 10,
      amountOffCents: 500,
      appliesTo: 'cart',
      productIds: [],
      isNew: true
    };
  }

  function readStoreCouponEditor(form) {
    var fields = {};
    $all('[data-store-coupon-field]', form).forEach(function(input) {
      var key = input.dataset.storeCouponField;
      if (key === 'code') fields[key] = normalizeStoreCouponCode(input.value);
      else if (key === 'percentOff') fields[key] = Number(input.value || 0);
      else if (key === 'amountOff') fields.amountOffCents = Math.round((Number(input.value || 0) || 0) * 100);
      else fields[key] = input.value;
    });
    fields.productIds = $all('[data-store-coupon-product]', form)
      .filter(function(input) { return input.checked; })
      .map(function(input) { return input.value; });
    if (fields.appliesTo !== 'products') fields.productIds = [];
    return {
      originalCode: form ? form.dataset.storeCouponOriginalCode || '' : '',
      coupon: fields
    };
  }

  function storeCouponEditorSnapshot(form) {
    return JSON.stringify(readStoreCouponEditor(form));
  }

  function storeCouponEditorHasUnsavedChanges(form) {
    if (!form) return false;
    if (form.dataset.storeCouponNew === 'true') return true;
    return storeCouponEditorSnapshot(form) !== String(form.dataset.storeCouponSavedSnapshot || '');
  }

  function updateStoreCouponEditorDirtyState(form) {
    if (!form) return;
    var save = $('[data-store-coupon-save]', form);
    setDirtyButtonState(save, storeCouponEditorHasUnsavedChanges(form), 'Save coupon', 'Save coupon');
  }

  function resetStoreCouponEditorDirtyBaseline(form) {
    if (!form) return;
    form.dataset.storeCouponSavedSnapshot = storeCouponEditorSnapshot(form);
    updateStoreCouponEditorDirtyState(form);
  }

  function syncStoreCouponEditorVisibility(form) {
    if (!form) return;
    var type = $('[data-store-coupon-field="discountType"]', form);
    var appliesTo = $('[data-store-coupon-field="appliesTo"]', form);
    var percent = $('[data-store-coupon-field-wrapper="percentOff"]', form);
    var amount = $('[data-store-coupon-field-wrapper="amountOff"]', form);
    var products = $('[data-store-coupon-products]', form);
    var productInputs = $all('[data-store-coupon-product]', form);
    var isAmount = type && type.value === 'amount';
    if (percent) percent.hidden = Boolean(isAmount);
    if (amount) amount.hidden = !isAmount;
    var productScoped = appliesTo && appliesTo.value === 'products';
    if (products) products.hidden = !productScoped;
    productInputs.forEach(function(input) {
      input.disabled = !productScoped;
    });
  }

  function createStoreCouponProductSelector(coupon) {
    var selected = new Set(Array.isArray(coupon.productIds) ? coupon.productIds : []);
    var wrapper = createElement('div', 'admin-store-coupons__products admin-store-coupons__field--full');
    wrapper.dataset.storeCouponProducts = 'true';
    wrapper.appendChild(createStoreCouponFieldLabel('Products', 'products', null));
    var choices = createElement('div', 'admin-store-coupons__product-grid');
    if (!currentStoreCouponProducts.length) {
      choices.appendChild(createElement('p', 'admin-app__muted', 'No products available.'));
    }
    currentStoreCouponProducts.forEach(function(product) {
      var label = createElement('label', 'admin-store-coupons__product-choice');
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.value = product.productId || '';
      input.checked = selected.has(product.productId);
      input.dataset.storeCouponProduct = 'true';
      var text = createElement('span', '', product.name || product.productId || 'Product');
      var meta = [product.collection, product.category, product.status].filter(Boolean).join(' / ');
      label.appendChild(input);
      label.appendChild(text);
      if (meta) label.appendChild(createElement('small', '', meta));
      choices.appendChild(label);
    });
    wrapper.appendChild(choices);
    return wrapper;
  }

  function renderStoreCouponEditor(coupon) {
    var form = createElement('form', 'admin-store-coupons__editor');
    var isNew = coupon && coupon.isNew === true;
    form.dataset.storeCouponEditor = coupon.code || '__new_coupon__';
    form.dataset.storeCouponOriginalCode = coupon.code || '';
    form.dataset.storeCouponNew = isNew ? 'true' : 'false';

    var title = createElement('h2', 'admin-store-coupons__editor-title', isNew ? 'Create coupon' : 'Edit ' + (coupon.code || 'coupon'));
    form.appendChild(title);

    var grid = createElement('div', 'admin-store-coupons__editor-grid');
    var code = document.createElement('input');
    code.type = 'text';
    code.autocomplete = 'off';
    code.inputMode = 'text';
    code.required = true;
    code.maxLength = 40;
    code.value = coupon.code || '';
    grid.appendChild(createStoreCouponInputField('Code', 'code', code));

    var status = createStoreCouponSelect([
      ['active', 'Active'],
      ['draft', 'Draft']
    ], coupon.status || 'draft');
    grid.appendChild(createStoreCouponInputField('Status', 'status', status));

    var description = document.createElement('textarea');
    description.rows = 2;
    description.maxLength = 300;
    description.value = coupon.description || '';
    grid.appendChild(createStoreCouponInputField('Description', 'description', description, { full: true }));

    var discountType = createStoreCouponSelect([
      ['percent', 'Percent'],
      ['amount', 'Amount USD']
    ], coupon.discountType || 'percent');
    grid.appendChild(createStoreCouponInputField('Discount type', 'discountType', discountType));

    var percent = document.createElement('input');
    percent.type = 'number';
    percent.min = '0.01';
    percent.max = '100';
    percent.step = '0.01';
    percent.value = String(coupon.percentOff || 10);
    grid.appendChild(createStoreCouponInputField('Percent off', 'percentOff', percent));

    var amount = document.createElement('input');
    amount.type = 'number';
    amount.min = '0.01';
    amount.step = '0.01';
    amount.value = ((Number(coupon.amountOffCents || 0) || 0) / 100).toFixed(2);
    grid.appendChild(createStoreCouponInputField('Amount off', 'amountOff', amount));

    var appliesTo = createStoreCouponSelect([
      ['cart', 'Whole cart'],
      ['products', 'Specific products']
    ], coupon.appliesTo || 'cart');
    grid.appendChild(createStoreCouponInputField('Applies to', 'appliesTo', appliesTo));
    grid.appendChild(createStoreCouponProductSelector(coupon));
    form.appendChild(grid);

    var actions = createElement('div', 'admin-store-coupons__editor-actions');
    var save = createElement('button', 'btn', 'Save coupon');
    save.type = 'submit';
    save.dataset.storeCouponSave = 'true';
    var cancel = createElement('button', 'btn btn--secondary', 'Cancel');
    cancel.type = 'button';
    cancel.dataset.storeCouponCancel = 'true';
    actions.appendChild(save);
    actions.appendChild(cancel);
    form.appendChild(actions);

    syncStoreCouponEditorVisibility(form);
    resetStoreCouponEditorDirtyBaseline(form);
    return form;
  }

  function renderStoreCouponActions(coupon) {
    var actions = createElement('div', 'admin-store-coupons__actions');
    var edit = createElement('button', 'btn btn--secondary btn--small', 'Edit');
    edit.type = 'button';
    edit.dataset.storeCouponEdit = coupon.code || '';
    var deleteButton = createElement('button', 'btn btn--secondary btn--small', 'Delete');
    deleteButton.type = 'button';
    deleteButton.dataset.storeCouponDelete = coupon.code || '';
    actions.appendChild(edit);
    actions.appendChild(deleteButton);
    return actions;
  }

  function renderStoreCoupons(data) {
    var root = $('#admin-store-coupons-results');
    if (!root) return;
    clear(root);
    currentStoreCoupons = Array.isArray(data.coupons) ? data.coupons : [];
    currentStoreCouponProducts = Array.isArray(data.products) ? data.products : [];
    data.totals = data.totals || {
      coupons: currentStoreCoupons.length,
      active: currentStoreCoupons.filter(function(coupon) { return coupon.status === 'active'; }).length,
      draft: currentStoreCoupons.filter(function(coupon) { return coupon.status === 'draft'; }).length
    };
    renderStoreCouponsSummary(data);

    var toolbar = createElement('div', 'admin-store-coupons__toolbar');
    var create = createElement('button', 'btn btn--secondary', 'Create coupon');
    create.type = 'button';
    create.dataset.storeCouponCreate = 'true';
    toolbar.appendChild(create);
    root.appendChild(toolbar);

    var table = createElement('table', 'admin-store-coupons__table');
    var thead = document.createElement('thead');
    var header = document.createElement('tr');
    ['Code', 'Description', 'Discount', 'Applies to', 'Status', 'Actions'].forEach(function(text) {
      header.appendChild(createElement('th', '', text));
    });
    thead.appendChild(header);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    var columnCount = header.children.length;

    if (editingStoreCouponCode === '__new_coupon__') {
      var createRow = document.createElement('tr');
      createRow.className = 'admin-store-coupons__editor-row';
      var createCell = document.createElement('td');
      createCell.colSpan = columnCount;
      createCell.appendChild(renderStoreCouponEditor(createStoreCouponDraft()));
      createRow.appendChild(createCell);
      tbody.appendChild(createRow);
    }

    currentStoreCoupons.forEach(function(coupon) {
      var tr = document.createElement('tr');
      tr.appendChild(createLabeledTableCell('Code', coupon.code || ''));
      tr.appendChild(createLabeledTableCell('Description', coupon.description || ''));
      tr.appendChild(createLabeledTableCell('Discount', formatStoreCouponDiscount(coupon)));
      var scope = createElement('div', 'admin-store-coupons__scope', formatStoreCouponScope(coupon));
      if (coupon.appliesTo === 'products' && Array.isArray(coupon.productIds) && coupon.productIds.length) {
        scope.appendChild(createElement('small', '', coupon.productIds.map(storeCouponProductLabel).join(', ')));
      }
      tr.appendChild(createLabeledTableCell('Applies to', scope));
      tr.appendChild(createLabeledTableCell('Status', coupon.status || 'draft'));
      tr.appendChild(createLabeledTableCell('Actions', renderStoreCouponActions(coupon), 'admin-store-coupons__actions-cell'));
      tbody.appendChild(tr);

      if (editingStoreCouponCode === coupon.code) {
        var editorRow = document.createElement('tr');
        editorRow.className = 'admin-store-coupons__editor-row';
        var editorCell = document.createElement('td');
        editorCell.colSpan = columnCount;
        editorCell.appendChild(renderStoreCouponEditor(coupon));
        editorRow.appendChild(editorCell);
        tbody.appendChild(editorRow);
      }
    });

    if (!currentStoreCoupons.length && editingStoreCouponCode !== '__new_coupon__') {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.colSpan = columnCount;
      emptyCell.appendChild(createElement('p', 'admin-app__muted', 'No coupons yet.'));
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
    }

    table.appendChild(tbody);
    root.appendChild(table);
  }

  function loadStoreCoupons() {
    var status = $('#admin-store-coupons-status');
    setStatus(status, 'Loading Store coupons...');
    return requestJson('/admin/store/coupons').then(function(data) {
      storeCouponsLoaded = true;
      renderStoreCoupons(data);
      setStatus(status, '');
    }).catch(function(error) {
      setStatus(status, formatError(error), true);
    });
  }

  function scrollStoreCouponEditorIntoView() {
    window.requestAnimationFrame(function() {
      var editor = $('[data-store-coupon-editor]');
      if (!editor || typeof editor.scrollIntoView !== 'function') return;
      var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      editor.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
        inline: 'nearest'
      });
    });
  }

  function setupStoreCouponsEvents() {
    var root = $('#admin-store-coupons-results');
    if (!root) return;
    root.addEventListener('input', function(event) {
      var form = event.target.closest('[data-store-coupon-editor]');
      if (!form) return;
      if (event.target.matches('[data-store-coupon-field="code"]')) {
        event.target.value = normalizeStoreCouponCode(event.target.value);
      }
      updateStoreCouponEditorDirtyState(form);
    });
    root.addEventListener('change', function(event) {
      var form = event.target.closest('[data-store-coupon-editor]');
      if (!form) return;
      syncStoreCouponEditorVisibility(form);
      updateStoreCouponEditorDirtyState(form);
    });
    root.addEventListener('click', function(event) {
      var create = event.target.closest('[data-store-coupon-create]');
      if (create) {
        editingStoreCouponCode = '__new_coupon__';
        renderStoreCoupons({ coupons: currentStoreCoupons, products: currentStoreCouponProducts, totals: {
          coupons: currentStoreCoupons.length,
          active: currentStoreCoupons.filter(function(coupon) { return coupon.status === 'active'; }).length,
          draft: currentStoreCoupons.filter(function(coupon) { return coupon.status === 'draft'; }).length
        } });
        scrollStoreCouponEditorIntoView();
        return;
      }
      var edit = event.target.closest('[data-store-coupon-edit]');
      if (edit) {
        editingStoreCouponCode = edit.dataset.storeCouponEdit || '';
        renderStoreCoupons({ coupons: currentStoreCoupons, products: currentStoreCouponProducts, totals: {
          coupons: currentStoreCoupons.length,
          active: currentStoreCoupons.filter(function(coupon) { return coupon.status === 'active'; }).length,
          draft: currentStoreCoupons.filter(function(coupon) { return coupon.status === 'draft'; }).length
        } });
        scrollStoreCouponEditorIntoView();
        return;
      }
      var cancel = event.target.closest('[data-store-coupon-cancel]');
      if (cancel) {
        editingStoreCouponCode = '';
        renderStoreCoupons({ coupons: currentStoreCoupons, products: currentStoreCouponProducts, totals: {
          coupons: currentStoreCoupons.length,
          active: currentStoreCoupons.filter(function(coupon) { return coupon.status === 'active'; }).length,
          draft: currentStoreCoupons.filter(function(coupon) { return coupon.status === 'draft'; }).length
        } });
        return;
      }
      var remove = event.target.closest('[data-store-coupon-delete]');
      if (remove) {
        var code = remove.dataset.storeCouponDelete || '';
        if (!code) return;
        if (!window.confirm('Delete coupon ' + code + '?')) return;
        remove.disabled = true;
        setStatus($('#admin-store-coupons-status'), 'Deleting coupon...');
        requestJson('/admin/store/coupons/delete', {
          method: 'POST',
          body: { code: code }
        }).then(function(data) {
          editingStoreCouponCode = '';
          renderStoreCoupons(data);
          setStatus($('#admin-store-coupons-status'), 'Coupon deleted.');
        }).catch(function(error) {
          remove.disabled = false;
          setStatus($('#admin-store-coupons-status'), formatError(error), true);
        });
      }
    });
    root.addEventListener('submit', function(event) {
      var form = event.target.closest('[data-store-coupon-editor]');
      if (!form) return;
      event.preventDefault();
      if (!storeCouponEditorHasUnsavedChanges(form)) {
        setStatus($('#admin-store-coupons-status'), 'No coupon changes to save.');
        updateStoreCouponEditorDirtyState(form);
        return;
      }
      var save = $('[data-store-coupon-save]', form);
      if (save) save.disabled = true;
      setStatus($('#admin-store-coupons-status'), 'Saving coupon...');
      requestJson('/admin/store/coupons', {
        method: 'POST',
        body: readStoreCouponEditor(form)
      }).then(function(data) {
        editingStoreCouponCode = form.dataset.storeCouponNew === 'true' ? '' : (data.coupon ? data.coupon.code : '');
        renderStoreCoupons(data);
        setStatus($('#admin-store-coupons-status'), 'Coupon saved.');
      }).catch(function(error) {
        updateStoreCouponEditorDirtyState(form);
        setStatus($('#admin-store-coupons-status'), formatError(error), true);
      });
    });
  }

  function createStoreDownloadCreateField(labelText, field, control, helpText) {
    var fieldWrap = createElement(control.type === 'file' ? 'div' : 'label', 'admin-store-downloads__field');
    fieldWrap.dataset.storeDownloadCreateFieldWrapper = field;
    var labelRow = createElement('span', 'admin-store-downloads__field-label', labelText);
    var help = createHelp({
      label: labelText,
      path: 'store-download-create-' + field,
      help: helpText
    }, control);
    if (help) labelRow.appendChild(help);
    control.dataset.storeDownloadCreateField = field;
    fieldWrap.appendChild(labelRow);
    if (control.type === 'file') {
      fieldWrap.appendChild(createAdminFilePicker(control, {
        buttonLabel: 'Choose file',
        emptyLabel: 'No file chosen',
        idPrefix: 'admin-store-download-create-file'
      }));
    } else {
      control.classList.add('admin-settings__input');
      fieldWrap.appendChild(control);
    }
    return fieldWrap;
  }

  function createStoreDownloadCreateForm() {
    var form = createElement('form', 'admin-store-downloads__create');
    form.dataset.storeDownloadCreate = 'true';
    var fields = createElement('div', 'admin-store-downloads__create-fields');
    var file = document.createElement('input');
    file.type = 'file';
    file.required = true;
    file.setAttribute('aria-label', 'Choose download file');

    fields.appendChild(createStoreDownloadCreateField(
      'File',
      'file',
      file,
      'Upload a reusable download file, then select it from a digital product or variant.'
    ));
    form.appendChild(fields);
    var actions = createElement('div', 'admin-store-downloads__create-actions');
    var submit = createElement('button', 'btn', 'Upload file');
    submit.type = 'submit';
    submit.dataset.storeDownloadCreateSubmit = 'true';
    actions.appendChild(submit);
    form.appendChild(actions);
    return form;
  }

  function readStoreDownloadCreateForm(form, file, content) {
    return {
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      content: content
    };
  }

  function createStoreDownloadActions(row, input) {
    var actions = createElement('div', 'admin-store-downloads__actions');
    var fileKey = String(row.fileKey || '').trim();
    var filename = String(row.filename || fileKey || 'download file').trim();
    var replace = createAdminFilePicker(input, {
      buttonClass: 'btn--small',
      buttonLabel: 'Replace',
      className: 'admin-file-picker--compact',
      emptyLabel: 'No file chosen',
      idPrefix: 'admin-store-download-replace-file'
    });
    var deleteButton = createElement('button', 'btn btn--secondary btn--small admin-store-downloads__delete', 'Delete');
    deleteButton.type = 'button';
    deleteButton.dataset.storeDownloadDelete = 'true';
    deleteButton.dataset.fileKey = fileKey;
    deleteButton.dataset.filename = filename;
    deleteButton.setAttribute('aria-label', 'Delete ' + filename);
    if (!fileKey || row.source !== 'r2') {
      deleteButton.disabled = true;
      deleteButton.title = fileKey
        ? 'Only uploaded files can be deleted here.'
        : 'This download does not have a file key.';
    }
    actions.appendChild(replace);
    actions.appendChild(deleteButton);
    return actions;
  }

  function renderStoreDownloads(data) {
    var root = $('#admin-store-downloads-results');
    if (!root) return;
    clear(root);
    var files = Array.isArray(data.files) ? data.files : [];
    currentStoreDownloadFiles = files.length ? files : currentStoreDownloadFiles;
    root.appendChild(createStoreDownloadCreateForm());
    if (!files.length) {
      root.appendChild(createElement('p', 'admin-app__muted', 'No Store downloads are configured.'));
      return;
    }
    var table = createElement('table', 'admin-store-downloads__table');
    var thead = document.createElement('thead');
    var header = document.createElement('tr');
    var columns = ['File', 'Status', 'Attached to', 'Uploaded', 'Actions'];
    columns.forEach(function(text) {
      header.appendChild(createElement('th', '', text));
    });
    thead.appendChild(header);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    files.forEach(function(row) {
      var tr = document.createElement('tr');
      var input = document.createElement('input');
      input.type = 'file';
      input.dataset.storeDownloadUpload = 'true';
      input.dataset.productId = row.productId || '';
      input.dataset.variantId = row.variantId || '';
      input.dataset.fileKey = row.fileKey || '';
      input.setAttribute('aria-label', 'Replacement file for ' + (row.filename || row.fileKey || 'download file'));
      var attachedTo = Array.isArray(row.attachedTo) && row.attachedTo.length
        ? row.attachedTo.map(function(item) { return item.label || item.productId || item.sku || ''; }).filter(Boolean).join(', ')
        : 'Not attached';
      tr.appendChild(createLabeledTableCell('File', row.filename || row.fileKey || '', 'admin-store-downloads__download'));
      tr.appendChild(createLabeledTableCell('Status', row.status || (row.ready ? 'ready' : 'missing'), 'admin-store-downloads__status-cell'));
      tr.appendChild(createLabeledTableCell('Attached to', attachedTo, 'admin-store-downloads__file'));
      tr.appendChild(createLabeledTableCell('Uploaded', formatDate(row.uploadedAt), 'admin-store-downloads__uploaded'));
      tr.appendChild(createLabeledTableCell('Actions', createStoreDownloadActions(row, input), 'admin-store-downloads__upload'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    root.appendChild(table);
  }

  function loadStoreDownloads() {
    var status = $('#admin-store-downloads-status');
    setStatus(status, 'Loading Store downloads...');
    return requestJson('/admin/store/downloads').then(function(data) {
      storeDownloadsLoaded = true;
      renderStoreDownloads(data);
      setStatus(status, '');
    }).catch(function(error) {
      setStatus(status, formatError(error), true);
    });
  }

  function fileToDataUrl(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = function() { reject(reader.error || new Error('Unable to read file.')); };
      reader.readAsDataURL(file);
    });
  }

  function fileToText(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(String(reader.result || '')); };
      reader.onerror = function() { reject(reader.error || new Error('Unable to read file.')); };
      reader.readAsText(file);
    });
  }

  function setupStoreDownloadsEvents() {
    var root = $('#admin-store-downloads-results');
    if (!root) return;
    root.addEventListener('submit', function(event) {
      var form = event.target.closest('[data-store-download-create]');
      if (!form) return;
      event.preventDefault();
      var fileInput = $('[data-store-download-create-field="file"]', form);
      var file = fileInput && fileInput.files ? fileInput.files[0] : null;
      if (!file) {
        setStatus($('#admin-store-downloads-status'), 'Choose a file before uploading.', true);
        return;
      }
      var submit = $('[data-store-download-create-submit]', form);
      if (submit) submit.disabled = true;
      setStatus($('#admin-store-downloads-status'), 'Uploading file...');
      fileToDataUrl(file).then(function(content) {
        return requestJson('/admin/store/downloads/create', {
          method: 'POST',
          body: readStoreDownloadCreateForm(form, file, content)
        });
      }).then(function(data) {
        storeProductsLoaded = false;
        var message = (data.filename || file.name) + ' uploaded.';
        return loadStoreDownloads().finally(function() {
          setStatus($('#admin-store-downloads-status'), message);
        });
      }).catch(function(error) {
        if (submit) submit.disabled = false;
        setStatus($('#admin-store-downloads-status'), formatError(error), true);
      });
    });
    root.addEventListener('change', function(event) {
      var input = event.target.closest('[data-store-download-upload]');
      if (!input || !input.files || !input.files[0]) return;
      var file = input.files[0];
      setStatus($('#admin-store-downloads-status'), 'Uploading ' + file.name + '...');
      fileToDataUrl(file).then(function(content) {
        var fileKey = input.dataset.fileKey || '';
        if (fileKey) {
          return requestJson('/admin/store/downloads/create', {
            method: 'POST',
            body: {
              fileKey: fileKey,
              filename: file.name,
              contentType: file.type || 'application/octet-stream',
              content: content
            }
          });
        }
        return requestJson('/admin/store/downloads/upload', {
          method: 'POST',
          body: {
            productId: input.dataset.productId || '',
            variantId: input.dataset.variantId || '',
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            content: content
          }
        });
      }).then(function(data) {
        var message = (data.filename || file.name) + ' uploaded.';
        return loadStoreDownloads().finally(function() {
          setStatus($('#admin-store-downloads-status'), message);
        });
      }).catch(function(error) {
        setStatus($('#admin-store-downloads-status'), formatError(error), true);
      });
    });
    root.addEventListener('click', function(event) {
      var button = event.target.closest('[data-store-download-delete]');
      if (!button) return;
      var fileKey = String(button.dataset.fileKey || '').trim();
      var filename = String(button.dataset.filename || fileKey || 'download file').trim();
      if (!fileKey) {
        setStatus($('#admin-store-downloads-status'), 'This download does not have a file key.', true);
        return;
      }
      if (!window.confirm('Delete ' + filename + '? Products that reference this file will show it as missing.')) return;
      button.disabled = true;
      setStatus($('#admin-store-downloads-status'), 'Deleting ' + filename + '...');
      requestJson('/admin/store/downloads/delete', {
        method: 'POST',
        body: {
          fileKey: fileKey,
          filename: filename
        }
      }).then(function(data) {
        storeProductsLoaded = false;
        var message = (data.filename || filename) + ' deleted.';
        return loadStoreDownloads().finally(function() {
          setStatus($('#admin-store-downloads-status'), message);
        });
      }).catch(function(error) {
        button.disabled = false;
        setStatus($('#admin-store-downloads-status'), formatError(error), true);
      });
    });
  }

  function initAdminDashboard() {
    if (!$('#admin-login-form') && !$('#admin-app')) return;
    setupAdminTabs();
    setupAuth();
    setupLogout();
    setupAdminFilePickerEvents();
    setupSettingsEvents();
    setupStoreAnalyticsEvents();
    setupStoreMarketingEvents();
    setupStoreOrdersEvents();
    setupStoreProductsEvents();
    setupStoreCouponsEvents();
    setupStoreDownloadsEvents();
  }

  initAdminDashboard();
})();
