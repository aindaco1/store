import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('header nav script', () => {
  beforeEach(() => {
    vi.resetModules();
    window.history.replaceState({}, '', '/order-success/?orderId=order-123#section');
    document.body.innerHTML = `
      <nav id="mobile-nav" class="site-header__nav">
        <a href="/terms/">Terms</a>
      </nav>
      <a href="/es/order-success/" data-lang-switcher-link="true">Español</a>
      <button
        id="menu-toggle"
        aria-expanded="false"
        aria-label="Abrir menú"
        data-open-label="Abrir menú"
        data-close-label="Cerrar menú"
        type="button"></button>
    `;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('toggles and closes the mobile nav accessibly', async () => {
    await import('../../assets/js/header-nav.js');

    const toggle = document.getElementById('menu-toggle') as HTMLButtonElement;
    const nav = document.getElementById('mobile-nav') as HTMLElement;
    const focusSpy = vi.spyOn(toggle, 'focus').mockImplementation(() => {});

    toggle.click();
    expect(nav.classList.contains('is-open')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Cerrar menú');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(nav.classList.contains('is-open')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Abrir menú');
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it('preserves the current query string and hash on language switcher links', async () => {
    await import('../../assets/js/header-nav.js');

    const langLink = document.querySelector('[data-lang-switcher-link="true"]') as HTMLAnchorElement;
    expect(langLink.getAttribute('href')).toBe('/es/order-success/?orderId=order-123#section');
  });

  it('strips admin magic-link tokens while preserving safe admin switcher state', async () => {
    vi.resetModules();
    window.history.replaceState({}, '', '/admin/?admin_login=secret-token&tab=orders#content');
    document.body.innerHTML = `
      <nav id="mobile-nav" class="site-header__nav"></nav>
      <a href="/es/admin/" data-lang-switcher-link="true">Español</a>
      <button id="menu-toggle" data-open-label="Open menu" data-close-label="Close menu" type="button"></button>
    `;

    await import('../../assets/js/header-nav.js');

    const langLink = document.querySelector('[data-lang-switcher-link="true"]') as HTMLAnchorElement;
    expect(langLink.getAttribute('href')).toBe('/es/admin/?tab=orders#content');
  });

  it('updates language switcher links even without the mobile nav controls', async () => {
    vi.resetModules();
    window.history.replaceState({}, '', '/es/admin/?admin_login=secret-token#reports');
    document.body.innerHTML = '<a href="/admin/" data-lang-switcher-link="true">English</a>';

    await import('../../assets/js/header-nav.js');

    const langLink = document.querySelector('[data-lang-switcher-link="true"]') as HTMLAnchorElement;
    expect(langLink.getAttribute('href')).toBe('/admin/#reports');
  });
});
