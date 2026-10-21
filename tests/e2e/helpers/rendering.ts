import type { Page } from '@playwright/test';
import { applyTextScale as sharedApplyTextScale } from '../../../shared/dust-wave-platform/packages/test-core/src/rendering.js';
export { waitForStableRendering } from '../../../shared/dust-wave-platform/packages/test-core/src/rendering.js';
export function applyTextScale(page: Page, percent = 200) {
  return sharedApplyTextScale(page, percent, { pathPrefix: '/__store-text-scale-' });
}
