import { describe, expect, it } from 'vitest';
import {
  hasAnimatedWebpChunks,
  normalizeRepoPath,
  publicAssetPathForRepoPath,
  responsiveWebpDerivativePathForImage,
  responsiveWebpDerivativePathsForImage,
  rewriteMediaReferences,
  webmDerivativePathForVideo
} from '../../scripts/optimize-media.mjs';
import {
  classifyMediaPath,
  expectedMediaDerivativePaths,
  mediaPlacementBudget
} from '../../worker/src/media-catalog.js';

function webpFixture(chunks) {
  const chunkBuffers = chunks.flatMap(([type, payload]) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32LE(payload.length, 4);
    return payload.length % 2 ? [header, payload, Buffer.from([0])] : [header, payload];
  });
  const body = Buffer.concat(chunkBuffers);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 4, 'ascii');
  return Buffer.concat([header, body]);
}

describe('media optimization script helpers', () => {
  it('normalizes repository asset paths to public URLs', () => {
    expect(normalizeRepoPath('.\\assets\\videos\\defaults\\hero.mp4'))
      .toBe('assets/videos/defaults/hero.mp4');
    expect(publicAssetPathForRepoPath('assets/videos/defaults/hero.mp4'))
      .toBe('/assets/videos/defaults/hero.mp4');
    expect(publicAssetPathForRepoPath('docs/DASHBOARD.md')).toBe('');
  });

  it('derives WebM video paths without changing existing WebM assets', () => {
    expect(webmDerivativePathForVideo('assets/videos/defaults/hero.mp4'))
      .toBe('assets/videos/defaults/hero.webm');
    expect(webmDerivativePathForVideo('assets/videos/defaults/hero.mov'))
      .toBe('assets/videos/defaults/hero.webm');
    expect(webmDerivativePathForVideo('assets/videos/defaults/hero.webm'))
      .toBe('');
  });

  it('derives responsive WebP image variant paths without recursively optimizing generated variants', () => {
    expect(responsiveWebpDerivativePathForImage('assets/images/products/frontiers-poster.png', 960))
      .toBe('assets/images/products/frontiers-poster-960.webp');
    expect(responsiveWebpDerivativePathsForImage('assets/images/defaults/hero-wide.jpg'))
      .toEqual([
        'assets/images/defaults/hero-wide-320.webp',
        'assets/images/defaults/hero-wide-480.webp',
        'assets/images/defaults/hero-wide-640.webp',
        'assets/images/defaults/hero-wide-960.webp',
        'assets/images/defaults/hero-wide-1600.webp'
      ]);
    expect(responsiveWebpDerivativePathForImage('assets/images/defaults/hero-wide-960.webp', 480))
      .toBe('');
    expect(responsiveWebpDerivativePathForImage('assets/videos/defaults/hero.mp4', 480))
      .toBe('');
  });

  it('detects animated WebP files before attempting cwebp optimization', () => {
    expect(hasAnimatedWebpChunks(webpFixture([
      ['VP8 ', Buffer.from([1, 2, 3])]
    ]))).toBe(false);
    expect(hasAnimatedWebpChunks(webpFixture([
      ['VP8X', Buffer.from([1, 2, 3, 4])],
      ['ANIM', Buffer.from([5, 6])]
    ]))).toBe(true);
    expect(hasAnimatedWebpChunks(Buffer.from('not a webp'))).toBe(false);
  });

  it('rewrites literal media references only for known generated derivatives', () => {
    const replacements = new Map([
      ['/assets/videos/defaults/hero.mp4', '/assets/videos/defaults/hero.webm']
    ]);
    const source = [
      'hero_video: /assets/videos/defaults/hero.mp4',
      'poster: /assets/images/products/frontiers-poster.jpg'
    ].join('\n');

    expect(rewriteMediaReferences(source, replacements)).toBe([
      'hero_video: /assets/videos/defaults/hero.webm',
      'poster: /assets/images/products/frontiers-poster.jpg'
    ].join('\n'));
  });

  it('classifies Store source and generated media across product, default, add-on, and audio paths', () => {
    const known = new Set([
      'assets/images/products/poster.png',
      'assets/images/products/poster-640.webp',
      'assets/images/add-ons/sticker.jpg',
      'assets/videos/defaults/loop.mp4',
      'assets/videos/defaults/loop.webm',
      'assets/audio/products/sample.mp3'
    ]);

    expect(classifyMediaPath('assets/images/products/poster.png', known)).toMatchObject({
      type: 'image', role: 'source', scope: 'product'
    });
    expect(classifyMediaPath('assets/images/products/poster-640.webp', known)).toMatchObject({
      type: 'image', role: 'derived', sourcePath: 'assets/images/products/poster.png', derivativeWidth: 640
    });
    expect(classifyMediaPath('assets/images/add-ons/sticker.jpg', known)).toMatchObject({
      type: 'image', role: 'source', scope: 'add_on'
    });
    expect(classifyMediaPath('assets/videos/defaults/loop.webm', known)).toMatchObject({
      type: 'video', role: 'derived', scope: 'default', sourcePath: 'assets/videos/defaults/loop.mp4'
    });
    expect(classifyMediaPath('assets/audio/products/sample.mp3', known)).toMatchObject({
      type: 'audio', role: 'source', scope: 'product'
    });
  });

  it('derives Store placement-aware optimization expectations from the shared policy', () => {
    expect(expectedMediaDerivativePaths('assets/images/products/poster.png', { width: 700 }))
      .toEqual([
        'assets/images/products/poster-320.webp',
        'assets/images/products/poster-480.webp',
        'assets/images/products/poster-640.webp'
      ]);
    expect(mediaPlacementBudget('product_card')).toMatchObject({ maxBytes: 1_000_000, label: 'product card' });
    expect(mediaPlacementBudget('checkout_order')).toMatchObject({ maxBytes: 750_000 });
  });
});
