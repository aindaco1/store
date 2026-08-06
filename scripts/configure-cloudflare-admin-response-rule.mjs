#!/usr/bin/env node
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  ADMIN_RESPONSE_RULE_PHASE,
  createAdminResponseRuleClient
} from '../shared/dust-wave-platform/packages/release-core/src/cloudflare-admin-response-rule.js';

export { ADMIN_RESPONSE_RULE_PHASE };
export const ADMIN_RESPONSE_RULE_REF = 'store_admin_no_transform_v1';
export const ADMIN_RESPONSE_RULE_DESCRIPTION = 'Store admin no-transform and no-store';

const client = createAdminResponseRuleClient({
  ruleRef: ADMIN_RESPONSE_RULE_REF,
  ruleDescription: ADMIN_RESPONSE_RULE_DESCRIPTION,
  rulesetName: 'Store cache response rules',
  rulesetDescription: 'Store-managed response cache controls',
  adminPaths: ['/admin', '/es/admin'],
  publicPaths: ['/admin/', '/es/admin/']
});

export const ADMIN_RESPONSE_RULE_POLICY = client.policy;
export const buildAdminResponseRule = client.buildAdminResponseRule;
export const adminResponseRuleMatches = client.adminResponseRuleMatches;
export const verifyAdminResponsePolicy = client.verifyAdminResponsePolicy;
export const configureAdminResponseRule = client.configureAdminResponseRule;

function valueArg(args, name, fallback = '') {
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npm run cloudflare:admin-response-rule -- [--verify-public | --apply] [--require-current] [--site-base=https://example.com]');
    console.log('API reads/apply require CLOUDFLARE_ZONE_ID and CLOUDFLARE_CACHE_RULES_API_TOKEN; public verification requires neither.');
    return;
  }
  const siteBase = valueArg(args, '--site-base', process.env.SITE_BASE || 'https://shop.dustwave.xyz');
  const result = args.includes('--verify-public')
    ? await verifyAdminResponsePolicy({ siteBase })
    : await configureAdminResponseRule({
      apply: args.includes('--apply'),
      zoneId: process.env.CLOUDFLARE_ZONE_ID || process.env.CLOUDFLARE_ZONE,
      token: process.env.CLOUDFLARE_CACHE_RULES_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN,
      siteBase
    });
  console.log(JSON.stringify(result, null, 2));
  if (args.includes('--require-current') && result.state !== 'current') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}
