import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worker, {
  buildStoreTicketEmailArtifacts,
  signStoreFulfillmentToken
} from '../../worker/src/index.js';

class MockKVNamespace {
  store = new Map<string, string>();

  async get(key: string, options?: { type?: string }) {
    if (!this.store.has(key)) return null;
    const value = this.store.get(key) as string;
    if (options?.type === 'json') return JSON.parse(value);
    return value;
  }

  async put(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

const ORDER_TOKEN = 'store-order-d990fc50-2e3b-4f14-a42a-fce90ea8413c';
const ITEM_ID = 'film-fatale-at-the-guild-cinema';
const SITE_BASE = 'http://127.0.0.1:4002';
const WORKER_BASE = 'http://127.0.0.1:8989';

const I18N_CATALOG = {
  en: {
    fulfillment: {
      check_in: {
        ticket_title: 'Ticket verification',
        valid_status: 'Valid ticket',
        valid_heading: 'This ticket is valid.',
        when: 'When',
        where: 'Where',
        quantity: 'Quantity',
        holder: 'Holder',
        order_reference: 'Order reference',
        staff_note: 'This page verifies the ticket. Attendance changes remain available only to authorized staff in the Store admin.',
        error_title: 'Unable to verify ticket',
        expired_error: 'This ticket link has expired. Open the latest ticket from the order page.',
        return_to_store: 'Return to the store'
      }
    }
  },
  es: {
    fulfillment: {
      check_in: {
        ticket_title: 'Verificación de boleto',
        valid_status: 'Boleto válido',
        valid_heading: 'Este boleto es válido.',
        when: 'Cuándo',
        where: 'Dónde',
        quantity: 'Cantidad',
        holder: 'Titular',
        order_reference: 'Referencia del pedido',
        staff_note: 'Esta página verifica el boleto. Los cambios de asistencia siguen disponibles solo para el personal autorizado en la administración de la Tienda.',
        error_title: 'No se pudo verificar el boleto',
        expired_error: 'Este enlace de boleto ha caducado. Abre el boleto más reciente desde la página del pedido.',
        return_to_store: 'Volver a la tienda'
      }
    }
  }
};

function buildTicketOrder() {
  return {
    orderToken: ORDER_TOKEN,
    status: 'confirmed',
    createdAt: '2026-07-29T12:00:00.000Z',
    confirmedAt: '2026-07-29T12:01:00.000Z',
    orderDraft: {
      orderToken: ORDER_TOKEN,
      status: 'confirmed',
      preferredLang: 'es',
      customer: {
        email: 'buyer@example.com',
        name: 'Compradora Ejemplo'
      },
      items: [{
        sku: ITEM_ID,
        productId: ITEM_ID,
        name: 'FILM FATALE at the Guild Cinema',
        variantLabel: 'Entrada general',
        quantity: 1,
        subtotalCents: 1500,
        fulfillmentType: 'ticket',
        eventDetails: {
          starts_at: '2026-08-22T19:30:00-06:00',
          ends_at: '2026-08-22T21:30:00-06:00',
          venue: 'Guild Cinema',
          address: '3405 Central Ave NE Albuquerque, NM 87106'
        }
      }],
      totals: {
        itemCount: 1,
        totalCents: 1500
      }
    },
    payment: {
      required: true,
      status: 'succeeded',
      amountCents: 1500,
      currency: 'USD'
    }
  };
}

function buildEnv(storeState = new MockKVNamespace()) {
  return {
    SITE_BASE,
    WORKER_BASE,
    CORS_ALLOWED_ORIGIN: SITE_BASE,
    PLATFORM_TIMEZONE: 'America/Denver',
    STORE_FULFILLMENT_SECRET: 'local-fulfillment-secret',
    STORE_STATE: storeState,
    RATELIMIT: new MockKVNamespace(),
    OBSERVABILITY_SAMPLE_RATE: '0',
    I18N_CATALOG
  } as any;
}

function storeRequest(url: string, env: any, accept = 'application/json') {
  return worker.fetch(new Request(url, {
    headers: {
      Accept: accept,
      Origin: SITE_BASE,
      'CF-Connecting-IP': '127.0.0.1'
    }
  }), env);
}

async function seedOrder() {
  const storeState = new MockKVNamespace();
  await storeState.put(`orders:${ORDER_TOKEN}`, JSON.stringify(buildTicketOrder()));
  const env = buildEnv(storeState);
  return { env, storeState };
}

async function getSummary(env: any) {
  const response = await storeRequest(`${WORKER_BASE}/api/orders/${ORDER_TOKEN}`, env);
  expect(response.status).toBe(200);
  return response.json();
}

describe('Store ticket check-in page', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T18:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses an event-scoped expiry for ticket, check-in, and calendar actions', async () => {
    const { env } = await seedOrder();
    const summary = await getSummary(env);
    const actions = summary.items[0].actions;

    expect(actions.ticket.expiresInSeconds).toBeGreaterThan(72 * 60 * 60);
    expect(actions.checkIn.expiresInSeconds).toBe(actions.ticket.expiresInSeconds);
    expect(actions.calendar.expiresInSeconds).toBe(actions.ticket.expiresInSeconds);
  });

