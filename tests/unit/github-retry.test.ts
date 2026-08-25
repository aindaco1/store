import { afterEach, describe, expect, it, vi } from 'vitest';

import { getGitHubTextFile, putGitHubTextFile } from '../../worker/src/github.js';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function fileResponse(content: string, sha: string) {
  return jsonResponse({
    path: '_products/example.md',
    sha,
    encoding: 'base64',
    content: Buffer.from(content, 'utf8').toString('base64')
  });
}

function buildEnv() {
  return {
    APP_MODE: 'test',
    GITHUB_TOKEN: 'ghs_test',
    GITHUB_OWNER: 'dustwave',
    GITHUB_REPO: 'store',
    GITHUB_REF: 'main'
  };
}

describe('GitHub publish recovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('retries transient repository reads before returning a dashboard 502', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('temporary network failure'))
      .mockResolvedValueOnce(fileResponse('current product', 'sha-current'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getGitHubTextFile(buildEnv(), '_products/example.md')).resolves.toMatchObject({
      ok: true,
      content: 'current product',
      sha: 'sha-current'
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => init?.redirect === 'manual')).toBe(true);
  });

  it('retries a transient product write after confirming the original file is unchanged', async () => {
    const current = 'current product';
    const desired = 'archived product';
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = String(init?.method || 'GET');
      const writeNumber = fetchMock.mock.calls.filter((call) => String(call[1]?.method || 'GET') === 'PUT').length;
      if (method === 'PUT' && writeNumber === 1) throw new TypeError('temporary network failure');
      if (method === 'GET') return fileResponse(current, 'sha-current');
      if (method === 'PUT') {
        return jsonResponse({
          content: { path: '_products/example.md', sha: 'sha-archived' },
          commit: { sha: 'commit-archived', html_url: 'https://github.com/dustwave/store/commit/commit-archived' }
        });
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(putGitHubTextFile(
      buildEnv(),
      '_products/example.md',
      desired,
      'Archive product',
      'sha-current'
    )).resolves.toMatchObject({
      ok: true,
      commitSha: 'commit-archived'
    });
    expect(fetchMock.mock.calls.filter((call) => String(call[1]?.method || 'GET') === 'PUT')).toHaveLength(2);
  });

  it('reconciles a write that GitHub committed before the response was lost', async () => {
    const desired = 'archived product';
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('response lost after commit'))
      .mockResolvedValueOnce(fileResponse(desired, 'sha-archived'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(putGitHubTextFile(
      buildEnv(),
      '_products/example.md',
      desired,
      'Archive product',
      'sha-current'
    )).resolves.toMatchObject({
      ok: true,
      reconciled: true,
      contentSha: 'sha-archived'
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
