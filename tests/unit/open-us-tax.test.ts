import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { resolveOpenUsTax } from '../../worker/src/open-us-tax.js';
import bundled from '../../shared/dust-wave-platform/packages/tax-core/data/open-us-tax.json';
import { buildOpenTaxSnapshot, updateOpenTax } from '../../scripts/update-open-us-tax.mjs';

const now = Date.parse('2026-10-27T12:00:00Z');
const metadata = { release: 'test', sourceUpdatedAt: '2026-10-01T00:00:00Z', sha256: 'a'.repeat(64) };
const fixture = [
  'COPY public.states (id, abbrev, name, sst_member, sst_joined, has_sales_tax, notes) FROM stdin;',
  '1\tNY\tNew York\tf\t\\N\tt\t\\N', '\\.',
  'COPY public.tax_authorities (id, state_id, name, authority_type, parent_id) FROM stdin;',
  '1\t1\tNew York\tstate\t\\N', '2\t1\tNew York City\tcity\t1',
  '3\t1\tMCTD\tdistrict\t1', '\\.',
  'COPY public.boundaries (id, authority_id, zip5, zip4_low, zip4_high, address_pattern, data_version_id) FROM stdin;',
  '1\t1\t10467\t\\N\t\\N\t\\N\t1', '2\t2\t10467\t\\N\t\\N\t\\N\t1',
  '3\t3\t10467\t\\N\t\\N\t\\N\t1', '\\.',
  'COPY public.rates (id, authority_id, rate_pct, effective_from, effective_to, applies_to_categories, data_version_id) FROM stdin;',
  '1\t1\t4.00000\t2005-06-01\t\\N\tnull\t1', '2\t2\t4.50000\t2005-06-01\t\\N\tnull\t1',
  '3\t3\t0.37500\t2005-06-01\t\\N\tnull\t1', '\\.'
];

describe('open US tax snapshots', () => {
  it.each(['10467', '10467-1234', '10001', '11201'])('includes NYC and MCTD for %s', (zip) => {
    const result = resolveOpenUsTax(zip, { now });
    expect(result?.ratePartsPerMillion).toBe(88750);
    expect(result?.components.map((item) => item.rate)).toEqual([40000, 3750, 45000]);
  });

  it.each([['33101', 70000], ['60601', 102500], ['75201', 82500], ['90210', 105000]])(
    'includes available local components for %s', (zip, rate) => {
      expect(resolveOpenUsTax(zip, { now })?.ratePartsPerMillion).toBe(rate);
    });

  it('does not invent local coverage for partial, missing, or excluded destinations', () => {
    for (const zip of ['98101', '98101-1234', '80205', '70112', '00501', '87048', '1046', '1046x']) {
      expect(resolveOpenUsTax(zip, { now }), zip).toBeNull();
    }
  });

  it('expires against the source timestamp, not the date we downloaded it', () => {
    const updated = Date.parse(bundled.sourceUpdatedAt);
    expect(resolveOpenUsTax('10467', { now: updated - 1 })).toBeNull();
    expect(resolveOpenUsTax('10467', { now: updated + 90 * 86400000 })).toBeNull();
  });

  it('imports data without executing SQL and preserves exact fractional rates', async () => {
    const data = await buildOpenTaxSnapshot([...fixture, 'DROP TABLE customers;'], metadata);
    expect(resolveOpenUsTax('10467', { data, now })?.ratePartsPerMillion).toBe(88750);
  });

  it('rejects ZIPs with address or ZIP+4-specific boundaries instead of guessing', async () => {
    const data = await buildOpenTaxSnapshot(fixture.map((line) => line.startsWith('2\t2\t10467')
      ? line.replace('10467\t\\N\t\\N', '10467\t1000\t1999') : line), metadata);
    expect(resolveOpenUsTax('10467', { data, now })).toBeNull();
    expect(resolveOpenUsTax('10467-1000', { data, now })).toBeNull();
  });

  it('uses effective dates and refuses missing or overlapping active rates', async () => {
    const data = await buildOpenTaxSnapshot(fixture, metadata);
    data.authorities['2'].rates = [[45000, '2005-06-01', '2026-10-31'], [46000, '2026-11-01', null]];
    expect(resolveOpenUsTax('10467', { data, now })?.ratePartsPerMillion).toBe(88750);
    expect(resolveOpenUsTax('10467', { data, now: Date.parse('2026-11-01') })?.ratePartsPerMillion).toBe(89750);
    data.authorities['2'].rates.pop();
    expect(resolveOpenUsTax('10467', { data, now: Date.parse('2026-11-01') })).toBeNull();
    data.authorities['2'].rates.push([46000, '2026-10-01', null]);
    expect(resolveOpenUsTax('10467', { data, now })).toBeNull();
  });

  it('does not stack competing cities or states', async () => {
    const data = await buildOpenTaxSnapshot(fixture, metadata);
    data.authorities['4'] = { ...data.authorities['2'], name: 'Different city' };
    data.zipCodes['10467'].push('4');
    expect(resolveOpenUsTax('10467', { data, now })).toBeNull();
    data.authorities['4'].type = 'district';
    data.authorities['4'].state = 'NJ';
    expect(resolveOpenUsTax('10467', { data, now })).toBeNull();
  });

  it('refuses truncated or changed schemas', async () => {
    await expect(buildOpenTaxSnapshot(fixture.slice(0, 3), metadata)).rejects.toThrow('Incomplete');
    await expect(buildOpenTaxSnapshot(fixture.map((line) => line.replace('rate_pct,', 'rate_fraction,')), metadata)).rejects.toThrow('schema');
  });

  it('preserves the current snapshot if a download fails integrity validation', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tax-test-'));
    try {
      const output = path.join(directory, 'snapshot.json'), dump = path.join(directory, 'source.gz');
      await writeFile(output, 'existing snapshot');
      await writeFile(dump, gzipSync(fixture.join('\n')));
      await expect(updateOpenTax({ dump, output, manifest: { ...metadata, sourceUpdatedAt: new Date().toISOString() } })).rejects.toThrow('SHA-256');
      expect(await readFile(output, 'utf8')).toBe('existing snapshot');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
