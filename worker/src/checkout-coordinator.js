import { createStoreStripeClient, storeReconciliationBreak, recordStripeProcessorEvent } from './payment-integrity.js';
import { cancelStorePaymentIntent } from './stripe.js';
import { CHECKOUT_ATTEMPT_PATTERN, CHECKOUT_RETENTION_SECONDS, checkoutPolicy, checkoutStripeKey } from './checkout-policy.js';

const key = (id) => `checkout:${id}`;
const orderToken = (id) => `store-order-${id}`;
const pinnedExpiry = '9999-12-31T23:59:59.999Z';
const terminal = (record) => ['confirmed', 'expired', 'released'].includes(record?.phase);
const error = (code, message, status = 409) => ({ success: false, code, error: message, status });
const dueKey = (at, id) => `checkout-due:${String(at).padStart(15, '0')}:${id}`;

// Lives in the existing inventory DO. Every stock/attempt transition is one
// storage transaction; provider I/O is outside it and uses a frozen request.
export function checkoutCoordinator(owner, mechanics) {
  const { ctx, env } = owner;
  const { getWorkingState, putWorkingState, reserveCounts, syncInventoryToKv } = mechanics;
  const policy = checkoutPolicy(env);
  const paymentCreations = new Map();
  const view = (record) => ({
    success: true, attemptId: record.id, phase: record.phase,
    expiresAt: new Date(record.expiresAt).toISOString(), serverTime: new Date().toISOString(),
    extensionsRemaining: Math.max(0, policy.extensions - record.extensions),
    heldQuantity: Object.values(record.ticketCounts || {}).reduce((sum, count) => sum + count, 0),
    ...(record.phase === 'confirmed' ? { orderToken: orderToken(record.id) } : {})
  });

  async function save(storage, record, nextAt) {
    if (record.dueAt) await storage.delete(dueKey(record.dueAt, record.id));
    record.dueAt = nextAt;
    await storage.put(key(record.id), record);
    await storage.put(dueKey(nextAt, record.id), record.id);
    const alarm = await storage.getAlarm();
    if (!alarm || alarm > nextAt) await storage.setAlarm(nextAt);
  }

  async function mutate(id, callback) {
    return ctx.storage.transaction(async (storage) => {
      const record = await storage.get(key(id));
      const state = await getWorkingState(storage);
      const result = await callback(record, state, storage);
      return result;
    });
  }

  async function hold(body) {
    const previousOrder = await env.STORE_STATE.get(`orders:${orderToken(body.attemptId)}`, { type: 'json' });
    return ctx.storage.transaction(async (storage) => {
      let record = await storage.get(key(body.attemptId));
      if (!record && previousOrder) {
        if (previousOrder.status !== 'confirmed' && previousOrder.payment?.status !== 'canceled') return error('payment_resolving', 'We are checking your payment. Do not pay again.');
        return view({ id: body.attemptId, phase: previousOrder.status === 'confirmed' ? 'confirmed' : 'released', expiresAt: Date.now(), extensions: 0 });
      }
      const state = await getWorkingState(storage, body.inventory);
      if (record?.phase === 'held' && record.expiresAt <= Date.now()) {
        delete state.reservations[orderToken(record.id)];
        record.phase = 'expired';
        await putWorkingState(storage, state);
        await save(storage, record, Date.now() + CHECKOUT_RETENTION_SECONDS * 1000);
      }
      if (record && (record.phase !== 'held' || record.expiresAt <= Date.now())) {
        return record.phase === 'held' ? error('hold_expired', 'Your hold ended. Check availability again.') :
          (record.selection !== body.selection && !terminal(record) ? error('checkout_locked', 'Payment has already started. Return to your cart before changing this order.') : view(record));
      }
      record ||= { id: body.attemptId, phase: 'held', createdAt: Date.now(), expiresAt: Date.now() + (Object.keys(body.counts || {}).length ? policy.seconds : 86400) * 1000, extensions: 0 };
      const result = reserveCounts(state, orderToken(record.id), body.counts, new Date(record.expiresAt).toISOString());
      if (!result.success) return result;
      record.counts = body.counts;
      record.ticketCounts = body.counts;
      record.selection = body.selection;
      await putWorkingState(storage, state);
      await save(storage, record, record.expiresAt);
      return view(record);
    });
  }

  async function extend(body) {
    return mutate(body.attemptId, async (record, state, storage) => {
      if (!record || !['held', 'payment'].includes(record.phase) || record.cancelRequested || record.expiresAt <= Date.now()) return error('hold_expired', 'Your hold ended. Check availability again.');
      if (record.extensions >= policy.extensions) return error('extension_limit', 'The time extension limit has been reached.');
      // Extend only near expiry. A duplicate request cannot consume another extension.
      if (record.expiresAt - Date.now() > 120000) return view(record);
      record.extensions += 1;
      record.expiresAt += policy.seconds * 1000;
      const reserved = reserveCounts(state, orderToken(record.id), record.counts, record.phase === 'payment' ? pinnedExpiry : new Date(record.expiresAt).toISOString());
      if (!reserved.success) return reserved;
      await putWorkingState(storage, state);
      await save(storage, record, record.expiresAt);
      return view(record);
    });
  }

  async function pay(body) {
    const prepared = await ctx.storage.transaction(async (storage) => {
      let record = await storage.get(key(body.attemptId));
      if (!record) return error('hold_required', 'Start checkout again to check availability.');
      if (terminal(record)) return record.phase === 'confirmed' ? { ...view(record), requiresPayment: false, nextAction: 'order_confirmed' } : error('hold_expired', 'Your hold ended. Check availability again.');
      if (record.phase === 'held') {
        if (record.expiresAt <= Date.now()) return error('hold_expired', 'Your hold ended. Check availability again.');
        if (record.selection !== body.selection) return error('cart_changed', 'Your cart changed. Return to your cart to check availability.');
        const state = await getWorkingState(storage, body.inventory);
        const reserved = reserveCounts(state, orderToken(record.id), body.counts, pinnedExpiry);
        if (!reserved.success) return reserved;
        record = { ...record, counts: body.counts, phase: 'creating', paymentStartedAt: Date.now(), orderHash: body.order.orderHash, order: body.order, params: body.params, publishableKey: body.publishableKey };
        await putWorkingState(storage, state);
        await save(storage, record, Date.now() + 30000);
      }
      if (record.orderHash !== body.order.orderHash) return error('checkout_locked', 'Payment has already started. Return to your cart before changing this order.');
      return { record };
    });
    if (!prepared.record) return prepared;
    const record = await createPayment(prepared.record);
    if (record.phase === 'confirmed') return { ...view(record), requiresPayment: false, nextAction: 'order_confirmed' };
    if (record.phase !== 'payment' || record.cancelRequested || record.expiresAt <= Date.now()) return error('payment_resolving', 'We are checking this payment. Do not pay again.', 409);
    return { ...view(record), checkoutUiMode: 'payment_intent', nextAction: 'confirm_payment', requiresPayment: true,
      orderToken: orderToken(record.id), paymentIntentId: record.paymentIntentId, clientSecret: record.clientSecret,
      publishableKey: record.publishableKey, totals: record.order.orderDraft.totals, orderDraft: record.order.orderDraft };
  }

  async function createPayment(record) {
    if (paymentCreations.has(record.id)) return paymentCreations.get(record.id);
    const pending = performPaymentCreation(record).finally(() => paymentCreations.delete(record.id));
    paymentCreations.set(record.id, pending);
    return pending;
  }

  async function performPaymentCreation(record) {
    if (record.phase !== 'creating') return record;
    // Never replay creation after Stripe's minimum 24-hour idempotency window.
    if (Date.now() - record.paymentStartedAt >= 23 * 3600000) {
      await storeReconciliationBreak(env, { orderToken: orderToken(record.id), reasons: ['checkout_creation_unresolved'], source: 'checkout_alarm', severity: 'critical' });
      return mutate(record.id, async (current, _state, storage) => {
        if (current.phase === 'creating') {
          current.phase = 'unresolved';
          // The order checkpoint is already in canonical KV; creation can no
          // longer be replayed safely, so discard its duplicate private payload.
          delete current.params; delete current.order; delete current.leaseUntil;
          await save(storage, current, Date.now() + 3600000);
        }
        return current;
      });
    }
    const lease = await mutate(record.id, async (current, _state, storage) => {
      if (current.phase !== 'creating' || current.leaseUntil > Date.now()) return null;
      current.leaseUntil = Date.now() + 30000;
      await save(storage, current, current.leaseUntil);
      return current;
    });
    if (!lease) return await ctx.storage.get(key(record.id));
    const stripe = createStoreStripeClient(env, checkoutStripeKey(env), { operation: 'checkout_payment_intent', orderToken: orderToken(record.id), intent: 'create' });
    try {
      // Retain unresolved payment evidence independently of the short hold.
      await env.STORE_STATE.put(`orders:${orderToken(record.id)}`, JSON.stringify(lease.order));
      const intent = await stripe.paymentIntents.create(lease.params, { idempotencyKey: `store-order:${orderToken(record.id)}` });
      if (!intent?.id || !intent?.client_secret) throw new Error('Incomplete payment response');
      const pending = { ...lease.order, status: 'payment_pending', orderDraft: { ...lease.order.orderDraft, status: 'payment_pending' },
        payment: { ...lease.order.payment, paymentIntentId: intent.id, status: intent.status } };
      // Webhooks cannot commit a creating attempt. They retry until this write
      // and the following durable transition have completed.
      await env.STORE_STATE.put(`orders:${orderToken(record.id)}`, JSON.stringify(pending));
      return await mutate(record.id, async (current, _state, storage) => {
        if (current.phase !== 'creating') return current;
        current.phase = 'payment'; current.order = pending;
        current.paymentIntentId = intent.id; current.clientSecret = intent.client_secret;
        delete current.params; delete current.leaseUntil;
        await save(storage, current, Math.max(Date.now() + 1000, current.expiresAt));
        return current;
      });
    } catch (_error) {
      // An ambiguous create must keep capacity and the frozen request. Alarm
      // recovery retries the SAME request/key, never a fresh payment attempt.
      return await ctx.storage.get(key(record.id));
    }
  }

  async function release(id) {
    let record = await mutate(id, async (current, state, storage) => {
      if (!current) return null;
      if (terminal(current)) return current;
      if (current.phase === 'held') {
        delete state.reservations[orderToken(id)];
        current.phase = current.expiresAt <= Date.now() ? 'expired' : 'released';
        await putWorkingState(storage, state);
        await save(storage, current, Date.now() + CHECKOUT_RETENTION_SECONDS * 1000);
      } else {
        current.cancelRequested = true;
        await save(storage, current, Date.now() + 30000);
      }
      return current;
    });
    if (!record || terminal(record)) return record ? view(record) : error('hold_missing', 'Checkout was not found.', 404);
    record = await createPayment(record);
    if (record.phase !== 'payment') return error('payment_resolving', 'We are checking this payment. Do not pay again.');
    try {
      const stripe = createStoreStripeClient(env, checkoutStripeKey(env), { operation: 'checkout_expiry', orderToken: orderToken(id), intent: 'read' });
      let intent = await stripe.paymentIntents.retrieve(record.paymentIntentId);
      if (['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status)) {
        intent = await cancelStorePaymentIntent(checkoutStripeKey(env), intent.id, { idempotencyKey: `store-checkout-cancel:${id}`, stripeVersion: env.STRIPE_API_VERSION,
          onRequest: (event) => recordStripeProcessorEvent(env, event, { operation: 'checkout_expiry', intent: 'cancel', orderToken: orderToken(id) }) });
      }
      if (intent.status !== 'canceled') {
        await storeReconciliationBreak(env, { orderToken: orderToken(id), paymentIntentId: record.paymentIntentId, reasons: ['checkout_awaiting_payment_resolution'], source: 'checkout_alarm' });
        return error('payment_resolving', 'We are checking this payment. Do not pay again.');
      }
      // Checkpoint provider truth before releasing capacity. If this write fails,
      // the pinned attempt and its alarm can retry without orphaning the order.
      const raw = await env.STORE_STATE.get(`orders:${orderToken(id)}`, { type: 'json' });
      if (raw && raw.status !== 'confirmed') await env.STORE_STATE.put(`orders:${orderToken(id)}`, JSON.stringify({ ...raw, status: 'payment_failed', orderDraft: { ...raw.orderDraft, status: 'payment_failed' },
        ...(raw.inventoryReservation ? { inventoryReservation: { ...raw.inventoryReservation, status: 'released', releasedAt: new Date().toISOString() } } : {}),
        payment: { ...raw.payment, status: 'canceled' } }), { expirationTtl: CHECKOUT_RETENTION_SECONDS });
      const released = await mutate(id, async (current, state, storage) => {
        if (current.phase === 'confirmed') return view(current);
        delete state.reservations[orderToken(id)];
        current.phase = current.expiresAt <= Date.now() ? 'expired' : 'released';
        delete current.clientSecret; delete current.order; delete current.params;
        await putWorkingState(storage, state);
        await save(storage, current, Date.now() + CHECKOUT_RETENTION_SECONDS * 1000);
        return view(current);
      });
      return released;
    } catch (_error) {
      return error('payment_resolving', 'We are checking this payment. Do not pay again.');
    }
  }

  async function confirm(id) {
    const result = await mutate(id, async (record, state, storage) => {
      if (!record) return error('hold_missing', 'Checkout was not found.');
      if (record.phase === 'confirmed') return { success: true, confirmed: true, inventory: state.inventory };
      if (record.phase !== 'payment') return error('payment_resolving', 'Checkout is awaiting payment resolution.');
      const reservation = state.reservations[orderToken(id)];
      if (!reservation && Object.keys(record.counts || {}).length) return error('hold_missing', 'Checkout inventory requires reconciliation.');
      for (const [sku, count] of Object.entries(record.counts)) {
        if (!state.inventory[sku]) return error('inventory_missing', 'Checkout inventory requires reconciliation.');
        state.inventory[sku].claimed = Number(state.inventory[sku].claimed || 0) + count;
      }
      delete state.reservations[orderToken(id)]; record.phase = 'confirmed';
      delete record.clientSecret; delete record.order; delete record.params;
      await putWorkingState(storage, state);
      await save(storage, record, Date.now() + CHECKOUT_RETENTION_SECONDS * 1000);
      return { success: true, confirmed: true, inventory: state.inventory };
    });
    if (result.inventory) await syncInventoryToKv(env, 'store', result.inventory, 'store-inventory:v1');
    return result;
  }

  async function persistFreeOrder(id, checkpoint) {
    const storageKey = `orders:${orderToken(id)}`;
    const existing = await env.STORE_STATE.get(storageKey, { type: 'json' });
    if (existing?.status === 'confirmed') return existing;
    await env.STORE_STATE.put(storageKey, JSON.stringify(checkpoint));
    return checkpoint;
  }

  async function free(body) {
    const result = await ctx.storage.transaction(async (storage) => {
      const record = await storage.get(key(body.attemptId));
      if (!record) return error('hold_required', 'Start checkout again.');
      if (record.phase === 'confirmed' && record.freeOrder) return { success: true, order: record.freeOrder };
      if (record.phase !== 'held' || record.expiresAt <= Date.now()) return error('hold_expired', 'Your hold ended. Check availability again.');
      if (record.selection !== body.selection) return error('cart_changed', 'Your cart changed. Return to your cart.');
      const state = await getWorkingState(storage, body.inventory);
      const reserved = reserveCounts(state, orderToken(record.id), body.counts, pinnedExpiry);
      if (!reserved.success) return reserved;
      for (const [sku, count] of Object.entries(body.counts)) state.inventory[sku].claimed += count;
      delete state.reservations[orderToken(record.id)];
      record.phase = 'confirmed'; record.counts = body.counts; record.freeOrder = body.order;
      await putWorkingState(storage, state);
      await save(storage, record, Date.now() + 30000);
      return { success: true, order: record.freeOrder, inventory: state.inventory };
    });
    if (result.order) {
      result.order = await persistFreeOrder(body.attemptId, result.order);
      if (result.inventory) await syncInventoryToKv(env, 'store', result.inventory, 'store-inventory:v1');
      await mutate(body.attemptId, async (record, _state, storage) => {
        await save(storage, record, Date.now() + CHECKOUT_RETENTION_SECONDS * 1000);
      });
    }
    return result;
  }

  return {
    async handle(path, body) {
      if (!CHECKOUT_ATTEMPT_PATTERN.test(body.attemptId || '')) return error('invalid_attempt', 'Invalid checkout attempt.', 400);
      if (path === '/checkout-hold') return hold(body);
      if (path === '/checkout-extend') return extend(body);
      if (path === '/checkout-pay') return pay(body);
      if (path === '/checkout-free') return free(body);
      if (path === '/checkout-release') return release(body.attemptId);
      if (path === '/checkout-confirm') return confirm(body.attemptId);
      let record = await ctx.storage.get(key(body.attemptId));
      if (!record) return error('hold_missing', 'Checkout was not found.', 404);
      if (record.phase === 'creating') record = await createPayment(record);
      if (!terminal(record) && record.expiresAt <= Date.now()) return release(record.id);
      return view(record);
    },
    async alarm() {
      // Bounded, indexed work. Due keys contain no customer data.
      const due = await ctx.storage.list({ prefix: 'checkout-due:', limit: 25 });
      for (const [entry, id] of due) {
        const record = await ctx.storage.get(key(id));
        if (!record) { await ctx.storage.delete(entry); continue; }
        if (record.dueAt > Date.now()) break;
        if (terminal(record)) {
          if (record.freeOrder) await persistFreeOrder(id, record.freeOrder);
          if (Date.now() - record.createdAt < CHECKOUT_RETENTION_SECONDS * 1000) {
            await mutate(id, async (current, _state, storage) => save(storage, current, Date.now() + CHECKOUT_RETENTION_SECONDS * 1000));
          } else await ctx.storage.delete([entry, key(id)]);
          continue;
        }
        if (record.phase === 'creating') await createPayment(record);
        if (record.expiresAt <= Date.now() || record.cancelRequested) await release(id);
        // Persist another alarm even after provider failure/retry exhaustion.
        await mutate(id, async (current, _state, storage) => {
          if (!terminal(current)) await save(storage, current, Math.max(Date.now() + (current.phase === 'unresolved' ? 3600000 : 60000), current.phase === 'held' ? current.expiresAt : 0));
        });
      }
      const next = await ctx.storage.list({ prefix: 'checkout-due:', limit: 1 });
      if (next.size) await ctx.storage.setAlarm(Math.max(Date.now() + 1000, Number([...next.keys()][0].split(':')[1])));
    }
  };
}
