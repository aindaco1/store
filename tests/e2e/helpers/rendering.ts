import type { Page } from '@playwright/test';

export async function waitForStableRendering(page: Page, fontTimeoutMs = 2000) {
  await page.evaluate(async (timeoutMs) => {
    const fontsReady = document.fonts?.ready
      ? Promise.resolve(document.fonts.ready).catch(() => undefined)
      : Promise.resolve();
    await Promise.race([
      fontsReady,
      new Promise((resolve) => window.setTimeout(resolve, timeoutMs))
    ]);
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  }, fontTimeoutMs);
}

export async function applyTextScale(page: Page, percent = 200) {
  const stylesheetPath = `/__store-text-scale-${percent}.css`;
  await page.route(`**${stylesheetPath}`, async (route) => {
    await route.fulfill({
      contentType: 'text/css',
      body: `:root { font-size: ${percent}% !important; }`
    });
  });
  await page.addStyleTag({ url: stylesheetPath });
  await waitForStableRendering(page);
}
