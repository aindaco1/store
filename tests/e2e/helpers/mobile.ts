import { expect } from '@playwright/test';
import { expectNoHorizontalOverflow as expectSharedNoHorizontalOverflow } from '../../../shared/dust-wave-platform/packages/test-core/src/index.js';

export function expectNoHorizontalOverflow(page: any) {
  return expectSharedNoHorizontalOverflow(page, { expectTarget: expect });
}
