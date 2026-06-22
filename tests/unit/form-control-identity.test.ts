import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Store form control identity helper', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = `
      <button type="button" data-action="save">Save</button>
      <input type="text" aria-label="Search">
      <select id="existing-select"></select>
      <textarea name="existing-textarea"></textarea>
    `;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    delete (window as any).StoreFormControlIdentity;
  });

  it('adds ids to nameless first-party controls without changing named controls', async () => {
    await import('../../assets/js/form-control-identity.js');
    (window as any).StoreFormControlIdentity.start(document);

    const button = document.querySelector('button[data-action="save"]') as HTMLButtonElement;
    const input = document.querySelector('input[aria-label="Search"]') as HTMLInputElement;
    const select = document.getElementById('existing-select') as HTMLSelectElement;
    const textarea = document.querySelector('textarea[name="existing-textarea"]') as HTMLTextAreaElement;

    expect(button.id).toMatch(/^store-form-control-save-/);
    expect(input.id).toMatch(/^store-form-control-search-/);
    expect(button.getAttribute('name')).toBeNull();
    expect(input.getAttribute('name')).toBeNull();
    expect(select.id).toBe('existing-select');
    expect(textarea.id).toBe('');
    expect(textarea.name).toBe('existing-textarea');
  });

  it('observes controls inserted after startup', async () => {
    await import('../../assets/js/form-control-identity.js');
    (window as any).StoreFormControlIdentity.start(document);

    const late = document.createElement('button');
    late.type = 'button';
    late.dataset.storeMarketingCopy = 'Launch copy';
    late.textContent = 'Copy';
    document.body.append(late);
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(late.id).toMatch(/^store-form-control-launch-copy-/);
  });
});
