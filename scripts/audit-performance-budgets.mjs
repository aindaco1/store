#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CONFIG = path.join(ROOT, 'config', 'performance-budgets.json');

function filesWithExtension(root, extension) {
  const files = [];
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      if (entry.isFile() && entry.name.endsWith(extension)) files.push(absolute);
    }
  }
  visit(root);
  return files;
}

export function collectAssetBudgetEvidence(options = {}) {
  const config = options.config || JSON.parse(fs.readFileSync(options.configPath || DEFAULT_CONFIG, 'utf8'));
  const siteDirectory = path.resolve(options.siteDirectory || path.join(ROOT, config.assets.siteDirectory));
  if (!fs.existsSync(siteDirectory)) throw new Error(`Built site directory is missing: ${siteDirectory}`);
  const javascriptFiles = filesWithExtension(path.join(siteDirectory, 'assets', 'js'), '.js');
  const cssFiles = filesWithExtension(path.join(siteDirectory, 'assets'), '.css');
  const javascriptTotalBytes = javascriptFiles.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  const cssTotalBytes = cssFiles.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  const checks = [
    {
      id: 'javascript-total',
      actual: javascriptTotalBytes,
      maximum: Number(config.assets.javascriptTotalBytes),
      ok: javascriptTotalBytes <= Number(config.assets.javascriptTotalBytes)
    },
    {
      id: 'css-total',
      actual: cssTotalBytes,
      maximum: Number(config.assets.cssTotalBytes),
      ok: cssTotalBytes <= Number(config.assets.cssTotalBytes)
    }
  ];
  for (const [relativePath, maximum] of Object.entries(config.assets.files || {})) {
    const absolute = path.resolve(siteDirectory, relativePath);
    const contained = absolute.startsWith(`${siteDirectory}${path.sep}`);
    const actual = contained && fs.existsSync(absolute) ? fs.statSync(absolute).size : null;
    checks.push({
      id: `file:${relativePath}`,
      actual,
      maximum: Number(maximum),
      ok: actual !== null && actual <= Number(maximum)
    });
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: checks.every((check) => check.ok),
    totals: { javascriptTotalBytes, cssTotalBytes },
    checks,
    containsCredentials: false,
    containsCustomerData: false
  };
}

function valueArg(args, name, fallback = '') {
  const found = args.find((arg) => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

function main() {
  const args = process.argv.slice(2);
  const evidence = collectAssetBudgetEvidence({
    configPath: valueArg(args, '--config', DEFAULT_CONFIG),
    siteDirectory: valueArg(args, '--site-dir', '')
  });
  const output = valueArg(args, '--output', '');
  if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
  if (!evidence.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
