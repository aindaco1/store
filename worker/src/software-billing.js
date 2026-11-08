import { softwareLicensingEnabled, complimentaryKey } from './software-licenses.js';
import { softwareStripe, invoicePayment, objectId } from './software-stripe.js';
import { invoiceFulfillment, invoiceItems, invoiceLineAmount, itemRefundIntent } from './software-invoice-fulfillment.js';
import { invoiceLineId } from './software-invoice-plan.js';
import { purchasedCoverage } from './software-offers.js';
import { quoteTax } from './tax.js';
import { enqueueEmailOutbox } from './email-outbox.js';
import { licensingRequest } from './software-service.js';
import { softwarePaymentRecovery } from './software-payment-recovery.js';
import { manageLicense, isLicenseAdministrationAction } from './software-administration.js';

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
const dueKey = job => `billing-due:${String(job.nextAt).padStart(13, '0')}:${job.id}`;

export async function callSoftwareBilling(env, orderToken, action, payload = {}) {
  if (!softwareLicensingEnabled(env) || !/^store-order-[a-f0-9]{64}$/.test(orderToken || '') || !env.STORE_INVENTORY_COORDINATOR) fail('Software billing unavailable', 503);
  const ns = env.STORE_INVENTORY_COORDINATOR;
  // Register before touching the journal: failed/KV-lagged orders remain discoverable.
  const registration = await ns.get(ns.idFromName('software-licenses')).fetch(new Request('https://inventory/license-owner', {
    method: 'POST', body: JSON.stringify({ orderToken })
  }));
  if (!registration.ok) fail('Billing recovery index unavailable', 503);
  const response = await ns.get(ns.idFromName(`software-billing:${orderToken}`)).fetch(new Request(`https://inventory/billing-${action}`, { method: 'POST', body: JSON.stringify(payload) }));
  const result = await response.json();
  if (!response.ok || result.error) fail(result.error || 'Software billing unavailable', result.status || response.status);
  return result;
}

// Recovery hint only; canonical orders discover their own billing authority.
// Bounded scanning avoids a second order index and does not replay payments.
export async function softwareBillingWatchdog(env, settleInitial) {
  if (!softwareLicensingEnabled(env) || !env.STORE_STATE?.list) return;
  const key = 'software-billing-watchdog:v1';
  const state = await env.STORE_STATE.get(key, { type: 'json' });
  const page = await env.STORE_STATE.list({ prefix: 'orders:', limit: 25, ...(state?.cursor ? { cursor: state.cursor } : {}) });
  let drained = 0, failed = 0;
  for (const { name } of page.keys) {
    const order = await env.STORE_STATE.get(name, { type: 'json' });
    if (!order?.payment?.billing?.snapshot) continue;
    try {
      const result = await callSoftwareBilling(env, order.orderToken, 'reconcile', { settleInitial: !!settleInitial && order.status !== 'confirmed' });
      if (result.paymentIntent) await settleInitial(result.paymentIntent);
      drained++;
    }
    catch { failed++; }
  }
  await env.STORE_STATE.put(key, JSON.stringify({ cursor: page.list_complete ? '' : page.cursor }));
  return { checked: page.keys.length, drained, failed };
}

