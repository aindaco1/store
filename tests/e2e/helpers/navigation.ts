import type { Page } from '@playwright/test';

export function gotoDomReady(page: Page, url: string, options: Parameters<Page['goto']>[1] = {}) {
  return page.goto(url, { waitUntil: 'domcontentloaded', ...options });
}
