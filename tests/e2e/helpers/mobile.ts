import { expect } from '@playwright/test';

export async function expectNoHorizontalOverflow(page: any) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.scrollingElement || document.documentElement;
        return Math.ceil(root.scrollWidth - window.innerWidth);
      })
    )
    .toBeLessThanOrEqual(1);
}
