/** Thin Store policy adapter for the shared bounded GitHub transport. */

import { createGitHubClient } from '../../shared/dust-wave-platform/packages/worker-core/src/github.js';
import { getScopedConsole } from './logger.js';

const GITHUB_READ_ATTEMPTS = 3;
const GITHUB_WRITE_ATTEMPTS = 3;

function isRetryableGitHubResult(result = {}) {
  if (['github_timeout', 'github_request_failed', 'github_invalid_response'].includes(result?.code)) return true;
  return [429, 500, 502, 503, 504].includes(Number(result?.status));
}

function waitForGitHubRetry(env = {}, attempt = 1) {
  if (String(env.APP_MODE || '').trim().toLowerCase() === 'test') return Promise.resolve();
  const delayMs = Math.min(500, 125 * (2 ** Math.max(0, attempt - 1)));
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function readWithGitHubRetry(env, operation, label, { quiet = false } = {}) {
  let result = null;
  for (let attempt = 1; attempt <= GITHUB_READ_ATTEMPTS; attempt += 1) {
    result = await operation();
    if (result.ok || !isRetryableGitHubResult(result) || attempt === GITHUB_READ_ATTEMPTS) return result;
    if (!quiet) {
      getScopedConsole(env, 'github').warn(`${label} failed transiently; retrying (${attempt}/${GITHUB_READ_ATTEMPTS - 1})`);
    }
    await waitForGitHubRetry(env, attempt);
  }
  return result;
}

function getClient(env = {}) {
  return createGitHubClient({
    token: env.GITHUB_TOKEN,
    owner: env.GITHUB_OWNER || 'aindaco1',
    repo: env.GITHUB_REPO || 'store',
    ref: env.GITHUB_REF || 'main',
    userAgent: 'store-worker'
  });
}

function notConfigured(env) {
  if (env?.GITHUB_TOKEN) return null;
  return { ok: false, status: 503, error: 'GITHUB_TOKEN not configured', code: 'github_not_configured' };
}

function githubFailureLabel(result = {}) {
  const status = Number(result?.status) || 502;
  const code = String(result?.code || '').trim().replace(/[^a-z0-9_-]/giu, '').slice(0, 64);
  return code ? `${status} ${code}` : String(status);
}

async function triggerGitHubWorkflow(env, {
  workflow,
  inputs = {},
  successMessage = 'GitHub workflow triggered',
  missingTokenReason = 'No GitHub token configured'
} = {}) {
  const console = getScopedConsole(env, 'github');
  if (!env.GITHUB_TOKEN) {
    console.warn(`GITHUB_TOKEN not set, skipping ${workflow || 'workflow'} trigger`);
    return { triggered: false, reason: missingTokenReason };
  }
  const workflowFile = workflow || 'deploy.yml';
  const result = await getClient(env).dispatchWorkflow(workflowFile, inputs);
  if (result.ok) {
    console.log(successMessage);
    return { triggered: true, workflow: workflowFile };
  }
  console.error(`Failed to trigger ${workflowFile}: ${result.status} ${result.code || ''}`.trim());
  return {
    triggered: false,
    workflow: workflowFile,
    reason: result.code === 'github_api_error'
      ? `GitHub API error: ${result.status}`
      : result.error
  };
}

export async function triggerSiteRebuild(env, reason = 'manual') {
  const result = await triggerGitHubWorkflow(env, {
    workflow: env.GITHUB_WORKFLOW || 'deploy.yml',
    inputs: { reason },
    successMessage: `Site rebuild triggered: ${reason}`
  });
  return result.triggered ? { triggered: true } : { triggered: false, reason: result.reason };
}

export function triggerMediaOptimization(env, { scope = 'changed' } = {}) {
  const normalizedScope = scope === 'all' ? 'all' : 'changed';
  return triggerGitHubWorkflow(env, {
    workflow: env.GITHUB_MEDIA_OPTIMIZATION_WORKFLOW || 'media-optimization.yml',
    inputs: { scope: normalizedScope },
    successMessage: `Media optimization triggered: ${normalizedScope}`
  });
}

export async function getGitHubTextFile(env, filePath) {
  const missing = notConfigured(env);
  if (missing) return missing;
  const client = getClient(env);
  const result = await readWithGitHubRetry(
    env,
    () => client.getTextFile(filePath),
    `GitHub file read for ${filePath}`
  );
  if (!result.ok) getScopedConsole(env, 'github').error(`Failed to load GitHub file ${filePath}: ${githubFailureLabel(result)}`);
  return result;
}

export async function listGitHubDirectory(env, directoryPath, options = {}) {
  const missing = notConfigured(env);
  if (missing) return missing;
  const client = getClient(env);
  const result = await readWithGitHubRetry(
    env,
    () => client.listDirectory(directoryPath),
    `GitHub directory read for ${directoryPath}`,
    { quiet: options?.quiet === true }
  );
  if (!result.ok && options?.quiet !== true) {
    getScopedConsole(env, 'github').error(`Failed to list GitHub directory ${directoryPath}: ${githubFailureLabel(result)}`);
  }
  return result;
}

export async function putGitHubTextFile(env, filePath, content, message, sha) {
  const missing = notConfigured(env);
  if (missing) return missing;
  const client = getClient(env);
  const expectedContent = String(content ?? '');
  let result = null;
  for (let attempt = 1; attempt <= GITHUB_WRITE_ATTEMPTS; attempt += 1) {
    result = await client.putTextFile(filePath, expectedContent, message, sha);
    if (result.ok) return result;

    const ambiguous = isRetryableGitHubResult(result) || [409, 422].includes(Number(result.status));
    if (ambiguous) {
      const current = await readWithGitHubRetry(
        env,
        () => client.getTextFile(filePath),
        `GitHub write reconciliation for ${filePath}`,
        { quiet: true }
      );
      if (current.ok && current.content === expectedContent) {
        return {
          ok: true,
          path: current.path || filePath,
          contentSha: current.sha || '',
          commitSha: '',
          commitUrl: '',
          reconciled: true
        };
      }
      if (current.ok && (!sha || current.sha !== sha)) {
        result = {
          ok: false,
          status: 409,
          path: current.path || filePath,
          code: 'github_file_changed',
          error: `${filePath} changed in GitHub before the update could be confirmed. Reload and try again.`
        };
        break;
      }
    }

    if (!isRetryableGitHubResult(result) || attempt === GITHUB_WRITE_ATTEMPTS) break;
    getScopedConsole(env, 'github').warn(`GitHub file write for ${filePath} failed transiently; retrying (${attempt}/${GITHUB_WRITE_ATTEMPTS - 1})`);
    await waitForGitHubRetry(env, attempt);
  }
  if (!result.ok) getScopedConsole(env, 'github').error(`Failed to update GitHub file ${filePath}: ${githubFailureLabel(result)}`);
  return result;
}

export async function putGitHubTextFiles(env, files, message) {
  const result = await getClient(env).putTextFiles(files, message);
  if (!result.ok && result.code === 'github_file_changed') {
    return {
      ...result,
      error: `${result.path} changed in GitHub before the batch commit could be created. Reload the products and try again.`
    };
  }
  if (!result.ok) getScopedConsole(env, 'github').error(`Failed to batch-update GitHub files: ${githubFailureLabel(result)}`);
  return result;
}

export async function putGitHubBase64File(env, filePath, base64Content, message, sha = undefined) {
  const result = await getClient(env).putBase64File(filePath, base64Content, message, sha);
  if (!result.ok) getScopedConsole(env, 'github').error(`Failed to update GitHub file ${filePath}: ${githubFailureLabel(result)}`);
  return result;
}

export async function deleteGitHubFile(env, filePath, message) {
  const result = await getClient(env).deleteFile(filePath, message);
  if (!result.ok) getScopedConsole(env, 'github').error(`Failed to delete GitHub file ${filePath}: ${githubFailureLabel(result)}`);
  return result;
}
