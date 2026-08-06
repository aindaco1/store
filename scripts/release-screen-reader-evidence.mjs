#!/usr/bin/env node
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { runScreenReaderEvidence } from '../shared/dust-wave-platform/packages/release-core/src/screen-reader-evidence.js';

export const SCREEN_READER_EVIDENCE_POLICY = Object.freeze({
  productLabel: 'Store',
  tempPrefix: 'store-screen-reader-evidence-',
  defaultExpectedPhrases: Object.freeze(['Shop']),
  defaultUrl: 'http://127.0.0.1:4002/'
});

export function collectScreenReaderEvidence(options = {}) {
  return runScreenReaderEvidence(SCREEN_READER_EVIDENCE_POLICY, options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const evidence = collectScreenReaderEvidence({
      args: process.argv.slice(2),
      env: process.env,
      platform: process.platform
    });
    process.exitCode = evidence.exitCode;
  } catch (error) {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  }
}
