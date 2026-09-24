// One Store policy shared by the gateway and inventory coordinator.
export const CHECKOUT_ATTEMPT_PATTERN = /^[a-f0-9]{64}$/;
export const CHECKOUT_RETENTION_SECONDS = 30 * 86400;
export function checkoutPolicy(env = {}) {
  return {
    seconds: Math.min(1800, Math.max(600, Number(env.CHECKOUT_HOLD_SECONDS) || 600)),
    extensions: 10
  };
}
export function checkoutStripeKey(env = {}) {
  const mode = String(env.APP_MODE || 'live').toLowerCase() === 'test' ? 'TEST' : 'LIVE';
  return env[`STRIPE_SECRET_KEY_${mode}`] || env.STRIPE_SECRET_KEY;
}
