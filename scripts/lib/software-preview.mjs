import fs from 'node:fs';

// Preview recovery is restricted to newly named rehearsal resources, never the
// Store production/ordinary preview bindings. Keep these checks before any I/O.
export function validateSoftwarePreview({ previewId, storeBase, licensingBase, workerConfig, previewR2Bucket }) {
  if (!/^[a-f0-9]{16}$/.test(previewId || '')) throw new Error('A unique software preview ID is required');
  const prefix = `dw-recovery-${previewId}`;
  for (const [role, base] of [['store', storeBase], ['licensing', licensingBase]]) {
    const url = new URL(base);
    if (url.protocol !== 'https:' || !new RegExp(`^${prefix}-${role}\\.[a-z0-9-]+\\.workers\\.dev$`).test(url.hostname) ||
        url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Software preview origin is not an isolated rehearsal Worker');
  }
  const config = JSON.parse(fs.readFileSync(workerConfig, 'utf8'));
  if (config.name !== `${prefix}-store` || config.vars?.APP_MODE !== 'test' || config.vars?.SOFTWARE_CHECKOUT_ENABLED !== 'false' ||
      config.vars?.SOFTWARE_RECOVERY_PREVIEW_ID !== previewId || config.vars?.SOFTWARE_RECOVERY_TARGET !== 'empty' ||
      config.routes?.length || config.triggers?.crons?.length || config.env ||
      previewR2Bucket !== `${prefix}-downloads` || config.r2_buckets?.length !== 1 ||
      config.r2_buckets[0].bucket_name !== previewR2Bucket || config.kv_namespaces?.length !== 2 || config.kv_namespaces[1].binding !== 'RATELIMIT' || config.kv_namespaces[1].id !== config.kv_namespaces[0].id || config.kv_namespaces[1].preview_id !== config.kv_namespaces[0].id ||
      config.kv_namespaces[0].binding !== 'STORE_STATE' || !/^[a-f0-9]{32}$/.test(config.kv_namespaces[0].id) ||
      config.kv_namespaces[0].preview_id !== config.kv_namespaces[0].id) throw new Error('Software preview bindings must be dedicated, empty and test-only');
  return { previewId, prefix };
}
