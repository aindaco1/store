#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function valueArg(name, fallback = '') {
  const found = process.argv.slice(2).find((arg) => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

function filesUnder(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [relativePath];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.posix.join(relativePath.replace(/\\/g, '/'), entry.name);
    return entry.isDirectory() ? filesUnder(child) : entry.isFile() ? [child] : [];
  }).sort();
}

function digest(paths) {
  const hash = crypto.createHash('sha256');
  for (const relativePath of paths) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(ROOT, relativePath)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function buildLocalizationReview(config) {
  const areas = (config.requiredReviewAreas || []).map((area) => {
    const files = (area.paths || []).flatMap(filesUnder);
    const missing = (area.paths || []).filter((item) => filesUnder(item).length === 0);
    return {
      id: area.id,
      label: area.label,
      files,
      missing,
      sourceHash: missing.length ? '' : digest(files),
      status: missing.length ? 'blocked' : 'ready_for_human_review'
    };
  });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    defaultLocale: config.defaultLocale,
    reviewLocales: config.reviewLocales || [],
    status: areas.every((area) => area.status === 'ready_for_human_review') ? 'workflow_ready' : 'blocked',
    professionalReviewClaimed: false,
    areas,
    containsCredentials: false,
    containsCustomerData: false
  };
}

export function localizationReviewMarkdown(evidence) {
  const lines = [
    '# Store Localization Review Packet',
    '',
    `Generated: ${evidence.generatedAt}`,
    `Locales: ${(evidence.reviewLocales || []).join(', ') || 'none'}`,
    '',
    '> This packet validates the review workflow and source coverage. It does not claim professional or native-speaker approval.',
    '',
    'For each area, review meaning, tone, truncation, placeholders, links, legal accuracy where applicable, keyboard/screen-reader labels, and mobile layout.',
    ''
  ];
  for (const area of evidence.areas || []) {
    lines.push(`## ${area.label}`, '');
    lines.push(`- [ ] Review completed for each target locale`);
    lines.push(`- [ ] Placeholder names and interpolation preserved`);
    lines.push(`- [ ] Screenshots or notes attached to release evidence`);
    lines.push(`- Source hash: \`${area.sourceHash || 'blocked'}\``);
    lines.push(`- Files: ${area.files.length}`);
    if (area.missing.length) lines.push(`- Missing: ${area.missing.join(', ')}`);
    lines.push('');
  }
  lines.push('## Sign-off', '', '- Reviewer:', '- Locale:', '- Date:', '- Residual issues and owner:', '');
  return `${lines.join('\n')}\n`;
}

function main() {
  const configPath = path.resolve(valueArg('--config', path.join(ROOT, 'config', 'localization-review.json')));
  const outputDirectory = path.resolve(valueArg('--output-dir', path.join(ROOT, 'release-evidence', 'localization-review')));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const evidence = buildLocalizationReview(config);
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'localization-review.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, 'localization-review.md'), localizationReviewMarkdown(evidence));
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.status !== 'workflow_ready') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
