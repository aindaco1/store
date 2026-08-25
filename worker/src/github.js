/** Thin Store policy adapter for the shared bounded GitHub transport. */

import { createGitHubClient } from '../../shared/dust-wave-platform/packages/worker-core/src/github.js';
import { fetchWithTimeout } from '../../shared/dust-wave-platform/packages/worker-core/src/provider-fetch.js';
import { readBoundedText } from '../../shared/dust-wave-platform/packages/worker-core/src/request-validation.js';
import { getScopedConsole } from './logger.js';

const GITHUB_READ_ATTEMPTS = 3;
const GITHUB_WRITE_ATTEMPTS = 3;
const GITHUB_WORKFLOW_STATUS_TIMEOUT_MS = 10_000;
const GITHUB_WORKFLOW_STATUS_MAX_BYTES = 512_000;
const GITHUB_COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const GITHUB_WORKFLOW_FILE_PATTERN = /^[a-z0-9._-]+\.ya?ml$/iu;

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
  const requestedAt = new Date().toISOString();
  const result = await getClient(env).dispatchWorkflow(workflowFile, inputs);
  if (result.ok) {
    console.log(successMessage);
    return { triggered: true, workflow: workflowFile, requestedAt };
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
  return result.triggered
    ? { triggered: true, workflow: result.workflow, requestedAt: result.requestedAt }
    : { triggered: false, workflow: result.workflow, requestedAt: result.requestedAt, reason: result.reason };
}

function normalizedWorkflowStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return ['requested', 'queued', 'pending', 'waiting', 'in_progress', 'completed'].includes(status)
    ? status
    : 'requested';
}

function normalizedWorkflowConclusion(value) {
  const conclusion = String(value || '').trim().toLowerCase();
  return [
    'action_required',
    'cancelled',
    'failure',
    'neutral',
    'skipped',
    'stale',
    'success',
    'timed_out'
  ].includes(conclusion) ? conclusion : '';
}

function boundedWorkflowTimestamp(value) {
  const timestamp = String(value || '').trim();
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : '';
}

function normalizedWorkflowRun(run = {}, nowMs = Date.now()) {
  const createdAt = boundedWorkflowTimestamp(run.created_at);
  const startedAt = boundedWorkflowTimestamp(run.run_started_at);
  const updatedAt = boundedWorkflowTimestamp(run.updated_at);
  const status = normalizedWorkflowStatus(run.status);
  const conclusion = normalizedWorkflowConclusion(run.conclusion);
  const startMs = Date.parse(startedAt || createdAt || '');
  const endMs = status === 'completed' ? Date.parse(updatedAt || '') : nowMs;
  const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.max(0, endMs - startMs)
    : 0;
  const runId = Number(run.id);

  return {
    found: true,
    runId: Number.isSafeInteger(runId) && runId > 0 ? runId : null,
    status,
    conclusion,
    createdAt,
    startedAt,
    updatedAt,
    durationMs,
    url: /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/u.test(String(run.html_url || ''))
      ? String(run.html_url)
      : ''
  };
}

function withWorkflowRequestTiming(run = {}, requestedAt = '', nowMs = Date.now()) {
  const requestedAtTimestamp = boundedWorkflowTimestamp(requestedAt);
  const requestedAtMs = Date.parse(requestedAtTimestamp);
  const updatedAtMs = Date.parse(String(run.updatedAt || ''));
  const endMs = run.status === 'completed' && Number.isFinite(updatedAtMs) ? updatedAtMs : nowMs;
  return {
    ...run,
    requestedAt: requestedAtTimestamp,
    elapsedMs: Number.isFinite(requestedAtMs) && Number.isFinite(endMs)
      ? Math.max(0, endMs - requestedAtMs)
      : Number(run.durationMs || 0)
  };
}

