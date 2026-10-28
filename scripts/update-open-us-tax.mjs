#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { updateOpenTax } from '../shared/dust-wave-platform/packages/tax-core/src/open-us-tax-updater.js';
export { updateOpenTax, buildOpenTaxSnapshot, verifyDigest } from '../shared/dust-wave-platform/packages/tax-core/src/open-us-tax-updater.js';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const value = (name) => process.argv.slice(2).find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  updateOpenTax({ output: value('--output'), dump: value('--dump'),
    manifest: value('--manifest') ? JSON.parse(await readFile(value('--manifest'), 'utf8')) : undefined
  }).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
