const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_MAX_TOKEN_LENGTH = 2048;

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isLocalUrl(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  try {
    const hostname = new URL(text).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

function getRequestIp(request) {
  return String(
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For') ||
    ''
  ).split(',')[0].trim();
}

export function shouldBypassTurnstile(env, bypassEnvName) {
  if (!bypassEnvName || !isTruthyEnv(env?.[bypassEnvName])) return false;
  if (String(env?.APP_MODE || '').trim().toLowerCase() === 'test') return true;
  return isLocalUrl(env?.SITE_BASE) || isLocalUrl(env?.WORKER_BASE) || isLocalUrl(env?.CORS_ALLOWED_ORIGIN);
}

export function getTurnstileSecret(env, secretEnvNames = ['TURNSTILE_SECRET_KEY']) {
  for (const name of secretEnvNames) {
    const value = String(env?.[name] || '').trim();
    if (value) return value;
  }
  return '';
}

export function isTurnstileRequired(env, {
  secretEnvNames = ['TURNSTILE_SECRET_KEY'],
  requiredEnvName = '',
  bypassEnvName = ''
} = {}) {
  if (shouldBypassTurnstile(env, bypassEnvName)) return false;
  return Boolean(getTurnstileSecret(env, secretEnvNames)) || isTruthyEnv(env?.[requiredEnvName]);
}

export async function verifyTurnstile(request, env, token, {
  action = '',
  secretEnvNames = ['TURNSTILE_SECRET_KEY'],
  requiredEnvName = '',
  bypassEnvName = ''
} = {}) {
  if (!isTurnstileRequired(env, { secretEnvNames, requiredEnvName, bypassEnvName })) {
    return { ok: true };
  }

  const secret = getTurnstileSecret(env, secretEnvNames);
  if (!secret) {
    return {
      ok: false,
      code: 'challenge_not_configured',
      status: 503,
      error: 'Challenge is not configured'
    };
  }

  const responseToken = String(token || '').trim();
  if (!responseToken || responseToken.length > TURNSTILE_MAX_TOKEN_LENGTH) {
    return {
      ok: false,
      code: 'challenge_required',
      status: 400,
      error: 'Challenge required'
    };
  }

  let result = null;
  try {
    const verifyResponse = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        response: responseToken,
        remoteip: getRequestIp(request) || undefined,
        idempotency_key: crypto.randomUUID()
      })
    });
    result = await verifyResponse.json().catch(() => null);
    if (!verifyResponse.ok) {
      return {
        ok: false,
        code: 'challenge_failed',
        status: 400,
        error: 'Challenge verification failed'
      };
    }
  } catch {
    return {
      ok: false,
      code: 'challenge_unavailable',
      status: 503,
      error: 'Challenge verification unavailable'
    };
  }

  if (!result?.success) {
    return {
      ok: false,
      code: 'challenge_failed',
      status: 400,
      error: 'Challenge verification failed'
    };
  }

  if (action && result.action && result.action !== action) {
    return {
      ok: false,
      code: 'challenge_failed',
      status: 400,
      error: 'Challenge verification failed'
    };
  }

  return { ok: true };
}
