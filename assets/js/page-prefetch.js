(function() {
  'use strict';

  if (window.StorePagePrefetch) {
    return;
  }

  var script = document.currentScript ||
    document.querySelector('[data-store-page-prefetch]');
  var delayMs = Math.max(0, Number(script?.dataset?.prefetchDelayMs || 90));
  var prefetchLimit = Math.max(0, Number(script?.dataset?.prefetchLimit || 3));
  var sensitiveParams = new Set([
    'admintoken',
    'email',
    'orderid',
    'publictoken',
    'session',
    'token'
  ]);
  var prefetchedUrls = new Set();
  var pendingTimer = null;
  var pendingLink = null;
  var supportsPrefetchMemo = null;

  function getLogger() {
    return window.StoreLogger?.createLogger?.('page-prefetch') || {
      debug: function() {},
      info: function() {},
      warn: function() {},
      error: function() {}
    };
  }

  function getConnection() {
    return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  }

  function supportsPrefetch() {
    if (supportsPrefetchMemo !== null) return supportsPrefetchMemo;

    try {
      var link = document.createElement('link');
      if (!link.relList) {
        supportsPrefetchMemo = false;
        return supportsPrefetchMemo;
      }
      if (typeof link.relList.supports !== 'function') {
        supportsPrefetchMemo = true;
        return supportsPrefetchMemo;
      }
      supportsPrefetchMemo = link.relList.supports('prefetch');
      return supportsPrefetchMemo;
    } catch (_error) {
      supportsPrefetchMemo = false;
      return supportsPrefetchMemo;
    }
  }

  function canUseNetworkForPrefetch() {
    if (prefetchLimit <= 0) return false;
    if (!supportsPrefetch()) return false;
    if (document.visibilityState && document.visibilityState !== 'visible') return false;

    var connection = getConnection();
    if (connection?.saveData === true) return false;
    var effectiveType = String(connection?.effectiveType || '').toLowerCase();
    if (effectiveType === 'slow-2g' || effectiveType === '2g') return false;

    return true;
  }

  function getLocaleStrippedPath(pathname) {
    var path = String(pathname || '/').toLowerCase();
    if (!path.startsWith('/')) path = '/' + path;
    path = path.replace(/\/+/g, '/');
    path = path.replace(/^\/[a-z]{2,3}(?:-[a-z0-9]{2,8})?(?=\/)/, '');
    return path || '/';
  }

  function isAllowedPublicPath(pathname) {
    var path = getLocaleStrippedPath(pathname);
    if (path === '/' || path === '/terms/') {
      return true;
    }
    return /^\/products\/[^/?#]+\/?$/.test(path);
  }

  function isBlockedPath(pathname) {
    var path = getLocaleStrippedPath(pathname);
    return /^\/(?:admin|cart|checkout|orders|order-success|api|worker)(?:\/|$)/.test(path);
  }

  function hasSensitiveQuery(url) {
    var foundSensitiveParam = false;
    url.searchParams.forEach(function(_value, key) {
      if (sensitiveParams.has(String(key || '').toLowerCase())) {
        foundSensitiveParam = true;
      }
    });
    return foundSensitiveParam;
  }

  function isCurrentDocumentNavigation(url) {
    var current = new URL(window.location.href);
    return url.origin === current.origin &&
      url.pathname === current.pathname &&
      url.search === current.search;
  }

  function normalizePrefetchUrl(url) {
    var normalized = new URL(url.href);
    normalized.hash = '';
    return normalized.href;
  }

  function getEligibleUrl(link) {
    if (!(link instanceof HTMLAnchorElement)) return null;
    if (!link.href) return null;
    if (link.hasAttribute('download')) return null;
    if (link.hasAttribute('data-no-prefetch')) return null;

    var rel = String(link.getAttribute('rel') || '').toLowerCase().split(/\s+/);
    if (rel.includes('nofollow')) return null;

    var target = String(link.getAttribute('target') || '').trim().toLowerCase();
    if (target && target !== '_self') return null;

    var url;
    try {
      url = new URL(link.href, window.location.href);
    } catch (_error) {
      return null;
    }

    if (url.origin !== window.location.origin) return null;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (isCurrentDocumentNavigation(url)) return null;
    if (hasSensitiveQuery(url)) return null;
    if (isBlockedPath(url.pathname)) return null;
    if (!isAllowedPublicPath(url.pathname)) return null;

    return normalizePrefetchUrl(url);
  }

  function findLink(event) {
    return event.target?.closest?.('a[href]') || null;
  }

  function prefetchUrl(url, reason) {
    if (!url) return false;
    if (!canUseNetworkForPrefetch()) return false;
    if (prefetchedUrls.has(url)) return false;
    if (prefetchedUrls.size >= prefetchLimit) return false;

    var link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'document';
    link.href = url;
    link.dataset.storePagePrefetch = 'true';
    if (reason) {
      link.dataset.prefetchReason = reason;
    }
    document.head.appendChild(link);
    prefetchedUrls.add(url);
    getLogger().debug('Prefetched likely navigation', { url: url, reason: reason || '' });
    return true;
  }

  function prefetchLink(link, reason) {
    return prefetchUrl(getEligibleUrl(link), reason);
  }

  function clearPending(link) {
    if (!pendingTimer) return;
    if (link && pendingLink && link !== pendingLink) return;
    window.clearTimeout(pendingTimer);
    pendingTimer = null;
    pendingLink = null;
  }

  function queuePrefetch(link, reason, delay) {
    var url = getEligibleUrl(link);
    if (!url || prefetchedUrls.has(url)) return;
    clearPending();
    pendingLink = link;
    pendingTimer = window.setTimeout(function() {
      pendingTimer = null;
      pendingLink = null;
      prefetchUrl(url, reason);
    }, delay);
  }

  function handleIntent(event) {
    var link = findLink(event);
    if (!link) return;

    if (event.type === 'touchstart') {
      prefetchLink(link, 'touchstart');
      return;
    }

    queuePrefetch(link, event.type, delayMs);
  }

  function handleCancel(event) {
    var link = findLink(event);
    if (!link) return;
    clearPending(link);
  }

  document.addEventListener('pointerover', handleIntent, {
    capture: true,
    passive: true
  });
  document.addEventListener('focusin', handleIntent, true);
  document.addEventListener('touchstart', handleIntent, {
    capture: true,
    passive: true
  });
  document.addEventListener('pointerout', handleCancel, {
    capture: true,
    passive: true
  });
  document.addEventListener('focusout', handleCancel, true);

  var runtime = {
    canUseNetworkForPrefetch: canUseNetworkForPrefetch,
    getEligibleUrl: getEligibleUrl,
    prefetch: prefetchLink,
    prefetchUrl: prefetchUrl,
    getPrefetchedUrls: function() {
      return Array.from(prefetchedUrls);
    }
  };
  window.StorePagePrefetch = runtime;
})();
