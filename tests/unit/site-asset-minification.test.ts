// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isMinifiableAssetPath,
  minifyAssetSource,
  minifySiteAssets
} from '../../scripts/minify-site-assets.mjs';

const tempDirs: string[] = [];

async function makeTempDir() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'store-minify-assets-'));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
});

describe('site asset minification', () => {
  it('targets generated CSS and JS assets only', () => {
    expect(isMinifiableAssetPath('_site/assets/main.css')).toBe(true);
    expect(isMinifiableAssetPath('_site/assets/js/cart-provider.js')).toBe(true);
    expect(isMinifiableAssetPath('_site/assets/js/cart-provider.js.map')).toBe(false);
    expect(isMinifiableAssetPath('_site/index.html')).toBe(false);
    expect(isMinifiableAssetPath('_site/assets/vendor/library.js')).toBe(false);
  });

  it('minifies JavaScript without rewriting global names', async () => {
    const source = `
      window.StoreExample = window.StoreExample || {};
      function verboseGlobalName(value) {
        return value ? 1 : 0;
      }
      window.StoreExample.verboseGlobalName = verboseGlobalName;
    `;

    const minified = await minifyAssetSource(source, '_site/assets/js/example.js');

    expect(minified.length).toBeLessThan(source.length);
    expect(minified).toContain('window.StoreExample');
    expect(minified).toContain('function verboseGlobalName(value)');
    expect(minified).not.toContain('\n      ');
  });

  it('rewrites generated assets only when the minified output is smaller', async () => {
    const tempDir = await makeTempDir();
    const siteDir = path.join(tempDir, '_site');
    await fs.mkdir(path.join(siteDir, 'assets/js'), { recursive: true });
    await fs.mkdir(path.join(siteDir, 'assets/vendor'), { recursive: true });

    const jsPath = path.join(siteDir, 'assets/js/app.js');
    const cssPath = path.join(siteDir, 'assets/main.css');
    const vendorPath = path.join(siteDir, 'assets/vendor/library.js');
    const htmlPath = path.join(siteDir, 'index.html');

    await fs.writeFile(jsPath, 'window.StoreApp = window.StoreApp || {};\nwindow.StoreApp.ready = true;\n');
    await fs.writeFile(cssPath, '.example {\n  color: #ffffff;\n  margin: 0px;\n}\n');
    await fs.writeFile(vendorPath, 'function vendorName() {\n  return true;\n}\n');
    await fs.writeFile(htmlPath, '<script>window.inline = true;</script>\n');

    const summary = await minifySiteAssets({ siteDir, write: true });

    expect(summary.filesChecked).toBe(2);
    expect(summary.minifiedCount).toBe(2);
    expect(summary.bytesSaved).toBeGreaterThan(0);
    await expect(fs.readFile(jsPath, 'utf8')).resolves.not.toContain('\n');
    await expect(fs.readFile(cssPath, 'utf8')).resolves.toContain('#fff');
    await expect(fs.readFile(vendorPath, 'utf8')).resolves.toContain('\n');
    await expect(fs.readFile(htmlPath, 'utf8')).resolves.toContain('<script>window.inline = true;</script>');
  });
});
