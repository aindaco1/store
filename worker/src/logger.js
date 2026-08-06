import {
  getConsoleLoggingEnabled,
  getVerboseConsoleLogging
} from './provider-config.js';
import { createScopedConsoleFactory } from '../../shared/dust-wave-platform/packages/worker-core/src/logger.js';

const { getScopedConsole: getCoreScopedConsole } = createScopedConsoleFactory({
  productName: 'Store'
});

export function getScopedConsole(env = {}, scope = 'worker') {
  return getCoreScopedConsole(env, scope, {
    consoleLoggingEnabled: getConsoleLoggingEnabled(env),
    verboseConsoleLogging: getVerboseConsoleLogging(env)
  });
}
