(function() {
  'use strict';

  var root = document.getElementById('email-preview-root');
  var parentOrigin = '';
  try {
    parentOrigin = document.referrer ? new URL(document.referrer).origin : '';
  } catch (_error) {
    parentOrigin = '';
  }

  function safePreviewDocument(html) {
    var parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');
    parsed.querySelectorAll('script, iframe, object, embed, form, input, button, meta[http-equiv], base, link').forEach(function(node) {
      node.remove();
    });
    parsed.querySelectorAll('*').forEach(function(node) {
      Array.from(node.attributes).forEach(function(attribute) {
        if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
      });
      if (node instanceof HTMLAnchorElement) {
        node.target = '_blank';
        node.rel = 'noopener noreferrer';
      }
    });
    return parsed;
  }

  function renderPreview(html) {
    if (!root) return;
    var parsed = safePreviewDocument(html);
    document.head.querySelectorAll('[data-email-preview-content-style]').forEach(function(node) {
      node.remove();
    });
    parsed.head.querySelectorAll('style').forEach(function(source) {
      var style = document.createElement('style');
      style.dataset.emailPreviewContentStyle = 'true';
      style.textContent = source.textContent || '';
      document.head.appendChild(style);
    });
    document.body.style.cssText = parsed.body.getAttribute('style') || '';
    root.innerHTML = parsed.body.innerHTML;
  }

  window.addEventListener('message', function(event) {
    if (event.source !== window.parent) return;
    if (parentOrigin && event.origin !== parentOrigin) return;
    if (!event.data || event.data.type !== 'store-event-followup-email-preview') return;
    renderPreview(event.data.html);
  });

  document.addEventListener('click', function(event) {
    if (event.target && event.target.closest && event.target.closest('a')) event.preventDefault();
  });
}());
