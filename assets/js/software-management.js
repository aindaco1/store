// Customer and operator views share rendering and the existing Store API owners.
const config = () => window.STORE_CONFIG || window.StoreConfig || {};
const t = (key, values = {}) => String(config().i18n?.messages?.software?.[key] || key).replace(/%\{([^}]+)\}/g, (match, name) => values[name] ?? match);
const locale = () => document.documentElement.lang === 'es' ? 'es-US' : 'en-US';
const money = cents => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'USD' }).format(cents / 100);
const coverageDate = value => new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) + ' UTC';
const date = value => new Intl.DateTimeFormat(locale(), { dateStyle: 'medium' }).format(new Date(value));
function node(parent, tag, text = '', className = '') {
  const element = document.createElement(tag); element.textContent = text; element.className = className;
  parent.append(element); return element;
}
function button(parent, label, action) {
  const element = node(parent, 'button', label, 'btn btn--secondary'); element.type = 'button';
  element.addEventListener('click', action); return element;
}
function field(parent, label, name, type = 'text', value = '') {
  const wrapper = node(parent, 'label', label, 'store-software__field');
  const input = node(wrapper, 'input', '', type === 'checkbox' ? '' : 'admin-settings__input'); input.type = type; input.name = name; input.value = value; input.required = true;
  return input;
}
function select(parent, label, name, options) {
  const wrapper = node(parent, 'label', label, 'store-software__field');
  const element = node(wrapper, 'select', '', 'admin-settings__input'); element.name = name;
  for (const [value, text] of options) { const option = node(element, 'option', text); option.value = value; }
  return element;
}
function view(root) {
  root.classList.add('store-software');
  const status = node(root, 'p', '', 'store-software__status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  let busy = false;
  return async action => {
    if (busy) return;
    busy = true; root.setAttribute('aria-busy', 'true'); status.textContent = t('working');
    const controls = [...root.querySelectorAll('button,input,select')].map(element => [element, element.disabled]);
    controls.forEach(([element]) => { element.disabled = true; });
    try { await action(); status.textContent = t('done'); }
    catch (error) { status.textContent = [t('failed'), error.message].filter(Boolean).join(' '); }
    finally { controls.forEach(([element, disabled]) => { element.disabled = disabled; }); busy = false; root.removeAttribute('aria-busy'); }
  };
}
function confirmAction(parent, label, explanation, run, action) {
  const details = node(parent, 'details'); node(details, 'summary', label);
  node(details, 'p', explanation);
  button(details, t('confirm'), () => run(async () => { await action(); details.open = false; }));
}
function reveal(parent, run, request) {
  let output;
  const control = button(parent, t('reveal'), () => run(async () => {
    if (output) { output.parentElement.remove(); output = null; control.textContent = t('reveal'); return; }
    const result = await request();
    output = field(parent, t('key'), 'license-key', 'text', result.key); output.readOnly = true;
    output.autocomplete = 'off'; output.spellcheck = false; output.focus(); output.select();
    control.textContent = t('hide_key');
  }));
}
function administration(parent,run,request,changed) {
  const body=node(parent,'div');
  button(parent,t('manage_devices'),()=>run(load));
  async function load() {
    const state=await request('status');body.replaceChildren();
    node(body,'p',t('device_count',{count:state.installations.length,seats:state.seats}));
    for(const device of state.installations) {
      const row=node(body,'section');node(row,'p',device.installation);
      if(!state.revoked)mutation(row,'deactivate','deactivate_help',{installation:device.installation,revision:device.revision});
    }
    if(!state.revoked) {mutation(body,'replace','replace_help');mutation(body,'reset','reset_help');}
    const history=node(body,'div');
    button(body,t('history'),()=>run(()=>loadHistory()));
    async function loadHistory(cursor='',append=false) {
      const page=await request('history',{cursor});if(!append)history.replaceChildren();
      for(const entry of page.entries)node(history,'p',`${date(entry.at)} · ${t('action_'+entry.action)}${entry.installation?' · '+entry.installation:''}`);
      if(page.cursor) {const more=button(history,t('more'),()=>run(async()=>{await loadHistory(page.cursor,true);more.remove();}));}
    }
    function mutation(target,action,explanation,extra={}) {
      const id=crypto.randomUUID();
      confirmAction(target,t(action),t(explanation),run,async()=>{await request(action,{id,generation:state.generation,...extra});await changed();});
    }
  }
}
function coverageText(policy) {
  if (policy.kind === 'lifetime') return t('lifetime');
  if (policy.kind === 'major') return t('major_coverage', { major: policy.major });
  return policy.start === 0 ? t('through', { end: coverageDate(policy.end) }) : t('between', { start: coverageDate(policy.start), end: coverageDate(policy.end) });
}
function safeNavigate(value, allowedHost) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== allowedHost) throw new Error(t('invalid_link'));
  window.location.assign(url.href);
}

