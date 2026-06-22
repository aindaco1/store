import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('a11y live announcer', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="aria-live-region"></div>
      <span data-live-announce="Item added to cart"></span>
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('announces pending live text and clears it', async () => {
    await import('../../assets/js/a11y-live.js');

    const region = document.getElementById('aria-live-region') as HTMLElement;
    const announcer = document.querySelector('[data-live-announce]') as HTMLElement | null;

    expect(region.textContent).toBe('Item added to cart');
    expect(announcer).toBeNull();

    vi.advanceTimersByTime(1000);
    expect(region.textContent).toBe('');
  });
});
