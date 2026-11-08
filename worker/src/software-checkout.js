import { planCombinedInvoice } from './software-invoice-plan.js';
import { softwareOrderSnapshot } from './software-offers.js';
import { softwareStripe, invoicePayment, objectId } from './software-stripe.js';

// Selected only from the frozen server-owned order, never a browser billing flag.
export function softwarePayments(env, injectedStripe) {
  return {
    async create(record) {
      const order = record.order;
      const stripe = injectedStripe || softwareStripe(env, order.orderToken);
      const snapshot = softwareOrderSnapshot(order.orderDraft);
      if (!snapshot.lines.some(line => line.interval)) {
        const intent = await stripe.paymentIntents.create(record.params, { idempotencyKey: `store-order:${order.orderToken}` });
        return { ...intent, billing: { snapshot } };
      }
      // A dedicated customer prevents unrelated pending items/credits from
      // joining this initial invoice. Store remains the customer identity owner.
      const customer = await stripe.customers.create({ metadata: { orderToken: order.orderToken } }, { idempotencyKey: `store-customer:${order.orderToken}` });
      const providerLines = [];
      for (const line of snapshot.lines) {
        const product = await stripe.products.create({ name: line.name.slice(0, 250), metadata: { orderToken: order.orderToken, order_line_id: line.id } }, { idempotencyKey: `store-product:${order.orderToken}:${line.id}` });
        const providerLine = { ...line, product: product.id };
        if (line.interval && line.renewalAmount > line.unitAmount) {
          const coupon = await stripe.extra('/coupons', { duration: 'once', currency: 'usd', amount_off: line.renewalAmount - line.unitAmount }, `store-discount:${order.orderToken}:${line.id}`);
          providerLine.initialCoupon = coupon.id;
        }
        providerLines.push(providerLine);
      }
      const plan = planCombinedInvoice({ ...snapshot, lines: providerLines });
      const subscription = await stripe.subscriptions.create({ ...plan.subscription, customer: customer.id,
        metadata: { orderToken: order.orderToken, orderHash: order.orderHash, checkoutProvider: 'first_party' } },
      { idempotencyKey: `store-order:${order.orderToken}` });
      // Future invoices must start noncollectible even if Store is offline.
      // This does not change the already-created initial invoice. Each renewal
      // is advanced individually only after Store verifies its tax snapshot.
      const held = await stripe.subscriptions.update(subscription.id, { pause_collection: { behavior: 'keep_as_draft' } },
        { idempotencyKey: `store-tax-guard:${order.orderToken}` });
      if (held.pause_collection?.behavior !== 'keep_as_draft') throw new Error('Renewal tax guard not confirmed');
      const invoice = await stripe.invoices.retrieve(objectId(subscription.latest_invoice));
      if (invoice.amount_due !== snapshot.total || invoice.currency !== snapshot.currency || invoice.livemode !== false) throw new Error('Initial invoice mismatch');
      const intent = await invoicePayment(stripe, invoice);
      // Invoice-created PIs do not inherit Store metadata. Attach the same
      // integrity fields as ordinary checkout before exposing the Elements secret.
      const fields = Object.fromEntries(Object.entries(record.params.metadata).map(([key, value]) => [`metadata[${key}]`, value]));
      await stripe.extra(`/payment_intents/${intent.id}`, fields, `store-payment-metadata:${order.orderToken}`);
      if (subscription.items.has_more) throw new Error('Incomplete subscription mapping');
      return { ...intent, billing: { snapshot, customerId: customer.id, subscriptionId: subscription.id, initialInvoiceId: invoice.id,
        items: subscription.items.data.map(item => ({ id: item.id, metadata: { order_line_id: item.metadata.order_line_id } })) } };
    },
    retrieve: record => (injectedStripe || softwareStripe(env, record.order?.orderToken)).paymentIntents.retrieve(record.paymentIntentId),
    async cancel(record) {
      const stripe = injectedStripe || softwareStripe(env, record.order.orderToken), billing = record.order.payment.billing;
      if (!billing?.subscriptionId) throw new Error('Not a subscription');
      try { await stripe.subscriptions.cancel(billing.subscriptionId, { invoice_now: false, prorate: false }); }
      catch (error) { if (error.statusCode !== 404) throw error; }
      let intent = await stripe.paymentIntents.retrieve(record.paymentIntentId);
      if (['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status)) {
        await stripe.extra(`/invoices/${billing.initialInvoiceId}/void`, {}, `store-invoice-void:${record.id}`);
        intent = await stripe.paymentIntents.retrieve(record.paymentIntentId);
      }
      return intent;
    }
  };
}
