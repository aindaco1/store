// Fixture-only policy. Shipping Workers never import this module.
export function acceptanceEnv(env) {
  if (env.APP_MODE !== 'test' || env.SOFTWARE_CHECKOUT_ENABLED !== 'false' ||
      !/^[a-f0-9]{16}$/.test(env.ACCEPTANCE_ID || '') ||
      !/^[a-f0-9]{64}$/.test(env.ACCEPTANCE_SECRET || '') ||
      !/^store-order-[a-f0-9]{64}$/.test(env.ACCEPTANCE_ORDER || '') ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.ACCEPTANCE_EMAIL || '') ||
      !env.STRIPE_SECRET_KEY_TEST?.startsWith('sk_test_') || env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY_LIVE ||
      !env.PLATFORM_NAME?.startsWith('[TEST]') || env.SOFTWARE_RECOVERY_TARGET || env.SOFTWARE_RECOVERY_SOURCE_ID)
    throw new Error('Isolated acceptance configuration required');
  // Only this private fixture entry and its DO adapter select the test checkout.
  return {...env, SOFTWARE_CHECKOUT_ENABLED:'true'};
}
export function acceptanceAuthorized(request, env) {
  return request.headers.get('Authorization') === `Bearer ${env.ACCEPTANCE_SECRET}` ||
    (request.headers.get('Cookie') || '').split(';').some(v=>v.trim() === `acceptance=${env.ACCEPTANCE_SECRET}`);
}
export function acceptanceOwnsEvent(event, orderToken) {
  if (event?.livemode !== false) return false;
  const o=event.data?.object;
  return [o?.metadata?.orderToken,o?.parent?.subscription_details?.metadata?.orderToken].includes(orderToken);
}
export function acceptanceMailAllowed(job, env) {
  const recipients=Array.isArray(job?.providerPayload?.to) ? job.providerPayload.to : [job?.providerPayload?.to || job?.payload?.email];
  return ['software_license','software_billing'].includes(job?.kind) && recipients.length===1 &&
    recipients[0]===env.ACCEPTANCE_EMAIL && job.orderToken===env.ACCEPTANCE_ORDER &&
    (!job.providerPayload || (job.providerPayload.subject?.includes('[TEST]') && !job.providerPayload.cc && !job.providerPayload.bcc));
}