export function mountCustomer(root, { orderToken, token, workerBase }) {
  root.replaceChildren(); node(root, 'h2', t('title'));
  const run = view(root), body = node(root, 'div');
  async function request(action, payload = {}) {
    const response = await fetch(`${workerBase}/api/orders/${encodeURIComponent(orderToken)}/software/${action}`, {
      method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, token })
    });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || t('failed')); return data;
  }
  async function refresh() {
    const result = await request('status'); body.replaceChildren();
    node(body, 'p', t('installed'));
    for (const license of result.licenses) {
      const card = node(body, 'section', '', 'store-software__card store-order__panel'); node(card, 'h3', license.name);
      node(card, 'p', t('seats', { count: license.offer.seats }));
      if (!license.issued) { node(card, 'p', t('pending')); continue; }
      if (license.revoked || !license.coverage.length) node(card, 'p', t('no_coverage'));
      else {
        const coverage = node(card, 'ul');
        for (const policy of license.coverage) node(coverage, 'li', coverageText(policy));
      }
      reveal(card, run, () => request('recover', { lineId: license.lineId }));
      administration(card,run,(action,p={})=>request('administration',{...p,action,lineId:license.lineId}),refresh);
      if (license.releases.length) {
        node(card, 'h4', t('downloads'));
        const list = node(card, 'ul');
        for (const release of license.releases) {
          const link = node(node(list, 'li'), 'a', `${release.version || release.id} · ${release.platform}`);
          const url = new URL(release.url);
          if (url.origin === new URL(workerBase).origin && url.pathname.startsWith(`/api/orders/${orderToken}/software/download`)) {
            link.href = url.href; link.referrerPolicy = 'no-referrer';
          }
        }
      } else node(card, 'p', t('no_downloads'));
      if (license.coverageTruncated || license.releasesTruncated) node(card, 'p', t('recent_only'));
    }
    if (result.renewal) {
      const section = node(body, 'section', '', 'store-software__card store-order__panel'); node(section, 'h3', t('billing'));
      node(section, 'p', t(result.renewal.cancelled ? 'cancelled' : 'automatic'));
      node(section, 'p', t('card_help'));
      let setupId;
      if (result.renewal.status !== 'canceled') button(section, t('update_card'), () => run(async () => {
        setupId ||= crypto.randomUUID(); const data = await request('card-setup', { id: setupId }); safeNavigate(data.url, 'checkout.stripe.com');
      }));
      if (!result.renewal.cancelled) confirmAction(section, t('cancel'), t('cancel_help'), run, async () => { await request('cancel'); await refresh(); });
      const invoiceList=node(section,'div');
      function invoicePage(page) {
      for (const invoice of page.invoices) {
        const row = node(invoiceList, 'div', '', 'store-software__invoice');
        node(row, 'p', `${date(invoice.createdAt)} · ${money(invoice.amountCents)} · ${t(`invoice_${invoice.status}`)}`);
        if (invoice.payable) button(row, t('pay_invoice'), () => run(async () => { const data = await request('invoice-page', { invoiceId: invoice.id }); safeNavigate(data.url, 'invoice.stripe.com'); }));
      }
      if(page.invoicesCursor) {const more=button(invoiceList,t('more'),()=>run(async()=>{const next=await request('invoices',{cursor:page.invoicesCursor});invoicePage(next);more.remove();}));}
      }
      invoicePage(result);
    }
  }
  button(root, t('refresh'), () => run(refresh));
  const sessionId = new URL(window.location.href).searchParams.get('billing_session');
  if (sessionId) run(async () => {
    await request('card-complete', { sessionId });
    const url = new URL(window.location.href); url.searchParams.delete('billing_session'); window.history.replaceState({}, '', url);
    await refresh();
  });
  else run(refresh);
}

