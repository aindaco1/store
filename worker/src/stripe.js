/**
 * Stripe utilities for Cloudflare Workers
 */

export const DEFAULT_STRIPE_API_VERSION = '2026-02-25.clover';

export class StripeApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'StripeApiError';
    this.type = details.type || 'stripe_api_error';
    this.code = details.code || '';
    this.declineCode = details.declineCode || '';
    this.statusCode = Number(details.statusCode || 0) || 0;
    this.requestId = details.requestId || '';
    this.objectId = details.objectId || '';
    this.retryable = details.retryable === true;
  }
}

/**
 * Verify Stripe webhook signature
 * @see https://stripe.com/docs/webhooks/signatures
 */
export async function verifyStripeSignature(payload, signature, secret) {
  if (!signature || !secret) {
    return { valid: false, error: 'Missing signature or secret' };
  }

  // Parse signature header: t=timestamp,v1=signature1,v1=signature2,...
  const parts = signature.split(',');
  const timestampPart = parts.find(p => p.startsWith('t='));
  const signatureParts = parts.filter(p => p.startsWith('v1='));

  if (!timestampPart || signatureParts.length === 0) {
    return { valid: false, error: 'Invalid signature format' };
  }

  const timestamp = timestampPart.split('=')[1];
  const signatures = signatureParts.map(p => p.split('=')[1]);

  // Check timestamp tolerance (5 minutes)
  const tolerance = 300;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > tolerance) {
    return { valid: false, error: 'Timestamp outside tolerance' };
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(signedPayload)
  );

  const expectedSignature = arrayBufferToHex(signatureBytes);

  // Compare against all v1 signatures (Stripe may send multiple)
  const valid = signatures.some(sig => timingSafeEqual(sig, expectedSignature));

  return { valid, timestamp: parseInt(timestamp) };
}

/**
 * Convert ArrayBuffer to hex string
 */
function arrayBufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Timing-safe string comparison
 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Create a minimal Stripe API client for Workers
 */
export function createStripeClient(secretKey, clientOptions = {}) {
  const baseUrl = 'https://api.stripe.com/v1';

  async function notifyRequest(event) {
    try {
      await clientOptions.onRequest?.(event);
    } catch {
      // Observability must never change payment behavior.
    }
  }

  function safeStripeErrorMessage(payload, status) {
    const error = payload?.error || {};
    return String(error.message || `Stripe API request failed (${status})`).replace(/\s+/g, ' ').trim().slice(0, 320);
  }

  function stripeErrorDetails(payload, response) {
    const error = payload?.error || {};
    const statusCode = response.status;
    return {
      type: String(error.type || 'stripe_api_error'),
      code: String(error.code || ''),
      declineCode: String(error.decline_code || ''),
      statusCode,
      requestId: String(response.headers?.get?.('request-id') || error.request_id || ''),
      objectId: String(error.payment_intent?.id || error.setup_intent?.id || error.charge || ''),
      retryable: statusCode === 409 || statusCode === 429 || statusCode >= 500
    };
  }

  async function request(method, path, data, requestOptions = {}) {
    const url = `${baseUrl}${path}`;
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'store-worker/1.0.9'
      }
    };

    const stripeVersion = requestOptions.stripeVersion || clientOptions.stripeVersion || DEFAULT_STRIPE_API_VERSION;
    if (stripeVersion) {
      options.headers['Stripe-Version'] = stripeVersion;
    }

    if (requestOptions.idempotencyKey) {
      options.headers['Idempotency-Key'] = requestOptions.idempotencyKey;
    }

    if (data) {
      options.body = new URLSearchParams(flattenObject(data)).toString();
    }

    let response;
    let payload = {};
    try {
      response = await fetch(url, options);
      payload = await response.json().catch(() => ({}));
    } catch (_error) {
      const networkError = new StripeApiError('Stripe API request failed before a response was received', {
        type: 'network_error',
        retryable: true
      });
      await notifyRequest({
        method,
        path: String(path || '').split('?')[0],
        idempotencyKey: String(requestOptions.idempotencyKey || ''),
        stripeVersion,
        success: false,
        status: 0,
        errorType: networkError.type,
        retryable: true
      });
      throw networkError;
    }

    const requestEvent = {
      method,
      path: String(path || '').split('?')[0],
      idempotencyKey: String(requestOptions.idempotencyKey || ''),
      stripeVersion,
      success: response.ok,
      status: response.status,
      requestId: String(response.headers?.get?.('request-id') || ''),
      objectId: String(payload?.id || ''),
      objectType: String(payload?.object || ''),
      errorType: String(payload?.error?.type || ''),
      errorCode: String(payload?.error?.code || '')
    };
    await notifyRequest(requestEvent);

    if (!response.ok) {
      throw new StripeApiError(safeStripeErrorMessage(payload, response.status), stripeErrorDetails(payload, response));
    }
    return payload;
  }

  return {
    checkout: {
      sessions: {
        create: (data, requestOptions) => request('POST', '/checkout/sessions', data, requestOptions),
        retrieve: (id, requestOptions) => request('GET', `/checkout/sessions/${id}`, null, requestOptions),
        list: (params, requestOptions) => request('GET', `/checkout/sessions?${new URLSearchParams(params).toString()}`, null, requestOptions)
      }
    },
    setupIntents: {
      retrieve: (id, requestOptions) => request('GET', `/setup_intents/${id}`, null, requestOptions)
    },
    paymentIntents: {
      create: (data, requestOptions) => request('POST', '/payment_intents', data, requestOptions),
      retrieve: (id, params = {}) => {
        const query = new URLSearchParams(flattenObject(params)).toString();
        return request('GET', `/payment_intents/${id}${query ? `?${query}` : ''}`);
      }
    },
    customers: {
      create: (data, requestOptions) => request('POST', '/customers', data, requestOptions),
      retrieve: (id, requestOptions) => request('GET', `/customers/${id}`, null, requestOptions),
      update: (id, data, requestOptions) => request('POST', `/customers/${id}`, data, requestOptions)
    },
    paymentMethods: {
      attach: (id, data, requestOptions) => request('POST', `/payment_methods/${id}/attach`, data, requestOptions),
      retrieve: (id, requestOptions) => request('GET', `/payment_methods/${id}`, null, requestOptions)
    }
  };
}

function flattenObject(obj, prefix = '') {
  const result = {};
  for (const key in obj) {
    const value = obj[key];
    const newKey = prefix ? `${prefix}[${key}]` : key;

    if (Array.isArray(value)) {
      // Handle arrays: payment_method_types[0]=card, payment_method_types[1]=...
      value.forEach((item, index) => {
        if (typeof item === 'object' && item !== null) {
          Object.assign(result, flattenObject(item, `${newKey}[${index}]`));
        } else {
          result[`${newKey}[${index}]`] = item;
        }
      });
    } else if (typeof value === 'object' && value !== null) {
      Object.assign(result, flattenObject(value, newKey));
    } else {
      result[newKey] = value;
    }
  }
  return result;
}
