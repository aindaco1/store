#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_API_BASE = 'https://grt.edacnm.org';
const OUTPUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'worker',
  'src',
  'tax-data',
  'nm-grt-starter.js'
);

const STARTER_ADDRESSES = [
  {
    city: 'Albuquerque',
    county: 'Bernalillo',
    postalCode: '87193',
    street_number: '65432',
    street_name: 'PO BOX'
  },
  {
    city: 'Santa Fe',
    county: 'Santa Fe',
    postalCode: '87501',
    street_number: '1',
    street_name: 'Mansion',
    street_suffix: 'Dr'
  },
  {
    city: 'Los Alamos',
    county: 'Los Alamos',
    postalCode: '87544',
    street_number: '1',
    street_name: 'PO BOX'
  },
  {
    city: 'Española',
    county: 'Rio Arriba',
    postalCode: '87532',
    street_number: '1',
    street_name: 'PO BOX'
  },
  {
    city: 'Taos',
    county: 'Taos',
    postalCode: '87571',
    street_number: '1',
    street_name: 'PO BOX'
  }
];

function normalizeCityAliases(city) {
  const ascii = String(city || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  const original = String(city || '').trim().toUpperCase();
  return Array.from(new Set([ascii, original])).filter(Boolean);
}

async function lookupAddress(apiBase, seed) {
  const params = new URLSearchParams({
    street_number: seed.street_number,
    street_name: seed.street_name,
    city: seed.city,
    zipcode: seed.postalCode,
    county: seed.county
  });
  if (seed.street_suffix) params.set('street_suffix', seed.street_suffix);
  if (seed.street_post_directional) params.set('street_post_directional', seed.street_post_directional);
  if (seed.pre_direction) params.set('pre_direction', seed.pre_direction);

  const response = await fetch(`${apiBase.replace(/\/+$/, '')}/api/by_address?${params.toString()}`, {
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) {
    throw new Error(`Lookup failed for ${seed.city} ${seed.postalCode}: ${response.status}`);
  }
  const payload = await response.json();
  const result = Array.isArray(payload?.results) ? payload.results[0] : null;
  if (!result || result.success !== true) {
    throw new Error(`No successful result for ${seed.city} ${seed.postalCode}`);
  }

  return {
    city: normalizeCityAliases(seed.city)[0] === String(seed.city || '').trim().toUpperCase()
      ? seed.city
      : seed.city.normalize('NFD').replace(/\p{Diacritic}/gu, ''),
    cityAliases: normalizeCityAliases(seed.city),
    county: seed.county,
    postalCodes: [seed.postalCode],
    locationCode: String(result.location_code || '').trim(),
    effectiveRate: Math.max(0, Number(result.tax_rate) || 0) / 100,
    source: String(result.source || '').trim() || 'Unknown',
    sampleAddress: {
      street_number: seed.street_number,
      street_name: seed.street_name,
      ...(seed.street_suffix ? { street_suffix: seed.street_suffix } : {}),
      ...(seed.street_post_directional ? { street_post_directional: seed.street_post_directional } : {}),
      ...(seed.pre_direction ? { pre_direction: seed.pre_direction } : {}),
      city: seed.city,
      zipcode: seed.postalCode,
      county: seed.county
    }
  };
}

function renderModule(entries, apiBase) {
  return `export const NM_GRT_STARTER_METADATA = ${JSON.stringify({
    generatedAt: new Date().toISOString().slice(0, 10),
    source: `${apiBase.replace(/\/+$/, '')}/api/by_address`,
    notes: 'Starter New Mexico GRT reference locations harvested from the public EDAC API. Rates are percentages and should be refreshed over time.'
  }, null, 2)};

export const NM_GRT_STARTER_LOCATIONS = ${JSON.stringify(entries, null, 2)};
`;
}

const apiBase = process.env.NM_GRT_API_BASE || DEFAULT_API_BASE;
const entries = [];
for (const seed of STARTER_ADDRESSES) {
  entries.push(await lookupAddress(apiBase, seed));
}

await writeFile(OUTPUT_PATH, renderModule(entries, apiBase), 'utf8');
console.log(`Wrote ${entries.length} New Mexico starter locations to ${OUTPUT_PATH}`);
