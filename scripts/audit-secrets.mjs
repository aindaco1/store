#!/usr/bin/env node

import {
  runSecretAudit
} from "../shared/dust-wave-platform/scripts/scan-tracked-secrets.mjs";

const passed = runSecretAudit({
  root: process.cwd(),
  localSecretFiles: ["worker/.dev.vars"],
  allowedLocalValues: [
    "whsec_smoke",
    "sk_test_smoke",
    "test-admin-secret",
    "test-magic-link-secret",
    "re_test_smoke"
  ]
});

if (!passed) process.exitCode = 1;
