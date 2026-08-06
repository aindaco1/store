import { beforeEach } from 'vitest';
import { syncBrowserStorageGlobals } from '../../shared/dust-wave-platform/packages/test-core/src/index.js';

syncBrowserStorageGlobals();
beforeEach(syncBrowserStorageGlobals);
