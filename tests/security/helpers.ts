export const WORKER_URL = process.env.WORKER_URL || 'http://127.0.0.1:8989';
export const PROD_MODE = process.env.PROD_MODE === 'true';
const DEFAULT_FETCH_TIMEOUT_MS = Number(process.env.SECURITY_FETCH_TIMEOUT_MS || 8000);

export async function securityFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${WORKER_URL}${path}`;
  const headers = new Headers(options.headers);

  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      headers,
      signal: options.signal || controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function expectStatusIn(res: Response, statuses: number[], context?: string) {
  if (!statuses.includes(res.status)) {
    throw new Error(`Expected one of ${statuses.join(', ')}, got ${res.status}${context ? ` for ${context}` : ''}`);
  }
}

export function generateFakeStripeSignature(): string {
  const timestamp = Math.floor(Date.now() / 1000);
  return `t=${timestamp},v1=fake_signature_that_should_fail_verification`;
}

export const STORE_CART_ITEM = {
  id: 't-shirt-2__m',
  price: 30,
  quantity: 1,
  customFields: [
    { name: '_product_type', value: 'physical' },
    { name: '_sku', value: 't-shirt-2' },
    { name: '_variant', value: 'M' }
  ]
};

export const MALICIOUS_STRINGS = [
  '<script>alert(1)</script>',
  '"><script>alert(1)</script>',
  "'; DROP TABLE orders; --",
  '../../../etc/passwd',
  '{{constructor.constructor("alert(1)")()}}'
];

export async function burstRequests(
  fn: () => Promise<Response>,
  count: number
): Promise<Response[]> {
  return Promise.all(Array.from({ length: count }, () => fn()));
}