// One existing-class DO per order. Append-only money entries and immutable
// coverage commands remain authoritative across KV lag, webhook replay and mail failure.
export function softwareBilling(ctx, env, injectedStripe) {
  const storage = ctx.storage;
  let running;
  let cardWork = Promise.resolve();
  const invoiceFlights = new Map();
  const getOrder = async () => { const value = await storage.get('billing-order'); if (!value) fail('Billing order not ready', 503); return value; };
  const provider = order => injectedStripe || softwareStripe(env, order.orderToken);
  async function queue(tx, job) {
    const old = await tx.get(`billing-work:${job.id}`);
    if (old) return;
    job = { ...job, nextAt: Date.now(), attempts: 0 };
    await tx.put(`billing-work:${job.id}`, job);
    await tx.put(dueKey(job), job.id);
    await tx.setAlarm(Date.now() + 1000);
  }
  async function register(order) {
    if (!order.payment?.billing?.snapshot || !order.orderHash) fail('Invalid billing order');
    const identity = await digest(JSON.stringify([order.orderHash, order.payment.paymentIntentId, order.payment.billing]));
    await storage.transaction(async tx => {
      const old = await tx.get('billing-order');
      if (old && old.identity !== identity) fail('Billing order conflict');
      if (!old) await tx.put('billing-order', { orderToken: order.orderToken, identity, orderHash: order.orderHash,
        snapshot: order.payment.billing.snapshot, billing: order.payment.billing, paymentIntentId: order.payment.paymentIntentId,
        email: order.orderDraft.customer.email, preferredLang: order.orderDraft.preferredLang,
        taxDestination: order.orderDraft.billingAddress || order.orderDraft.shippingAddress });
    });
    return { registered: true };
  }
  async function license(order, line) {
    const id = 'paid-' + await digest(`${order.orderToken}:${line.id}`);
    const key = await complimentaryKey(env, id, 'paid');
    const keyHash = await digest(key);
    const old = await storage.get(`billing-license:${line.id}`);
    if (old && old.keyHash !== keyHash) fail('Original licensing key secret required', 503);
    return { id, key, keyHash, lineId: line.id, product: line.offer.product, seats: line.offer.seats };
  }
  async function coverage(tx, order, item, revision) {
    const source = order.snapshot.lines.find(line => line.id === item.orderLineId);
    const grant = await license(order, source);
    const coverageId = 'paid-' + await digest(item.id);
    const previous = await tx.get(`billing-license:${source.id}`);
    await tx.put(`billing-license:${source.id}`, { ...previous, ...grant, key: undefined });
    await queue(tx, { id: `${coverageId}-${revision}`, type: 'coverage', lineId: source.id, coverageId, policy: item.coverage, revision });
  }
  async function commitPayment(order, receipt, items) {
    await storage.transaction(async tx => {
      const key = `billing-payment:${receipt.id}`, old = await tx.get(key);
      if (old) {
        if (JSON.stringify(old.receipt) !== JSON.stringify(receipt) || JSON.stringify(old.items) !== JSON.stringify(items)) fail('Paid receipt conflict');
        return;
      }
      await tx.put(key, { receipt, items });
      // Balanced postings, integer cents. Derived balances never authorize money.
      await tx.put(`billing-ledger:paid:${receipt.id}`, { at: receipt.paidAt, source: receipt.id, currency: 'usd',
        postings: [{ account: 'stripe_receivable', cents: receipt.amountCents }, ...items.map(item => ({ account: item.kind === 'tax' ? 'tax_payable' : 'sales', lineId: item.orderLineId, cents: -item.amountCents }))] });
      for (const item of items.filter(item => item.kind === 'license')) await coverage(tx, order, item, 0);
      if (receipt.id !== order.billing.initialInvoiceId && order.billing.subscriptionId) await queue(tx, {
        id: `mail-${receipt.id}`, type: 'mail', event: 'renewed', paymentId: receipt.id
      });
    });
  }
  async function settlePayment() {
    const order = await getOrder(), stripe = provider(order);
    if (order.billing.subscriptionId) return reconcileInvoice(order.billing.initialInvoiceId);
    const intent = await stripe.paymentIntents.retrieve(order.paymentIntentId, { expand: ['latest_charge'] });
    if (intent.livemode !== false || intent.status !== 'succeeded' || intent.amount !== order.snapshot.total || intent.amount_received !== intent.amount || intent.currency !== 'usd' || intent.metadata?.orderHash !== order.orderHash || intent.metadata?.orderToken !== order.orderToken) fail('Payment mismatch');
    const paidAt = intent.latest_charge?.created * 1000;
    if (!Number.isSafeInteger(paidAt)) fail('Missing successful charge timestamp');
    const items = order.snapshot.lines.map(line => ({ id: `${intent.id}:${line.id}`, invoiceId: intent.id, orderLineId: line.id, kind: line.kind,
      amountCents: line.unitAmount, quantity: line.purchasedQuantity ?? 1, ...(line.offer ? { coverage: purchasedCoverage(line, paidAt) } : {}) }));
    await commitPayment(order, { id: intent.id, paymentIntentId: intent.id, amountCents: intent.amount, paidAt }, items);
    return { paymentIntent: intent };
  }
  async function prepareRenewal(order, invoice, stripe) {
    if (invoice.lines.has_more || invoice.status !== 'draft' || invoice.livemode !== false) fail('Invalid draft renewal');
    await stripe.extra(`/invoices/${invoice.id}`, { auto_advance: false });
    let prepared = await storage.get(`billing-tax:${invoice.id}`);
    const seen = new Set();
    const recurring = invoice.lines.data.filter(line => line.metadata?.order_line_id !== 'tax').map(line => {
        const id = invoiceLineId(line, order.billing.items), source = order.snapshot.lines.find(item => item.id === id && item.interval);
        if (!source || seen.has(id) || line.currency !== 'usd' || line.quantity !== 1 || invoiceLineAmount(line) !== source.renewalAmount || line.parent?.subscription_item_details?.proration) fail('Unexpected renewal item');
        seen.add(id); return source;
    });
    if (!recurring.length) fail('Empty renewal');
    if (prepared && JSON.stringify(prepared.lines.filter(line => line.interval).map(line => line.id).sort()) !== JSON.stringify(recurring.map(line => line.id).sort())) fail('Renewal items changed');
    if (!prepared) {
      const quote = await quoteTax(env, { subtotalCents: recurring.filter(line => line.taxable).reduce((sum, line) => sum + line.renewalAmount, 0), destination: order.taxDestination });
      const tax = { id: 'tax', kind: 'tax', quantity: 1, unitAmount: quote.taxCents, renewalTax: true };
      prepared = { lines: [...recurring, ...(quote.taxCents ? [tax] : [])], taxCents: quote.taxCents, source: quote.source, effectiveRate: quote.effectiveRate };
      await storage.put(`billing-tax:${invoice.id}`, prepared);
    }
    const existingTax = invoice.lines.data.filter(line => line.metadata?.order_line_id === 'tax');
    if (existingTax.length > 1 || (existingTax.length && (existingTax[0].amount !== prepared.taxCents || existingTax[0].currency !== 'usd'))) fail('Renewal tax line conflict');
    // Inspect provider truth before retrying a tax write, including beyond the
    // provider's idempotency retention window after a prolonged outage.
    if (prepared.taxCents && !existingTax.length) await stripe.extra('/invoiceitems', { customer: order.billing.customerId, invoice: invoice.id, currency: 'usd',
      amount: prepared.taxCents, description: 'Store sales tax', 'metadata[order_line_id]': 'tax' }, `store-renewal-tax:${invoice.id}`);
    try {
      await stripe.extra(`/invoices/${invoice.id}/finalize`, { auto_advance: true }, `store-renewal-finalize:${invoice.id}`);
      await collectRenewal(invoice, stripe);
    }
    catch (error) {
      const current = await stripe.invoices.retrieve(invoice.id);
      if (current.status === 'paid') return performInvoiceReconciliation(invoice.id);
      throw error;
    }
    return { prepared: true };
  }
  async function collectRenewal(invoice, stripe) {
    // Pay this existing invoice only. Its paid state prevents another charge
    // even after provider idempotency retention; never create a replacement PI.
    try { await stripe.invoices.pay(invoice.id, {}, { idempotencyKey: `store-renewal-pay:${invoice.id}` }); }
    catch (error) {
      const current = await stripe.invoices.retrieve(invoice.id);
      if (current.status !== 'paid' && !(current.status === 'open' && current.attempted)) throw error;
    }
  }
  async function reconcileInvoice(id) {
    if (invoiceFlights.has(id)) return invoiceFlights.get(id);
    const pending = performInvoiceReconciliation(id).finally(() => invoiceFlights.delete(id));
    invoiceFlights.set(id, pending);
    return pending;
  }
  async function performInvoiceReconciliation(id, canCollect = true) {
    if (!/^in_[A-Za-z0-9_]+$/.test(id || '')) fail('Invalid invoice', 400);
    const order = await getOrder(), stripe = provider(order), invoice = await stripe.invoices.retrieve(id);
    if (invoice.livemode !== false || objectId(invoice.parent?.subscription_details?.subscription) !== order.billing.subscriptionId || objectId(invoice.customer) !== order.billing.customerId) fail('Invoice ownership mismatch');
    const initial = id === order.billing.initialInvoiceId;
    if (!initial && invoice.status === 'draft') return prepareRenewal(order, invoice, stripe);
    const prepared = initial ? order.snapshot : await storage.get(`billing-tax:${id}`);
    if (!initial && invoice.status === 'open' && !invoice.attempted && prepared && canCollect) {
      // Recovery after finalization committed but collection was not attempted.
      const items = invoiceItems(invoice, { ...order.snapshot, lines: prepared.lines }, order.billing);
      if (items.length !== prepared.lines.length || items.reduce((sum, item) => sum + item.amountCents, 0) !== invoice.amount_due) fail('Prepared renewal changed');
      await collectRenewal(invoice, stripe);
      return performInvoiceReconciliation(id, false);
    }
    if (invoice.status !== 'paid') {
      if (!initial && invoice.status === 'open' && invoice.attempted) await storage.transaction(tx => queue(tx, { id: `mail-failed-${id}`, type: 'mail', event: 'payment_failed', paymentId: id }));
      return { pending: true };
    }
    if (!prepared) fail('Renewal has no verified tax snapshot');
    const snapshot = initial ? order.snapshot : { ...order.snapshot, lines: prepared.lines };
    const items = invoiceFulfillment(invoice, snapshot, order.billing);
    if (!initial && prepared.lines.some(line => !items.some(item => item.orderLineId === line.id))) fail('Missing renewal line');
    const intent = await invoicePayment(stripe, invoice);
    if (intent.status !== 'succeeded' || intent.amount_received !== invoice.amount_paid || invoice.paid_out_of_band) fail('Invoice was not paid by its payment');
    await stripe.extra(`/payment_intents/${intent.id}`, { 'metadata[orderToken]': order.orderToken, 'metadata[softwareInvoice]': id }, `store-renewal-metadata:${id}`);
    await commitPayment(order, { id, paymentIntentId: intent.id, amountCents: invoice.amount_paid, paidAt: invoice.status_transitions.paid_at * 1000 }, items);
    return { ...(initial ? { paymentIntent: intent } : {}), paid: true };
  }
  async function requestRefund(payload) {
    const { id, paymentId, allocations, actor } = payload;
    if (!validId(id) || !validId(paymentId) || !Array.isArray(allocations) || !allocations.length || allocations.length > 20 || !actor) fail('Invalid refund', 400);
    const normalized = allocations.map(value => ({ lineId: value.lineId, amountCents: value.amountCents })).sort((a, b) => a.lineId.localeCompare(b.lineId));
    if (new Set(normalized.map(value => value.lineId)).size !== normalized.length) fail('Duplicate refund line', 400);
    const request = { id, paymentId, allocations: normalized, actor, ...(payload.refundId ? { refundId: payload.refundId } : {}) };
    await storage.transaction(async tx => {
      const old = await tx.get(`billing-refund:${id}`);
      if (old) { if (JSON.stringify(old.request) !== JSON.stringify(request)) fail('Refund conflict'); return; }
      const payment = await tx.get(`billing-payment:${paymentId}`);
      if (!payment) fail('Paid receipt not found');
      for (const allocation of normalized) {
        const item = payment.items.find(item => item.orderLineId === allocation.lineId);
        const reserved = await tx.get(`billing-refunded:${paymentId}:${allocation.lineId}`) || 0;
        if (!item || !Number.isSafeInteger(allocation.amountCents) || allocation.amountCents < 1 || reserved + allocation.amountCents > item.amountCents) fail('Refund exceeds available line amount');
        await tx.put(`billing-refunded:${paymentId}:${allocation.lineId}`, reserved + allocation.amountCents);
      }
      await tx.put(`billing-refund:${id}`, { request, createdAt: Date.now(), state: 'pending', amountCents: normalized.reduce((sum, value) => sum + value.amountCents, 0) });
      await queue(tx, { id: `refund-${id}`, type: 'refund', refundRequestId: id });
    });
    return { id, state: (await storage.get(`billing-refund:${id}`)).state };
  }
  async function processRefund(order, id) {
    const record = await storage.get(`billing-refund:${id}`);
    const payment = await storage.get(`billing-payment:${record.request.paymentId}`), stripe = provider(order);
    if (record.state === 'succeeded' || record.state === 'failed' || record.state === 'review') return;
    if (!record.refundId && !record.request.refundId && Date.now() - record.createdAt >= 23 * 3600000) {
      record.state = 'review'; await storage.put(`billing-refund:${id}`, record); return;
    }
    const refund = record.refundId || record.request.refundId
      ? await stripe.refunds.retrieve(record.refundId || record.request.refundId)
      : await stripe.refunds.create({ payment_intent: payment.receipt.paymentIntentId, amount: record.amountCents,
        metadata: { orderToken: order.orderToken, refundRequestId: id, softwarePayment: record.request.paymentId } }, { idempotencyKey: `store-refund:${order.orderToken}:${id}` });
    if (refund.livemode === true || objectId(refund.payment_intent) !== payment.receipt.paymentIntentId || refund.currency !== 'usd' || refund.amount !== record.amountCents) fail('Refund ownership mismatch');
    record.refundId = refund.id;
    const checkpointed = await storage.transaction(async tx => {
      const current = await tx.get(`billing-refund:${id}`);
      if (['succeeded', 'failed', 'review'].includes(current.state)) return false;
      await tx.put(`billing-refund:${id}`, { ...current, refundId: refund.id });
      return true;
    });
    if (!checkpointed) return;
    if (!['succeeded', 'failed', 'canceled'].includes(refund.status)) fail('Refund still pending', 503);
    await storage.transaction(async tx => {
      const current = await tx.get(`billing-refund:${id}`);
      if (['succeeded', 'failed'].includes(current.state)) return;
      const prior = await tx.get(`billing-refund-provider:${refund.id}`);
      if (prior && prior !== id) fail('Refund already allocated');
      await tx.put(`billing-refund-provider:${refund.id}`, id);
      if (refund.status !== 'succeeded') {
        for (const item of record.request.allocations) {
          const key = `billing-refunded:${record.request.paymentId}:${item.lineId}`;
          await tx.put(key, (await tx.get(key)) - item.amountCents);
        }
        record.state = 'failed';
      } else {
        for (const allocation of record.request.allocations) {
          const key = `billing-refund-settled:${record.request.paymentId}:${allocation.lineId}`;
          const cumulative = (await tx.get(key) || 0) + allocation.amountCents;
          const action = itemRefundIntent({ invoiceId: record.request.paymentId, orderLineId: allocation.lineId, amountCents: allocation.amountCents, cumulativeRefundCents: cumulative }, payment.items);
          await tx.put(key, cumulative);
          if (action.entitlementAction === 'revoke_invoice_coverage') await coverage(tx, order, payment.items.find(item => item.orderLineId === allocation.lineId), 1);
          if (action.entitlementAction === 'review') await tx.put(`billing-review:${refund.id}:${allocation.lineId}`, { reason: 'partial_software_refund', paymentId: record.request.paymentId, lineId: allocation.lineId });
        }
        await tx.put(`billing-ledger:refund:${refund.id}`, { at: refund.created * 1000, source: refund.id, currency: 'usd',
          postings: [{ account: 'stripe_receivable', cents: -record.amountCents }, ...record.request.allocations.map(item => ({ account: payment.items.find(line => line.orderLineId === item.lineId)?.kind === 'tax' ? 'tax_payable' : 'sales_returns', lineId: item.lineId, cents: item.amountCents }))] });
        record.state = 'succeeded';
        await queue(tx, { id: `mail-${refund.id}`, type: 'mail', event: 'refunded', paymentId: record.request.paymentId });
      }
      await tx.put(`billing-refund:${id}`, record);
    });
  }
  async function refundEvent(id) {
    const order = await getOrder(), stripe = provider(order), refund = await stripe.refunds.retrieve(id);
    const requestId = refund.metadata?.refundRequestId || await storage.get(`billing-refund-provider:${id}`);
    if (requestId && await storage.get(`billing-refund:${requestId}`)) {
      await processRefund(order, requestId); return { reconciled: true };
    }
    // Dashboard refunds have no trusted item allocation. Preserve evidence for
    // explicit import; never guess which software line a partial refund affected.
    const intent = await stripe.paymentIntents.retrieve(objectId(refund.payment_intent));
    if (intent.metadata?.orderToken !== order.orderToken || intent.livemode !== false || refund.livemode === true) fail('Refund ownership mismatch');
    await storage.put(`billing-review:${id}`, { reason: 'unallocated_refund', refundId: id, amountCents: refund.amount, status: refund.status, paymentIntentId: intent.id });
    return { review: true };
  }
  async function discoverInvoices() {
    const order = await getOrder();
    if (!order.billing.subscriptionId) return;
    const cursor = await storage.get('billing-invoice-cursor');
    const page = await provider(order).invoices.list({ subscription: order.billing.subscriptionId, limit: 25, ...(cursor ? { starting_after: cursor } : {}) });
    for (const invoice of page.data) {
      if (['void', 'uncollectible'].includes(invoice.status) || await storage.get(`billing-payment:${invoice.id}`)) continue;
      // A durable job survives provider failures; a scan discovers missed events.
      // Include the observed state so a completed draft job cannot hide payment.
      await storage.transaction(tx => queue(tx, { id: `discover-${invoice.id}-${invoice.status}-${invoice.attempt_count || 0}`, type: 'invoice', invoiceId: invoice.id }));
    }
    await storage.put('billing-invoice-cursor', page.has_more ? page.data.at(-1).id : '');
  }
  async function cancelRenewals() {
    const order = await getOrder();
    if (!order.billing.subscriptionId) fail('Order has no subscription');
    const result = await provider(order).subscriptions.update(order.billing.subscriptionId, { cancel_at_period_end: true }, { idempotencyKey: `store-renewal-cancel:${order.orderToken}` });
    if (!result.cancel_at_period_end) fail('Cancellation not confirmed', 503);
    await storage.put('billing-cancellation', { subscriptionId: result.id, cancelAt: result.cancel_at });
    await storage.transaction(tx => queue(tx, { id: 'mail-cancelled', type: 'mail', event: 'cancelled' }));
    return { cancelled: true, cancelAt: result.cancel_at };
  }
  async function issuedLicense(lineId) {
    const order = await getOrder(), line = order.snapshot.lines.find(line => line.id === lineId && line.offer);
    const stored = await storage.get(`billing-license:${lineId}`);
    if (!line || !stored?.grantedAt) fail('Issued license not found', 404);
    return { ...await license(order, line), email: order.email };
  }
  const recover=async lineId=>manageLicense(env,await issuedLicense(lineId),'paid','recover');
  async function customerView() {
    const order = await getOrder(), licenses = [];
    for (const line of order.snapshot.lines.filter(line => line.offer)) {
      const stored = await storage.get(`billing-license:${line.id}`);
      const base = { lineId: line.id, name: line.name, offer: line.offer, issued: !!stored?.grantedAt };
      if (!base.issued) { licenses.push({ ...base, coverage: [], releases: [] }); continue; }
      const response = await licensingRequest(env, 'library', { id: stored.id, product: line.offer.product });
      if (!response.ok) fail('License status unavailable', 503);
      licenses.push({ ...base, ...await response.json() });
    }
    let renewal = null;
    if (order.billing.subscriptionId) {
      const stripe = provider(order), sub = await stripe.subscriptions.retrieve(order.billing.subscriptionId);
      if (sub.livemode !== false || objectId(sub.customer) !== order.billing.customerId) fail('Subscription mismatch');
      renewal = { status: sub.status, cancelled: !!sub.cancel_at_period_end || sub.status === 'canceled', cancelAt: sub.cancel_at ? sub.cancel_at * 1000 : null };
    }
    return {licenses,renewal,...await customerInvoices()};
  }
  async function customerInvoices(cursor='') {
    const order=await getOrder();
    if(!order.billing.subscriptionId)return {invoices:[],invoicesCursor:null,invoicesTruncated:false};
    const stripe=provider(order);
    if(cursor) {
      if(!/^in_[A-Za-z0-9_]{1,100}$/.test(cursor))fail('Invalid invoice cursor',400);
      const prior=await stripe.invoices.retrieve(cursor);
      if(prior.livemode!==false || objectId(prior.customer)!==order.billing.customerId || objectId(prior.parent?.subscription_details?.subscription)!==order.billing.subscriptionId)fail('Invoice ownership mismatch',403);
    }
    const page=await stripe.invoices.list({subscription:order.billing.subscriptionId,limit:25,...(cursor?{starting_after:cursor}:{})});
    const invoices=[];
    for(const invoice of page.data) invoices.push({id:invoice.id,status:invoice.status,amountCents:invoice.amount_due,createdAt:invoice.created*1000,
      payable:invoice.status==='open' && !!await storage.get(`billing-tax:${invoice.id}`)});
    return {invoices,invoicesCursor:page.has_more?page.data.at(-1)?.id:null,invoicesTruncated:!!page.has_more};
  }
  async function history(kind,cursor='') {
    const prefixes={payments:'billing-payment:',refunds:'billing-refund:',reviews:'billing-review:',work:'billing-work:'};
    const prefix=Object.hasOwn(prefixes,kind)?prefixes[kind]:null;
    if(!prefix || typeof cursor!=='string' || cursor.length>250 || (cursor && !/^[A-Za-z0-9_:-]+$/.test(cursor)))fail('Invalid history cursor',400);
    const rows=[...await storage.list({prefix,limit:26,...(cursor?{startAfter:prefix+cursor}:{})})];
    return {entries:rows.slice(0,25).map(([,value])=>{if(kind!=='work')return value;const {id,type,done,review}=value;return {id,type,done,review};}),cursor:rows.length>25?rows[24][0].slice(prefix.length):null};
  }

  async function runJob(order, job) {
    if (job.type === 'refund') return processRefund(order, job.refundRequestId);
    if (job.type === 'invoice') return reconcileInvoice(job.invoiceId);
    if (job.type === 'coverage') {
      const line = order.snapshot.lines.find(line => line.id === job.lineId), grant = await license(order, line);
      const response = await licensingRequest(env, 'coverage', { id: grant.id, key: grant.key, product: grant.product,
        seats: grant.seats, coverageId: job.coverageId, policy: job.policy, revision: job.revision });
      if (!response.ok) fail('Coverage delivery failed', response.status);
      const receipt = await response.json();
      if (receipt.id !== grant.id || receipt.coverageId !== job.coverageId || receipt.revision < job.revision) fail('Coverage receipt mismatch');
      await storage.transaction(async tx => {
        const record = await tx.get(`billing-license:${line.id}`);
        record.grantedAt ||= Date.now(); await tx.put(`billing-license:${line.id}`, record);
        if (!job.revision && receipt.revision === 0) await queue(tx, { id: `mail-key-${line.id}`, type: 'mail', event: 'key', lineId: line.id });
      });
      return;
    }
    const result = await enqueueEmailOutbox(env, { kind: job.event === 'key' ? 'software_license' : 'software_billing', dedupeKey: `${order.orderToken}:${job.id}`,
      payload: { orderToken: order.orderToken, lineId: job.lineId, event: job.event, paymentId: job.paymentId, email: order.email, preferredLang: order.preferredLang } });
    if (!(result.queued || result.sent)) fail(result.deduped ? 'Email requires review' : 'Email handoff unavailable', result.deduped ? 409 : 503);
  }
  async function drain() {
    if (!softwareLicensingEnabled(env)) return;
    if (running) return running;
    running = (async () => {
      const order = await storage.get('billing-order'); if (!order) return;
      const due = await storage.list({ prefix: 'billing-due:', limit: 25 });
      for (const [index, id] of due) {
        const job = await storage.transaction(async tx => {
          const value = await tx.get(`billing-work:${id}`);
          if (!value || value.done || value.review) { await tx.delete(index); return null; }
          if (value.nextAt > Date.now() || value.leaseUntil > Date.now()) return null;
          value.leaseUntil = Date.now() + 60000; await tx.put(`billing-work:${id}`, value); return value;
        });
        if (!job) continue;
        try { await runJob(order, job); job.done = true; }
        catch (error) {
          job.attempts++; job.nextAt = Date.now() + Math.min(3600000, 1000 * 2 ** Math.min(job.attempts, 12));
          if ([400, 409].includes(error.status)) job.review = true;
        }
        delete job.leaseUntil;
        await storage.transaction(async tx => {
          await tx.delete(index); await tx.put(`billing-work:${id}`, job);
          if (!job.done && !job.review) await tx.put(dueKey(job), id);
        });
      }
      const next = await storage.list({ prefix: 'billing-due:', limit: 1 });
      if (next.size) await storage.setAlarm(Math.max(Date.now() + 1000, Number([...next.keys()][0].split(':')[1])));
    })().finally(() => { running = undefined; });
    return running;
  }
  return {
    drain,
    async handle(action, payload) {
      try {
        if (!softwareLicensingEnabled(env)) fail('Software billing unavailable', 503);
        if (action === 'register') return await register(payload.order);
        if (action === 'payment') return await settlePayment();
        if (action === 'invoice') {
          // Keep a recovery command before external calls; webhook retries also
          // reconcile directly so initial Store settlement finishes before ACK.
          await storage.transaction(tx => queue(tx, { id: `invoice-${payload.eventId}`, type: 'invoice', invoiceId: payload.invoiceId }));
          return await reconcileInvoice(payload.invoiceId);
        }
        if (action === 'refund') return await requestRefund(payload);
        if (action === 'refund-event') return await refundEvent(payload.refundId);
        if (action === 'cancel') return await cancelRenewals();
        if (action === 'subscription') {
          const order = await getOrder();
          if (payload.subscriptionId !== order.billing.subscriptionId) fail('Subscription mismatch');
          const subscription = await provider(order).subscriptions.retrieve(payload.subscriptionId);
          if (subscription.cancel_at_period_end || subscription.status === 'canceled') {
            await storage.put('billing-cancellation', { subscriptionId: subscription.id, cancelAt: subscription.cancel_at });
            await storage.transaction(tx => queue(tx, { id: 'mail-cancelled', type: 'mail', event: 'cancelled' }));
          }
          return { reconciled: true };
        }
        if (action === 'recover') return await recover(payload.lineId);
        if (action === 'administration') {
          if(!isLicenseAdministrationAction(payload.action))fail('Invalid license action',400);
          return await manageLicense(env,await issuedLicense(payload.lineId),'paid',payload.action,payload);
        }
        if (action === 'customer') return await customerView();
        if (action === 'invoices') return await customerInvoices(payload.cursor);
        if (action === 'history') return await history(payload.kind,payload.cursor);
        if (['card-setup', 'card-complete', 'card-complete-event', 'invoice-page'].includes(action)) {
          const operation = cardWork.then(async () => {
            if (action === 'card-complete-event' && (await storage.get('billing-card-setup'))?.sessionId !== payload.sessionId) return { ignored: true };
            const order = await getOrder();
            return softwarePaymentRecovery(action === 'card-complete-event' ? 'card-complete' : action, payload, { storage, order, stripe: provider(order), returnUrl: payload.returnUrl });
          });
          cardWork = operation.catch(() => {});
          return await operation;
        }
        if (action === 'reconcile') {
          await discoverInvoices(); await drain();
          if (payload.settleInitial) {
            const order = await getOrder(), intent = await provider(order).paymentIntents.retrieve(order.paymentIntentId);
            if (intent.status === 'succeeded') return { drained: true, paymentIntent: intent };
          }
          return { drained: true };
        }
        if (action === 'drain') { await drain(); return { drained: true }; }
        if (action === 'status') {
          const order = await getOrder();
          const result={orderToken:order.orderToken,lines:order.snapshot.lines,cancellation:await storage.get('billing-cancellation'),cursors:{}};
          for(const kind of ['payments','refunds','reviews','work']) {const page=await history(kind);result[kind]=page.entries;result.cursors[kind]=page.cursor;}
          return result;
        }
        fail('Not found', 404);
      } catch (error) { return { error: error.status ? error.message : 'Software billing operation failed', status: error.status || 503 }; }
    }
  };
}