async function requestGitHubWorkflowStatus(env, path) {
  if (!env?.GITHUB_TOKEN) return notConfigured(env);
  const owner = String(env.GITHUB_OWNER || 'aindaco1').trim();
  const repo = String(env.GITHUB_REPO || 'store').trim();
  let response;
  try {
    response = await fetchWithTimeout(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`,
      {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'store-worker'
        }
      },
      GITHUB_WORKFLOW_STATUS_TIMEOUT_MS
    );
  } catch (error) {
    return {
      ok: false,
      status: 502,
      code: error?.name === 'AbortError' ? 'github_timeout' : 'github_request_failed',
      error: error?.name === 'AbortError' ? 'GitHub request timed out' : 'Unable to reach GitHub'
    };
  }

  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    return { ok: false, status: 502, code: 'github_redirect_rejected', error: 'GitHub request was redirected' };
  }

  let text = '';
  try {
    text = await readBoundedText(response, GITHUB_WORKFLOW_STATUS_MAX_BYTES, 'GitHub response');
  } catch (error) {
    return error?.code === 'body_too_large'
      ? { ok: false, status: 502, code: 'github_response_too_large', error: 'GitHub response exceeds the configured limit' }
      : { ok: false, status: 502, code: 'github_invalid_response', error: 'Unable to read GitHub response' };
  }

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_error) {
    return { ok: false, status: 502, code: 'github_invalid_response', error: 'GitHub returned an invalid response' };
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      code: 'github_api_error',
      error: String(data?.message || `GitHub API error: ${response.status}`).slice(0, 512)
    };
  }
  return { ok: true, data };
}

export async function getGitHubWorkflowRun(env, options = {}) {
  const commitSha = String(options.commitSha || '').trim().toLowerCase();
  if (!GITHUB_COMMIT_SHA_PATTERN.test(commitSha)) {
    return { ok: false, status: 400, code: 'github_invalid_commit', error: 'A full GitHub commit SHA is required.' };
  }
  const runId = Number(options.runId);
  let result;
  if (Number.isSafeInteger(runId) && runId > 0) {
    result = await requestGitHubWorkflowStatus(env, `/actions/runs/${runId}`);
    if (!result.ok) return result;
    if (String(result.data?.head_sha || '').trim().toLowerCase() !== commitSha) {
      return { ok: false, status: 409, code: 'github_workflow_commit_mismatch', error: 'GitHub workflow run does not match the published commit.' };
    }
    return { ok: true, run: withWorkflowRequestTiming(normalizedWorkflowRun(result.data), options.requestedAt) };
  }

  const workflow = String(options.workflow || env.GITHUB_WORKFLOW || 'deploy.yml').trim();
  if (!GITHUB_WORKFLOW_FILE_PATTERN.test(workflow)) {
    return { ok: false, status: 400, code: 'github_invalid_workflow', error: 'GitHub workflow file is invalid.' };
  }

  const query = new URLSearchParams({
    event: 'workflow_dispatch',
    exclude_pull_requests: 'true',
    head_sha: commitSha,
    per_page: '10'
  });
  result = await requestGitHubWorkflowStatus(
    env,
    `/actions/workflows/${encodeURIComponent(workflow)}/runs?${query.toString()}`
  );
  if (!result.ok) return result;

  const requestedAt = String(options.requestedAt || '');
  const requestedAtMs = Date.parse(requestedAt);
  const earliestCreatedAt = Number.isFinite(requestedAtMs) ? requestedAtMs - 10_000 : 0;
  const runs = Array.isArray(result.data?.workflow_runs) ? result.data.workflow_runs : [];
  const match = runs.find((run) => {
    if (String(run?.head_sha || '').trim().toLowerCase() !== commitSha) return false;
    const createdAtMs = Date.parse(String(run?.created_at || ''));
    return !earliestCreatedAt || (Number.isFinite(createdAtMs) && createdAtMs >= earliestCreatedAt);
  });

  return {
    ok: true,
    run: match
      ? withWorkflowRequestTiming(normalizedWorkflowRun(match), requestedAt)
      : withWorkflowRequestTiming({
        found: false,
        runId: null,
        status: 'requested',
        conclusion: '',
        createdAt: '',
        startedAt: '',
        updatedAt: '',
        durationMs: 0,
        url: ''
      }, requestedAt)
  };
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
