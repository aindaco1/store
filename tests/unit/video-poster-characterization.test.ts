import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
const repo = path.resolve(import.meta.dirname, '../..');
const markup = fs.readFileSync(path.join(repo, '_layouts/admin.html'), 'utf8').match(/<script[^>]*src="[^"]*first-frame-poster[^>]*><\/script>/)![0];
const sourcePath = markup.match(/src="([^"?]+)/)![1]!;
const source = fs.readFileSync(path.join(repo, sourcePath), 'utf8');
const globalName = 'StoreVideoPosters';

function fixture({ observer = true, origin = 'https://example.test', baseURI = 'https://example.test/folder/', loading = false } = {}) {
  const previews: any[] = [], timers = new Map<number, () => void>(), drawCalls: any[] = [], watched: any[] = [];
  let timerId = 0, observeCallback: any, readyCallback: any;
  class Video {
    attrs = new Map<string, string>(); listeners = new Map<string, { fn: () => void; once?: boolean }[]>();
    currentSrc = ''; poster = ''; src = ''; videoWidth = 2560; videoHeight = 1440; loads = 0;
    constructor(src = '/fixture.webm') { this.currentSrc = src; this.setAttribute('data-first-frame-poster', 'true'); }
    getAttribute(n: string) { return this.attrs.get(n) ?? null; } hasAttribute(n: string) { return this.attrs.has(n); }
    setAttribute(n: string, v: string) { this.attrs.set(n, v); }
    removeAttribute(n: string) { this.attrs.delete(n); if (n === 'src') this.src = ''; }
    querySelector() { return null; } querySelectorAll() { return []; }
    addEventListener(n: string, fn: () => void, opts: any = {}) { const list = this.listeners.get(n) || []; list.push({ fn, once: opts.once }); this.listeners.set(n, list); }
    emit(n: string) { for (const item of [...(this.listeners.get(n) || [])]) { if (item.once) this.listeners.set(n, this.listeners.get(n)!.filter(x => x !== item)); item.fn(); } }
    load() { this.loads++; }
  }
  const video = new Video();
  const script = { getAttribute: (name: string) => markup.match(new RegExp(`${name}="([^"]*)"`))?.[1] || null };
  const document = {
    baseURI, readyState: loading ? 'loading' : 'complete', currentScript: script,
    addEventListener: (_n: string, fn: any) => { readyCallback = fn; },
    querySelector: () => script, querySelectorAll: () => [video],
    createElement: (tag: string) => {
      if (tag === 'video') { const preview = new Video(''); previews.push(preview); return preview; }
      return { width: 0, height: 0, getContext() { return { drawImage: (...args: any[]) => drawCalls.push(args) }; }, toDataURL: () => 'data:image/jpeg;base64,fixture' };
    },
  };
  class Observer { constructor(fn: any) { observeCallback = fn; } observe(v: any) { watched.push(v); } unobserve(v: any) { watched.splice(watched.indexOf(v), 1); } }
  const window: any = { location: { origin, href: 'https://example.test/page/' }, setTimeout: (fn: any) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id: number) => timers.delete(id) };
  if (observer) window.IntersectionObserver = Observer;
  vm.runInNewContext(source, { window, document, HTMLVideoElement: Video, IntersectionObserver: Observer, URL, Date });
  return { window, video, previews, timers, watched, drawCalls, ready: () => readyCallback(), trigger: (visible = true) => observeCallback([{ target: video, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }]), runTimer: () => { const [id, fn] = timers.entries().next().value!; timers.delete(id); fn(); } };
}

describe('first-frame poster characterization', () => {
  it('waits for DOM readiness and intersection, then captures once at bounded dimensions', () => {
    const f = fixture({ loading: true }); expect(f.watched).toHaveLength(0); f.ready();
    expect(f.watched).toHaveLength(1); f.window[globalName].init(f.video); expect(f.watched).toHaveLength(1);
    f.trigger(false); expect(f.previews).toHaveLength(0); f.trigger();
    expect(f.previews).toHaveLength(1); expect(f.video.hasAttribute('data-first-frame-poster-pending')).toBe(true);
    expect(new URL(f.previews[0].src).searchParams.has('store_first_frame_poster')).toBe(true);
    f.previews[0].emit('loadeddata'); expect(f.video.poster).toMatch(/^data:image\/jpeg/);
    expect(f.drawCalls[0].slice(1)).toEqual([0, 0, 1280, 720]);
    expect(f.video.hasAttribute('data-first-frame-poster-ready')).toBe(true);
    expect(f.video.hasAttribute('data-first-frame-poster-pending')).toBe(false);
    expect(f.previews[0].src).toBe(''); expect(f.timers.size).toBe(0);
    f.previews[0].emit('canplay'); f.window[globalName].init(f.video); expect(f.drawCalls).toHaveLength(1); expect(f.previews).toHaveLength(1);
  });
  it('uses delayed fallback without an observer and clears failed attempts for later retry', () => {
    const f = fixture({ observer: false }); expect(f.previews).toHaveLength(0); f.runTimer();
    f.previews[0].emit('error'); expect(f.video.hasAttribute('data-first-frame-poster-pending')).toBe(false); expect(f.timers.size).toBe(0);
    f.window[globalName].init(f.video); f.runTimer(); expect(f.previews).toHaveLength(2); f.runTimer();
    expect(f.video.hasAttribute('data-first-frame-poster-pending')).toBe(false); expect(f.video.hasAttribute('data-first-frame-poster-ready')).toBe(false);
  });
  it('preserves explicit posters and rejects other origins', () => {
    const f = fixture(); f.video.poster = 'existing.jpg'; f.trigger(); expect(f.previews).toHaveLength(0);
    const external = fixture(); external.video.currentSrc = 'https://other.test/video.webm'; external.trigger(); expect(external.previews).toHaveLength(0);
  });
  it('retains this consumer\'s document-base and opaque-origin policy', () => {
    const base = fixture({ baseURI: 'https://other.test/base/' }); base.video.currentSrc = 'relative.webm'; base.trigger(); expect(base.previews).toHaveLength(1);
    const opaque = fixture({ origin: 'null' }); opaque.trigger(); expect(opaque.previews).toHaveLength(0);
  });
});
