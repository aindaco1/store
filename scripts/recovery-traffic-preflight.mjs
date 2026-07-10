#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

function valueArg(args, name, fallback = '') {
  const exact = args.indexOf(name);
  if (exact >= 0 && args[exact + 1]) return args[exact + 1];
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function normalizedAccountId(value) {
  const accountId = String(value || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('Recovery traffic preflight requires a valid Cloudflare account ID.');
  return accountId;
}

function normalizedScriptName(value) {
  const scriptName = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(scriptName)) throw new Error('Recovery traffic preflight requires a valid Worker script name.');
  return scriptName;
}

export function buildRecoveryTrafficQuery() {
  return `query StoreRecoveryTraffic($accountTag: string!, $scriptName: string!, $start: string!, $end: string!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      recent: workersInvocationsAdaptive(
        limit: 10000
        filter: { scriptName: $scriptName, datetime_geq: $start, datetime_leq: $end }
      ) {
        sum { requests subrequests errors }
      }
    }
  }
}`;
}

export function summarizeRecoveryTraffic(rows = [], options = {}) {
  const maximumRequests = boundedInteger(options.maximumRequests, 100, 0, 1_000_000);
  const maximumErrors = boundedInteger(options.maximumErrors, 0, 0, 1_000_000);
  const totals = (Array.isArray(rows) ? rows : []).reduce((summary, row) => {
    summary.requests += Math.max(0, Number(row?.sum?.requests || 0));
    summary.subrequests += Math.max(0, Number(row?.sum?.subrequests || 0));
    summary.errors += Math.max(0, Number(row?.sum?.errors || 0));
    return summary;
  }, { requests: 0, subrequests: 0, errors: 0 });
  return {
    ...totals,
    maximumRequests,
    maximumErrors,
    lowTraffic: totals.requests <= maximumRequests && totals.errors <= maximumErrors
  };
}

export async function collectRecoveryTrafficPreflight(options = {}) {
  const accountId = normalizedAccountId(options.accountId);
  const scriptName = normalizedScriptName(options.scriptName || 'store-worker');
  const apiToken = String(options.apiToken || '').trim();
  if (!apiToken) throw new Error('Recovery traffic preflight requires a Cloudflare Analytics API token.');
  const recentMinutes = boundedInteger(options.recentMinutes, 15, 5, 120);
  const end = options.now instanceof Date ? options.now : new Date();
  const start = new Date(end.getTime() - recentMinutes * 60 * 1000);
  const response = await (options.fetchImpl || fetch)('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: buildRecoveryTrafficQuery(),
      variables: {
        accountTag: accountId,
        scriptName,
        start: start.toISOString(),
        end: end.toISOString()
      }
    }),
    redirect: 'error'
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || (Array.isArray(body.errors) && body.errors.length)) {
    throw new Error(`Cloudflare recovery traffic query failed with status ${response.status}.`);
  }
  const rows = body?.data?.viewer?.accounts?.[0]?.recent || [];
  return {
    schemaVersion: 1,
    checkedAt: end.toISOString(),
    window: { start: start.toISOString(), end: end.toISOString(), minutes: recentMinutes },
    scriptName,
    containsCredentials: false,
    containsCustomerData: false,
    traffic: summarizeRecoveryTraffic(rows, options)
  };
}

function writeOutput(output, value) {
  if (!output) return;
  const resolved = path.resolve(output);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/recovery-traffic-preflight.mjs [--recent-minutes=15] [--maximum-requests=100] [--maximum-errors=0] [--output=FILE] [--strict]');
    console.log('Requires CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ANALYTICS_API_TOKEN, and CLOUDFLARE_WORKER_SCRIPT_NAME.');
    return;
  }
  const result = await collectRecoveryTrafficPreflight({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_ANALYTICS_API_TOKEN || process.env.CLOUDFLARE_USAGE_API_TOKEN,
    scriptName: process.env.CLOUDFLARE_WORKER_SCRIPT_NAME || 'store-worker',
    recentMinutes: valueArg(args, '--recent-minutes', '15'),
    maximumRequests: valueArg(args, '--maximum-requests', '100'),
    maximumErrors: valueArg(args, '--maximum-errors', '0')
  });
  writeOutput(valueArg(args, '--output', ''), result);
  console.log(JSON.stringify(result, null, 2));
  if (args.includes('--strict') && !result.traffic.lowTraffic) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
