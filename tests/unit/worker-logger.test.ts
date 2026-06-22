import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('worker logger', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits logs by default', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { getScopedConsole } = await import('../../worker/src/logger.js');

    const logger = getScopedConsole({}, 'test');
    logger.log('hello');

    expect(logSpy).toHaveBeenCalled();
    expect(logSpy.mock.calls[0][1]).toBe('[Store Worker:test]');
    expect(logSpy.mock.calls[0][2]).toBe('[LOG]');
    expect(logSpy.mock.calls[0][3]).toBe('hello');
  });

  it('suppresses all worker console output when disabled', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getScopedConsole } = await import('../../worker/src/logger.js');

    const logger = getScopedConsole({
      DEBUG_CONSOLE_LOGGING_ENABLED: 'false',
      DEBUG_VERBOSE_CONSOLE_LOGGING: 'true'
    }, 'test');

    logger.log('hello');
    logger.error('boom');

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('suppresses low-severity worker logs when verbose logging is disabled', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getScopedConsole } = await import('../../worker/src/logger.js');

    const logger = getScopedConsole({
      DEBUG_CONSOLE_LOGGING_ENABLED: 'true',
      DEBUG_VERBOSE_CONSOLE_LOGGING: 'false'
    }, 'test');

    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][1]).toBe('[Store Worker:test]');
    expect(warnSpy.mock.calls[0][2]).toBe('[WARN]');
    expect(warnSpy.mock.calls[0][3]).toBe('warn');
  });

  it('normalizes worker Error objects into readable structured output', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getScopedConsole } = await import('../../worker/src/logger.js');

    const logger = getScopedConsole({}, 'test');
    logger.error(new Error('kaboom'));

    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls[0][1]).toBe('[Store Worker:test]');
    expect(errorSpy.mock.calls[0][2]).toBe('[ERROR]');
    expect(errorSpy.mock.calls[0][3]).toMatchObject({
      name: 'Error',
      message: 'kaboom'
    });
  });
});
