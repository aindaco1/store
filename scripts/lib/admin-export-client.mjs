function normalizedBase(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('Admin Worker base must be a valid URL.');
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHosts.has(url.hostname))) {
    throw new Error('Admin Worker base must use HTTPS except for loopback development.');
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new Error('Admin Worker base must be an origin without credentials, path, query, or fragment.');
  }
  return url.origin;
}

function cookieFromResponse(response) {
  const setCookie = response.headers.get('set-cookie') || '';
  return setCookie.split(';')[0].trim();
}

export async function exchangeAdminLoginToken({ workerBase, token, fetchImpl = fetch } = {}) {
  const base = normalizedBase(workerBase);
  if (!base || !String(token || '').trim()) throw new Error('Admin export requires a Worker base and one-time login token.');
  const response = await fetchImpl(`${base}/admin/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ token: String(token).trim(), preferredLang: 'en' }),
    redirect: 'error'
  });
  const body = await response.json().catch(() => ({}));
  const cookie = cookieFromResponse(response);
  if (!response.ok || !cookie || !body.csrfToken) {
    throw new Error(`Admin login token exchange failed with status ${response.status}.`);
  }
  return { cookie, csrfToken: String(body.csrfToken), role: String(body.user?.role || '') };
}

export async function fetchAdminExport({ workerBase, session, path, accept = 'application/json', fetchImpl = fetch } = {}) {
  const base = normalizedBase(workerBase);
  if (!base) throw new Error('Admin export requires a Worker base.');
  const relativePath = String(path || '');
  if (!relativePath.startsWith('/admin/')) throw new Error('Admin export path must stay under /admin/.');
  const exportUrl = new URL(relativePath, `${base}/`);
  if (exportUrl.origin !== base || !exportUrl.pathname.startsWith('/admin/')) {
    throw new Error('Admin export path must stay under /admin/.');
  }
  const response = await fetchImpl(exportUrl.toString(), {
    method: 'GET',
    headers: { Accept: accept, Cookie: session.cookie },
    redirect: 'error'
  });
  if (!response.ok) throw new Error(`Admin export ${relativePath} failed with status ${response.status}.`);
  return {
    contentType: response.headers.get('content-type') || '',
    contentDisposition: response.headers.get('content-disposition') || '',
    bytes: new Uint8Array(await response.arrayBuffer())
  };
}