const REFUND_HINT = 'store-software-refund:v1';
async function refundRequestId(payload) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  const fingerprint = [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
  const stored = sessionStorage.getItem(REFUND_HINT);
  const hint = stored ? JSON.parse(stored) : { id: crypto.randomUUID(), fingerprint };
  if (hint.fingerprint !== fingerprint) throw new Error(t('refund_uncertain'));
  sessionStorage.setItem(REFUND_HINT, JSON.stringify(hint)); // only opaque ID and hash, no customer/key/order data
  return hint.id;
}

export async function mountAdmin(root, { request }) {
  const config = await request('/admin/store/licenses/config');
  if (!config.enabled) { root.hidden = true; return; }
  root.hidden = false; root.replaceChildren();
  node(node(root, 'summary'), 'h2', t('admin_title'));
  const run = view(root);
  const api = (action, body = {}) => request(`/admin/store/licenses/${action}`, { method: 'POST', body });
  node(root, 'p', t('pilot'));
  if (config.paidActions) {
    const form = node(root, 'form', '', 'store-software__card store-order__panel'); node(form, 'h3', t('paid_title'));
    const order = field(form, t('order'), 'orderToken'); order.pattern = 'store-order-[a-f0-9]{64}';
    node(form, 'button', t('load'), 'btn').type = 'submit';
    const body = node(root, 'div');
    form.addEventListener('submit', event => { event.preventDefault(); const orderToken = order.value.trim(); run(() => loadPaid(orderToken)); });
    async function loadPaid(orderToken,data) {
      data ||= await api('billing', { orderToken }); body.replaceChildren();
      const hint = JSON.parse(sessionStorage.getItem(REFUND_HINT) || 'null');
      if (hint && data.refunds.some(refund => refund.request.id === hint.id)) sessionStorage.removeItem(REFUND_HINT);
      const card = node(body, 'section', '', 'store-software__card store-order__panel'); node(card, 'h3', t('paid_status'));
      node(card, 'p', t('work', { pending: data.work.filter(job => !job.done && !job.review).length, review: data.work.filter(job => job.review).length + data.reviews.length }));
      button(card, t('reconcile'), () => run(async () => { await api('reconcile', { orderToken }); await loadPaid(orderToken); }));
      if (data.lines.some(line => line.interval) && !data.cancellation) confirmAction(card, t('cancel'), t('cancel_help'), run, async () => { await api('cancel-renewals', { orderToken }); await loadPaid(orderToken); });
      if (data.cancellation) node(card, 'p', t('cancelled'));
      for (const line of data.lines.filter(line => line.offer)) {
        const row = node(card, 'section'); node(row, 'h4', line.name);
        reveal(row, run, () => api('paid-recover', { orderToken, lineId: line.id }));
        administration(row,run,(action,p={})=>api('administration',{...p,action,orderToken,lineId:line.id}),()=>loadPaid(orderToken));
      }
      const reviews = node(card, 'ul');
      for (const review of data.reviews) node(reviews, 'li', t(`review_${review.reason}`) + ` · ${review.paymentId || review.refundId || ''}`);
      for (const refund of data.refunds) node(card, 'p', `${t('refund')} ${refund.request.id} · ${money(refund.amountCents)} · ${t(`refund_${refund.state}`)}`);
      node(card,'p',t('history_hint'));
      for(const [kind,cursor] of Object.entries(data.cursors || {})) if(cursor)button(card,t('more_'+kind),()=>run(async()=>{const page=await api('history',{orderToken,kind,cursor});data[kind].push(...page.entries);data.cursors[kind]=page.cursor;await loadPaid(orderToken,data);}));
      for (const payment of data.payments) {
        const details = node(body, 'details', '', 'store-software__card store-order__panel'); node(details, 'summary', `${date(payment.receipt.paidAt)} · ${money(payment.receipt.amountCents)} · ${payment.receipt.id}`);
        for (const item of payment.items) {
          const source = data.lines.find(line => line.id === item.orderLineId);
          node(details, 'p', `${source?.name || item.orderLineId}: ${money(item.amountCents)}`);
          if (!item.amountCents) continue;
          const refundForm = node(details, 'form');
          const amount = field(refundForm, t('refund_amount'), 'amount', 'number'); amount.min = '0.01'; amount.max = String(item.amountCents / 100); amount.step = '0.01';
          const existing = field(refundForm, t('existing_refund'), 'refundId'); existing.required = false; existing.pattern = 're_[A-Za-z0-9_]+';
          field(refundForm, t('refund_confirm'), 'confirmed', 'checkbox');
          const submit = node(refundForm, 'button', t('refund'), 'btn'); submit.type = 'submit';
          refundForm.addEventListener('submit', event => {
            event.preventDefault();
            const value = amount.value;
            if (!/^\d+(\.\d{1,2})?$/.test(value)) return;
            const cents = Number(value.split('.')[0]) * 100 + Number((value.split('.')[1] || '').padEnd(2,'0'));
            const payload = { orderToken, paymentId: payment.receipt.id, allocations: [{ lineId: item.orderLineId, amountCents: cents }], ...(existing.value ? { refundId: existing.value.trim() } : {}) };
            run(async () => { const id = await refundRequestId(payload); await api('refunds', { ...payload, id }); sessionStorage.removeItem(REFUND_HINT); await loadPaid(orderToken); });
          });
        }
      }
    }
  }
  if(config.paidActions) {
    const releases=node(root,'section','','store-software__card store-order__panel');node(releases,'h3',t('releases'));
    const list=node(releases,'div');
    button(releases,t('load_releases'),()=>run(()=>load()));
    async function load(cursor='',append=false) {
      const page=await api('releases',{action:'releases',cursor});if(!append)list.replaceChildren();
      for(const release of page.releases) {
        const row=node(list,'section');node(row,'p',`${release.version || release.id} · ${release.platform}`);
        if(release.withdrawn)node(row,'p',t('withdrawn'));
        else {const id=crypto.randomUUID();confirmAction(row,t('withdraw'),t('withdraw_help'),run,async()=>{await api('releases',{action:'withdraw',id,releaseId:release.id});await load();});}
      }
      if(page.cursor){const more=button(list,t('more'),()=>run(async()=>{await load(page.cursor,true);more.remove();}));}
    }
  }
  const grantForm = node(root, 'form', '', 'store-software__card store-order__panel'); node(grantForm, 'h3', t('complimentary'));
  const email = field(grantForm, t('email'), 'email', 'email');
  const seats = field(grantForm, t('seat_count'), 'seats', 'number', '1'); seats.min = '1'; seats.max = '100';
  const policy = select(grantForm, t('policy'), 'policy', [['lifetime',t('lifetime')],['major',t('major')],['term',t('term')]]);
  const major = field(grantForm, t('major'), 'major', 'number', '1'); major.min = '1';
  const end = field(grantForm, t('end'), 'end', 'date');
  function policyFields() { major.parentElement.hidden = policy.value !== 'major'; major.required = policy.value === 'major'; end.parentElement.hidden = policy.value !== 'term'; end.required = policy.value === 'term'; }
  policy.addEventListener('change', policyFields); policyFields();
  field(grantForm, t('grant_confirm'), 'confirmed', 'checkbox');
  node(grantForm, 'button', t('issue'), 'btn').type = 'submit';
  let grantRequest;
  const grantResults = node(root, 'div');
  grantForm.addEventListener('submit', event => {
    event.preventDefault();
    const meaning = { email: email.value.trim(), product: 'ascii-vj-remix', seats: Number(seats.value), preferredLang: document.documentElement.lang === 'es' ? 'es' : 'en',
      policy: policy.value === 'term' ? { kind:'term',start:0,end:Date.parse(`${end.value}T00:00:00Z`) } : policy.value === 'major' ? {kind:'major',major:Number(major.value)} : {kind:'lifetime'} };
    if (!grantRequest || JSON.stringify(grantRequest.meaning) !== JSON.stringify(meaning)) grantRequest = { id: crypto.randomUUID(), meaning };
    run(async () => { const result = await api('complimentary', { id: grantRequest.id, ...meaning }); node(grantResults, 'p', t('grant_saved', { id: result.id })); await loadGrants(); });
  });
  const grants = node(root, 'div');
  async function loadGrants(cursor = '', append = false) {
    const data = await api('list', { cursor }); if (!append) grants.replaceChildren();
    for (const grant of data.grants) {
      const card = node(grants, 'section', '', 'store-software__card store-order__panel'); node(card, 'h4', grant.email);
      node(card, 'p', `${grant.id} · ${coverageText(grant.policy)} · ${t(`grant_${grant.state}`)}`);
      if (grant.grantedAt) {
        reveal(card, run, () => api('recover', { id: grant.id }));
        administration(card,run,(action,p={})=>api('administration',{...p,action,grantId:grant.id}),()=>loadGrants());
      }
    }
    if (data.cursor) { const more = button(grants, t('more'), () => run(async () => { more.remove(); await loadGrants(data.cursor,true); })); }
  }
  button(root, t('refresh_grants'), () => run(() => loadGrants()));
}
