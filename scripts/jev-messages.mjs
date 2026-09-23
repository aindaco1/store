#!/usr/bin/env node
// Development-only semantic pilot. No Store runtime imports this module.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { getStoreTranslator } from '../worker/src/i18n.js';
import { sendStoreOrderEmail, sendStoreOrderLookupEmail, sendStoreAbandonedCartEmail } from '../worker/src/email.js';
import { parseWranglerConfig } from './lib/wrangler-config.mjs';
import { createJevRequest, evaluateJevCases, callCloudflareJev } from '../shared/dust-wave-platform/packages/test-core/src/jev.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = 'tests/fixtures/jev-messages.json';
const POLICY = { minimumMargin: 0.10, models: ['jev-1.13.0'] }; // Provisional; not calibrated for Store.
const LIMITS = { requests: 40, questions: 80, requestBytes: 16000 };
const PARITY = 'The Spanish candidate preserves the English reference meaning, including conditions, quantities, timing, consent, and next steps, without unsupported promises. Natural paraphrases and unchanged proper names, URLs and identifiers are allowed. Information present only in the reference does not count as present in the candidate.';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const at = (object, key) => key.split('.').reduce((value, part) => value?.[part], object);

export function loadCatalog() {
  return Object.fromEntries(['en', 'es'].map((lang) => [lang, JSON.parse(execFileSync('ruby', [
    '-ryaml', '-rjson', '-e', 'puts JSON.generate(YAML.load_file(ARGV.fetch(0)))', `_data/i18n/${lang}.yml`
  ], { cwd: ROOT, encoding: 'utf8', timeout: 15000 }))]));
}

async function renderCandidate(entry, lang, catalog) {
  const env = {
    I18N_CATALOG: catalog, SITE_BASE: 'https://store.example', PLATFORM_NAME: 'Example Store',
    PLATFORM_COMPANY_NAME: 'Example Store', SUPPORT_EMAIL: 'support@store.example',
    ORDERS_EMAIL_FROM: 'Example Store <orders@store.example>',
    UPDATES_EMAIL_FROM: 'Example Store <updates@store.example>',
    RESEND_API_KEY: 'synthetic-not-a-credential', STORE_EMAIL_CAPTURE_PAYLOAD: 'true', STORE_EMAIL_DRY_RUN: 'true'
  };
  if (entry.key) {
    if (typeof at(catalog[lang], entry.key) !== 'string') throw new Error('Missing localized pilot copy');
    const { t } = await getStoreTranslator(env, lang);
    return t(entry.key, '', { platform: 'Example Store' });
  }
  const common = { email: 'customer@example.com', preferredLang: lang };
  if (entry.email === 'lookup') {
    await sendStoreOrderLookupEmail(env, { ...common, orderCount: 1, lookupUrl: 'https://store.example/orders/?lookup=synthetic' });
  } else if (entry.email === 'reminder') {
    await sendStoreAbandonedCartEmail(env, { ...common, itemCount: 1, amountCents: 2500,
      resumeUrl: 'https://store.example/checkout/', unsubscribeUrl: 'https://store.example/unsubscribe/?token=synthetic' });
  } else if (entry.email === 'rsvp') {
    await sendStoreOrderEmail(env, { ...common, orderToken: 'synthetic-rsvp', orderDraft: {
      orderToken: 'synthetic-rsvp', preferredLang: lang, totals: { subtotalCents: 0, totalCents: 0 },
      items: [{ name: 'Example Screening', quantity: 1, subtotalCents: 0, fulfillmentType: 'rsvp' }]
    } });
  } else throw new Error('Unknown built-in email fixture');
  const payload = env.__STORE_CAPTURED_EMAIL_PAYLOAD;
  if (!payload?.subject || !payload?.text) throw new Error('Email capture did not produce subject and plain text');
  return `${payload.subject}\n\n${payload.text}`;
}

