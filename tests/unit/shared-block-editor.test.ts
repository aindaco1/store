import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise the real dashboard closure, exposing only fixture construction.
// Production code has no test API and all interactions below use its DOM events.
const source = readFileSync('assets/js/admin-dashboard.js', 'utf8');
let api: any;
let root: HTMLElement;
let field: HTMLTextAreaElement;
function mount(blocks: unknown[]) {
const wrapper = api.mount({ productId: 'fixture', longContent: blocks });
    document.body.append(wrapper);
    root = wrapper.querySelector('[data-store-product-description-editor]')!;
    field = wrapper.querySelector('[data-store-product-long-content-source]')!;
}
function change(index: number, action: string, value: string) {
  const control = root.querySelector(`[data-content-index="${index}"][data-content-action="${action}"]`) as HTMLSelectElement;
  control.value = value;
  control.dispatchEvent(new Event('change', { bubbles: true }));
}
function click(index: number, action: string) {
  (root.querySelector(`[data-content-index="${index}"][data-content-action="${action}"]`) as HTMLButtonElement).click();
}
const read = () => JSON.parse(field.value);

describe('block editor behavior before and after Platform migration', () => {
  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = '<script data-admin-dashboard-script="true"></script><textarea id="admin-content-long-content"></textarea><div id="admin-content-blocks"></div>';
    await import('../../shared/dust-wave-platform/packages/admin-shell/src/editor-codec.js');
    await import('../../shared/dust-wave-platform/packages/admin-shell/src/editor-media.js');
    await import('../../shared/dust-wave-platform/packages/admin-shell/src/block-editor.js');
    await import('../../shared/dust-wave-platform/packages/admin-shell/src/feedback.js');
    (window as any).STORE_CONFIG = { i18n: { currentLang: 'en', messages: { admin: {} } }, platform: { siteUrl: 'https://fixture.test', workerUrl: '' } };
    global.fetch = vi.fn(async () => new Response('{}', { status: 401 })) as any;
    window.eval(source.replace(/\}\)\(\);\s*$/, 'window.__editorFixture = { mount: createStoreProductDescriptionEditor, parse: storeProductDescriptionParseBlocks }; })();'));
    api = (window as any).__editorFixture;
  });
  afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); vi.restoreAllMocks(); });

  it('renders all eight block types and preserves media metadata on reorder', () => {
    mount([
      { type: 'text', body: '**Lead**', align: 'right' },
      { type: 'quote', text: 'Quote', author: 'Author' },
      { type: 'image', src: '/assets/example.png', alt: 'Description', caption: 'Caption' },
      { type: 'gallery', layout: 'carousel', caption_style: 'overlay', images: [{ src: '/assets/one.png', alt: 'One', caption: 'Hover' }] },
      { type: 'video', provider: 'vimeo', video_id: '1234', poster: '/assets/poster.png' },
      { type: 'audio', src: '/assets/sound.mp3', title: 'Sound' },
      { type: 'embed', src: 'https://example.test/media', title: 'External' },
      { type: 'divider' }
    ]);
    expect(root.querySelectorAll('.admin-content-block')).toHaveLength(8);
    expect(root.querySelectorAll('[data-content-action="insert-block"]')).toHaveLength(9);
    expect(root.querySelector('.gallery--carousel.gallery--caption-overlay')).not.toBeNull();
    const gallery = read()[3];
    click(3, 'up');
    expect(read()[2]).toEqual(gallery);
    click(2, 'down');
    expect(read()[3]).toEqual(gallery);
    expect(read()[4].provider).toBe('vimeo');
  });

  it('converts text and quotes without losing words or alignment, inserts and deletes', () => {
    mount([{ type: 'text', body: 'Keep **these words**', align: 'center' }]);
    change(0, 'type', 'quote');
    expect(read()[0]).toMatchObject({ type: 'quote', text: 'Keep **these words**', align: 'center' });
    change(0, 'type', 'text');
    expect(read()[0]).toMatchObject({ type: 'text', body: 'Keep **these words**', align: 'center' });
    click(1, 'insert-block');
    expect(root.querySelectorAll('.admin-content-block')).toHaveLength(2);
    click(1, 'delete');
    expect(root.querySelectorAll('.admin-content-block')).toHaveLength(1);
    expect((root.querySelector('[data-content-action="delete"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('supports slash insertion and hides inactive toolbar controls from keyboard navigation', () => {
    mount([{ type: 'text', body: 'Before\n\n/quote\n\nAfter', align: 'right' }]);
    const editable = root.querySelector('[data-content-field="body"]') as HTMLElement;
    Object.defineProperty(editable, 'isContentEditable', { value: true, configurable: true });
    editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect([...root.querySelectorAll('.admin-content-block')].map(block => block.className.match(/content-block--(text|quote)/)?.[1])).toEqual(['text', 'quote', 'text']);
    expect(read()[0].body).toBe('Before');
    expect(read()[1]).toMatchObject({ body: 'After', align: 'right' });
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect([...root.querySelectorAll('[data-content-chrome] button')].every(button => button.getAttribute('tabindex') === '-1')).toBe(true);
  });
});
