/**
 * Stripe utilities for Cloudflare Workers
 */

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
export function createStripeClient(secretKey) {
  const baseUrl = 'https://api.stripe.com/v1';

  async function request(method, path, data, requestOptions = {}) {
    const url = `${baseUrl}${path}`;
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    };

    if (requestOptions.stripeVersion) {
      options.headers['Stripe-Version'] = requestOptions.stripeVersion;
    }

    if (requestOptions.idempotencyKey) {
      options.headers['Idempotency-Key'] = requestOptions.idempotencyKey;
    }

    if (data) {
      options.body = new URLSearchParams(flattenObject(data)).toString();
    }

    const response = await fetch(url, options);
    return response.json();
  }

  return {
    checkout: {
      sessions: {
        create: (data, requestOptions) => request('POST', '/checkout/sessions', data, requestOptions),
        retrieve: (id) => request('GET', `/checkout/sessions/${id}`),
        list: (params) => request('GET', `/checkout/sessions?${new URLSearchParams(params).toString()}`)
      }
    },
    setupIntents: {
      retrieve: (id) => request('GET', `/setup_intents/${id}`)
    },
    paymentIntents: {
      create: (data, requestOptions) => request('POST', '/payment_intents', data, requestOptions),
      retrieve: (id, params = {}) => {
        const query = new URLSearchParams(flattenObject(params)).toString();
        return request('GET', `/payment_intents/${id}${query ? `?${query}` : ''}`);
      }
    },
    customers: {
      create: (data) => request('POST', '/customers', data),
      retrieve: (id) => request('GET', `/customers/${id}`),
      update: (id, data) => request('POST', `/customers/${id}`, data)
    },
    paymentMethods: {
      attach: (id, data) => request('POST', `/payment_methods/${id}/attach`, data),
      retrieve: (id) => request('GET', `/payment_methods/${id}`)
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
