(function() {
  'use strict';

  if (window.StoreFormControlIdentity?.start) return;

  var controlIdCounter = 0;
  var observedRoots = new WeakSet();
  var controlSelector = 'input, select, textarea, button';

  function slugifyControlPart(value, fallback) {
    return String(value || fallback || 'control')
      .trim()
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || fallback || 'control';
  }

  function controlIdentityBase(control) {
    if (!(control instanceof HTMLElement)) return 'control';
    var dataset = control.dataset || {};
    return dataset.storeMarketingCopy ||
      dataset.storeAnalyticsExport ||
      dataset.action ||
      dataset.itemId ||
      dataset.scrollTarget ||
      control.getAttribute('aria-label') ||
      control.textContent ||
      control.className ||
      control.tagName.toLowerCase();
  }

  function ensureControlIdentity(control) {
    if (!(control instanceof HTMLElement) || !control.matches(controlSelector)) return;
    if (control.id || control.getAttribute('name')) return;
    control.id = 'store-form-control-' + slugifyControlPart(controlIdentityBase(control), control.tagName.toLowerCase()) + '-' + String(++controlIdCounter);
  }

  function ensureControlIdentities(root) {
    if (!(root instanceof Element || root instanceof Document || root instanceof DocumentFragment)) return;
    if (root instanceof Element) ensureControlIdentity(root);
    root.querySelectorAll(controlSelector).forEach(ensureControlIdentity);
  }

  function start(root) {
    var target = root || document;
    var observeTarget = target instanceof Document ? target.documentElement : target;
    ensureControlIdentities(target);
    if (!(observeTarget instanceof Element) || observedRoots.has(observeTarget) || !window.MutationObserver) return;
    observedRoots.add(observeTarget);
    var observer = new MutationObserver(function(records) {
      records.forEach(function(record) {
        record.addedNodes.forEach(function(node) {
          ensureControlIdentities(node);
        });
      });
    });
    observer.observe(observeTarget, { childList: true, subtree: true });
  }

  window.StoreFormControlIdentity = { start: start };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      start(document);
    }, { once: true });
  } else {
    start(document);
  }
})();
