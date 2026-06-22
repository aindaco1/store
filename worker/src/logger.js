import {
  getConsoleLoggingEnabled,
  getVerboseConsoleLogging
} from './provider-config.js';

const CONSOLE_CACHE = new WeakMap();
const PASS_THROUGH_CONSOLE = globalThis.console;

function shouldLog(config, level) {
  if (!config.consoleLoggingEnabled) {
    return false;
  }
  if (!config.verboseConsoleLogging && (level === 'debug' || level === 'info' || level === 'log')) {
    return false;
  }
  return true;
}

function getMethod(level) {
  return typeof PASS_THROUGH_CONSOLE[level] === 'function'
    ? PASS_THROUGH_CONSOLE[level].bind(PASS_THROUGH_CONSOLE)
    : PASS_THROUGH_CONSOLE.log.bind(PASS_THROUGH_CONSOLE);
}

function formatTimestamp() {
  try {
    return new Date().toISOString();
  } catch {
    return 'unknown-time';
  }
}

function normalizeArg(arg) {
  if (arg instanceof Error) {
    return {
      name: arg.name,
      message: arg.message,
      stack: arg.stack || null
    };
  }
  return arg;
}

function createScopedConsole(config, scope) {
  return {
    child(childScope) {
      return createScopedConsole(config, scope ? `${scope}:${childScope}` : childScope);
    },
    debug(...args) {
      if (!shouldLog(config, 'debug')) return;
      getMethod('debug')(
        `[Store ${formatTimestamp()}]`,
        `[Store Worker:${scope}]`,
        '[DEBUG]',
        ...args.map(normalizeArg)
      );
    },
    info(...args) {
      if (!shouldLog(config, 'info')) return;
      getMethod('info')(
        `[Store ${formatTimestamp()}]`,
        `[Store Worker:${scope}]`,
        '[INFO]',
        ...args.map(normalizeArg)
      );
    },
    log(...args) {
      if (!shouldLog(config, 'log')) return;
      getMethod('log')(
        `[Store ${formatTimestamp()}]`,
        `[Store Worker:${scope}]`,
        '[LOG]',
        ...args.map(normalizeArg)
      );
    },
    warn(...args) {
      if (!shouldLog(config, 'warn')) return;
      getMethod('warn')(
        `[Store ${formatTimestamp()}]`,
        `[Store Worker:${scope}]`,
        '[WARN]',
        ...args.map(normalizeArg)
      );
    },
    error(...args) {
      if (!shouldLog(config, 'error')) return;
      getMethod('error')(
        `[Store ${formatTimestamp()}]`,
        `[Store Worker:${scope}]`,
        '[ERROR]',
        ...args.map(normalizeArg)
      );
    }
  };
}

function getConfig(env = {}) {
  return {
    consoleLoggingEnabled: getConsoleLoggingEnabled(env),
    verboseConsoleLogging: getVerboseConsoleLogging(env)
  };
}

export function getScopedConsole(env = {}, scope = 'worker') {
  if (!env || typeof env !== 'object') {
    return createScopedConsole(getConfig({}), scope);
  }

  let scopedCache = CONSOLE_CACHE.get(env);
  if (!scopedCache) {
    scopedCache = new Map();
    CONSOLE_CACHE.set(env, scopedCache);
  }

  const config = getConfig(env);
  const cacheKey = `${scope}:${config.consoleLoggingEnabled}:${config.verboseConsoleLogging}`;
  if (!scopedCache.has(cacheKey)) {
    scopedCache.set(cacheKey, createScopedConsole(config, scope));
  }
  return scopedCache.get(cacheKey);
}
