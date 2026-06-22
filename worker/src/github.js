/**
 * GitHub API utilities
 * 
 * Triggers workflow_dispatch to rebuild the site
 */

import { getScopedConsole } from './logger.js';

let console = globalThis.console;

function configureGitHubLogging(env) {
  console = getScopedConsole(env, 'github');
}

async function triggerGitHubWorkflow(env, {
  workflow,
  inputs = {},
  successMessage = 'GitHub workflow triggered',
  missingTokenReason = 'No GitHub token configured'
} = {}) {
  configureGitHubLogging(env);

  if (!env.GITHUB_TOKEN) {
    console.warn(`GITHUB_TOKEN not set, skipping ${workflow || 'workflow'} trigger`);
    return { triggered: false, reason: missingTokenReason };
  }

  const owner = env.GITHUB_OWNER || 'aindaco1';
  const repo = env.GITHUB_REPO || 'pool';
  const workflowFile = workflow || 'deploy.yml';
  const ref = env.GITHUB_REF || 'main';

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'pool-worker'
        },
        body: JSON.stringify({
          ref,
          inputs
        })
      }
    );

    if (res.status === 204) {
      console.log(successMessage);
      return { triggered: true, workflow: workflowFile };
    }

    const error = await res.text();
    console.error(`Failed to trigger ${workflowFile}: ${res.status} ${error}`);
    return { triggered: false, workflow: workflowFile, reason: `GitHub API error: ${res.status}` };
  } catch (err) {
    console.error(`Error triggering ${workflowFile}:`, err);
    return { triggered: false, workflow: workflowFile, reason: err.message };
  }
}

/**
 * Trigger a GitHub Actions workflow
 *
 * @param {Object} env - Worker environment
 * @param {string} reason - Reason for the rebuild (for logging)
 */
export async function triggerSiteRebuild(env, reason = 'manual') {
  const workflow = env.GITHUB_WORKFLOW || 'deploy.yml';
  const result = await triggerGitHubWorkflow(env, {
    workflow,
    inputs: { reason },
    successMessage: `Site rebuild triggered: ${reason}`
  });
  return result.triggered ? { triggered: true } : { triggered: false, reason: result.reason };
}

export async function triggerMediaOptimization(env, { scope = 'changed' } = {}) {
  const workflow = env.GITHUB_MEDIA_OPTIMIZATION_WORKFLOW || 'media-optimization.yml';
  const normalizedScope = scope === 'all' ? 'all' : 'changed';
  return triggerGitHubWorkflow(env, {
    workflow,
    inputs: { scope: normalizedScope },
    successMessage: `Media optimization triggered: ${normalizedScope}`
  });
}

function getGitHubRepoConfig(env = {}) {
  return {
    owner: env.GITHUB_OWNER || 'aindaco1',
    repo: env.GITHUB_REPO || 'pool',
    ref: env.GITHUB_REF || 'main'
  };
}

function getGitHubHeaders(env = {}) {
  return {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'pool-worker'
  };
}