export async function preparePilot(catalog = loadCatalog()) {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, FIXTURE), 'utf8'));
  const rows = [];
  const add = (id, kind, candidate, requirements, expected, reference) => {
    if (!candidate.trim() || /%\{[^}]+\}/.test(candidate)) throw new Error('Empty copy or unresolved interpolation');
    rows.push({ id, kind, expected, requirements, payload: createJevRequest(candidate, requirements, { reference }) });
  };
  for (const control of fixture.controls) {
    for (const lang of ['en', 'es']) for (const variant of ['good', 'bad']) {
      add(`${control.rule}-${lang}-${variant}`, 'control', control[variant][lang],
        { [control.rule]: fixture.rules[control.rule] }, variant === 'good' ? 'pass' : 'fail');
    }
  }
  for (const variant of ['good', 'bad']) {
    add(`translation-${variant}`, 'control', fixture.translationControl[variant], { parity: PARITY },
      variant === 'good' ? 'pass' : 'fail', fixture.translationControl.source);
  }
  // Even a future renderer regression must not make an external email/catalog request.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Network is disabled during synthetic rendering'); };
  try {
    for (const entry of fixture.cases) {
      let english;
      for (const lang of ['en', 'es']) {
        const candidate = await renderCandidate(entry, lang, catalog);
        const requirements = Object.fromEntries(entry.rules.map((rule) => [rule, fixture.rules[rule]]));
        if (lang === 'en') english = candidate;
        else requirements.parity = PARITY;
        add(`${entry.id}-${lang}`, 'candidate', candidate, requirements, undefined, lang === 'es' ? english : undefined);
      }
    }
  } finally { globalThis.fetch = originalFetch; }
  validatePlan(rows);
  return rows;
}

export function validatePlan(rows) {
  const questions = rows.reduce((sum, row) => sum + Object.keys(row.payload.input.questions).length, 0);
  if (!rows.length || new Set(rows.map((row) => row.id)).size !== rows.length ||
      rows.length > LIMITS.requests || questions > LIMITS.questions ||
      rows.some((row) => Buffer.byteLength(JSON.stringify(row.payload)) > LIMITS.requestBytes)) {
    throw new Error('Pilot request budget exceeded');
  }
  return { requests: rows.length, questions, limits: LIMITS };
}

