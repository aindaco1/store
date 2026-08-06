import {
  MEDIA_MANIFEST_VERSION,
  MEDIA_RESPONSIVE_WIDTHS,
  createMediaCatalog,
  mediaPathExtension,
  mediaPathLabel,
  mediaPublicPath,
  normalizeMediaRepoPath,
  probableResponsiveImageSourcePaths,
  probableVideoSourcePaths,
  responsiveImageDerivativeInfo
} from '../../shared/dust-wave-platform/packages/media-core/src/site-catalog.js';

export {
  MEDIA_MANIFEST_VERSION,
  MEDIA_RESPONSIVE_WIDTHS,
  mediaPathExtension,
  mediaPathLabel,
  mediaPublicPath,
  normalizeMediaRepoPath,
  probableResponsiveImageSourcePaths,
  probableVideoSourcePaths,
  responsiveImageDerivativeInfo
};

export const MEDIA_MANIFEST_PATH = '_data/media-optimization-manifest.json';

export function mediaProductSlug(value = '') {
  const match = normalizeMediaRepoPath(value)
    .match(/^assets\/(?:images|videos|audio)\/products\/([^/]+)\//);
  return match ? match[1] : '';
}

export function mediaScope(value = '') {
  const repoPath = normalizeMediaRepoPath(value);
  if (/^assets\/(?:images|videos|audio)\/products\//.test(repoPath)) return 'product';
  if (/^assets\/(?:images|videos|audio)\/add-ons\//.test(repoPath)) return 'add_on';
  if (/^assets\/(?:images|videos|audio)\/defaults\//.test(repoPath)) return 'default';
  if (/^assets\/images\/share-icons\//.test(repoPath)) return 'default';
  return 'product';
}

const catalog = createMediaCatalog({
  scopeForPath: mediaScope,
  entitySlugForPath: mediaProductSlug,
  entitySlugKey: 'productSlug',
  placementBudgets: {
    product_card: { maxBytes: 1_000_000, recommendedRatio: '1:1', label: 'product card' },
    product_detail: { maxBytes: 2_000_000, recommendedRatio: 'flexible', label: 'product detail' },
    social: { maxBytes: 1_500_000, recommendedRatio: '1.91:1', label: 'social preview' },
    checkout_order: { maxBytes: 750_000, recommendedRatio: '1:1', label: 'checkout/order thumbnail' },
    admin_preview: { maxBytes: 8_000_000, recommendedRatio: 'flexible', label: 'admin preview' },
    logo: { maxBytes: 500_000, recommendedRatio: 'flexible', label: 'brand logo' },
    favicon: { maxBytes: 250_000, recommendedRatio: '1:1', label: 'favicon' },
    email: { maxBytes: 1_000_000, recommendedRatio: 'flexible', label: 'email image' }
  },
  defaultPlacement: 'product_detail',
  includeWebmAudio: true,
  includeBrokenReferences: true
});

export const classifyMediaPath = catalog.classifyMediaPath;
export const expectedMediaDerivativePaths = catalog.expectedMediaDerivativePaths;
export const normalizeMediaManifest = catalog.normalizeMediaManifest;
export const mediaPlacementBudget = catalog.mediaPlacementBudget;
