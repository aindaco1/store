import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
}

describe('admin Turnstile sign-in', () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.lang = 'en';
    document.head.innerHTML = '';
    document.body.innerHTML = `
      <section id="admin-auth-panel">
        <form id="admin-login-form" data-admin-turnstile-site-key="site-key">
          <input id="admin-email" type="email">
          <button type="submit">Send magic link</button>
          <div data-admin-turnstile-widget></div>
        </form>
        <p id="admin-auth-status"></p>
      </section>
      <section id="admin-app" hidden>
        <p id="admin-session-summary"></p>
      </section>
      <script data-admin-dashboard-script="true" data-canonical-worker-base="https://checkout.dustwave.xyz"></script>
    `;
    (window as any).STORE_CONFIG = {
      i18n: { currentLang: 'en' },
      platform: { workerUrl: 'https://checkout.dustwave.xyz' }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete (window as any).STORE_CONFIG;
    delete (window as any).turnstile;
  });

  it('renders the admin challenge and sends the Turnstile token with the magic-link request', async () => {
    const authStartBodies: any[] = [];
    (window as any).turnstile = {
      render: vi.fn((_root: Element, options: any) => {
        options.callback('turnstile-client-token');
        return 'widget-1';
      }),
      getResponse: vi.fn(() => 'turnstile-client-token'),
      reset: vi.fn()
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith('/admin/session')) return jsonResponse({ error: 'Unauthorized' }, 401);
      if (requestUrl.endsWith('/admin/auth/start')) {
        authStartBodies.push(JSON.parse(String(init?.body || '{}')));
        return jsonResponse({ success: true, sent: true });
      }
      return jsonResponse({ ok: true });
    }));

    await import('../../assets/js/admin-dashboard.js');

    await waitFor(() => (window as any).turnstile.render.mock.calls.length === 1);

    expect((window as any).turnstile.render).toHaveBeenCalledWith(
      document.querySelector('[data-admin-turnstile-widget]'),
      expect.objectContaining({
        sitekey: 'site-key',
        action: 'admin_login'
      })
    );

    const email = document.getElementById('admin-email') as HTMLInputElement;
    const form = document.getElementById('admin-login-form') as HTMLFormElement;
    email.value = 'alonso@dustwave.xyz';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => authStartBodies.length === 1);
    expect(authStartBodies[0]).toMatchObject({
      email: 'alonso@dustwave.xyz',
      preferredLang: 'en',
      turnstileToken: 'turnstile-client-token'
    });
  });

  it('does not load or render the admin challenge for an existing authenticated session', async () => {
    (window as any).turnstile = {
      render: vi.fn(() => 'widget-1'),
      getResponse: vi.fn(() => ''),
      reset: vi.fn()
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/admin/session')) {
        return jsonResponse({
          user: { email: 'alonso@dustwave.xyz', role: 'super_admin' },
          csrfToken: 'csrf-token'
        });
      }
      return jsonResponse({ ok: true });
    }));

    await import('../../assets/js/admin-dashboard.js');

    await waitFor(() => !(document.getElementById('admin-app') as HTMLElement).hidden);
    expect((window as any).turnstile.render).not.toHaveBeenCalled();
    expect(document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')).toBeNull();
    expect((document.getElementById('admin-auth-panel') as HTMLElement).hidden).toBe(true);
  });

  it('loads the challenge script after the session endpoint rejects the user', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/admin/session')) return jsonResponse({ error: 'Unauthorized' }, 401);
      return jsonResponse({ ok: true });
    }));

    await import('../../assets/js/admin-dashboard.js');

    await waitFor(() => Boolean(document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')));
    expect((document.getElementById('admin-auth-panel') as HTMLElement).hidden).toBe(false);
    expect((document.getElementById('admin-app') as HTMLElement).hidden).toBe(true);
  });
});
