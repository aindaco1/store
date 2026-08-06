import { describe, expect, it } from 'vitest';

import {
  MEDIA_RESPONSIVE_WIDTHS,
  classifyMediaPath,
  expectedMediaDerivativePaths,
  mediaPathExtension,
  mediaPathLabel,
  mediaPublicPath,
  normalizeMediaRepoPath,
  probableResponsiveImageSourcePaths,
  probableVideoSourcePaths,
  responsiveImageDerivativeInfo
} from '../../worker/src/media-catalog.js';

describe('shared media catalog mechanics contract', () => {
  it('normalizes paths, labels, public URLs, and responsive derivatives', () => {
    expect(normalizeMediaRepoPath('\\assets\\images//defaults/cover-640.webp')).toBe(
      'assets/images/defaults/cover-640.webp'
    );
    expect(mediaPublicPath('./assets/images/defaults/cover.jpg')).toBe(
      '/assets/images/defaults/cover.jpg'
    );
    expect(mediaPathExtension('/assets/images/defaults/cover.JPG')).toBe('jpg');
    expect(mediaPathLabel('assets/images/defaults/cover-art-640.webp')).toBe('cover art');
    expect(MEDIA_RESPONSIVE_WIDTHS).toEqual([320, 480, 640, 960, 1600]);
    expect(responsiveImageDerivativeInfo('assets/images/defaults/cover-640.webp')).toEqual({
      basePath: 'assets/images/defaults/cover',
      width: 640
    });
    expect(probableResponsiveImageSourcePaths('assets/images/defaults/cover-640.webp')).toEqual([
      'assets/images/defaults/cover.png',
      'assets/images/defaults/cover.jpg',
      'assets/images/defaults/cover.jpeg',
      'assets/images/defaults/cover.gif'
    ]);
    expect(normalizeMediaRepoPath('assets/images/../private/file.jpg')).toBe('');
    expect(classifyMediaPath('assets/images/../private/file.jpg')).toBeNull();
  });

  it('classifies source/derived media and plans deterministic derivatives', () => {
    const source = 'assets/images/defaults/cover.jpg';
    const derivative = 'assets/images/defaults/cover-640.webp';
    expect(classifyMediaPath(derivative, new Set([source, derivative]))).toMatchObject({
      path: derivative,
      publicPath: `/${derivative}`,
      label: 'cover',
      extension: 'webp',
      type: 'image',
      role: 'derived',
      sourcePath: source,
      derivativeWidth: 640
    });
    expect(expectedMediaDerivativePaths(source, { width: 1000 })).toEqual([
      'assets/images/defaults/cover-320.webp',
      'assets/images/defaults/cover-480.webp',
      'assets/images/defaults/cover-640.webp',
      'assets/images/defaults/cover-960.webp'
    ]);
    expect(probableVideoSourcePaths('assets/videos/defaults/trailer.webm')).toEqual([
      'assets/videos/defaults/trailer.mp4',
      'assets/videos/defaults/trailer.mov',
      'assets/videos/defaults/trailer.m4v'
    ]);
  });
});