function credentials(wranglerAuth) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || parseWranglerConfig(fs.readFileSync(path.join(ROOT, 'worker/wrangler.toml'), 'utf8')).account_id;
  if (!/^[a-f0-9]{32}$/i.test(account || '')) throw new Error('Set CLOUDFLARE_ACCOUNT_ID for the pilot');
  let token = process.env.CLOUDFLARE_API_TOKEN;
  if (wranglerAuth || !token) {
    try {
      const value = JSON.parse(execFileSync(path.join(ROOT, 'worker/node_modules/.bin/wrangler'), ['auth', 'token', '--json'],
        { cwd: ROOT, encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'] }));
      token = value.token || value.access_token;
    } catch { throw new Error('Existing Wrangler authentication unavailable; set CLOUDFLARE_API_TOKEN'); }
  }
  if (typeof token !== 'string' || !token.trim()) throw new Error('Cloudflare token unavailable');
  return { account, token };
}

export async function evaluate(rows, call, progress = () => {}, checkpoint = () => {}) {
  validatePlan(rows);
  const shared = await evaluateJevCases(rows.map((row) => ({
    id: row.id, candidate: row.payload.input.state.candidate, reference: row.payload.input.state.reference,
    requirements: row.requirements
  })), { policy: POLICY, call, maxQuestions: LIMITS.questions, onProgress: checkpoint });
  const results = shared.cases.map((entry, index) => {
    const row = rows[index];
    const decisions = Object.fromEntries(Object.entries(entry.result?.findings || {}).map(([key, finding]) => [key, finding.decision]));
    const status = entry.error ? 'error' : Object.values(decisions).length &&
      Object.values(decisions).every((value) => value === (row.expected || 'pass')) ? 'pass' : 'review';
    progress(row.id, status);
    return { ...row, status, decisions, raw: entry.raw, error: entry.error,
      model: entry.result?.model, usage: entry.result?.usage, elapsedMs: entry.elapsedMs };
  });
  const controls = results.filter((row) => row.kind === 'control');
  const controlsPassed = shared.complete && controls.length > 0 && controls.every((row) => row.status === 'pass');
  return { complete: shared.complete, controlsPassed, networkAttempts: shared.networkAttempts,
    status: !shared.complete ? 'error' : controlsPassed && results.every((row) => row.status === 'pass') ? 'pass' : 'review',
    usage: results.reduce((sum, row) => ({ input_tokens: sum.input_tokens + (row.usage?.input_tokens || 0),
      output_tokens: sum.output_tokens + (row.usage?.output_tokens || 0) }), { input_tokens: 0, output_tokens: 0 }), results };
}

function reviewMarkdown(report) {
  const lines = ['# Store Jev message pilot', '', `Status: ${report.status}. Development diagnostics only; no release or translation approval.`,
    '', `Completed: ${report.complete}. Known-answer controls passed: ${report.controlsPassed ?? 'not run'}.`,
    '', 'The 0.10 margin is provisional. Review all findings against the displayed copy and requirement.', ''];
  for (const row of report.results || []) {
    lines.push(`## ${row.id}: ${row.status}`, '', row.payload.input.state.candidate, '');
    for (const [key, requirement] of Object.entries(row.requirements)) {
      lines.push(`- ${key}: ${row.decisions?.[key] || 'not evaluated'}${row.expected ? ` (expected ${row.expected})` : ''}. ${requirement}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean' }, 'wrangler-auth': { type: 'boolean' },
    'output-dir': { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('npm run test:jev -- [--dry-run] [--wrangler-auth] [--output-dir=/new/directory]\nBuilt-in synthetic fixtures only. Live calls require Cloudflare auth. No automatic retries.');
    return;
  }
  execFileSync('ruby', ['scripts/check-i18n-completeness.rb'], { cwd: ROOT, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
  const rows = await preparePilot(); // Complete local validation before auth.
  const output = path.resolve(values['output-dir'] || path.join(ROOT, 'jev-results', `jev-${new Date().toISOString().replace(/[:.]/g, '-')}`));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(output); // Refuse to overwrite prior evidence.
  const sourceFiles = [FIXTURE, 'scripts/jev-messages.mjs', '_data/i18n/en.yml', '_data/i18n/es.yml',
    'worker/src/email.js', 'worker/src/i18n.js', 'worker/src/provider-config.js',
    'shared/dust-wave-platform/packages/test-core/src/jev.js'];
  const report = { schemaVersion: 1, createdAt: new Date().toISOString(), releaseAccepted: false, dryRun: Boolean(values['dry-run']),
    status: 'error', complete: false, networkAttempts: 0, policy: POLICY, budget: validatePlan(rows),
    platformCommit: execFileSync('git', ['-C', path.join(ROOT, 'shared/dust-wave-platform'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceHashes: Object.fromEntries(sourceFiles.map((file) => [file, hash(fs.readFileSync(path.join(ROOT, file)))])), results: [] };
  fs.writeFileSync(path.join(output, 'requests.json'), JSON.stringify(rows, null, 2) + '\n');
  try {
    if (values['dry-run']) Object.assign(report, { status: 'dry-run', results: rows.map((row) => ({ ...row, status: 'not-run' })) });
    else {
      const auth = credentials(values['wrangler-auth']);
      Object.assign(report, await evaluate(rows, (payload) => callCloudflareJev(payload, { accountId: auth.account, token: auth.token }),
        (id, status) => console.log(`${id}: ${status}`),
        (partial) => fs.writeFileSync(path.join(output, 'progress.json'), JSON.stringify(partial, null, 2) + '\n')));
    }
  } catch { report.error = 'Pilot setup failed; verify local Cloudflare account and authentication. No secret details recorded.'; }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'review.md'), reviewMarkdown(report));
  console.log(`Jev pilot ${report.status}: ${output}`);
  process.exitCode = report.status === 'error' ? 2 : report.status === 'review' ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Jev pilot could not prepare local evidence; check fixtures, Ruby, locale completeness and a new output directory. No provider details printed.'); process.exitCode = 2; });
}
