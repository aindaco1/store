import {
  DEFAULT_PLATFORM_TIME_ZONE,
  getSupportedTimeZones,
  getTimeZoneOptions,
  isSupportedTimeZone,
  normalizeTimeZone
} from './timezones.js';

export {
  DEFAULT_PLATFORM_TIME_ZONE,
  getSupportedTimeZones,
  getTimeZoneOptions,
  isSupportedTimeZone,
  normalizeTimeZone
};

const FORMATTER_CACHE = new Map();

function getFormatter(timeZone, options = {}) {
  const includeSeconds = options.includeSeconds !== false;
  const key = `${timeZone}:${includeSeconds ? 'seconds' : 'minutes'}`;
  if (FORMATTER_CACHE.has(key)) return FORMATTER_CACHE.get(key);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
    hourCycle: 'h23'
  });
  FORMATTER_CACHE.set(key, formatter);
  return formatter;
}

export function getPlatformTimeZone(env = {}) {
  return normalizeTimeZone(env?.PLATFORM_TIMEZONE);
}

export function getTimeZoneParts(date = new Date(), timeZone = DEFAULT_PLATFORM_TIME_ZONE) {
  const safeTimeZone = normalizeTimeZone(timeZone);
  const parts = getFormatter(safeTimeZone).formatToParts(date instanceof Date ? date : new Date(date));
  const map = Object.fromEntries(parts
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  const hour = Number(map.hour || 0) || 0;
  return {
    year: Number(map.year || 0) || 0,
    month: Number(map.month || 0) || 0,
    day: Number(map.day || 0) || 0,
    hour: hour === 24 ? 0 : hour,
    minute: Number(map.minute || 0) || 0,
    second: Number(map.second || 0) || 0,
    timeZone: safeTimeZone
  };
}

export function getPlatformTimeParts(env = {}, date = new Date()) {
  return getTimeZoneParts(date, getPlatformTimeZone(env));
}

export function getTimeZoneDateKey(date = new Date(), timeZone = DEFAULT_PLATFORM_TIME_ZONE) {
  const parts = getTimeZoneParts(date, timeZone);
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0')
  ].join('-');
}

export function getPlatformDateKey(env = {}, date = new Date()) {
  return getTimeZoneDateKey(date, getPlatformTimeZone(env));
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = getTimeZoneParts(date, timeZone);
  const localAsUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return localAsUtcMs - date.getTime();
}

export function dateAtTimeInTimeZone(dateString, timeZone = DEFAULT_PLATFORM_TIME_ZONE, hour = 0, minute = 0, second = 0) {
  const match = String(dateString || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date(NaN);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const safeTimeZone = normalizeTimeZone(timeZone);
  const localAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstGuess = new Date(localAsUtcMs);
  const firstOffset = getTimeZoneOffsetMs(firstGuess, safeTimeZone);
  const firstResult = new Date(localAsUtcMs - firstOffset);
  const correctedOffset = getTimeZoneOffsetMs(firstResult, safeTimeZone);
  return new Date(localAsUtcMs - correctedOffset);
}

function timeZoneFromEnvOrValue(envOrTimeZone = {}) {
  return typeof envOrTimeZone === 'string'
    ? normalizeTimeZone(envOrTimeZone)
    : getPlatformTimeZone(envOrTimeZone);
}

export function platformDateStart(dateString, envOrTimeZone = {}) {
  return dateAtTimeInTimeZone(dateString, timeZoneFromEnvOrValue(envOrTimeZone), 0, 0, 0);
}

export function platformDateEnd(dateString, envOrTimeZone = {}) {
  return dateAtTimeInTimeZone(dateString, timeZoneFromEnvOrValue(envOrTimeZone), 23, 59, 59);
}

export function isPlatformDatePast(dateString, envOrTimeZone = {}, now = new Date()) {
  const end = platformDateEnd(dateString, envOrTimeZone);
  return end instanceof Date && Number.isFinite(end.getTime()) && now > end;
}

export function formatInPlatformTimeZone(env = {}, date = new Date(), options = {}) {
  const timeZone = getPlatformTimeZone(env);
  const { locale = 'en-US', ...formatOptions } = options || {};
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    ...formatOptions
  }).format(date instanceof Date ? date : new Date(date));
}

export function isInPlatformDailyWindow(env = {}, date = new Date(), { hour = 0, minuteWindow = 5 } = {}) {
  const parts = getPlatformTimeParts(env, date);
  return parts.hour === hour && parts.minute >= 0 && parts.minute < minuteWindow;
}
