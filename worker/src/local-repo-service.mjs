import http from 'node:http';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PORT = 8799;
const DEFAULT_MAX_BODY_BYTES = 140 * 1024 * 1024;

function parseDevVars(filePath) {
  const values = {};
  let source = '';
  try {
    source = readFileSync(filePath, 'utf8');
  } catch (_error) {
    return values;
  }

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    values[match[1]] = String(match[2] || '').replace(/^"(.*)"$/, '$1').trim();
  }
  return values;
}

const workerDir = process.cwd();
const devVars = parseDevVars(path.join(workerDir, '.dev.vars'));
const repoRoot = path.resolve(process.env.ADMIN_LOCAL_REPO_ROOT || devVars.ADMIN_LOCAL_REPO_ROOT || path.join(workerDir, '..'));
const token = String(process.env.ADMIN_LOCAL_REPO_TOKEN || devVars.ADMIN_LOCAL_REPO_TOKEN || process.env.ADMIN_SECRET || devVars.ADMIN_SECRET || '').trim();
const port = Number(process.env.ADMIN_LOCAL_REPO_SERVICE_PORT || devVars.ADMIN_LOCAL_REPO_SERVICE_PORT || DEFAULT_PORT) || DEFAULT_PORT;
const maxBodyBytes = Number(process.env.ADMIN_LOCAL_REPO_MAX_BODY_BYTES || devVars.ADMIN_LOCAL_REPO_MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES) || DEFAULT_MAX_BODY_BYTES;

function jsonResponse(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(`${JSON.stringify(payload)}\n`);
}

function authorize(req, res) {
  if (!token) {
    jsonResponse(res, 503, { ok: false, error: 'Local repo token is not configured.', code: 'local_repo_token_missing' });
    return false;
  }
  if (String(req.headers.authorization || '') !== `Bearer ${token}`) {
    jsonResponse(res, 403, { ok: false, error: 'Forbidden', code: 'local_repo_forbidden' });
    return false;
  }
  return true;
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      throw Object.assign(new Error('Request body is too large.'), { status: 413, code: 'local_repo_body_too_large' });
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_error) {
    throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400, code: 'local_repo_invalid_json' });
  }
}

function normalizeRepoPath(value = '') {
  const normalized = String(value || '').replace(/^\/+/, '').split(/[?#]/)[0];
  if (!normalized || normalized.includes('\\') || normalized.split('/').some((part) => part === '..')) return '';
  return normalized;
}

function absolute(repoPath) {
  const normalized = normalizeRepoPath(repoPath);
  if (!normalized || path.isAbsolute(normalized)) return '';
  const absolutePath = path.resolve(repoRoot, normalized);
  const rootWithSeparator = repoRoot.endsWith(path.sep) ? repoRoot : `${repoRoot}${path.sep}`;
  if (absolutePath !== repoRoot && !absolutePath.startsWith(rootWithSeparator)) return '';
  return absolutePath;
}

function decodeBase64Content(value = '') {
  const base64 = String(value || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw Object.assign(new Error('File content must be valid base64.'), { status: 400, code: 'local_repo_invalid_base64' });
  }
  return Buffer.from(base64, 'base64');
}

async function handleRequest(req, res) {
  if (req.method === 'GET' && req.url === '/health') {
    jsonResponse(res, 200, { ok: true, repoRoot, maxBodyBytes });
    return;
  }
  if (req.method !== 'POST') {
    jsonResponse(res, 405, { ok: false, error: 'Method not allowed', code: 'local_repo_method_not_allowed' });
    return;
  }
  if (!authorize(req, res)) return;

  const body = await readJsonBody(req);
  if (req.url === '/read') {
    const repoPath = normalizeRepoPath(body.path);
    const filePath = absolute(repoPath);
    if (!filePath) throw Object.assign(new Error('Invalid local repository path.'), { status: 400, code: 'invalid_local_repo_path' });
    const content = await fs.readFile(filePath, 'utf8');
    jsonResponse(res, 200, { ok: true, mode: 'local', path: repoPath, content, sha: '' });
    return;
  }

  if (req.url === '/write' || req.url === '/write-base64') {
    const repoPath = normalizeRepoPath(body.path);
    const filePath = absolute(repoPath);
    if (!filePath) throw Object.assign(new Error('Invalid local repository path.'), { status: 400, code: 'invalid_local_repo_path' });
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (req.url === '/write-base64') {
      await fs.writeFile(filePath, decodeBase64Content(body.content || body.base64), {
        flag: body.overwrite ? 'w' : 'wx'
      });
    } else {
      await fs.writeFile(filePath, String(body.content || ''), {
        encoding: 'utf8',
        flag: body.overwrite ? 'w' : 'wx'
      });
    }
    jsonResponse(res, 200, { ok: true, mode: 'local', path: repoPath, contentSha: '', commitSha: 'local', commitUrl: '' });
    return;
  }

  jsonResponse(res, 404, { ok: false, error: 'Not found', code: 'local_repo_not_found' });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    jsonResponse(res, error?.status || (error?.code === 'EEXIST' ? 409 : error?.code === 'ENOENT' ? 404 : 500), {
      ok: false,
      error: error?.message || 'Local repository operation failed.',
      code: error?.code || 'local_repo_operation_failed'
    });
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Local repo service listening on 127.0.0.1:${port} for ${repoRoot}`);
});
