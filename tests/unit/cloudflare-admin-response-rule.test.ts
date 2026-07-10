import { describe, expect, it, vi } from 'vitest';

import {
  ADMIN_RESPONSE_RULE_PHASE,
  ADMIN_RESPONSE_RULE_REF,
  adminResponseRuleMatches,
  buildAdminResponseRule,
  configureAdminResponseRule
} from '../../scripts/configure-cloudflare-admin-response-rule.mjs';

const ZONE_ID = '0123456789abcdef0123456789abcdef';
const TOKEN = 'cloudflare-test-token';
const SITE_BASE = 'https://shop.dustwave.xyz';

function apiResponse(result: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status >= 200 && status < 300, result, errors: [] }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function ruleset(rules: any[] = []) {
  return {
    id: 'ruleset-id',
    kind: 'zone',
    phase: ADMIN_RESPONSE_RULE_PHASE,
    rules
  };
}

describe('Cloudflare admin response rule', () => {
  it('builds a narrow no-store and no-transform policy for localized admin routes', () => {
    const rule = buildAdminResponseRule(SITE_BASE);

    expect(rule.ref).toBe(ADMIN_RESPONSE_RULE_REF);
    expect(rule.expression).toContain('http.host eq "shop.dustwave.xyz"');
    expect(rule.expression).toContain('http.request.uri.path eq "/admin"');
    expect(rule.expression).toContain('http.request.uri.path eq "/es/admin"');
    expect(rule.action_parameters).toMatchObject({
      'max-age': { operation: 'set', value: 0 },
      'no-store': { operation: 'set' },
      'no-transform': { operation: 'set' },
      private: { operation: 'set' }
    });
    expect(JSON.stringify(rule)).not.toContain('unsafe-inline');
  });

  it('reports an existing matching rule without writing or exposing credentials', async () => {
    const desired = { id: 'rule-id', ...buildAdminResponseRule(SITE_BASE) };
    const fetchImpl = vi.fn().mockResolvedValue(apiResponse(ruleset([desired])));

    const result = await configureAdminResponseRule({
      zoneId: ZONE_ID,
      token: TOKEN,
      siteBase: SITE_BASE,
      fetchImpl
    });

    expect(result).toMatchObject({ state: 'current', changed: false, containsCredentials: false });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('adds only the managed rule when an entrypoint already has unrelated rules', async () => {
    const unrelated = { id: 'other-rule', ref: 'other', action: 'set_cache_control' };
    const desired = { id: 'managed-rule', ...buildAdminResponseRule(SITE_BASE) };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(apiResponse(ruleset([unrelated])))
      .mockResolvedValueOnce(apiResponse(ruleset([unrelated, desired])));

    const result = await configureAdminResponseRule({
      apply: true,
      zoneId: ZONE_ID,
      token: TOKEN,
      siteBase: SITE_BASE,
      fetchImpl
    });

    expect(result).toMatchObject({ state: 'current', operation: 'add_rule', changed: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, request] = fetchImpl.mock.calls[1];
    expect(url).toContain('/rulesets/ruleset-id/rules');
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body)).toMatchObject({ ref: ADMIN_RESPONSE_RULE_REF });
    expect(request.body).not.toContain('other-rule');
  });

  it('updates its own drifted rule in place', async () => {
    const desired = buildAdminResponseRule(SITE_BASE);
    const drifted = { id: 'managed-rule', ...desired, expression: 'http.host eq "wrong.example"' };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(apiResponse(ruleset([drifted])))
      .mockResolvedValueOnce(apiResponse(ruleset([{ id: 'managed-rule', ...desired }])));

    const result = await configureAdminResponseRule({
      apply: true,
      zoneId: ZONE_ID,
      token: TOKEN,
      siteBase: SITE_BASE,
      fetchImpl
    });

    expect(result.operation).toBe('update_rule');
    expect(fetchImpl.mock.calls[1][1].method).toBe('PATCH');
    expect(fetchImpl.mock.calls[1][0]).toContain('/rules/managed-rule');
  });

  it('creates the phase entrypoint when it is missing', async () => {
    const desired = { id: 'managed-rule', ...buildAdminResponseRule(SITE_BASE) };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(apiResponse(null, 404))
      .mockResolvedValueOnce(apiResponse(ruleset([desired])));

    const result = await configureAdminResponseRule({
      apply: true,
      zoneId: ZONE_ID,
      token: TOKEN,
      siteBase: SITE_BASE,
      fetchImpl
    });

    expect(result.operation).toBe('create_ruleset');
    const body = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(body).toMatchObject({ kind: 'zone', phase: ADMIN_RESPONSE_RULE_PHASE });
    expect(body.rules).toHaveLength(1);
    expect(adminResponseRuleMatches(body.rules[0], buildAdminResponseRule(SITE_BASE))).toBe(true);
  });
});
