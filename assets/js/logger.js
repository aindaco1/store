(function() {
  'use strict';

  var GLOBAL_HANDLER_KEY = '__storeLoggerGlobalHandlersInstalled';

  function parseBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    return String(value).trim().toLowerCase() !== 'false';
  }

  function getInlineConfig() {
    var script = document.currentScript ||
      document.querySelector('script[data-store-logger-script]');
    var dataset = script && script.dataset ? script.dataset : {};
    return {
      consoleLoggingEnabled: parseBoolean(dataset.consoleLoggingEnabled, true),
      verboseConsoleLogging: parseBoolean(dataset.verboseConsoleLogging, true)
    };
  }

  function getConfig() {
    var inlineConfig = getInlineConfig();
    var storeConfig = window.STORE_CONFIG || window.StoreConfig || {};
    var debugConfig = storeConfig.debug || {};

    return {
      consoleLoggingEnabled: parseBoolean(debugConfig.consoleLoggingEnabled, inlineConfig.consoleLoggingEnabled),
      verboseConsoleLogging: parseBoolean(debugConfig.verboseConsoleLogging, inlineConfig.verboseConsoleLogging)
    };
  }

  function shouldLog(config, level) {
    if (!config.consoleLoggingEnabled) return false;
    if (!config.verboseConsoleLogging && (level === 'debug' || level === 'info' || level === 'log')) {
      return false;
    }
    return true;
  }

  function getConsoleMethod(level) {
    return console[level] ? level : 'log';
  }

  function formatTimestamp() {
    try {
      return new Date().toISOString();
    } catch (_error) {
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

  function emit(level, namespace, args) {
    var config = getConfig();
    if (!shouldLog(config, level)) return;

    var method = getConsoleMethod(level);
    var timestamp = '[Store ' + formatTimestamp() + ']';
    var scope = namespace ? '[Store:' + namespace + ']' : '[Store]';
    var severity = '[' + String(level || 'log').toUpperCase() + ']';
    var normalizedArgs = Array.prototype.slice.call(args || []).map(normalizeArg);
    console[method].apply(console, [timestamp, scope, severity].concat(normalizedArgs));
  }

  function createLogger(namespace) {
    return {
      child: function(childNamespace) {
        var resolved = namespace ? namespace + ':' + childNamespace : childNamespace;
        return createLogger(resolved);
      },
      debug: function() { emit('debug', namespace, arguments); },
      info: function() { emit('info', namespace, arguments); },
      log: function() { emit('log', namespace, arguments); },
      warn: function() { emit('warn', namespace, arguments); },
      error: function() { emit('error', namespace, arguments); }
    };
  }

  function installGlobalHandlers() {
    if (window[GLOBAL_HANDLER_KEY]) return;
    window[GLOBAL_HANDLER_KEY] = true;

    var logger = createLogger('window');

    window.addEventListener('error', function(event) {
      logger.error('Unhandled browser error', {
        message: event && event.message ? event.message : 'Unknown browser error',
        filename: event && event.filename ? event.filename : '',
        lineno: event && event.lineno ? event.lineno : 0,
        colno: event && event.colno ? event.colno : 0,
        error: event && event.error ? normalizeArg(event.error) : null
      });
    });

    window.addEventListener('unhandledrejection', function(event) {
      logger.error('Unhandled promise rejection', normalizeArg(event && event.reason));
    });
  }

  var storeLogger = {
    getConfig: getConfig,
    createLogger: createLogger,
    installGlobalHandlers: installGlobalHandlers
  };

  window.StoreLogger = storeLogger;

  installGlobalHandlers();
})();
