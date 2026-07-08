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
  const repo = env.GITHUB_REPO || 'store';
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
          'User-Agent': 'store-worker'
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
    repo: env.GITHUB_REPO || 'store',
    ref: env.GITHUB_REF || 'main'
  };
}

function getGitHubHeaders(env = {}) {
  return {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'store-worker'
  };
}

function encodeGitHubPath(filePath) {
  return String(filePath || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function normalizeGitHubBranchRef(ref) {
  const raw = String(ref || 'main').trim() || 'main';
  return raw
    .replace(/^refs\/heads\//, '')
    .replace(/^heads\//, '');
}

function encodeGitHubRefPath(ref) {
  return String(ref || '')
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

export async function putGitHubTextFiles(env, files, message) {
  configureGitHubLogging(env);

  if (!env.GITHUB_TOKEN) {
    return { ok: false, status: 503, error: 'GITHUB_TOKEN not configured', code: 'github_not_configured' };
  }

  const normalizedFiles = (Array.isArray(files) ? files : [])
    .map((file) => ({
      path: String(file?.path || file?.filePath || '').trim(),
      content: String(file?.content || ''),
      expectedSha: String(file?.expectedSha || file?.sha || '').trim()
    }))
    .filter((file) => file.path);

  if (normalizedFiles.length === 0) {
    return { ok: true, skipped: true, reason: 'No files to update', paths: [] };
  }

  const duplicatePaths = new Set();
  const seenPaths = new Set();
  for (const file of normalizedFiles) {
    if (seenPaths.has(file.path)) duplicatePaths.add(file.path);
    seenPaths.add(file.path);
  }
  if (duplicatePaths.size > 0) {
    return {
      ok: false,
      status: 400,
      error: `Duplicate GitHub file update path: ${Array.from(duplicatePaths).join(', ')}`
    };
  }

  const { owner, repo, ref } = getGitHubRepoConfig(env);
  const branch = normalizeGitHubBranchRef(ref);
  const encodedBranch = encodeGitHubRefPath(branch);
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = getGitHubHeaders(env);

  async function githubJson(url, init = {}, errorContext = 'GitHub API request') {
    const response = await fetch(url, {
      ...init,
      headers
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: data?.message || `${errorContext}: ${response.status}`,
        data
      };
    }
    return { ok: true, status: response.status, data };
  }

  const refResult = await githubJson(`${apiBase}/git/ref/heads/${encodedBranch}`, {
    method: 'GET'
  }, `Failed to load GitHub branch ${branch}`);
  if (!refResult.ok) return refResult;

  const baseCommitSha = String(refResult.data?.object?.sha || '').trim();
  if (!baseCommitSha) {
    return { ok: false, status: 502, error: 'Unexpected GitHub branch response' };
  }

  const commitResult = await githubJson(`${apiBase}/git/commits/${encodeURIComponent(baseCommitSha)}`, {
    method: 'GET'
  }, `Failed to load GitHub commit ${baseCommitSha}`);
  if (!commitResult.ok) return commitResult;

  const baseTreeSha = String(commitResult.data?.tree?.sha || '').trim();
  if (!baseTreeSha) {
    return { ok: false, status: 502, error: 'Unexpected GitHub commit response' };
  }

  for (const file of normalizedFiles) {
    if (!file.expectedSha) continue;
    const currentResult = await githubJson(
      `${apiBase}/contents/${encodeGitHubPath(file.path)}?ref=${encodeURIComponent(baseCommitSha)}`,
      { method: 'GET' },
      `Failed to verify GitHub file ${file.path}`
    );
    if (!currentResult.ok) {
      return { ...currentResult, path: file.path };
    }
    const currentSha = String(currentResult.data?.sha || '').trim();
    if (currentSha !== file.expectedSha) {
      return {
        ok: false,
        status: 409,
        path: file.path,
        error: `${file.path} changed in GitHub before the batch commit could be created. Reload the products and try again.`,
        code: 'github_file_changed'
      };
    }
  }

  const treeEntries = [];
  for (const file of normalizedFiles) {
    const blobResult = await githubJson(`${apiBase}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({
        content: file.content,
        encoding: 'utf-8'
      })
    }, `Failed to create GitHub blob for ${file.path}`);
    if (!blobResult.ok) {
      return { ...blobResult, path: file.path };
    }
    const blobSha = String(blobResult.data?.sha || '').trim();
    if (!blobSha) {
      return { ok: false, status: 502, path: file.path, error: 'Unexpected GitHub blob response' };
    }
    treeEntries.push({
      path: file.path,
      mode: '100644',
      type: 'blob',
      sha: blobSha
    });
  }

  const treeResult = await githubJson(`${apiBase}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeEntries
    })
  }, 'Failed to create GitHub tree');
  if (!treeResult.ok) return treeResult;

  const newTreeSha = String(treeResult.data?.sha || '').trim();
  if (!newTreeSha) {
    return { ok: false, status: 502, error: 'Unexpected GitHub tree response' };
  }

  const newCommitResult = await githubJson(`${apiBase}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: String(message || `Update ${normalizedFiles.length} files`),
      tree: newTreeSha,
      parents: [baseCommitSha]
    })
  }, 'Failed to create GitHub commit');
  if (!newCommitResult.ok) return newCommitResult;

  const newCommitSha = String(newCommitResult.data?.sha || '').trim();
  if (!newCommitSha) {
    return { ok: false, status: 502, error: 'Unexpected GitHub commit creation response' };
  }

  const updateResult = await githubJson(`${apiBase}/git/refs/heads/${encodedBranch}`, {
    method: 'PATCH',
    body: JSON.stringify({
      sha: newCommitSha,
      force: false
    })
  }, `Failed to update GitHub branch ${branch}`);
  if (!updateResult.ok) return updateResult;

  return {
    ok: true,
    paths: normalizedFiles.map((file) => file.path),
    commitSha: newCommitSha,
    commitUrl: newCommitResult.data?.html_url || `https://github.com/${owner}/${repo}/commit/${newCommitSha}`,
    updated: normalizedFiles.length
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
