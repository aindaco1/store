function initBuyButtons() {
  if (window.__StoreBuyButtonsLoaded) return;
  window.__StoreBuyButtonsLoaded = true;

  const addButtons = document.querySelectorAll('.store-add-item');
  const getCartProvider = () => window.StoreCartProvider || null;
  const logger = window.StoreLogger?.createLogger('buy-buttons') || {
    debug() {},
    info() {},
    warn() {},
    error() {}
  };

  addButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      if (button.disabled) {
        e.preventDefault();
        logger.debug('Button is disabled (item unavailable)');
        return;
      }
      logger.debug('Adding item to cart:', button.dataset.itemName);
    });
  });

  getCartProvider()?.onReady?.((cartApi) => {
    cartApi?.events?.on('item.added', (item) => {
      logger.debug('Item added to cart:', item);
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBuyButtons, { once: true });
} else {
  initBuyButtons();
}