function encodeGitHubPath(filePath) {
  return String(filePath || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function encodeUtf8Base64(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeUtf8Base64(value) {
  const binary = atob(String(value || '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

export async function getGitHubTextFile(env, filePath) {
  configureGitHubLogging(env);

  if (!env.GITHUB_TOKEN) {
    return { ok: false, status: 503, error: 'GITHUB_TOKEN not configured', code: 'github_not_configured' };
  }

  const { owner, repo, ref } = getGitHubRepoConfig(env);
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeGitHubPath(filePath)}?ref=${encodeURIComponent(ref)}`,
    {
      method: 'GET',
      headers: getGitHubHeaders(env)
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`Failed to load GitHub file ${filePath}: ${response.status}`);
    return { ok: false, status: response.status, error: data?.message || `GitHub API error: ${response.status}` };
  }

  if (data?.encoding !== 'base64' || typeof data?.content !== 'string' || !data?.sha) {
    return { ok: false, status: 502, error: 'Unexpected GitHub file response' };
  }

  return {
    ok: true,
    path: data.path || filePath,
    sha: data.sha,
    content: decodeUtf8Base64(data.content)
  };
}

export async function putGitHubTextFile(env, filePath, content, message, sha) {
  configureGitHubLogging(env);

  if (!env.GITHUB_TOKEN) {
    return { ok: false, status: 503, error: 'GITHUB_TOKEN not configured', code: 'github_not_configured' };
  }

  const { owner, repo, ref } = getGitHubRepoConfig(env);
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeGitHubPath(filePath)}`,
    {
      method: 'PUT',
      headers: getGitHubHeaders(env),
      body: JSON.stringify({
        message: String(message || `Update ${filePath}`),
        content: encodeUtf8Base64(content),
        sha,
        branch: ref
      })
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`Failed to update GitHub file ${filePath}: ${response.status}`);
    return { ok: false, status: response.status, error: data?.message || `GitHub API error: ${response.status}` };
  }

  return {
    ok: true,
    path: data?.content?.path || filePath,
    contentSha: data?.content?.sha || '',
    commitSha: data?.commit?.sha || '',
    commitUrl: data?.commit?.html_url || ''
  };
}

export async function putGitHubBase64File(env, filePath, base64Content, message, sha = undefined) {
  configureGitHubLogging(env);

  if (!env.GITHUB_TOKEN) {
    return { ok: false, status: 503, error: 'GITHUB_TOKEN not configured', code: 'github_not_configured' };
  }

  const { owner, repo, ref } = getGitHubRepoConfig(env);
  const body = {
    message: String(message || `Update ${filePath}`),
    content: String(base64Content || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, ''),
    branch: ref
  };
  if (sha) body.sha = sha;

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeGitHubPath(filePath)}`,
    {
      method: 'PUT',
      headers: getGitHubHeaders(env),
      body: JSON.stringify(body)
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`Failed to update GitHub file ${filePath}: ${response.status}`);
    return { ok: false, status: response.status, error: data?.message || `GitHub API error: ${response.status}` };
  }

  return {
    ok: true,
    path: data?.content?.path || filePath,
    contentSha: data?.content?.sha || '',
    commitSha: data?.commit?.sha || '',
    commitUrl: data?.commit?.html_url || ''
  };
}

export async function deleteGitHubFile(env, filePath, message) {
  configureGitHubLogging(env);

  if (!env.GITHUB_TOKEN) {
    return { ok: false, status: 503, error: 'GITHUB_TOKEN not configured', code: 'github_not_configured' };
  }

  const { owner, repo, ref } = getGitHubRepoConfig(env);
  const encodedPath = encodeGitHubPath(filePath);
  const loadResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    {
      method: 'GET',
      headers: getGitHubHeaders(env)
    }
  );
  const loadData = await loadResponse.json().catch(() => ({}));
  if (loadResponse.status === 404) {
    return { ok: true, path: filePath, deleted: false, skipped: true, reason: 'not_found' };
  }
  if (!loadResponse.ok || !loadData?.sha) {
    console.error(`Failed to load GitHub file for deletion ${filePath}: ${loadResponse.status}`);
    return { ok: false, status: loadResponse.status, path: filePath, error: loadData?.message || `GitHub API error: ${loadResponse.status}` };
  }

  const deleteResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`,
    {
      method: 'DELETE',
      headers: getGitHubHeaders(env),
      body: JSON.stringify({
        message: String(message || `Delete ${filePath}`),
        sha: loadData.sha,
        branch: ref
      })
    }
  );
  const deleteData = await deleteResponse.json().catch(() => ({}));
  if (!deleteResponse.ok) {
    console.error(`Failed to delete GitHub file ${filePath}: ${deleteResponse.status}`);
    return { ok: false, status: deleteResponse.status, path: filePath, error: deleteData?.message || `GitHub API error: ${deleteResponse.status}` };
  }

  return {
    ok: true,
    path: deleteData?.content?.path || filePath,
    deleted: true,
    commitSha: deleteData?.commit?.sha || '',
    commitUrl: deleteData?.commit?.html_url || ''
  };
}
