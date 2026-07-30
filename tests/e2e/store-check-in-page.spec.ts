import { expect, test } from '@playwright/test';

import { buildStoreCheckInDocument } from '../../worker/src/index.js';
import { expectNoHorizontalOverflow } from './helpers/mobile';

const longReference = [
  'd990fc50-2e3b-4f14-a42a-fce90ea8413c',
  'customer-supplied-reference-that-must-remain-inside-the-card'
].join('-');

const checkInHtml = buildStoreCheckInDocument({
  lang: 'es',
  pageTitle: 'Verificación de boleto',
  statusLabel: 'Boleto válido',
  statusTone: 'valid',
  heading: 'Este boleto es válido.',
  eventName: 'FILM FATALE at the Guild Cinema — una presentación comunitaria con un título deliberadamente largo',
  variantLabel: 'Entrada general con una etiqueta de variante deliberadamente larga',
  details: [
    { label: 'Cuándo', value: 'sáb, 22 de ago de 2026, 7:30 p.m. MDT' },
    {
      label: 'Dónde',
      value: 'Guild Cinema · 3405 Central Avenue Northeast, Albuquerque, New Mexico 87106, United States of America'
    },
    { label: 'Cantidad', value: '1' },
    {
      label: 'Titular',
      value: 'Una Compradora con un nombre deliberadamente largo que debe permanecer dentro de la tarjeta'
    },
    { label: 'Referencia del pedido', value: longReference, reference: true }
  ],
  notice: 'Esta página verifica el boleto. Los cambios de asistencia siguen disponibles solo para el personal autorizado en la administración de la Tienda.',
  returnLabel: 'Volver a la tienda',
  returnUrl: 'https://shop.dustwave.xyz/es/'
});

test.describe('Store ticket check-in page', () => {
  test('contains long ticket data at phone, tablet, and desktop widths', async ({ page }) => {
    for (const viewport of [
      { name: 'small phone', width: 320, height: 700 },
      { name: 'phone', width: 390, height: 844 },
      { name: 'tablet', width: 768, height: 1024 },
      { name: 'desktop', width: 1280, height: 900 }
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.setContent(checkInHtml);

      await expect(page.getByRole('heading', { name: 'Este boleto es válido.' }), viewport.name).toBeVisible();
      await expect(page.getByText(longReference), viewport.name).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(await page.locator('main, .card, dl, .detail, dd').evaluateAll((elements) => (
        elements.every((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left >= -1 && rect.right <= window.innerWidth + 1;
        })
      )), viewport.name).toBe(true);
    }
  });
});
