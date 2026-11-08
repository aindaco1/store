#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  runSecretAudit
} from "../shared/dust-wave-platform/scripts/scan-tracked-secrets.mjs";

// These exact Store settings are browser-visible identifiers, not credentials.
// A secret accidentally assigned to one still fails the value-shape check.
export function storePublicAuditValues(text) {
  return String(text).split(/\r?\n/).flatMap(line => {
    const match = line.trim().match(/^STRIPE_PUBLISHABLE_KEY(?:_TEST|_LIVE)?\s*=\s*(pk_(?:test|live)_[A-Za-z0-9]+)$/);
    return match ? [match[1]] : [];
  });
}

export function auditStoreSecrets(root = process.cwd()) {
  let local = '';
  try { local = readFileSync(resolve(root, 'worker/.dev.vars'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return runSecretAudit({
    root,
    localSecretFiles: ["worker/.dev.vars"],
    allowedLocalValues: [
      "whsec_smoke",
      "sk_test_smoke",
      "test-admin-secret",
      "test-magic-link-secret",
      "re_test_smoke",
      ...storePublicAuditValues(local)
    ]
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href && !auditStoreSecrets()) process.exitCode = 1;
