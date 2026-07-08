import { afterEach, describe, expect, it, vi } from 'vitest';
import { putGitHubTextFiles } from '../../worker/src/github.js';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

function buildEnv() {
  return {
    GITHUB_TOKEN: 'ghs_test',
    GITHUB_OWNER: 'dustwave',
    GITHUB_REPO: 'store',
    GITHUB_REF: 'main'
  };
}

describe('GitHub batch text commits', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('commits multiple files with one branch update instead of content PUTs', async () => {
    const calls: Array<{ url: string; method: string; body: any }> = [];
    let blobIndex = 0;

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method || 'GET');
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method, body });

      if (method === 'GET' && url.endsWith('/git/ref/heads/main')) {
        return jsonResponse({ object: { sha: 'base-commit' } });
      }
      if (method === 'GET' && url.endsWith('/git/commits/base-commit')) {
        return jsonResponse({ tree: { sha: 'base-tree' } });
      }
      if (method === 'GET' && url.includes('/contents/_products/alpha.md?')) {
        return jsonResponse({ sha: 'sha-alpha' });
      }
      if (method === 'GET' && url.includes('/contents/_products/bravo.md?')) {
        return jsonResponse({ sha: 'sha-bravo' });
      }
      if (method === 'POST' && url.endsWith('/git/blobs')) {
        blobIndex += 1;
        return jsonResponse({ sha: `blob-${blobIndex}` });
      }
      if (method === 'POST' && url.endsWith('/git/trees')) {
        return jsonResponse({ sha: 'new-tree' });
      }
      if (method === 'POST' && url.endsWith('/git/commits')) {
        return jsonResponse({
          sha: 'new-commit',
          html_url: 'https://github.com/dustwave/store/commit/new-commit'
        });
      }
      if (method === 'PATCH' && url.endsWith('/git/refs/heads/main')) {
        return jsonResponse({ ref: 'refs/heads/main' });
      }

      throw new Error(`Unexpected GitHub request: ${method} ${url}`);
    }));

    const result = await putGitHubTextFiles(buildEnv(), [
      { path: '_products/alpha.md', content: '---\norder: 1\n---\n', expectedSha: 'sha-alpha' },
      { path: '_products/bravo.md', content: '---\norder: 2\n---\n', expectedSha: 'sha-bravo' }
    ], 'Update Store product display order');

    expect(result).toMatchObject({
      ok: true,
      commitSha: 'new-commit',
      commitUrl: 'https://github.com/dustwave/store/commit/new-commit',
      updated: 2
    });

    expect(calls.filter((call) => call.method === 'PUT' && call.url.includes('/contents/'))).toHaveLength(0);
    expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/git/blobs'))).toHaveLength(2);
    expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/git/commits'))).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'PATCH' && call.url.endsWith('/git/refs/heads/main'))).toHaveLength(1);

    const treeCall = calls.find((call) => call.method === 'POST' && call.url.endsWith('/git/trees'));
    expect(treeCall?.body).toEqual({
      base_tree: 'base-tree',
      tree: [
        { path: '_products/alpha.md', mode: '100644', type: 'blob', sha: 'blob-1' },
        { path: '_products/bravo.md', mode: '100644', type: 'blob', sha: 'blob-2' }
      ]
    });

    const commitCall = calls.find((call) => call.method === 'POST' && call.url.endsWith('/git/commits'));
    expect(commitCall?.body).toEqual({
      message: 'Update Store product display order',
      tree: 'new-tree',
      parents: ['base-commit']
    });

    const branchUpdate = calls.find((call) => call.method === 'PATCH' && call.url.endsWith('/git/refs/heads/main'));
    expect(branchUpdate?.body).toEqual({
      sha: 'new-commit',
      force: false
    });
  });

  it('aborts before writing blobs when a loaded file changed on GitHub', async () => {
    const calls: Array<{ url: string; method: string }> = [];

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method || 'GET');
      calls.push({ url, method });

      if (method === 'GET' && url.endsWith('/git/ref/heads/main')) {
        return jsonResponse({ object: { sha: 'base-commit' } });
      }
      if (method === 'GET' && url.endsWith('/git/commits/base-commit')) {
        return jsonResponse({ tree: { sha: 'base-tree' } });
      }
      if (method === 'GET' && url.includes('/contents/_products/alpha.md?')) {
        return jsonResponse({ sha: 'newer-sha-alpha' });
      }

      throw new Error(`Unexpected GitHub request: ${method} ${url}`);
    }));

    const result = await putGitHubTextFiles(buildEnv(), [
      { path: '_products/alpha.md', content: '---\norder: 1\n---\n', expectedSha: 'sha-alpha' }
    ], 'Update Store product display order');

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      path: '_products/alpha.md',
      code: 'github_file_changed'
    });
    expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/git/blobs'))).toHaveLength(0);
    expect(calls.filter((call) => call.method === 'PATCH' && call.url.includes('/git/refs/heads/'))).toHaveLength(0);
  });
});
