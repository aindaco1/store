(function () {
  'use strict';

  function activateDeferredStylesheets() {
    document.querySelectorAll('link[data-deferred-stylesheet="true"]').forEach(function (stylesheet) {
      stylesheet.media = 'all';
      stylesheet.removeAttribute('data-deferred-stylesheet');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activateDeferredStylesheets, { once: true });
  } else {
    activateDeferredStylesheets();
  }
})();