  it('marks newly generated ticket QR destinations as browser pages', async () => {
    const { env } = await seedOrder();
    const order = buildTicketOrder();
    const item = order.orderDraft.items[0];
    const artifacts = await buildStoreTicketEmailArtifacts(env, order, item, ITEM_ID);
    const checkInUrl = new URL(artifacts?.checkInUrl || '');

    expect(checkInUrl.searchParams.get('format')).toBe('html');
    expect(checkInUrl.searchParams.get('token')).toBeTruthy();
    expect(artifacts?.tokenTtlSeconds).toBeGreaterThan(72 * 60 * 60);
  });

  it('does not extend a near-event QR beyond the event check-in window', async () => {
    vi.setSystemTime(new Date('2026-08-22T18:00:00.000Z'));
    const { env } = await seedOrder();
    const order = buildTicketOrder();
    const item = order.orderDraft.items[0];
    const artifacts = await buildStoreTicketEmailArtifacts(env, order, item, ITEM_ID);

    expect(artifacts?.tokenTtlSeconds).toBeGreaterThan(24 * 60 * 60);
    expect(artifacts?.tokenTtlSeconds).toBeLessThan(72 * 60 * 60);
  });

  it('renders a localized, private browser page without exposing customer email', async () => {
    const { env } = await seedOrder();
    const summary = await getSummary(env);
    const response = await storeRequest(summary.items[0].actions.checkIn.href, env, 'text/html');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(response.headers.get('Cache-Control')).toContain('private, no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(response.headers.get('Content-Language')).toBe('es');
    expect(response.headers.get('Vary')).toBe('Accept');
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('Verificación de boleto');
    expect(html).toContain('Este boleto es válido.');
    expect(html).toContain('Compradora Ejemplo');
    expect(html).toContain('d990fc50-2e3b-4f14-a42a-fce90ea8413c');
    expect(html).not.toContain(ORDER_TOKEN);
    expect(html).not.toContain('buyer@example.com');
    expect(html).toContain('max-width: 100%');
    expect(html).toContain('overflow-wrap: anywhere');
  });

  it('preserves the JSON representation for API clients', async () => {
    const { env } = await seedOrder();
    const summary = await getSummary(env);
    const response = await storeRequest(summary.items[0].actions.checkIn.href, env);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Vary')).toBe('Accept');
    expect(body).toMatchObject({
      ok: true,
      valid: true,
      checkedIn: false,
      orderToken: ORDER_TOKEN,
      customer: {
        name: 'Compradora Ejemplo'
      }
    });
    expect(body.customer).not.toHaveProperty('email');
  });

  it('honors an already-issued 72-hour QR through the event window, then expires it', async () => {
    const { env } = await seedOrder();
    const legacyToken = await signStoreFulfillmentToken(env, {
      orderToken: ORDER_TOKEN,
      itemId: ITEM_ID,
      action: 'check_in'
    }, 72 * 60 * 60);
    const checkInUrl = `${WORKER_BASE}/api/orders/${ORDER_TOKEN}/check-in/${ITEM_ID}?token=${encodeURIComponent(legacyToken)}`;

    vi.setSystemTime(new Date('2026-08-05T18:00:00.000Z'));
    const duringEventWindow = await storeRequest(checkInUrl, env, 'text/html');
    expect(duringEventWindow.status).toBe(200);
    expect(await duringEventWindow.text()).toContain('Este boleto es válido.');

    vi.setSystemTime(new Date('2026-08-25T18:00:00.000Z'));
    const afterEventWindow = await storeRequest(checkInUrl, env, 'text/html');
    const expiredHtml = await afterEventWindow.text();
    expect(afterEventWindow.status).toBe(410);
    expect(afterEventWindow.headers.get('Content-Type')).toContain('text/html');
    expect(expiredHtml).toContain('Este enlace de boleto ha caducado.');
  });
});
