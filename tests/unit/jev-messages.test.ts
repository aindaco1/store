// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluate, loadCatalog, preparePilot, validatePlan } from '../../scripts/jev-messages.mjs';

const catalog = loadCatalog();
const raw = (questions, choice = 'pass', model = 'jev-1.13.0') => ({
  success: true, result: { model, usage: { input_tokens: 100, output_tokens: 10 },
    answers: Object.fromEntries(Object.keys(questions).map((key) => [key, {
      type: 'choice', choice,
      probabilities: { pass: choice === 'pass' ? 0.98 : 0.01, fail: choice === 'fail' ? 0.98 : 0.01, uncertain: choice === 'uncertain' ? 0.98 : 0.01 }
    }])) }
});

describe('Store synthetic Jev pilot', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('captures actual localized templates with no network and transmits only copy', async () => {
    const fetchMock = vi.fn(() => { throw new Error('Unexpected network'); });
    vi.stubGlobal('fetch', fetchMock);
    const rows = await preparePilot(catalog);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).toBe(fetchMock);
    expect(rows.filter((row) => row.kind === 'control')).toHaveLength(18);
    expect(rows.filter((row) => row.kind === 'candidate')).toHaveLength(12);
    expect(validatePlan(rows)).toMatchObject({ requests: 30, questions: 44 });
    const candidates = Object.fromEntries(rows.map((row) => [row.id, row.payload.input.state.candidate]));
    expect(candidates['lookup-status-es']).toContain('Si ese correo tiene pedidos de Example Store');
    expect(candidates['lookup-email-en']).toContain('It works for 15 minutes.');
    expect(candidates['lookup-email-es']).toContain('Funciona por 15 minutos.');
    expect(candidates['reminder-email-es']).toContain('No enviar recordatorios de pago');
    expect(candidates['free-rsvp-email-en']).toContain('$0.00');
    for (const row of rows) {
      expect(Object.keys(row.payload.input.state).sort()).toEqual(row.payload.input.state.reference ? ['candidate', 'reference'] : ['candidate']);
      expect(JSON.stringify(row.payload)).not.toMatch(/synthetic-not-a-credential|customer@example\.com|RESEND_API_KEY|\/Users\//);
    }
  });

  it('rejects missing copy and unexpanded placeholders before any remote evaluation', async () => {
    const missing = structuredClone(catalog);
    delete missing.es.runtime.order_lookup.generic_sent;
    await expect(preparePilot(missing)).rejects.toThrow('Missing localized');
    const unexpanded = structuredClone(catalog);
    unexpanded.en.runtime.order_lookup.generic_sent = '%{private_data}';
    await expect(preparePilot(unexpanded)).rejects.toThrow('interpolation');
  });

  it('enforces batch and byte limits before invoking the provider', async () => {
    const rows = await preparePilot(catalog);
    const call = vi.fn();
    await expect(evaluate(Array(41).fill(rows[0]), call)).rejects.toThrow('budget');
    await expect(evaluate([rows[0], rows[0]], call)).rejects.toThrow('budget');
    rows[0].payload.input.state.candidate = 'x'.repeat(16001);
    await expect(evaluate(rows, call)).rejects.toThrow('budget');
    expect(call).not.toHaveBeenCalled();
  });

  it('requires both known-answer controls and candidate checks to pass', async () => {
    const rows = await preparePilot(catalog);
    let index = 0;
    const report = await evaluate(rows, async (payload) => raw(payload.input.questions, rows[index++].expected || 'pass'));
    expect(report).toMatchObject({ complete: true, controlsPassed: true, status: 'pass', usage: { input_tokens: 3000, output_tokens: 300 } });
    const badControls = await evaluate(rows, async (payload) => raw(payload.input.questions));
    expect(badControls).toMatchObject({ complete: true, controlsPassed: false, status: 'review' });
  });

  it('retains explicit review when the model changes or answers are uncertain', async () => {
    const rows = await preparePilot(catalog);
    let index = 0;
    const report = await evaluate(rows, async (payload) => {
      const row = rows[index++];
      return raw(payload.input.questions, row.expected || 'pass', row.kind === 'candidate' ? 'changed-model' : 'jev-1.13.0');
    });
    expect(report.status).toBe('review');
    expect(report.results.filter((row) => row.kind === 'candidate').every((row) => row.status === 'review')).toBe(true);
    const uncertain = await evaluate(rows, async (payload) => raw(payload.input.questions, 'uncertain'));
    expect(uncertain.status).toBe('review');
  });

  it('stops without retries and redacts provider failures and malformed responses', async () => {
    const rows = await preparePilot(catalog);
    for (const call of [vi.fn(async () => { throw Error('secret credential'); }), vi.fn(async () => ({ result: { state: 'Pending' } }))]) {
      const report = await evaluate(rows, call);
      expect(report).toMatchObject({ complete: false, controlsPassed: false, status: 'error' });
      expect(call).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(report)).not.toContain('secret credential');
    }
  });

  it('previews without credentials, rejects arbitrary inputs and refuses evidence overwrite', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'store-jev-'));
    try {
      const output = path.join(directory, 'preview');
      const args = ['scripts/jev-messages.mjs', '--dry-run', `--output-dir=${output}`];
      const options = { cwd: process.cwd(), encoding: 'utf8' as const,
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: 'invalid', CLOUDFLARE_API_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] as const };
      expect(execFileSync(process.execPath, args, options)).toContain('dry-run');
      const before = readFileSync(path.join(output, 'report.json'), 'utf8');
      expect(JSON.parse(before)).toMatchObject({ dryRun: true, complete: false, releaseAccepted: false, networkAttempts: 0 });
      expect(() => execFileSync(process.execPath, args, options)).toThrow();
      expect(readFileSync(path.join(output, 'report.json'), 'utf8')).toBe(before);
      expect(() => execFileSync(process.execPath, ['scripts/jev-messages.mjs', '--input=private.json'], options)).toThrow();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
