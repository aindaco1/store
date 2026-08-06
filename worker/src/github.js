/** Thin Store policy adapter for the shared bounded GitHub transport. */

import { createGitHubClient } from '../../shared/dust-wave-platform/packages/worker-core/src/github.js';
import { getScopedConsole } from './logger.js';

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
  const result = await getClient(env).getTextFile(filePath);
  if (!result.ok) getScopedConsole(env, 'github').error(`Failed to load GitHub file ${filePath}: ${result.status}`);
  return result;
}

export async function listGitHubDirectory(env, directoryPath, options = {}) {
  const missing = notConfigured(env);
  if (missing) return missing;
  const result = await getClient(env).listDirectory(directoryPath);
  if (!result.ok && options?.quiet !== true) {
    getScopedConsole(env, 'github').error(`Failed to list GitHub directory ${directoryPath}: ${result.status}`);
  }
  return result;
}

export async function putGitHubTextFile(env, filePath, content, message, sha) {
  const result = await getClient(env).putTextFile(filePath, content, message, sha);
  if (!result.ok) getScopedConsole(env, 'github').error(`Failed to update GitHub file ${filePath}: ${result.status}`);
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
  if (!result.ok) getScopedConsole(env, 'github').error(`Failed to batch-update GitHub files: ${result.status}`);
  return result;
}

export async function putGitHubBase64File(env, filePath, base64Content, message, sha = undefined) {
  const result = await getClient(env).putBase64File(filePath, base64Content, message, sha);
  if (!result.ok) getScopedConsole(env, 'github').error(`Failed to update GitHub file ${filePath}: ${result.status}`);
  return result;
}

export async function deleteGitHubFile(env, filePath, message) {
  const result = await getClient(env).deleteFile(filePath, message);
  if (!result.ok) getScopedConsole(env, 'github').error(`Failed to delete GitHub file ${filePath}: ${result.status}`);
  return result;
}
