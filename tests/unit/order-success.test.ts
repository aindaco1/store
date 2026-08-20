import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

function jsonResponse(payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('order success status recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/es/order-success/?orderToken=store-order-demo123');
    document.documentElement.lang = 'es';
    document.body.innerHTML = `
      <p data-store-order-summary-heading>Tu pago se está finalizando.</p>
      <div data-store-order-success>
        <div data-store-order-status></div>
        <div data-store-order-body hidden></div>
      </div>
    `;
    (window as any).STORE_CONFIG = {
      platform: { workerUrl: 'https://checkout.test' },
        i18n: {
        currentLang: 'es',
        messages: {
          orderSuccess: {
            subtotal: 'Total parcial',
            tax: 'Impuesto',
            total_paid: 'Total pagado',
            order_confirmed: 'Pedido confirmado',
            order_processing: 'Pedido en proceso',
            order: 'Pedido',
            items: 'Artículos',
            loading_order: 'Cargando pedido...',
            still_processing: 'El pago sigue procesándose...',
            payment_processing: 'El pago sigue procesándose.',
            retrying_order: 'Reconectando con tu pedido...',
            ready_fulfillment: 'Listo para cumplimiento.',
            confirmed_heading: 'Tu pedido está confirmado.',
            rsvp_details: 'Datos de la confirmación',
            attendees: 'Asistentes'
          }
        }
      }
    };
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (window as any).STORE_CONFIG;
    document.body.innerHTML = '';
    document.documentElement.lang = 'en';
  });

  it('retries a transient read and replaces processing copy with confirmed Spanish details', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        orderToken: 'store-order-demo123',
        status: 'pending_payment',
        fulfillmentReady: false,
        totals: { subtotalCents: 1500, taxCents: 113, totalCents: 1613, currency: 'USD' },
        payment: { status: 'pending', amountCents: 1613, currency: 'USD' },
        items: []
      }))
      .mockRejectedValueOnce(new TypeError('temporary network failure'))
      .mockResolvedValueOnce(jsonResponse({
        orderToken: 'store-order-demo123',
        status: 'confirmed',
        fulfillmentReady: true,
        confirmedAt: '2026-07-30T03:07:01.981Z',
        totals: { subtotalCents: 1500, taxCents: 113, totalCents: 1613, currency: 'USD' },
        payment: { status: 'succeeded', amountCents: 1613, currency: 'USD' },
        items: [{
          id: 'rsvp-1',
          name: 'Opening RSVP',
          quantity: 2,
          subtotalCents: 0,
          currency: 'USD',
          fulfillmentType: 'rsvp',
          registration: {
            version: 1,
            answers: [{ id: 'accessibility_needs', label: 'Accesibilidad', type: 'textarea', scope: 'party', value: 'Acceso sin escalones' }],
            attendees: [
              { id: 'attendee-1', name: 'Adriana Invitada', answers: [] },
              { id: 'attendee-2', name: 'Samuel Invitado', answers: [] }
            ]
          },
          actions: {}
        }]
      }));
    vi.stubGlobal('fetch', fetchMock);

    await import('../../assets/js/order-success.js');
    await flushPromises();

    expect(document.querySelector('[data-store-order-status]')?.textContent).toBe('El pago sigue procesándose.');

    await vi.advanceTimersByTimeAsync(2500);
    await flushPromises();
    expect(document.querySelector('[data-store-order-status]')?.textContent).toBe('Reconectando con tu pedido...');

    await vi.advanceTimersByTimeAsync(2500);
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(document.querySelector('[data-store-order-status]')?.textContent).toBe('Listo para cumplimiento.');
    expect(document.querySelector('[data-store-order-summary-heading]')?.textContent).toBe('Tu pedido está confirmado.');
    expect(document.querySelector('[data-store-order-body]')?.textContent).toContain('Pedido confirmado');
    expect(document.querySelector('[data-store-order-body]')?.textContent).toContain('Adriana Invitada');
    expect(document.querySelector('[data-store-order-body]')?.textContent).toContain('Acceso sin escalones');
    expect(document.querySelector('[data-store-order-body]')?.textContent).toContain('Total parcial');
  });
});
