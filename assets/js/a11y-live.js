(function () {
'use strict';

function announcePendingLiveText() {
  const region = document.getElementById('aria-live-region');
  if (!region) return;

  const announcers = document.querySelectorAll('[data-live-announce]');
  announcers.forEach((announcer) => {
    const text = announcer.getAttribute('data-live-announce');
    if (!text) return;
    region.textContent = text;
    announcer.removeAttribute('data-live-announce');
    setTimeout(() => {
      if (region.textContent === text) {
        region.textContent = '';
      }
    }, 1000);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', announcePendingLiveText, { once: true });
} else {
  announcePendingLiveText();
}

})();
