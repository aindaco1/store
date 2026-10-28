import { expect, test } from '@playwright/test';

import { sendStoreEventReminderEmail } from '../../worker/src/email.js';
import { expectNoHorizontalOverflow } from './helpers/mobile';

const orderToken = `store-order-${'1234567890abcdef'.repeat(4)}`;
const venue = 'The Cell Theatre at FUSION';
const address = '708 1st St NW Albuquerque, NM 87102';

test.describe('Store event reminder email', () => {
  for (const reminderLabel of ['1 day before', '1 hour before']) {
    test(`${reminderLabel} keeps the venue and full order reference inside the card`, async ({ page }) => {
      const env: any = {
        RESEND_API_KEY: 'test_capture_only',
        STORE_EMAIL_CAPTURE_PAYLOAD: 'true',
        SITE_BASE: 'https://store.example',
        I18N_CATALOG: { en: { email: {} } }
      };
      await sendStoreEventReminderEmail(env, {
        email: 'buyer@example.com',
        orderToken,
        orderUrl: `https://store.example/order-success/?orderToken=${orderToken}`,
        eventTitle: 'A Night in Paradiso',
        eventTime: 'Sat, Oct 24, 2026, 7:00 PM MDT',
        venue,
        address,
        reminderLabel,
        preferredLang: 'en'
      });
      const payload = env.__STORE_CAPTURED_EMAIL_PAYLOAD;
      expect(payload.text).toContain(orderToken);
      await page.route('**/*', (route) => route.abort());

      for (const width of [320, 390, 768, 1280]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.setContent(payload.html);
        await expect(page.getByText(`${venue}, ${address}`, { exact: true })).toBeVisible();
        await expect(page.getByText(orderToken, { exact: true })).toBeVisible();
        await expectNoHorizontalOverflow(page);
        expect(await page.locator('table').evaluate((table) => {
          const card = table.parentElement!.getBoundingClientRect();
          return [table, ...table.querySelectorAll('td')].every((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.left >= card.left && bounds.right <= card.right
              && element.scrollWidth <= element.clientWidth + 1;
          });
        }), `details fit the card at ${width}px`).toBe(true);
      }
    });
  }
});
